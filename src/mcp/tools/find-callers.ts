import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export type FindCallersParams = {
  symbolName: string;
  repoId: string | null;
  depth: 1 | 2 | 3;
};

export function findCallers(
  db: Db,
  graph: InMemoryGraph,
  defaultRepoId: string,
  params: FindCallersParams,
) {
  const repoId = params.repoId ?? defaultRepoId;

  const row = db
    .prepare(
      `SELECT s.id, s.name, s.kind, f.rel_path, s.start_line
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.name = ? AND s.repo_id = ? LIMIT 1`,
    )
    .get(params.symbolName, repoId) as
    | { id: string; name: string; kind: string; rel_path: string; start_line: number }
    | undefined;

  if (!row) return null;

  const g = graph.getGraph(repoId);
  const intId = g.mapper.intern(row.id);
  const callerRaw = bfsTraverse(g, intId, 'incoming', params.depth);

  const allUuids = callerRaw.map((r) => g.mapper.resolve(r.symbolId));
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

  return {
    symbol: { id: row.id, name: row.name, kind: row.kind, filePath: row.rel_path, line: row.start_line },
    callers,
    blastRadius: callers.length,
  };
}
