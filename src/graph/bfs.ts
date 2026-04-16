import type { RepoGraph, TraversalResult, IntId } from './types.js';

export function bfsTraverse(
  graph: RepoGraph,
  startId: IntId,
  direction: 'outgoing' | 'incoming',
  maxDepth: number = 3,
): TraversalResult[] {
  const visited = new Set<IntId>([startId]);
  const queue: Array<{ id: IntId; depth: number }> = [{ id: startId, depth: 0 }];
  const results: TraversalResult[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const node = graph.nodes.get(id);
    if (!node) continue;

    for (const edge of node[direction]) {
      if (visited.has(edge.targetId)) continue;
      visited.add(edge.targetId);
      results.push({ symbolId: edge.targetId, depth: depth + 1, via: edge.type });
      queue.push({ id: edge.targetId, depth: depth + 1 });
    }
  }

  return results;
}
