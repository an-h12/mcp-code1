# Plan 5d: 5 New MCP Tools + ContextEnricher

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Run **after Plans 5a, 5c**.

**Goal:** Add 5 new MCP tools (`get_symbol_context`, `get_impact_analysis`, `find_callers`, `find_callees`, `get_import_chain`) and implement `ContextEnricher` (Tầng 2 forced pre-fetch context injection).

**Architecture:** All 5 tools use `InMemoryGraph` BFS + DB lookups. `repoId` is NOT a parameter — it comes from `McpServerOptions` (process-level constant). `ContextEnricher` intercepts user messages, extracts symbol mentions, resolves via DB, does BFS, and assembles an enriched prompt prefix. Wire new tools into the existing `registerToolHandlers` and add zod schemas.

**Tech Stack:** `@modelcontextprotocol/sdk`, zod, better-sqlite3, `InMemoryGraph`, `bfsTraverse`.

**Key constraint:** `McpServerOptions` must be extended with `graph: InMemoryGraph` and `repoId: string`.

---

## Chunk 1: Extend McpServerOptions + new zod schemas

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/server.ts` | Add `graph: InMemoryGraph` and `repoId: string` to `McpServerOptions` |
| `src/mcp/tool-schemas.ts` | Add 5 new zod schemas |

---

### Task 1: Extend options + schemas

- [ ] **Step 1: Update McpServerOptions in server.ts**

Edit `src/mcp/server.ts` — add to imports:
```typescript
import type { InMemoryGraph } from '../graph/in-memory-graph.js';
```

Update `McpServerOptions` type:
```typescript
export type McpServerOptions = {
  db: Db;
  registry: RepoRegistry;
  indexer: Indexer;
  aiConfig: AiConfig | null;
  graph: InMemoryGraph;
  repoId: string;
};
```

- [ ] **Step 2: Add 5 zod schemas to tool-schemas.ts**

Edit `src/mcp/tool-schemas.ts` — append at bottom:

```typescript
export const GetSymbolContextSchema = z.object({
  symbol_name: z.string().min(1),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(2),
});

export const GetImpactAnalysisSchema = z.object({
  symbol_name: z.string().min(1),
});

export const FindCallersSchema = z.object({
  symbol_name: z.string().min(1),
});

export const FindCalleesSchema = z.object({
  symbol_name: z.string().min(1),
});

export const GetImportChainSchema = z.object({
  file_path: z.string().min(1),
  depth: z.number().int().min(1).max(5).optional().default(3),
});
```

- [ ] **Step 3: Add 5 tool definitions to TOOL_DEFINITIONS in src/mcp/tools/index.ts**

Append these 5 entries to `TOOL_DEFINITIONS`:

```typescript
{
  name: 'get_symbol_context',
  description: 'Get callers, callees, and impact for a symbol (BFS depth 1-3).',
  inputSchema: {
    type: 'object',
    properties: {
      symbol_name: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 3, default: 2 },
    },
    required: ['symbol_name'],
  },
},
{
  name: 'get_impact_analysis',
  description: 'Get depth-1/2/3 blast radius for a symbol.',
  inputSchema: {
    type: 'object',
    properties: { symbol_name: { type: 'string' } },
    required: ['symbol_name'],
  },
},
{
  name: 'find_callers',
  description: 'Find all symbols that call the given symbol.',
  inputSchema: {
    type: 'object',
    properties: { symbol_name: { type: 'string' } },
    required: ['symbol_name'],
  },
},
{
  name: 'find_callees',
  description: 'Find all symbols called by the given symbol.',
  inputSchema: {
    type: 'object',
    properties: { symbol_name: { type: 'string' } },
    required: ['symbol_name'],
  },
},
{
  name: 'get_import_chain',
  description: 'Get the import dependency chain for a file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
    },
    required: ['file_path'],
  },
},
```

- [ ] **Step 4: Build check**

```bash
npx tsc --noEmit
```

Expected: 0 errors (McpServer constructor call in app.ts will need updating — handled in Plan 5e).

---

## Chunk 2: 5 new MCP tool implementations

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/tools/get-symbol-context.ts` | BFS depth-2 callers+callees for a symbol |
| `src/mcp/tools/get-impact-analysis.ts` | Depth 1/2/3 blast radius |
| `src/mcp/tools/find-callers.ts` | Incoming BFS depth-1 |
| `src/mcp/tools/find-callees.ts` | Outgoing BFS depth-1 |
| `src/mcp/tools/get-import-chain.ts` | IMPORTS edge traversal for a file |
| `tests/mcp/tools/graph-tools.test.ts` | Integration tests with seeded graph |

