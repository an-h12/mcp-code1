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
