import { describe, it, expect } from 'vitest';
import { IdMapper } from '../../src/graph/id-mapper.js';
import type { RepoGraph, GraphNode } from '../../src/graph/types.js';
import { bfsTraverse } from '../../src/graph/bfs.js';

function makeGraph(edges: Array<[string, string, 'CALLS' | 'IMPORTS']>): RepoGraph {
  const mapper = new IdMapper();
  const nodes = new Map<number, GraphNode>();

  const getOrCreate = (uuid: string) => {
    const id = mapper.intern(uuid);
    if (!nodes.has(id)) nodes.set(id, { outgoing: [], incoming: [] });
    return id;
  };

  for (const [src, tgt, type] of edges) {
    const srcId = getOrCreate(src);
    const tgtId = getOrCreate(tgt);
    nodes.get(srcId)!.outgoing.push({ targetId: tgtId, type, confidence: 1.0 });
    nodes.get(tgtId)!.incoming.push({ targetId: srcId, type, confidence: 1.0 });
  }

  return { nodes, mapper, fileIndex: new Map() };
}

describe('bfsTraverse', () => {
  it('traverses outgoing edges up to maxDepth=3', () => {
    const g = makeGraph([['A', 'B', 'CALLS'], ['B', 'C', 'CALLS'], ['C', 'D', 'CALLS']]);
    const startId = g.mapper.intern('A');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    const depths = Object.fromEntries(results.map((r) => [g.mapper.resolve(r.symbolId), r.depth]));
    expect(depths['B']).toBe(1);
    expect(depths['C']).toBe(2);
    expect(depths['D']).toBe(3);
    expect(results.length).toBe(3);
  });

  it('traverses incoming edges (callers)', () => {
    const g = makeGraph([['A', 'B', 'CALLS'], ['C', 'B', 'CALLS']]);
    const startId = g.mapper.intern('B');
    const results = bfsTraverse(g, startId, 'incoming', 1);
    const names = results.map((r) => g.mapper.resolve(r.symbolId)).sort();
    expect(names).toEqual(['A', 'C']);
  });

  it('excludes self-loops (start node not in results)', () => {
    const g = makeGraph([['A', 'A', 'CALLS']]);
    const startId = g.mapper.intern('A');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    expect(results.length).toBe(0);
  });

  it('handles cycles without infinite loop', () => {
    const g = makeGraph([['A', 'B', 'CALLS'], ['B', 'A', 'CALLS']]);
    const startId = g.mapper.intern('A');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    expect(results.length).toBe(1);
    expect(g.mapper.resolve(results[0]!.symbolId)).toBe('B');
  });

  it('returns empty array for node with no outgoing edges', () => {
    const g = makeGraph([['A', 'B', 'CALLS']]);
    const startId = g.mapper.intern('B');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    expect(results.length).toBe(0);
  });
});
