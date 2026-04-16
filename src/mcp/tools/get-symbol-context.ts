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
        ).map((r) => [r.id, r] as const),
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
