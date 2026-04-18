import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export type GetImpactAnalysisParams = {
  symbolName: string;
  repoId: string | null;
};

type SymbolInfo = { symbolId: string; name: string; filePath: string; line: number; via: string };

export function getImpactAnalysis(
  db: Db,
  graph: InMemoryGraph,
  defaultRepoId: string,
  params: GetImpactAnalysisParams,
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

  const d1Raw = bfsTraverse(g, intId, 'incoming', 1);
  const d2Raw = bfsTraverse(g, intId, 'incoming', 2);
  const d3Raw = bfsTraverse(g, intId, 'incoming', 3);

  const d1Map = new Map(d1Raw.map((r) => [g.mapper.resolve(r.symbolId), r.via]));
  const d2Map = new Map(d2Raw.map((r) => [g.mapper.resolve(r.symbolId), r.via]));
  const d3Map = new Map(d3Raw.map((r) => [g.mapper.resolve(r.symbolId), r.via]));

  const directUuids = [...d1Map.entries()];
  const indirectUuids = [...d2Map.entries()].filter(([uuid]) => !d1Map.has(uuid));
  const transitiveUuids = [...d3Map.entries()].filter(([uuid]) => !d2Map.has(uuid));

  const allUuids = [...d3Map.keys()];
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

  const toSymbolInfo = ([uuid, via]: [string, string]): SymbolInfo => {
    const info = nameMap.get(uuid);
    return { symbolId: uuid, name: info?.name ?? uuid, filePath: info?.rel_path ?? '', line: info?.start_line ?? 0, via };
  };

  const direct = directUuids.map(toSymbolInfo);
  const indirect = indirectUuids.map(toSymbolInfo);
  const transitive = transitiveUuids.map(toSymbolInfo);

  const risk = direct.length < 4 ? 'LOW' : direct.length < 10 ? 'MEDIUM' : 'HIGH';

  return {
    symbol: { id: row.id, name: row.name, kind: row.kind, filePath: row.rel_path, line: row.start_line },
    risk: risk as 'LOW' | 'MEDIUM' | 'HIGH',
    direct: { symbols: direct, count: direct.length },
    indirect: { symbols: indirect, count: indirect.length },
    transitive: { symbols: transitive, count: transitive.length },
    totalImpact: d3Map.size,
  };
}
