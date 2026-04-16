import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';

export function getImportChain(db: Db, graph: InMemoryGraph, repoId: string, filePath: string, depth = 3) {
  const fileRow = db
    .prepare(`SELECT id FROM files WHERE rel_path = ? AND repo_id = ? LIMIT 1`)
    .get(filePath, repoId) as { id: string } | undefined;

  if (!fileRow) return null;

  const g = graph.getGraph(repoId);

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
          .prepare(
            `SELECT f.rel_path, s.file_id FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ? LIMIT 1`,
          )
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

  return { chain, resolvedAs: filePath };
}
