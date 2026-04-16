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
