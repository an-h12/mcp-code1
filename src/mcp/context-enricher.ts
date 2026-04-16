import type { Db } from '../db/index.js';
import type { InMemoryGraph } from '../graph/in-memory-graph.js';
import { bfsTraverse } from '../graph/bfs.js';
import type { EdgeType, SymbolContext, EnrichedContext } from '../graph/types.js';

const IMPACT_WARN_THRESHOLD = 10;

const TOKEN_BUDGET = {
  maxSymbols: 5,
  maxCallersPerSymbol: 5,
  maxCalleesPerSymbol: 5,
  maxTotalTokens: 2000,
};

type ResolvedSymbol = {
  id: string;
  name: string;
  filePath: string;
  repoId: string;
};

export class ContextEnricher {
  constructor(
    private readonly repoId: string,
    private readonly db: Db,
    private readonly graph: InMemoryGraph,
  ) {}

  async enrich(userMessage: string): Promise<EnrichedContext> {
    const mentions = this.extractMentions(userMessage);
    const resolvedSymbols = await this.resolveSymbols(mentions);

    const symbolContexts: SymbolContext[] = [];
    for (const s of resolvedSymbols) {
      try {
        symbolContexts.push(this.fetchSymbolContext(s.id, s.repoId));
      } catch {
        // Skip symbols that fail (e.g. orphaned edge race)
      }
    }

    return this.assembleContext(symbolContexts, userMessage);
  }

  extractMentions(message: string): string[] {
    // Strip URLs and emails before matching to avoid false-positive "file" mentions
    const cleaned = message
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ');

    const raw = [
      ...cleaned.matchAll(/`([A-Za-z_][A-Za-z0-9_.]*)`/g),
      ...cleaned.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g),
      ...cleaned.matchAll(/hàm\s+([A-Za-z_]\w*)/g),
      ...cleaned.matchAll(/function\s+([A-Za-z_]\w*)/g),
      // File paths: require a path separator before the filename (avoids version/domain)
      ...cleaned.matchAll(/[/\\]([A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|cs|java|cpp|c|h|hpp))\b/g),
    ].map((m) => m[1] as string);

    return [...new Set(raw)].slice(0, TOKEN_BUDGET.maxSymbols);
  }

  private async resolveSymbols(names: string[]): Promise<ResolvedSymbol[]> {
    const results: ResolvedSymbol[] = [];
    for (const name of names.slice(0, TOKEN_BUDGET.maxSymbols)) {
      let row = this.db
        .prepare(
          `SELECT s.id, s.name, f.rel_path as file_path, s.repo_id
           FROM symbols s JOIN files f ON f.id = s.file_id
           WHERE s.name = ? AND s.repo_id = ? LIMIT 1`,
        )
        .get(name, this.repoId) as
        | { id: string; name: string; file_path: string; repo_id: string }
        | undefined;

      if (!row) {
        try {
          const safeName = `"${name.replace(/"/g, '""')}"`;
          row = this.db
            .prepare(
              `SELECT s.id, s.name, f.rel_path as file_path, s.repo_id
               FROM symbols_fts fts
               JOIN symbols s ON s.rowid = fts.rowid
               JOIN files f ON f.id = s.file_id
               WHERE symbols_fts MATCH ? AND s.repo_id = ?
               ORDER BY rank LIMIT 1`,
            )
            .get(safeName, this.repoId) as typeof row;
        } catch {
          // FTS syntax error — skip fuzzy fallback
        }
      }

      if (row) {
        results.push({ id: row.id, name: row.name, filePath: row.file_path, repoId: row.repo_id });
      }
    }
    return results;
  }

  private fetchSymbolContext(symbolUuid: string, repoId: string): SymbolContext {
    const g = this.graph.getGraph(repoId);
    const intId = g.mapper.intern(symbolUuid);

    const callerRaw = bfsTraverse(g, intId, 'incoming', 2);
    const calleeRaw = bfsTraverse(g, intId, 'outgoing', 2);

    const allUuids = [
      ...callerRaw.map((r) => g.mapper.resolve(r.symbolId)),
      ...calleeRaw.map((r) => g.mapper.resolve(r.symbolId)),
    ];

    const CHUNK = 500;
    const nameMap = new Map<string, { name: string; kind: string; filePath: string }>();
    for (let i = 0; i < allUuids.length; i += CHUNK) {
      const batch = allUuids.slice(i, i + CHUNK);
      const rows = this.db
        .prepare(
          `SELECT s.id, s.name, s.kind, f.rel_path as file_path
           FROM symbols s JOIN files f ON f.id = s.file_id
           WHERE s.id IN (${batch.map(() => '?').join(',')})`,
        )
        .all(...batch) as Array<{ id: string; name: string; kind: string; file_path: string }>;
      rows.forEach((r) => nameMap.set(r.id, { name: r.name, kind: r.kind, filePath: r.file_path }));
    }

    const callers = callerRaw.map((r) => {
      const uuid = g.mapper.resolve(r.symbolId);
      return { symbolId: uuid, name: nameMap.get(uuid)?.name ?? uuid, depth: r.depth, via: r.via as EdgeType };
    });
    const callees = calleeRaw.map((r) => {
      const uuid = g.mapper.resolve(r.symbolId);
      return { symbolId: uuid, name: nameMap.get(uuid)?.name ?? uuid, depth: r.depth, via: r.via as EdgeType };
    });

    const own = this.db
      .prepare(
        `SELECT s.name, s.kind, f.rel_path, s.start_line
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.id = ?`,
      )
      .get(symbolUuid) as { name: string; kind: string; rel_path: string; start_line: number } | undefined;

    return {
      symbolUuid,
      name: own?.name ?? symbolUuid,
      kind: own?.kind ?? 'unknown',
      filePath: own?.rel_path ?? '',
      line: own?.start_line ?? 0,
      callers,
      callees,
    };
  }

  assembleContext(symbolContexts: SymbolContext[], userMessage: string): EnrichedContext {
    const sorted = [...symbolContexts].sort(
      (a, b) => b.callers.length + b.callees.length - (a.callers.length + a.callees.length),
    );

    const sections: string[] = [];
    let tokenCount = 0;

    for (const ctx of sorted) {
      if (tokenCount >= TOKEN_BUDGET.maxTotalTokens) break;

      const callerNames = ctx.callers
        .slice(0, TOKEN_BUDGET.maxCallersPerSymbol)
        .map((c) => `\`${c.name}\``);
      const calleeNames = ctx.callees
        .slice(0, TOKEN_BUDGET.maxCalleesPerSymbol)
        .map((c) => `\`${c.name}\``);
      const impactCount = ctx.callers.length + ctx.callees.length;
      const impactWarn =
        impactCount >= IMPACT_WARN_THRESHOLD
          ? `⚠️ **Impact warning:** Changing this affects ${impactCount} symbols\n`
          : '';

      const section = [
        `### \`${ctx.name}\` (${ctx.kind}) — ${ctx.filePath}:${ctx.line}`,
        callerNames.length ? `**Called by:** ${callerNames.join(', ')}` : '',
        calleeNames.length ? `**Calls:** ${calleeNames.join(', ')}` : '',
        impactWarn,
      ]
        .filter(Boolean)
        .join('\n');

      sections.push(section);
      tokenCount += Math.ceil(section.length / 4);
    }

    const prompt =
      sections.length > 0
        ? `## Code Context\n\n${sections.join('\n\n---\n\n')}\n\n---\n${userMessage}`
        : userMessage;

    return { enrichedPrompt: prompt, symbolCount: sorted.length, tokenCount };
  }
}