---

### Task 2: Implement the 5 tools

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/tools/graph-tools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';

function seedGraphDb(db: ReturnType<typeof openDb>) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t','/t')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','alpha','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','beta','function',7,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language)
     VALUES ('rel1','r1','s1','s2','beta','CALLS','typescript')`,
  ).run();
}

describe('graph tools — DB integration', () => {
  it('InMemoryGraph loads edges and derives incoming', () => {
    const db = openDb(':memory:');
    seedGraphDb(db);
    const graph = new InMemoryGraph(db);
    const g = graph.getGraph('r1');
    const s1int = g.mapper.intern('s1');
    const s2int = g.mapper.intern('s2');
    // s1 has 1 outgoing (to s2)
    expect(g.nodes.get(s1int)?.outgoing.length).toBe(1);
    // s2 has 1 incoming (from s1)
    expect(g.nodes.get(s2int)?.incoming.length).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test — expect PASS (InMemoryGraph already implemented)**

```bash
npx vitest run tests/mcp/tools/graph-tools.test.ts
```

Expected: PASS.

- [ ] **Step 3: Implement get-symbol-context.ts**

Create `src/mcp/tools/get-symbol-context.ts`:

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export function getSymbolContext(
  db: Db,
  graph: InMemoryGraph,
  repoId: string,
  symbolName: string,
  depth: 1 | 2 | 3 = 2,
) {
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.kind, f.rel_path, s.start_line
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.name = ? AND s.repo_id = ? LIMIT 1`,
    )
    .get(symbolName, repoId) as
    | { id: string; name: string; kind: string; rel_path: string; start_line: number }
    | undefined;

  if (!row) return null;

  const g = graph.getGraph(repoId);
  const intId = g.mapper.intern(row.id);

  const callerRaw = bfsTraverse(g, intId, 'incoming', depth);
  const calleeRaw = bfsTraverse(g, intId, 'outgoing', depth);

  const allUuids = [
    ...callerRaw.map((r) => g.mapper.resolve(r.symbolId)),
    ...calleeRaw.map((r) => g.mapper.resolve(r.symbolId)),
  ];

  const nameMap = allUuids.length
    ? new Map(
        (
          db
            .prepare(
              `SELECT s.id, s.name, f.rel_path, s.start_line
               FROM symbols s JOIN files f ON f.id = s.file_id
               WHERE s.id IN (${allUuids.map(() => '?').join(',')})`,
            )
            .all(...allUuids) as Array<{ id: string; name: string; rel_path: string; start_line: number }>
        ).map((r) => [r.id, r]),
      )
    : new Map<string, { name: string; rel_path: string; start_line: number }>();

  const callers = callerRaw.map((r) => {
    const uuid = g.mapper.resolve(r.symbolId);
    const info = nameMap.get(uuid);
    return { symbolId: uuid, name: info?.name ?? uuid, filePath: info?.rel_path ?? '', line: info?.start_line ?? 0, depth: r.depth, via: r.via };
  });

  const callees = calleeRaw.map((r) => {
    const uuid = g.mapper.resolve(r.symbolId);
    const info = nameMap.get(uuid);
    return { symbolId: uuid, name: info?.name ?? uuid, filePath: info?.rel_path ?? '', line: info?.start_line ?? 0, depth: r.depth, via: r.via };
  });

  return {
    symbol: { id: row.id, name: row.name, kind: row.kind, filePath: row.rel_path, line: row.start_line },
    callers,
    callees,
    impactCount: callers.length + callees.length,
    resolvedAs: row.name,
  };
}
```

- [ ] **Step 4: Implement get-impact-analysis.ts**

Create `src/mcp/tools/get-impact-analysis.ts`:

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export function getImpactAnalysis(db: Db, graph: InMemoryGraph, repoId: string, symbolName: string) {
  const row = db
    .prepare(`SELECT id FROM symbols WHERE name = ? AND repo_id = ? LIMIT 1`)
    .get(symbolName, repoId) as { id: string } | undefined;

  if (!row) return null;

  const g = graph.getGraph(repoId);
  const intId = g.mapper.intern(row.id);

  const getNames = (intIds: number[]) => {
    const uuids = intIds.map((i) => g.mapper.resolve(i));
    if (!uuids.length) return [];
    return (
      db
        .prepare(`SELECT name FROM symbols WHERE id IN (${uuids.map(() => '?').join(',')})`)
        .all(...uuids) as Array<{ name: string }>
    ).map((r) => r.name);
  };

  const d1 = bfsTraverse(g, intId, 'outgoing', 1);
  const d2 = bfsTraverse(g, intId, 'outgoing', 2).filter((r) => r.depth === 2);
  const d3 = bfsTraverse(g, intId, 'outgoing', 3).filter((r) => r.depth === 3);

  return {
    symbol: symbolName,
    resolvedAs: symbolName,
    depth1: getNames(d1.map((r) => r.symbolId)),
    depth2: getNames(d2.map((r) => r.symbolId)),
    depth3: getNames(d3.map((r) => r.symbolId)),
    totalCount: d1.length + d2.length + d3.length,
  };
}
```

