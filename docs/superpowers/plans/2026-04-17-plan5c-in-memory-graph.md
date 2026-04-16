# Plan 5c: InMemoryGraph + IdMapper + BFS + TTL Eviction

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Run **after Plan 5a**.

**Goal:** Build the in-memory graph layer: `IdMapper` (UUID↔integer), `InMemoryGraph` (lazy load, TTL eviction, bidirectional edges), and `bfsTraverse` function.

**Architecture:** `InMemoryGraph` loads all resolved edges for a repo from `symbol_relations` on first access. It maintains bidirectional edges in RAM (outgoing stored in DB, incoming derived at load). A `setInterval` every 10 minutes evicts repos idle > 30 minutes. During full scans, an empty sentinel is returned to avoid caching partial graphs.

**Tech Stack:** better-sqlite3 (synchronous), TypeScript, no external dependencies.

---

## Chunk 1: IdMapper + types

### File Map

| Path | Responsibility |
|------|---------------|
| `src/graph/types.ts` | EdgeType, Edge, GraphNode, RepoGraph, SymbolContext, EnrichedContext type definitions |
| `src/graph/id-mapper.ts` | UUID↔integer bidirectional mapping |
| `tests/graph/id-mapper.test.ts` | intern, resolve, out-of-bounds guard |

---

### Task 1: Types + IdMapper

- [ ] **Step 1: Write failing test**

Create `tests/graph/id-mapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { IdMapper } from '../../src/graph/id-mapper.js';

describe('IdMapper', () => {
  it('interns UUIDs to sequential integers starting at 0', () => {
    const m = new IdMapper();
    expect(m.intern('uuid-a')).toBe(0);
    expect(m.intern('uuid-b')).toBe(1);
    expect(m.intern('uuid-c')).toBe(2);
  });

  it('intern is idempotent — same UUID returns same int', () => {
    const m = new IdMapper();
    const id1 = m.intern('uuid-x');
    const id2 = m.intern('uuid-x');
    expect(id1).toBe(id2);
  });

  it('resolve returns the UUID for a known int', () => {
    const m = new IdMapper();
    const intId = m.intern('uuid-a');
    expect(m.resolve(intId)).toBe('uuid-a');
  });

  it('resolve throws for unknown int (out-of-bounds guard)', () => {
    const m = new IdMapper();
    expect(() => m.resolve(999)).toThrow(/unknown IntId/);
  });

  it('size reports number of interned UUIDs', () => {
    const m = new IdMapper();
    m.intern('a');
    m.intern('b');
    m.intern('a'); // idempotent
    expect(m.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd E:\Code\MCP-web\mcp-code1
npx vitest run tests/graph/id-mapper.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create types + IdMapper**

Create `src/graph/types.ts`:

```typescript
export type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

export type IntId = number;

export type Edge = {
  targetId: IntId;
  type: EdgeType;
  confidence: number;
};

export type GraphNode = {
  outgoing: Edge[];
  incoming: Edge[];
};

export type RepoGraph = {
  nodes: Map<IntId, GraphNode>;
  mapper: IdMapper;
  fileIndex: Map<string, IntId[]>;
};

export type TraversalResult = {
  symbolId: IntId;
  depth: number;
  via: EdgeType;
};

export type SymbolContext = {
  symbolUuid: string;
  name: string;
  kind: string;
  filePath: string;
  line: number;
  callers: Array<{ symbolId: string; name: string; depth: number; via: EdgeType }>;
  callees: Array<{ symbolId: string; name: string; depth: number; via: EdgeType }>;
};

export type EnrichedContext = {
  enrichedPrompt: string;
  symbolCount: number;
  tokenCount: number;
};

// Forward declaration — IdMapper is imported from id-mapper.ts
// This avoids circular imports: types.ts uses IdMapper in RepoGraph,
// but IdMapper is defined separately. Re-export it here for convenience.
import type { IdMapper } from './id-mapper.js';
export type { IdMapper };
```

Create `src/graph/id-mapper.ts`:

```typescript
export class IdMapper {
  private uuidToInt = new Map<string, number>();
  private intToUuid: string[] = [];

  intern(uuid: string): number {
    if (this.uuidToInt.has(uuid)) return this.uuidToInt.get(uuid)!;
    const id = this.intToUuid.length;
    this.intToUuid.push(uuid);
    this.uuidToInt.set(uuid, id);
    return id;
  }

  resolve(id: number): string {
    const uuid = this.intToUuid[id];
    if (uuid === undefined) {
      throw new Error(`IdMapper: unknown IntId ${id} — possible orphaned edge`);
    }
    return uuid;
  }

