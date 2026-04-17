import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export type FindReferencesParams = {
  symbolName: string;
  repoId: string | null;
};

export type ReferenceResult = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
  referenceType: 'definition' | 'caller';
};

type Row = {
  id: string;
  name: string;
  kind: string;
  repo_id: string;
  rel_path: string;
  start_line: number;
};

export function findReferences(
  db: Db,
  params: FindReferencesParams,
  graph?: InMemoryGraph,
  defaultRepoId?: string,
): ReferenceResult[] {
  const args: unknown[] = [params.symbolName];
  const repoFilter = params.repoId ? `AND s.repo_id = ?` : '';
  if (params.repoId) args.push(params.repoId);

  // 1. DB lookup — definitions matching exact name
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.name = ? ${repoFilter}
       ORDER BY f.rel_path, s.start_line
       LIMIT 200`,
    )
    .all(...args) as Row[];

  const results: ReferenceResult[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    repoId: r.repo_id,
    filePath: r.rel_path,
    startLine: r.start_line,
    referenceType: 'definition' as const,
  }));

  // 2. Call graph lookup — who calls this symbol (incoming edges, depth=1)
  if (graph && rows.length > 0) {
    const repoId = params.repoId ?? defaultRepoId;
    if (repoId) {
      const seen = new Set(results.map((r) => r.id));
      try {
        const g = graph.getGraph(repoId);

        for (const defRow of rows) {
          if (defRow.repo_id !== repoId) continue;
          const intId = g.mapper.intern(defRow.id);
          const callers = bfsTraverse(g, intId, 'incoming', 1);

          if (callers.length === 0) continue;
          const callerUuids = callers.map((c) => g.mapper.resolve(c.symbolId));
          const newUuids = callerUuids.filter((u) => !seen.has(u));
          if (newUuids.length === 0) continue;

          const callerRows = db
            .prepare(
              `SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line
               FROM symbols s JOIN files f ON f.id = s.file_id
               WHERE s.id IN (${newUuids.map(() => '?').join(',')})`,
            )
            .all(...newUuids) as Row[];

          for (const cr of callerRows) {
            if (seen.has(cr.id)) continue;
            seen.add(cr.id);
            results.push({
              id: cr.id,
              name: cr.name,
              kind: cr.kind,
              repoId: cr.repo_id,
              filePath: cr.rel_path,
              startLine: cr.start_line,
              referenceType: 'caller',
            });
          }
        }
      } catch {
        // graph not ready yet — return DB-only results
      }
    }
  }

  return results;
}