- [ ] **Step 5: Implement find-callers.ts**

Create `src/mcp/tools/find-callers.ts`:

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export function findCallers(db: Db, graph: InMemoryGraph, repoId: string, symbolName: string) {
  const row = db
    .prepare(`SELECT id FROM symbols WHERE name = ? AND repo_id = ? LIMIT 1`)
    .get(symbolName, repoId) as { id: string } | undefined;

  if (!row) return null;

  const g = graph.getGraph(repoId);
  const intId = g.mapper.intern(row.id);
  const raw = bfsTraverse(g, intId, 'incoming', 1);
  const uuids = raw.map((r) => g.mapper.resolve(r.symbolId));

  if (!uuids.length) return { callers: [], resolvedAs: symbolName };

  const callers = (
    db
      .prepare(
        `SELECT s.id, s.name, f.rel_path, s.start_line
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.id IN (${uuids.map(() => '?').join(',')})`,
      )
      .all(...uuids) as Array<{ id: string; name: string; rel_path: string; start_line: number }>
  ).map((r) => ({ symbolId: r.id, name: r.name, filePath: r.rel_path, line: r.start_line }));

  return { callers, resolvedAs: symbolName };
}
```

- [ ] **Step 6: Implement find-callees.ts**

Create `src/mcp/tools/find-callees.ts`:

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export function findCallees(db: Db, graph: InMemoryGraph, repoId: string, symbolName: string) {
  const row = db
    .prepare(`SELECT id FROM symbols WHERE name = ? AND repo_id = ? LIMIT 1`)
    .get(symbolName, repoId) as { id: string } | undefined;

  if (!row) return null;

  const g = graph.getGraph(repoId);
  const intId = g.mapper.intern(row.id);
  const raw = bfsTraverse(g, intId, 'outgoing', 1);
  const uuids = raw.map((r) => g.mapper.resolve(r.symbolId));

  if (!uuids.length) return { callees: [], resolvedAs: symbolName };

  const callees = (
    db
      .prepare(
        `SELECT s.id, s.name, f.rel_path, s.start_line
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.id IN (${uuids.map(() => '?').join(',')})`,
      )
      .all(...uuids) as Array<{ id: string; name: string; rel_path: string; start_line: number }>
  ).map((r) => ({ symbolId: r.id, name: r.name, filePath: r.rel_path, line: r.start_line }));

  return { callees, resolvedAs: symbolName };
}
```