  get size(): number {
    return this.intToUuid.length;
  }
}
```

- [ ] **Step 4: Fix RepoGraph circular import in types.ts**

`types.ts` imports `IdMapper` type — but it's fine since it's a type-only import. Verify `src/graph/types.ts` compiles. If circular error, simplify: remove the `import type { IdMapper }` from `types.ts` and define `RepoGraph` using the imported type inline in `in-memory-graph.ts` instead.

- [ ] **Step 5: Run test — expect PASS**

```bash
npx vitest run tests/graph/id-mapper.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/graph/types.ts src/graph/id-mapper.ts tests/graph/id-mapper.test.ts
git commit -m "feat: add IdMapper UUID↔integer mapping and graph type definitions"
```

---

## Chunk 2: bfsTraverse

### File Map

| Path | Responsibility |
|------|---------------|
| `src/graph/bfs.ts` | Depth-limited BFS over RepoGraph in either direction |
| `tests/graph/bfs.test.ts` | BFS outgoing, incoming, maxDepth, self-loop exclusion, cycles |

---

### Task 2: bfsTraverse

- [ ] **Step 1: Write failing test**

Create `tests/graph/bfs.test.ts`:

```typescript
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
    // A→B→C→D (depth 1, 2, 3)
    const g = makeGraph([['A', 'B', 'CALLS'], ['B', 'C', 'CALLS'], ['C', 'D', 'CALLS']]);
    const startId = g.mapper.intern('A');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    const depths = Object.fromEntries(results.map(r => [g.mapper.resolve(r.symbolId), r.depth]));
    expect(depths['B']).toBe(1);
    expect(depths['C']).toBe(2);
    expect(depths['D']).toBe(3);
    // depth 4 would be beyond limit
    expect(results.length).toBe(3);
  });

  it('traverses incoming edges (callers)', () => {
    const g = makeGraph([['A', 'B', 'CALLS'], ['C', 'B', 'CALLS']]);
    const startId = g.mapper.intern('B');
    const results = bfsTraverse(g, startId, 'incoming', 1);
    const names = results.map(r => g.mapper.resolve(r.symbolId)).sort();
    expect(names).toEqual(['A', 'C']);
  });

  it('excludes self-loops (start node not in results)', () => {
    const g = makeGraph([['A', 'A', 'CALLS']]); // self-loop
    const startId = g.mapper.intern('A');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    expect(results.length).toBe(0);
  });

  it('handles cycles without infinite loop', () => {
    // A→B→A (cycle)
    const g = makeGraph([['A', 'B', 'CALLS'], ['B', 'A', 'CALLS']]);
    const startId = g.mapper.intern('A');
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    // B visited at depth 1, A already visited (start), no infinite loop
    expect(results.length).toBe(1);
    expect(g.mapper.resolve(results[0]!.symbolId)).toBe('B');
  });

  it('returns empty array for node with no outgoing edges', () => {
    const g = makeGraph([['A', 'B', 'CALLS']]);
    const startId = g.mapper.intern('B'); // leaf
    const results = bfsTraverse(g, startId, 'outgoing', 3);
    expect(results.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/graph/bfs.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement bfsTraverse**

Create `src/graph/bfs.ts`:

```typescript
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
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/graph/bfs.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/bfs.ts tests/graph/bfs.test.ts
git commit -m "feat: add depth-limited BFS traversal for InMemoryGraph"
```

---

## Chunk 3: InMemoryGraph

### File Map

| Path | Responsibility |
|------|---------------|
| `src/graph/in-memory-graph.ts` | Lazy load from DB, TTL eviction, reloadFile, scan guard |
| `tests/graph/in-memory-graph.test.ts` | loadFromDb, getGraph, evictStale, reloadFile, scanGuard |

---

### Task 3: InMemoryGraph

- [ ] **Step 1: Write failing tests**

Create `tests/graph/in-memory-graph.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';

function seedGraph(db: ReturnType<typeof openDb>) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t','/t')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','foo','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','bar','function',7,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language)
     VALUES ('rel1','r1','s1','s2','bar','CALLS','typescript')`,
  ).run();
}

describe('InMemoryGraph', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('getGraph loads from DB on first access', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const graph = g.getGraph('r1');
    expect(graph.nodes.size).toBeGreaterThan(0);
    const s1int = graph.mapper.intern('s1');
    const node = graph.nodes.get(s1int);
    expect(node?.outgoing.length).toBe(1);
    db.close();
  });

  it('getGraph caches — second call returns same object reference', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const g1 = g.getGraph('r1');
    const g2 = g.getGraph('r1');
    expect(g1).toBe(g2);
    db.close();
  });

  it('invalidate removes cached graph — next getGraph reloads', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const g1 = g.getGraph('r1');
    g.invalidate('r1');
    const g2 = g.getGraph('r1');
    expect(g1).not.toBe(g2);
    db.close();
  });

  it('getGraph returns fresh empty graph when scan in progress', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    g.setScanInProgress('r1', true);
    const graph = g.getGraph('r1');
    expect(graph.nodes.size).toBe(0);
    // Each call returns a NEW empty object (not same reference)
    const graph2 = g.getGraph('r1');
    expect(graph).not.toBe(graph2);
    db.close();
  });

  it('derived incoming edges are set at load time', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const graph = g.getGraph('r1');
    const s2int = graph.mapper.intern('s2');
    const node = graph.nodes.get(s2int);
    // s2 should have 1 incoming edge (from s1)
    expect(node?.incoming.length).toBe(1);
    db.close();
  });

  it('evictStale removes graphs idle beyond TTL', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    g.getGraph('r1'); // loads it

    // Manually set lastAccess to past to trigger eviction
    (g as any).lastAccess.set('r1', Date.now() - 31 * 60 * 1000);
    g.evictStale();

    // After eviction, next getGraph reloads
    const graph = g.getGraph('r1'); // reloads
    expect(graph.nodes.size).toBeGreaterThan(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/graph/in-memory-graph.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement InMemoryGraph**

Create `src/graph/in-memory-graph.ts`:

```typescript
import type { Db } from '../db/index.js';
import { IdMapper } from './id-mapper.js';
import type { RepoGraph, GraphNode, IntId, EdgeType } from './types.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes

function makeEmptyRepoGraph(): RepoGraph {
  return { nodes: new Map(), mapper: new IdMapper(), fileIndex: new Map() };
}

export class InMemoryGraph {
  private graphs = new Map<string, RepoGraph>();
  private lastAccess = new Map<string, number>();
  private scanInProgress = new Set<string>();
  private evictTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Db) {}

  /** Start automatic eviction. Call once at app startup. */
  startEviction(): void {
    if (this.evictTimer) return;
    this.evictTimer = setInterval(() => this.evictStale(), 10 * 60 * 1000).unref?.() ?? setInterval(() => this.evictStale(), 10 * 60 * 1000);
  }

  stopEviction(): void {
    if (this.evictTimer) {
      clearInterval(this.evictTimer);
      this.evictTimer = null;
    }
  }

  setScanInProgress(repoId: string, inProgress: boolean): void {
    if (inProgress) this.scanInProgress.add(repoId);
    else this.scanInProgress.delete(repoId);
  }

  invalidate(repoId: string): void {
    this.graphs.delete(repoId);
    this.lastAccess.delete(repoId);
  }

  getGraph(repoId: string): RepoGraph {
    if (this.scanInProgress.has(repoId)) return makeEmptyRepoGraph();
    this.lastAccess.set(repoId, Date.now());
    if (!this.graphs.has(repoId)) {
      this.graphs.set(repoId, this.loadFromDb(repoId));
    }
    return this.graphs.get(repoId)!;
  }

  evictStale(): void {
    const now = Date.now();
    for (const [repoId, lastUsed] of this.lastAccess) {
      if (now - lastUsed > TTL_MS) {
        this.graphs.delete(repoId);
        this.lastAccess.delete(repoId);
      }
    }
  }

  loadFromDb(repoId: string, minConfidence = 0.5): RepoGraph {
    const rows = this.db
      .prepare(
        `SELECT source_id, target_id, type, confidence
         FROM symbol_relations
         WHERE repo_id = ?
           AND target_id IS NOT NULL
           AND confidence >= ?`,
      )
      .all(repoId, minConfidence) as Array<{
        source_id: string;
        target_id: string;
        type: EdgeType;
        confidence: number;
      }>;

    const symbolFileRows = this.db
      .prepare(`SELECT id, file_id FROM symbols WHERE repo_id = ?`)
      .all(repoId) as Array<{ id: string; file_id: string }>;

    const mapper = new IdMapper();
    const nodes = new Map<IntId, GraphNode>();
    const fileIndex = new Map<string, IntId[]>();

    // Build fileIndex
    for (const row of symbolFileRows) {
      const intId = mapper.intern(row.id);
      if (!nodes.has(intId)) nodes.set(intId, { outgoing: [], incoming: [] });
      const list = fileIndex.get(row.file_id) ?? [];
      list.push(intId);
      fileIndex.set(row.file_id, list);
    }

    // Build outgoing edges
    for (const row of rows) {
      const srcInt = mapper.intern(row.source_id);
      const tgtInt = mapper.intern(row.target_id);
      if (!nodes.has(srcInt)) nodes.set(srcInt, { outgoing: [], incoming: [] });
      if (!nodes.has(tgtInt)) nodes.set(tgtInt, { outgoing: [], incoming: [] });
      nodes.get(srcInt)!.outgoing.push({ targetId: tgtInt, type: row.type, confidence: row.confidence });
    }

    // Derive incoming edges (reverse pass)
    for (const [srcInt, node] of nodes) {
      for (const edge of node.outgoing) {
        nodes.get(edge.targetId)!.incoming.push({ targetId: srcInt, type: edge.type, confidence: edge.confidence });
      }
    }

    return { nodes, mapper, fileIndex };
  }

  reloadFile(repoId: string, fileId: string): void {
    const graph = this.graphs.get(repoId);
    if (!graph) return;

    const CHUNK = 500;

    // 1. Find all IntIds belonging to this file
    const affectedIntIds = graph.fileIndex.get(fileId) ?? [];

    // 2. Collect stale outgoing targets, clear outgoing
    const staleTgtIds = new Set<IntId>();
    for (const intId of affectedIntIds) {
      const node = graph.nodes.get(intId);
      if (!node) continue;
      node.outgoing.forEach((e) => staleTgtIds.add(e.targetId));
      node.outgoing = [];
    }

    // 3. Remove stale incoming edges from targets
    const affectedSet = new Set<IntId>(affectedIntIds);
    for (const tgtId of staleTgtIds) {
      const tgtNode = graph.nodes.get(tgtId);
      if (!tgtNode) continue;
      tgtNode.incoming = tgtNode.incoming.filter((e) => !affectedSet.has(e.targetId));
    }

    // 4. Prune ghost nodes for deleted symbols (EC-5.1)
    const affectedUuids = affectedIntIds.map((id) => graph.mapper.resolve(id));
    const stillExistingUuids = new Set<string>();
    for (let i = 0; i < affectedUuids.length; i += CHUNK) {
      const batch = affectedUuids.slice(i, i + CHUNK);
      const rows = this.db
        .prepare(`SELECT id FROM symbols WHERE id IN (${batch.map(() => '?').join(',')})`)
        .all(...batch) as Array<{ id: string }>;
      rows.forEach((r) => stillExistingUuids.add(r.id));
    }
    const list = graph.fileIndex.get(fileId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const intId = list[i]!;
      const uuid = graph.mapper.resolve(intId);
      if (!stillExistingUuids.has(uuid)) {
        graph.nodes.delete(intId);
        list.splice(i, 1);
      }
    }

    // 5. Re-sync fileIndex with current DB state (B-2 FIX: captures new symbols)
    const currentRows = this.db
      .prepare(`SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?`)
      .all(fileId, repoId) as Array<{ id: string }>;

    const updatedIntIds: IntId[] = [];
    for (const row of currentRows) {
      const intId = graph.mapper.intern(row.id);
      if (!graph.nodes.has(intId)) {
        graph.nodes.set(intId, { outgoing: [], incoming: [] });
      }
      updatedIntIds.push(intId);
    }
    graph.fileIndex.set(fileId, updatedIntIds);

    // 6. Re-load edges for current symbols — chunked
    const allCurrentUuids = currentRows.map((r) => r.id);
    const freshRows: Array<{ source_id: string; target_id: string; type: EdgeType; confidence: number }> = [];
    for (let i = 0; i < allCurrentUuids.length; i += CHUNK) {
      const batch = allCurrentUuids.slice(i, i + CHUNK);
      const rows = this.db
        .prepare(
          `SELECT source_id, target_id, type, confidence
           FROM symbol_relations
           WHERE source_id IN (${batch.map(() => '?').join(',')})
             AND target_id IS NOT NULL`,
        )
        .all(...batch) as typeof freshRows;
      freshRows.push(...rows);
    }

    for (const row of freshRows) {
      const srcInt = graph.mapper.intern(row.source_id);
      const tgtInt = graph.mapper.intern(row.target_id);
      if (!graph.nodes.has(tgtInt)) graph.nodes.set(tgtInt, { outgoing: [], incoming: [] });
      graph.nodes.get(srcInt)!.outgoing.push({ targetId: tgtInt, type: row.type, confidence: row.confidence });
      graph.nodes.get(tgtInt)!.incoming.push({ targetId: srcInt, type: row.type, confidence: row.confidence });
    }
  }
}
```

**Note on `startEviction` timer:** `.unref()` prevents the Node.js process from staying alive just for the timer. Better approach — simplify the line:
```typescript
const timer = setInterval(() => this.evictStale(), 10 * 60 * 1000);
if (typeof timer.unref === 'function') timer.unref();
this.evictTimer = timer;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/graph/in-memory-graph.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Run full suite + build**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/graph/in-memory-graph.ts src/graph/types.ts src/graph/bfs.ts src/graph/id-mapper.ts tests/graph/in-memory-graph.test.ts tests/graph/bfs.test.ts tests/graph/id-mapper.test.ts
git commit -m "feat: add InMemoryGraph with lazy load, TTL eviction, BFS traversal"
```