- [ ] **Step 7: Implement get-import-chain.ts**

Create `src/mcp/tools/get-import-chain.ts`:

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export function getImportChain(db: Db, graph: InMemoryGraph, repoId: string, filePath: string, depth = 3) {
  // Find all symbols in this file
  const fileRow = db
    .prepare(`SELECT id FROM files WHERE rel_path = ? AND repo_id = ? LIMIT 1`)
    .get(filePath, repoId) as { id: string } | undefined;

  if (!fileRow) return null;

  const g = graph.getGraph(repoId);
  const fileIntIds = g.fileIndex.get(fileRow.id) ?? [];

  // Collect all IMPORTS edges from this file's symbols
  const chain: Array<{ file: string; imports: string[] }> = [];
  const visited = new Set<string>([filePath]);
  const queue: Array<{ fileId: string; relPath: string; depth: number }> = [
    { fileId: fileRow.id, relPath: filePath, depth: 0 },
  ];

  while (queue.length > 0) {
    const { fileId, relPath, depth: d } = queue.shift()!;
    if (d >= depth) continue;

    const fileSymIntIds = g.fileIndex.get(fileId) ?? [];
    const importedPaths: string[] = [];

    for (const intId of fileSymIntIds) {
      const node = g.nodes.get(intId);
      if (!node) continue;
      for (const edge of node.outgoing) {
        if (edge.type !== 'IMPORTS') continue;
        const uuid = g.mapper.resolve(edge.targetId);
        const targetRow = db
          .prepare(`SELECT f.rel_path, s.file_id FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ? LIMIT 1`)
          .get(uuid) as { rel_path: string; file_id: string } | undefined;
        if (!targetRow || visited.has(targetRow.rel_path)) continue;
        visited.add(targetRow.rel_path);
        importedPaths.push(targetRow.rel_path);
        queue.push({ fileId: targetRow.file_id, relPath: targetRow.rel_path, depth: d + 1 });
      }
    }

    if (importedPaths.length) {
      chain.push({ file: relPath, imports: importedPaths });
    }
  }

  void fileIntIds; // suppress unused warning
  return { chain, resolvedAs: filePath };
}
```

- [ ] **Step 8: Wire new tools into registerToolHandlers in src/mcp/tools/index.ts**

Add imports at top:
```typescript
import { getSymbolContext } from './get-symbol-context.js';
import { getImpactAnalysis } from './get-impact-analysis.js';
import { findCallers } from './find-callers.js';
import { findCallees } from './find-callees.js';
import { getImportChain } from './get-import-chain.js';
import {
  // ... existing schemas plus:
  GetSymbolContextSchema,
  GetImpactAnalysisSchema,
  FindCallersSchema,
  FindCalleesSchema,
  GetImportChainSchema,
} from '../tool-schemas.js';
```

In the `switch (name)` block, add before `default:`:
```typescript
case 'get_symbol_context': {
  const p = GetSymbolContextSchema.parse(args);
  const result = getSymbolContext(opts.db, opts.graph, opts.repoId, p.symbol_name, p.depth);
  if (!result) return { content: [{ type: 'text', text: `Symbol not found: ${p.symbol_name}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
case 'get_impact_analysis': {
  const p = GetImpactAnalysisSchema.parse(args);
  const result = getImpactAnalysis(opts.db, opts.graph, opts.repoId, p.symbol_name);
  if (!result) return { content: [{ type: 'text', text: `Symbol not found: ${p.symbol_name}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
case 'find_callers': {
  const p = FindCallersSchema.parse(args);
  const result = findCallers(opts.db, opts.graph, opts.repoId, p.symbol_name);
  if (!result) return { content: [{ type: 'text', text: `Symbol not found: ${p.symbol_name}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
case 'find_callees': {
  const p = FindCalleesSchema.parse(args);
  const result = findCallees(opts.db, opts.graph, opts.repoId, p.symbol_name);
  if (!result) return { content: [{ type: 'text', text: `Symbol not found: ${p.symbol_name}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
case 'get_import_chain': {
  const p = GetImportChainSchema.parse(args);
  const result = getImportChain(opts.db, opts.graph, opts.repoId, p.file_path, p.depth);
  if (!result) return { content: [{ type: 'text', text: `File not found: ${p.file_path}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
```

- [ ] **Step 9: Build + full tests**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: 0 errors, all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/mcp/tools/get-symbol-context.ts src/mcp/tools/get-impact-analysis.ts src/mcp/tools/find-callers.ts src/mcp/tools/find-callees.ts src/mcp/tools/get-import-chain.ts src/mcp/tools/index.ts src/mcp/tool-schemas.ts src/mcp/server.ts tests/mcp/tools/graph-tools.test.ts
git commit -m "feat: add 5 graph-aware MCP tools (symbol context, impact, callers, callees, import chain)"
```

---

## Chunk 3: ContextEnricher (Tầng 2)

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/context-enricher.ts` | Mention extraction, symbol resolution, BFS, prompt assembly |
| `tests/mcp/context-enricher.test.ts` | extractMentions, resolveSymbols, assembleContext |

---

### Task 3: ContextEnricher

- [ ] **Step 1: Write failing tests**

Create `tests/mcp/context-enricher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import { ContextEnricher } from '../../src/mcp/context-enricher.js';

describe('ContextEnricher', () => {
  it('extractMentions finds backtick symbols', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const mentions = ce.extractMentions('Can you explain `processOrder` and `validateCart`?');
    expect(mentions).toContain('processOrder');
    expect(mentions).toContain('validateCart');
    db.close();
  });

  it('extractMentions finds PascalCase symbols', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const mentions = ce.extractMentions('How does OrderProcessor interact with PaymentGateway?');
    expect(mentions).toContain('OrderProcessor');
    expect(mentions).toContain('PaymentGateway');
    db.close();
  });

  it('extractMentions deduplicates', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    // 'processOrder' matches both backtick and PascalCase if camel — but let's test exact dedup
    const mentions = ce.extractMentions('`foo` and `foo` again');
    expect(mentions.filter((m) => m === 'foo').length).toBe(1);
    db.close();
  });

  it('extractMentions caps at 5 symbols', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const msg = '`a` `b` `c` `d` `e` `f` `g`';
    const mentions = ce.extractMentions(msg);
    expect(mentions.length).toBeLessThanOrEqual(5);
    db.close();
  });

  it('enrich returns enrichedPrompt containing original message', async () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t','/t')`).run();
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const result = await ce.enrich('How does foo work?');
    expect(result.enrichedPrompt).toContain('How does foo work?');
    db.close();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/mcp/context-enricher.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement ContextEnricher**

Create `src/mcp/context-enricher.ts`:

```typescript
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
      } catch (err) {
        // Skip symbols that fail (e.g. orphaned edge race)
      }
    }

    return this.assembleContext(symbolContexts, userMessage);
  }

  extractMentions(message: string): string[] {
    const raw = [
      ...message.matchAll(/`([A-Za-z_][A-Za-z0-9_.]*)`/g),
      ...message.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g),
      ...message.matchAll(/hàm\s+([A-Za-z_]\w*)/g),
      ...message.matchAll(/function\s+([A-Za-z_]\w*)/g),
      ...message.matchAll(/([A-Za-z0-9_/.-]+\.[a-z]{2,4})/g),
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/mcp/context-enricher.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Full build + suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: 0 errors, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/context-enricher.ts tests/mcp/context-enricher.test.ts
git commit -m "feat: add ContextEnricher (Tầng 2 forced pre-fetch context injection)"
```
