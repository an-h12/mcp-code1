# Relationship Intelligence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add graph-based symbol relationship intelligence (CALLS / IMPORTS / EXTENDS / IMPLEMENTS) plus forced pre-fetch context enrichment (Tầng 2) to the existing MCP server, enabling blast-radius analysis across TypeScript/JavaScript, Python, Go, Rust, and C# (dual-tier: tree-sitter + optional Roslyn daemon).

**Architecture:** SQLite stores outgoing edges only (`symbol_relations` table) with FK cascades; `InMemoryGraph` lazily loads a UUID→integer-compressed bidirectional graph per repo with 30-minute TTL eviction; a two-pass `Indexer` writes edges in a single transaction (DELETE + INSERT atomic); `ContextEnricher` intercepts any user message, extracts mentions, fetches depth-2 BFS context and injects a markdown block before the prompt reaches the model. C# uses tree-sitter Tier 1 (~75–80%) with an NDJSON-framed Roslyn daemon subprocess as optional Tier 2 (~98%). One MCP server process serves exactly one repo (`REPO_ROOT` env).

**Tech Stack:** TypeScript 5 strict (NodeNext), `better-sqlite3` (sync; FK+WAL PRAGMA), Zod env validation, pino logger, Vitest TDD, tree-sitter parsers for JS/TS/Python/Go/Rust/C#, Roslyn self-contained binary (daemon via stdin/stdout NDJSON).

**Pre-reqs:**
- Plan 1 (`docs/superpowers/plans/2026-04-15-mcp-core-infra.md`) complete: `DbPool`, migrations, `RepoRegistry`, `App`, pino logger, Zod config.
- Plan 2 (`docs/superpowers/plans/2026-04-15-mcp-indexing-pipeline.md`) complete: `Indexer.indexFile()` Pass 1 (symbols), chokidar `Watcher` with 300 ms debounce, tree-sitter parser harness, `IGNORE_PATTERNS`.
- Plan 3 (`docs/superpowers/plans/2026-04-15-mcp-server-tools.md`) complete: 11 existing MCP tools, tool-registration plumbing.

**Spec:** `docs/superpowers/specs/2026-04-16-relationship-intelligence-design.md` (authoritative — re-open when in doubt).

**Deliverables:** 5 new MCP tools, 1 migration, 4 new TS modules (`graph/`, `indexer/relation-extractor.ts`, `indexer/module-map.ts`, `mcp/context-enricher.ts`), 1 Roslyn bridge + C# project scaffold, 5 `.scm` query files, updated `src/app.ts` startup sequencing. Net tool count: 16 (matches GitNexus).

---

## Chunk 1: Schema Migration 002 + FK Pragma Verification

**Files touched:**
- Create: `src/db/migrations/002_relations.ts`
- Modify: `src/db/migrations/index.ts` — register migration 002
- Modify: `src/db/pool.ts` — verify `foreign_keys=ON` PRAGMA (M16 FIX)
- Create: `tests/db/migrations/002_relations.test.ts`
- Create: `tests/db/pool-fk.test.ts`

### Task 1: Add `symbol_relations` table migration

**Files:**
- Create: `src/db/migrations/002_relations.ts`
- Modify: `src/db/migrations/index.ts`
- Test: `tests/db/migrations/002_relations.test.ts`

- [ ] **Step 1: Write failing test** — verify migration creates table + indexes

```typescript
// tests/db/migrations/002_relations.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations';

describe('migration 002_relations', () => {
  it('creates symbol_relations table with correct schema', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const info = db.prepare("PRAGMA table_info('symbol_relations')").all() as Array<{ name: string; type: string; notnull: number }>;
    const cols = Object.fromEntries(info.map(c => [c.name, c]));
    expect(cols.id.type).toBe('TEXT');
    expect(cols.id.notnull).toBe(1);
    expect(cols.repo_id.notnull).toBe(1);
    expect(cols.source_id.notnull).toBe(1);
    expect(cols.target_id.notnull).toBe(0);        // nullable
    expect(cols.target_name.notnull).toBe(1);
    expect(cols.type.notnull).toBe(1);
    expect(cols.confidence.type).toBe('REAL');
  });

  it('creates the four indexes', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='symbol_relations'")
      .all().map((r: any) => r.name);
    expect(indexes).toContain('idx_relations_source');
    expect(indexes).toContain('idx_relations_target');
    expect(indexes).toContain('idx_relations_repo');
    expect(indexes).toContain('idx_relations_repo_type');
  });

  it('enforces CASCADE on repos delete', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1', 'n', '/p')`).run();
    db.prepare(`INSERT INTO files(id, repo_id, rel_path, language) VALUES ('f1', 'r1', 'a.ts', 'ts')`).run();
    db.prepare(`INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
                VALUES ('s1', 'r1', 'f1', 'foo', 'function', 1, 2)`).run();
    db.prepare(`INSERT INTO symbol_relations(id, repo_id, source_id, target_name, type, language)
                VALUES ('e1', 'r1', 's1', 'bar', 'CALLS', 'ts')`).run();

    db.prepare(`DELETE FROM repos WHERE id = 'r1'`).run();
    const remaining = db.prepare(`SELECT COUNT(*) AS c FROM symbol_relations`).get() as { c: number };
    expect(remaining.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/db/migrations/002_relations.test.ts`
Expected: FAIL — `no such table: symbol_relations`.

- [ ] **Step 3: Implement migration**

```typescript
// src/db/migrations/002_relations.ts
import type { Database } from 'better-sqlite3';

export const version = 2;
export const name = '002_relations';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE symbol_relations (
      id          TEXT PRIMARY KEY,
      repo_id     TEXT NOT NULL REFERENCES repos(id)    ON DELETE CASCADE,
      source_id   TEXT NOT NULL REFERENCES symbols(id)  ON DELETE CASCADE,
      target_id   TEXT,
      target_name TEXT NOT NULL,
      target_file TEXT,
      type        TEXT NOT NULL,
      language    TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 1.0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_relations_source    ON symbol_relations(source_id);
    CREATE INDEX idx_relations_target    ON symbol_relations(target_id);
    CREATE INDEX idx_relations_repo      ON symbol_relations(repo_id);
    CREATE INDEX idx_relations_repo_type ON symbol_relations(repo_id, type);
  `);
}
```

- [ ] **Step 4: Register migration in index**

```typescript
// src/db/migrations/index.ts  (excerpt)
import * as m001 from './001_initial';
import * as m002 from './002_relations';

const MIGRATIONS = [m001, m002] as const;
// (existing runMigrations loop unchanged)
```

- [ ] **Step 5: Verify tests pass**

Run: `npx vitest run tests/db/migrations/002_relations.test.ts`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/002_relations.ts src/db/migrations/index.ts tests/db/migrations/002_relations.test.ts
git commit -m "feat(db): add migration 002 — symbol_relations table + indexes"
```

### Task 2: Confirm DbPool sets `foreign_keys = ON` on every connection (M16 FIX)

**Files:**
- Modify: `src/db/pool.ts` (if not already)
- Test: `tests/db/pool-fk.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/db/pool-fk.test.ts
import { describe, it, expect } from 'vitest';
import { DbPool } from '../../src/db/pool';

describe('DbPool FK enforcement', () => {
  it('enables foreign_keys on every new connection', () => {
    const pool = new DbPool(':memory:');
    const db = pool.open();
    const result = db.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);   // 1 = ON
    pool.close();
  });

  it('uses WAL journal mode', () => {
    const pool = new DbPool(':memory:');
    const db = pool.open();
    // :memory: forces 'memory' mode — skip assertion if so
    const mode = db.pragma('journal_mode', { simple: true });
    expect(['wal', 'memory']).toContain(mode);
    pool.close();
  });
});
```

- [ ] **Step 2: Run — expect pass if Plan 1 Task 8 already wired pragmas; otherwise add:**

```typescript
// src/db/pool.ts  (in open())
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
```

- [ ] **Step 3: Run — tests green**

Run: `npx vitest run tests/db/pool-fk.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/db/pool.ts tests/db/pool-fk.test.ts
git commit -m "test(db): verify foreign_keys=ON pragma on pool connections (M16)"
```

---

## Chunk 2: IdMapper + Graph Types + bfsTraverse

**Files:**
- Create: `src/graph/types.ts` — `EdgeType`, `IntId`, `Edge`, `GraphNode`, `RepoGraph`, `SymbolContext`, `EnrichedContext`, `ResolvedSymbol`, `TraversalResult`.
- Create: `src/graph/id-mapper.ts` — `IdMapper` class.
- Create: `src/graph/bfs.ts` — `bfsTraverse` pure function.
- Tests: `tests/graph/id-mapper.test.ts`, `tests/graph/bfs.test.ts`.

### Task 3: `src/graph/types.ts`

- [ ] **Step 1: Create file**

```typescript
// src/graph/types.ts
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

export type ResolvedSymbol = {
  id: string;
  name: string;
  filePath: string;
  repoId: string;
};

export type TraversalResult = {
  symbolId: IntId;
  depth: number;
  via: EdgeType;
};

// Forward-ref so types.ts stays dependency-free at compile time.
import type { IdMapper } from './id-mapper';
```

- [ ] **Step 2: Commit**

```bash
git add src/graph/types.ts
git commit -m "feat(graph): add core types (EdgeType, IntId, RepoGraph, SymbolContext)"
```

### Task 4: `IdMapper` (S10 FIX — throw on unknown IntId)

**Files:**
- Create: `src/graph/id-mapper.ts`
- Test: `tests/graph/id-mapper.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/graph/id-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { IdMapper } from '../../src/graph/id-mapper';

describe('IdMapper', () => {
  it('assigns sequential integer ids from 0', () => {
    const m = new IdMapper();
    expect(m.intern('uuid-a')).toBe(0);
    expect(m.intern('uuid-b')).toBe(1);
    expect(m.intern('uuid-c')).toBe(2);
  });

  it('intern is idempotent (same uuid → same int)', () => {
    const m = new IdMapper();
    const first = m.intern('uuid-a');
    expect(m.intern('uuid-a')).toBe(first);
    expect(m.intern('uuid-b')).toBe(1);
    expect(m.intern('uuid-a')).toBe(first);
  });

  it('resolve returns original uuid', () => {
    const m = new IdMapper();
    const id = m.intern('uuid-xyz');
    expect(m.resolve(id)).toBe('uuid-xyz');
  });

  it('resolve throws on unknown IntId (S10 FIX)', () => {
    const m = new IdMapper();
    m.intern('uuid-a');
    expect(() => m.resolve(999)).toThrow(/unknown IntId 999/);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL (module missing).

Run: `npx vitest run tests/graph/id-mapper.test.ts`

- [ ] **Step 3: Implement**

```typescript
// src/graph/id-mapper.ts
export class IdMapper {
  private uuidToInt = new Map<string, number>();
  private intToUuid: string[] = [];

  intern(uuid: string): number {
    const existing = this.uuidToInt.get(uuid);
    if (existing !== undefined) return existing;
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

  get size(): number { return this.intToUuid.length; }
}
```

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```bash
git add src/graph/id-mapper.ts tests/graph/id-mapper.test.ts
git commit -m "feat(graph): IdMapper UUID↔IntId bidirectional, throws on unknown (S10)"
```

### Task 5: `bfsTraverse`

**Files:**
- Create: `src/graph/bfs.ts`
- Test: `tests/graph/bfs.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/graph/bfs.test.ts
import { describe, it, expect } from 'vitest';
import { bfsTraverse } from '../../src/graph/bfs';
import { IdMapper } from '../../src/graph/id-mapper';
import type { RepoGraph, GraphNode } from '../../src/graph/types';

function buildGraph(edges: Array<[number, number]>): RepoGraph {
  const nodes = new Map<number, GraphNode>();
  const addNode = (id: number) => {
    if (!nodes.has(id)) nodes.set(id, { outgoing: [], incoming: [] });
  };
  for (const [src, tgt] of edges) {
    addNode(src); addNode(tgt);
    nodes.get(src)!.outgoing.push({ targetId: tgt, type: 'CALLS', confidence: 1 });
    nodes.get(tgt)!.incoming.push({ targetId: src, type: 'CALLS', confidence: 1 });
  }
  return { nodes, mapper: new IdMapper(), fileIndex: new Map() };
}

describe('bfsTraverse', () => {
  it('depth-3 outgoing traversal', () => {
    // 0 -> 1 -> 2 -> 3 -> 4
    const g = buildGraph([[0, 1], [1, 2], [2, 3], [3, 4]]);
    const res = bfsTraverse(g, 0, 'outgoing', 3);
    expect(res.map(r => r.symbolId)).toEqual([1, 2, 3]);   // 4 excluded (depth=4)
    expect(res.map(r => r.depth)).toEqual([1, 2, 3]);
  });

  it('depth-3 incoming traversal', () => {
    const g = buildGraph([[0, 4], [1, 0], [2, 1], [3, 2]]);
    const res = bfsTraverse(g, 4, 'incoming', 3);
    expect(res.map(r => r.symbolId)).toEqual([0, 1, 2]);
  });

  it('excludes self-loop (start pre-visited)', () => {
    const g = buildGraph([[0, 0], [0, 1]]);
    const res = bfsTraverse(g, 0, 'outgoing', 3);
    expect(res.find(r => r.symbolId === 0)).toBeUndefined();
    expect(res.find(r => r.symbolId === 1)).toBeDefined();
  });

  it('handles cycles without infinite loop', () => {
    const g = buildGraph([[0, 1], [1, 2], [2, 0]]);
    const res = bfsTraverse(g, 0, 'outgoing', 3);
    expect(res.map(r => r.symbolId).sort()).toEqual([1, 2]);
  });

  it('returns empty for missing start node', () => {
    const g = buildGraph([[0, 1]]);
    expect(bfsTraverse(g, 99, 'outgoing', 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL (module missing)**

- [ ] **Step 3: Implement**

```typescript
// src/graph/bfs.ts
import type { RepoGraph, IntId, TraversalResult } from './types';

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

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```bash
git add src/graph/bfs.ts tests/graph/bfs.test.ts
git commit -m "feat(graph): bfsTraverse pure function, pre-visits start (no self-loops)"
```

---

## Chunk 3: InMemoryGraph — loadFromDb + TTL Eviction

**Files:**
- Create: `src/graph/in-memory-graph.ts` — class with `loadFromDb`, `getGraph`, `evictStale`, `getMapper`, `invalidate`, `setScanInProgress`, `makeEmptyRepoGraph`.
- Test: `tests/graph/in-memory-graph.test.ts`.

### Task 6: `loadFromDb` builds outgoing + derives incoming + fileIndex

**Files:**
- Create: `src/graph/in-memory-graph.ts`
- Test: `tests/graph/in-memory-graph.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/graph/in-memory-graph.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { InMemoryGraph } from '../../src/graph/in-memory-graph';
import { runMigrations } from '../../src/db/migrations';

function seed(db: Database.Database) {
  db.exec(`
    INSERT INTO repos(id, name, root_path) VALUES ('R', 'r', '/r');
    INSERT INTO files(id, repo_id, rel_path, language) VALUES ('F1', 'R', 'a.ts', 'ts');
    INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
      VALUES ('A','R','F1','a','function',1,2),
             ('B','R','F1','b','function',3,4),
             ('C','R','F1','c','function',5,6);
    INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
      VALUES ('e1','R','A','B','b','CALLS','ts',1.0),
             ('e2','R','A','C','c','CALLS','ts',1.0),
             ('e3','R','B','C','c','CALLS','ts',1.0),
             ('e4','R','C', NULL,'ext','CALLS','ts',0.7);   -- unresolved, excluded
  `);
}

describe('InMemoryGraph.loadFromDb', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seed(db);
  });

  it('loads outgoing edges and derives incoming', () => {
    const g = new InMemoryGraph(db).loadFromDb('R');
    const aInt = g.mapper.intern('A');
    const bInt = g.mapper.intern('B');
    const cInt = g.mapper.intern('C');

    const a = g.nodes.get(aInt)!;
    expect(a.outgoing.map(e => e.targetId).sort()).toEqual([bInt, cInt].sort());
    expect(a.incoming).toEqual([]);

    const b = g.nodes.get(bInt)!;
    expect(b.incoming.map(e => e.targetId)).toEqual([aInt]);
    expect(b.outgoing.map(e => e.targetId)).toEqual([cInt]);

    const c = g.nodes.get(cInt)!;
    expect(c.incoming.map(e => e.targetId).sort()).toEqual([aInt, bInt].sort());
  });

  it('excludes unresolved edges (target_id IS NULL)', () => {
    const g = new InMemoryGraph(db).loadFromDb('R');
    // Node C has outgoing e4 (unresolved) — must be absent
    const cInt = g.mapper.intern('C');
    expect(g.nodes.get(cInt)!.outgoing).toEqual([]);
  });

  it('builds fileIndex from symbols table', () => {
    const g = new InMemoryGraph(db).loadFromDb('R');
    const list = g.fileIndex.get('F1')!;
    expect(list.length).toBe(3);
  });

  it('confidence >= 0.5 filter keeps resolved edges', () => {
    const g = new InMemoryGraph(db).loadFromDb('R', 0.5);
    // All resolved edges are confidence=1.0 → present
    expect(g.nodes.size).toBe(3);
  });
});

describe('InMemoryGraph.getGraph + TTL', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seed(db);
  });

  it('lazily loads on first access, caches on second', () => {
    const mem = new InMemoryGraph(db);
    const spy = vi.spyOn(mem as any, 'loadFromDb');
    mem.getGraph('R');
    mem.getGraph('R');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('evictStale removes graphs older than TTL', () => {
    const mem = new InMemoryGraph(db, { ttlMs: 10 });
    mem.getGraph('R');
    // force lastAccess into the past
    (mem as any).lastAccess.set('R', Date.now() - 1000);
    mem.evictStale();
    expect((mem as any).graphs.has('R')).toBe(false);
  });
});
```

Add `import { vi } from 'vitest';` at top.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement (core)**

```typescript
// src/graph/in-memory-graph.ts
import type { Database } from 'better-sqlite3';
import type { RepoGraph, IntId, GraphNode, EdgeType } from './types';
import { IdMapper } from './id-mapper';
import { logger } from '../logger';

export function makeEmptyRepoGraph(): RepoGraph {
  return { nodes: new Map(), mapper: new IdMapper(), fileIndex: new Map() };
}

interface Options {
  ttlMs?: number;
}

export class InMemoryGraph {
  private graphs = new Map<string, RepoGraph>();
  private lastAccess = new Map<string, number>();
  private scanInProgress = new Set<string>();
  private readonly ttlMs: number;

  constructor(private readonly db: Database, opts: Options = {}) {
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
  }

  getGraph(repoId: string): RepoGraph {
    if (this.scanInProgress.has(repoId)) return makeEmptyRepoGraph();   // B3 + S-3 FIX
    this.lastAccess.set(repoId, Date.now());
    if (!this.graphs.has(repoId)) {
      this.graphs.set(repoId, this.loadFromDb(repoId));
    }
    return this.graphs.get(repoId)!;
  }

  getMapper(repoId: string): IdMapper {
    return this.getGraph(repoId).mapper;
  }

  setScanInProgress(repoId: string, inProgress: boolean): void {
    if (inProgress) this.scanInProgress.add(repoId);
    else this.scanInProgress.delete(repoId);
  }

  invalidate(repoId: string): void {
    this.graphs.delete(repoId);
    this.lastAccess.delete(repoId);
  }

  evictStale(): void {
    const now = Date.now();
    for (const [repoId, lastUsed] of this.lastAccess) {
      if (now - lastUsed > this.ttlMs) {
        this.graphs.delete(repoId);
        this.lastAccess.delete(repoId);
        logger.info({ repoId }, 'graph evicted — inactive');
      }
    }
  }

  loadFromDb(repoId: string, minConfidence = 0.5): RepoGraph {
    const edgeRows = this.db.prepare(`
      SELECT source_id, target_id, type, confidence
      FROM symbol_relations
      WHERE repo_id = ? AND target_id IS NOT NULL AND confidence >= ?
    `).all(repoId, minConfidence) as Array<{ source_id: string; target_id: string; type: EdgeType; confidence: number }>;

    const symFileRows = this.db.prepare(
      `SELECT id, file_id FROM symbols WHERE repo_id = ?`
    ).all(repoId) as Array<{ id: string; file_id: string }>;

    const mapper = new IdMapper();
    const nodes = new Map<IntId, GraphNode>();
    const fileIndex = new Map<string, IntId[]>();

    for (const row of symFileRows) {
      const intId = mapper.intern(row.id);
      if (!nodes.has(intId)) nodes.set(intId, { outgoing: [], incoming: [] });
      const list = fileIndex.get(row.file_id) ?? [];
      list.push(intId);
      fileIndex.set(row.file_id, list);
    }

    for (const row of edgeRows) {
      const srcInt = mapper.intern(row.source_id);
      const tgtInt = mapper.intern(row.target_id);
      if (!nodes.has(srcInt)) nodes.set(srcInt, { outgoing: [], incoming: [] });
      if (!nodes.has(tgtInt)) nodes.set(tgtInt, { outgoing: [], incoming: [] });
      nodes.get(srcInt)!.outgoing.push({ targetId: tgtInt, type: row.type, confidence: row.confidence });
    }

    // Derive incoming
    for (const [srcInt, node] of nodes) {
      for (const edge of node.outgoing) {
        nodes.get(edge.targetId)!.incoming.push({ targetId: srcInt, type: edge.type, confidence: edge.confidence });
      }
    }

    return { nodes, mapper, fileIndex };
  }
}
```

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```bash
git add src/graph/in-memory-graph.ts tests/graph/in-memory-graph.test.ts
git commit -m "feat(graph): InMemoryGraph with lazy load, TTL, scan-invalidate (S-3/B3)"
```

### Task 7: TTL eviction interval wiring (deferred — start in Chunk 9 with `App`)

(No code in this task — the `setInterval(() => mem.evictStale(), 10 * 60 * 1000)` registration is added in Chunk 9 alongside `App.start()`. Placeholder task kept for plan completeness.)

---

## Chunk 4: reloadFile + Ghost-Node Prune + B-2 Re-sync

### Task 8: `InMemoryGraph.reloadFile`

**Files:**
- Modify: `src/graph/in-memory-graph.ts`
- Test: `tests/graph/reload-file.test.ts`

- [ ] **Step 1: Write failing tests** — verify stale incoming prune, ghost node pruning (EC-5.1), B-2 re-sync.

```typescript
// tests/graph/reload-file.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { InMemoryGraph } from '../../src/graph/in-memory-graph';
import { runMigrations } from '../../src/db/migrations';

describe('InMemoryGraph.reloadFile', () => {
  let db: Database.Database;
  let mem: InMemoryGraph;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.exec(`
      INSERT INTO repos(id,name,root_path) VALUES ('R','r','/r');
      INSERT INTO files(id,repo_id,rel_path,language) VALUES
        ('F1','R','a.ts','ts'), ('F2','R','b.ts','ts');
      INSERT INTO symbols(id,repo_id,file_id,name,kind,start_line,end_line) VALUES
        ('A','R','F1','a','function',1,2),
        ('B','R','F2','b','function',3,4);
      INSERT INTO symbol_relations(id,repo_id,source_id,target_id,target_name,type,language,confidence) VALUES
        ('e1','R','A','B','b','CALLS','ts',1.0);
    `);
    mem = new InMemoryGraph(db);
    mem.getGraph('R');   // prime cache
  });

  it('adds NEW symbols appearing in file after edit (B-2 FIX)', () => {
    // Simulate: add C in F1 after Pass 1 commit
    db.exec(`
      INSERT INTO symbols(id,repo_id,file_id,name,kind,start_line,end_line)
        VALUES ('C','R','F1','c','function',5,6);
      INSERT INTO symbol_relations(id,repo_id,source_id,target_id,target_name,type,language,confidence)
        VALUES ('e2','R','C','B','b','CALLS','ts',1.0);
    `);
    mem.reloadFile('R', 'F1');
    const g = (mem as any).graphs.get('R')!;
    expect(g.fileIndex.get('F1')!.length).toBe(2);   // A + C
    const cInt = g.mapper.intern('C');
    const bInt = g.mapper.intern('B');
    expect(g.nodes.get(cInt).outgoing.map((e: any) => e.targetId)).toEqual([bInt]);
    expect(g.nodes.get(bInt).incoming.some((e: any) => e.targetId === cInt)).toBe(true);
  });

  it('prunes ghost nodes for symbols deleted from file (EC-5.1)', () => {
    db.exec(`DELETE FROM symbols WHERE id='A'`);
    mem.reloadFile('R', 'F1');
    const g = (mem as any).graphs.get('R')!;
    const aInt = g.mapper.intern('A');   // intern returns existing
    // Node should be pruned
    expect(g.nodes.has(aInt)).toBe(false);
    expect(g.fileIndex.get('F1')!.length).toBe(0);
  });

  it('removes stale incoming edges from other files', () => {
    db.exec(`DELETE FROM symbol_relations WHERE id='e1'`);
    mem.reloadFile('R', 'F1');
    const g = (mem as any).graphs.get('R')!;
    const bInt = g.mapper.intern('B');
    expect(g.nodes.get(bInt).incoming).toEqual([]);
  });

  it('is no-op when graph not loaded', () => {
    const mem2 = new InMemoryGraph(db);
    expect(() => mem2.reloadFile('R', 'F1')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — FAIL (method missing)**

- [ ] **Step 3: Implement**

```typescript
// src/graph/in-memory-graph.ts  — append to class
  reloadFile(repoId: string, fileId: string): void {
    const graph = this.graphs.get(repoId);
    if (!graph) return;

    const affectedIntIds = graph.fileIndex.get(fileId) ?? [];

    // 1. Clear outgoing, collect stale target IntIds for incoming cleanup
    const staleTgtIds = new Set<IntId>();
    for (const intId of affectedIntIds) {
      const node = graph.nodes.get(intId);
      if (!node) continue;
      node.outgoing.forEach(e => staleTgtIds.add(e.targetId));
      node.outgoing = [];
    }

    // 2. S-1 FIX: Set for O(1) membership
    const affectedSet = new Set<IntId>(affectedIntIds);
    for (const tgtId of staleTgtIds) {
      const tgtNode = graph.nodes.get(tgtId);
      if (!tgtNode) continue;
      tgtNode.incoming = tgtNode.incoming.filter(e => !affectedSet.has(e.targetId));
    }

    // EC-5.1: prune ghost nodes
    const CHUNK = 500;
    const affectedUuids = affectedIntIds.map(id => graph.mapper.resolve(id));
    const stillExisting = new Set<string>();
    for (let i = 0; i < affectedUuids.length; i += CHUNK) {
      const batch = affectedUuids.slice(i, i + CHUNK);
      const rows = this.db.prepare(
        `SELECT id FROM symbols WHERE id IN (${batch.map(() => '?').join(',')})`
      ).all(...batch) as Array<{ id: string }>;
      rows.forEach(r => stillExisting.add(r.id));
    }
    const list = graph.fileIndex.get(fileId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const uuid = graph.mapper.resolve(list[i]);
      if (!stillExisting.has(uuid)) {
        graph.nodes.delete(list[i]);
        list.splice(i, 1);
      }
    }

    // B-2 FIX: re-sync fileIndex with current DB
    const currentRows = this.db.prepare(
      `SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?`
    ).all(fileId, repoId) as Array<{ id: string }>;

    const updatedIntIds: IntId[] = [];
    for (const row of currentRows) {
      const intId = graph.mapper.intern(row.id);
      if (!graph.nodes.has(intId)) {
        graph.nodes.set(intId, { outgoing: [], incoming: [] });
      }
      updatedIntIds.push(intId);
    }
    graph.fileIndex.set(fileId, updatedIntIds);

    // 4. Reload edges for all current symbols in this file
    const allCurrentUuids = currentRows.map(r => r.id);
    const freshRows: Array<{ source_id: string; target_id: string; type: EdgeType; confidence: number }> = [];
    for (let i = 0; i < allCurrentUuids.length; i += CHUNK) {
      const batch = allCurrentUuids.slice(i, i + CHUNK);
      const rows = this.db.prepare(`
        SELECT source_id, target_id, type, confidence
        FROM symbol_relations
        WHERE source_id IN (${batch.map(() => '?').join(',')})
          AND target_id IS NOT NULL
      `).all(...batch) as typeof freshRows;
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
```

- [ ] **Step 4: Run — green**

- [ ] **Step 5: Commit**

```bash
git add src/graph/in-memory-graph.ts tests/graph/reload-file.test.ts
git commit -m "feat(graph): reloadFile with ghost prune (EC-5.1) + B-2 re-sync"
```

---

## Chunk 5: ModuleMap + RelationExtractor base

### Task 9: `ModuleMap`

**Files:**
- Create: `src/indexer/module-map.ts`
- Test: `tests/indexer/module-map.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/indexer/module-map.test.ts
import { describe, it, expect } from 'vitest';
import { ModuleMap } from '../../src/indexer/module-map';

describe('ModuleMap', () => {
  it('registers and looks up by file + name', () => {
    const m = new ModuleMap();
    m.register('a.ts', [{ id: 'S1', name: 'foo' }, { id: 'S2', name: 'bar' }]);
    expect(m.getSymbolId('a.ts', 'foo')).toBe('S1');
    expect(m.getSymbolId('a.ts', 'missing')).toBeNull();
  });

  it('findSymbol returns first match across all files', () => {
    const m = new ModuleMap();
    m.register('a.ts', [{ id: 'S1', name: 'dup' }]);
    m.register('b.ts', [{ id: 'S2', name: 'dup' }]);
    const id = m.findSymbol('dup');
    expect(['S1', 'S2']).toContain(id);
  });

  it('clearFile removes file-scoped entries', () => {
    const m = new ModuleMap();
    m.register('a.ts', [{ id: 'S1', name: 'foo' }]);
    m.clearFile('a.ts');
    expect(m.getSymbolId('a.ts', 'foo')).toBeNull();
    expect(m.findSymbol('foo')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/indexer/module-map.ts
export interface SymbolRef { id: string; name: string }

export class ModuleMap {
  private fileSymbols = new Map<string, Map<string, string>>();
  private nameIndex = new Map<string, string[]>();

  register(filePath: string, symbols: SymbolRef[]): void {
    this.clearFile(filePath);
    const perFile = new Map<string, string>();
    for (const s of symbols) {
      perFile.set(s.name, s.id);
      const list = this.nameIndex.get(s.name) ?? [];
      list.push(s.id);
      this.nameIndex.set(s.name, list);
    }
    this.fileSymbols.set(filePath, perFile);
  }

  getSymbolId(filePath: string, name: string): string | null {
    return this.fileSymbols.get(filePath)?.get(name) ?? null;
  }

  findSymbol(name: string): string | null {
    const list = this.nameIndex.get(name);
    return list && list.length > 0 ? list[0] : null;
  }

  clearFile(filePath: string): void {
    const old = this.fileSymbols.get(filePath);
    if (!old) return;
    for (const [name, id] of old) {
      const list = this.nameIndex.get(name);
      if (!list) continue;
      const filtered = list.filter(x => x !== id);
      if (filtered.length === 0) this.nameIndex.delete(name);
      else this.nameIndex.set(name, filtered);
    }
    this.fileSymbols.delete(filePath);
  }
}
```

- [ ] **Step 3: Run — green**

- [ ] **Step 4: Commit**

```bash
git add src/indexer/module-map.ts tests/indexer/module-map.test.ts
git commit -m "feat(indexer): ModuleMap in-RAM name→UUID resolution"
```

### Task 10: `RelationExtractor` core — transactional DELETE+INSERT, caps, guards

**Files:**
- Create: `src/indexer/relation-extractor.ts`
- Test: `tests/indexer/relation-extractor.test.ts`

- [ ] **Step 1: Write failing test** covering (a) atomic delete+insert (EC-1.1), (b) 10 000 edge cap (EC-3.1), (c) extension guard (EC-3.2), (d) unresolved target → confidence 0.7 + NULL target_id.

```typescript
// tests/indexer/relation-extractor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { RelationExtractor, type RawEdge } from '../../src/indexer/relation-extractor';
import { ModuleMap } from '../../src/indexer/module-map';

describe('RelationExtractor.persist', () => {
  let db: Database.Database;
  let mm: ModuleMap;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.exec(`
      INSERT INTO repos(id,name,root_path) VALUES ('R','r','/r');
      INSERT INTO files(id,repo_id,rel_path,language) VALUES ('F1','R','a.ts','ts');
      INSERT INTO symbols(id,repo_id,file_id,name,kind,start_line,end_line)
        VALUES ('A','R','F1','a','function',1,2), ('B','R','F1','b','function',3,4);
    `);
    mm = new ModuleMap();
    mm.register('a.ts', [{ id: 'A', name: 'a' }, { id: 'B', name: 'b' }]);
  });

  it('extension guard skips non-code files', () => {
    const x = new RelationExtractor(db, mm, 'R');
    x.persistForFile('a.png', 'A', []);   // should no-op
    expect(db.prepare('SELECT count(*) as c FROM symbol_relations').get()).toEqual({ c: 0 });
  });

  it('inserts resolved edges with confidence 1.0', () => {
    const x = new RelationExtractor(db, mm, 'R');
    const edges: RawEdge[] = [{ sourceId: 'A', targetName: 'b', type: 'CALLS', language: 'ts' }];
    x.persistForFile('a.ts', 'A', edges);
    const rows = db.prepare(`SELECT target_id, confidence FROM symbol_relations`).all();
    expect(rows).toEqual([{ target_id: 'B', confidence: 1.0 }]);
  });

  it('unresolved target → target_id NULL, confidence 0.7', () => {
    const x = new RelationExtractor(db, mm, 'R');
    x.persistForFile('a.ts', 'A', [{ sourceId: 'A', targetName: 'external', type: 'CALLS', language: 'ts' }]);
    const row = db.prepare(`SELECT target_id, confidence FROM symbol_relations`).get() as any;
    expect(row.target_id).toBeNull();
    expect(row.confidence).toBeCloseTo(0.7);
  });

  it('atomic DELETE + INSERT replaces prior edges for file', () => {
    const x = new RelationExtractor(db, mm, 'R');
    x.persistForFile('a.ts', 'A', [{ sourceId: 'A', targetName: 'b', type: 'CALLS', language: 'ts' }]);
    x.persistForFile('a.ts', 'A', [{ sourceId: 'A', targetName: 'b', type: 'IMPORTS', language: 'ts' }]);
    const rows = db.prepare(`SELECT type FROM symbol_relations`).all() as Array<{type: string}>;
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('IMPORTS');
  });

  it('caps at 10 000 edges (EC-3.1)', () => {
    const x = new RelationExtractor(db, mm, 'R');
    const edges: RawEdge[] = Array.from({ length: 15000 }, (_, i) =>
      ({ sourceId: 'A', targetName: `t${i}`, type: 'CALLS', language: 'ts' }));
    x.persistForFile('a.ts', 'A', edges);
    const { c } = db.prepare(`SELECT count(*) as c FROM symbol_relations`).get() as any;
    expect(c).toBe(10000);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/indexer/relation-extractor.ts
import type { Database } from 'better-sqlite3';
import type { ModuleMap } from './module-map';
import type { EdgeType } from '../graph/types';
import { randomUUID } from 'crypto';
import path from 'path';
import { logger } from '../logger';

export type RawEdge = {
  sourceId: string;
  targetName: string;
  type: EdgeType;
  language: string;
  targetFile?: string;
};

const VALID_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.cs']);
const EDGE_CAP = 10_000;

export class RelationExtractor {
  constructor(
    private readonly db: Database,
    private readonly mm: ModuleMap,
    private readonly repoId: string,
  ) {}

  persistForFile(filePath: string, _sourceFileId: string, edges: RawEdge[]): void {
    if (!VALID_EXT.has(path.extname(filePath).toLowerCase())) return;

    let toInsert = edges;
    if (edges.length > EDGE_CAP) {
      logger.warn({ filePath, count: edges.length }, 'edge count exceeded cap — truncating');
      toInsert = edges.slice(0, EDGE_CAP);
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO symbol_relations
        (id, repo_id, source_id, target_id, target_name, target_file, type, language, confidence)
      VALUES (?,  ?,       ?,         ?,         ?,           ?,           ?,    ?,        ?)
    `);
    const deleteStmt = this.db.prepare(`
      DELETE FROM symbol_relations
      WHERE source_id IN (SELECT id FROM symbols WHERE file_id = (
        SELECT id FROM files WHERE repo_id = ? AND rel_path = ?))
    `);

    const tx = this.db.transaction((fp: string, rows: RawEdge[]) => {
      deleteStmt.run(this.repoId, fp);
      for (const e of rows) {
        const targetId = this.mm.findSymbol(e.targetName);
        const confidence = targetId ? 1.0 : 0.7;
        insertStmt.run(
          randomUUID(), this.repoId, e.sourceId,
          targetId, e.targetName, e.targetFile ?? null,
          e.type, e.language, confidence
        );
      }
    });
    tx(filePath, toInsert);
  }
}
```

- [ ] **Step 3: Run — green**

- [ ] **Step 4: Commit**

```bash
git add src/indexer/relation-extractor.ts tests/indexer/relation-extractor.test.ts
git commit -m "feat(indexer): RelationExtractor atomic persist (EC-1.1), 10k cap (EC-3.1)"
```

### Task 11: Wire Indexer two-pass — integrate extractor + emit reload event

**Files:**
- Modify: `src/indexer/indexer.ts`
- Test: `tests/indexer/indexer-two-pass.test.ts`

- [ ] **Step 1: Write failing test** — `indexFile` runs Pass 1 then Pass 2, emits `file-indexed` with `{ repoId, fileId }`.

- [ ] **Step 2: Implement**

```typescript
// src/indexer/indexer.ts  (excerpt — add after existing extractSymbols call)
// Pass 2: relations
const rawEdges = this.parserRegistry.extractRelations(filePath, tree);  // Chunk 6
this.relationExtractor.persistForFile(filePath, fileId, rawEdges);
this.emit('file-indexed', { repoId: this.repoId, fileId });
```

- [ ] **Step 3: Wire InMemoryGraph listener in `App.start()` (deferred to Chunk 9 Task 22).**

- [ ] **Step 4: S7 FIX — duplicate-scan guard**

```typescript
// src/indexer/indexer.ts (append)
private _scanPromise: Promise<void> | null = null;

async runFullScan(repoRoot: string): Promise<void> {
  if (this._scanPromise) return this._scanPromise;
  this._scanPromise = this._doFullScan(repoRoot).finally(() => { this._scanPromise = null; });
  return this._scanPromise;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/indexer/indexer.ts tests/indexer/indexer-two-pass.test.ts
git commit -m "feat(indexer): two-pass pipeline + scan dedup (S7)"
```

---

## Chunk 6: Tree-Sitter Query Files (JS/TS, Python, Go, Rust, C#) + ParserRegistry.extractRelations

### Task 12: Create `.scm` query files (5 languages)

**Files:**
- Create: `src/parser/queries/relations-javascript.scm`
- Create: `src/parser/queries/relations-python.scm`
- Create: `src/parser/queries/relations-go.scm`
- Create: `src/parser/queries/relations-rust.scm`
- Create: `src/parser/queries/relations-csharp.scm`

- [ ] **Step 1: Copy exact content from spec Section 2b + 3**
  (See spec lines 184–213 (JS/TS), 217–235 (Python), 239–256 (Go), 260–281 (Rust), 309–330 (C#). Copy verbatim — these are tested tree-sitter queries.)

- [ ] **Step 2: Ensure `ts-node` + Vitest can load `.scm` files**
  — they're plain text read via `fs.readFileSync`; no bundler config needed.

- [ ] **Step 3: Commit**

```bash
git add src/parser/queries/relations-*.scm
git commit -m "feat(parser): tree-sitter relation queries for 5 languages"
```

### Task 13: `ParserRegistry.extractRelations` dispatcher

**Files:**
- Modify: `src/parser/parser-registry.ts`
- Test: `tests/parser/extract-relations.test.ts`

- [ ] **Step 1: Write failing test** — parse a small TS file, expect at least one CALLS edge with correct name.

```typescript
// tests/parser/extract-relations.test.ts
import { describe, it, expect } from 'vitest';
import { ParserRegistry } from '../../src/parser/parser-registry';

const TS_SRC = `
function foo() { return 1; }
function bar() { return foo(); }
`;

describe('ParserRegistry.extractRelations', () => {
  it('captures function call in TS', () => {
    const reg = new ParserRegistry();
    const tree = reg.parse('src.ts', TS_SRC);
    const edges = reg.extractRelations('src.ts', tree, 'ts', /*sourceResolver*/ (line: number) => 'bar-id');
    expect(edges.some(e => e.targetName === 'foo' && e.type === 'CALLS')).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/parser/parser-registry.ts  (excerpt)
import fs from 'fs';
import path from 'path';
import type { RawEdge } from '../indexer/relation-extractor';

private queries = new Map<string, Query>();

private getQuery(lang: string): Query {
  const cached = this.queries.get(lang);
  if (cached) return cached;
  const scmPath = path.join(__dirname, 'queries', `relations-${lang === 'tsx' ? 'javascript' : lang}.scm`);
  const src = fs.readFileSync(scmPath, 'utf8');
  const q = new Query(this.getLanguage(lang), src);
  this.queries.set(lang, q);
  return q;
}

extractRelations(
  filePath: string,
  tree: Tree,
  lang: string,
  sourceResolver: (line: number) => string | null,
): RawEdge[] {
  const query = this.getQuery(lang);
  const edges: RawEdge[] = [];
  for (const match of query.captures(tree.rootNode)) {
    const capName = match.name;
    const node = match.node;
    // Map capture to EdgeType
    const type =
      capName.startsWith('import')     ? 'IMPORTS' :
      capName.startsWith('call')       ? 'CALLS' :
      capName.startsWith('extends')    ? 'EXTENDS' :
      capName.startsWith('base')       ? 'EXTENDS' :
      capName.startsWith('implements') ? 'IMPLEMENTS' : null;
    if (!type) continue;
    const sourceId = sourceResolver(node.startPosition.row);
    if (!sourceId) continue;
    edges.push({ sourceId, targetName: node.text, type, language: lang });
  }
  return edges;
}
```

(The `sourceResolver` takes a line number and returns the enclosing symbol's UUID — supplied by `Indexer` from the symbols emitted in Pass 1 for this file.)

- [ ] **Step 3: Run — green**

- [ ] **Step 4: Commit**

```bash
git add src/parser/parser-registry.ts tests/parser/extract-relations.test.ts
git commit -m "feat(parser): extractRelations dispatcher with capture→EdgeType mapping"
```

---

## Chunk 7: RoslynBridge + C# Tier-1 Fallback + Ignore Patterns

### Task 14: Add C# ignore patterns to Watcher + runFullScan (EC-4.3)

**Files:**
- Modify: `src/indexer/watcher.ts` (or wherever `IGNORE_PATTERNS` lives)
- Test: `tests/indexer/csharp-ignore.test.ts`

- [ ] **Step 1: Copy `CSHARP_IGNORE_PATTERNS` from spec line 348** into a new exported const.

- [ ] **Step 2: Write test** — creating files under `obj/`, `bin/`, etc. are not yielded by the scanner.

- [ ] **Step 3: Commit**

```bash
git add src/indexer/watcher.ts tests/indexer/csharp-ignore.test.ts
git commit -m "feat(indexer): C# ignore patterns — obj/, bin/, *.g.cs, *.Designer.cs (EC-4.3)"
```

### Task 15: `RoslynBridge` NDJSON framing + crash guards (N3 / EC-4.4 / S-5 / EC-4.5)

**Files:**
- Create: `src/analyzers/roslyn-bridge.ts`
- Test: `tests/analyzers/roslyn-bridge.test.ts` (uses a fake daemon script, spawned via `node -e '...'`)

- [ ] **Step 1: Write failing test** — spawn a fake daemon that echoes one NDJSON line; verify `analyze()` resolves correctly. Then test (a) timeout → falls back to null, (b) stdout close mid-response (N3) rejects with `stdout closed before response`, (c) missing binary → returns null silently.

Sample fake daemon for tests:
```typescript
const FAKE_DAEMON = `
process.stdin.on('data', () => {
  process.stdout.write(JSON.stringify({symbols:[],relations:[],partialMerges:[],errors:[]}) + '\\n');
});
`;
```

- [ ] **Step 2: Implement** — copy the `RoslynBridge` class verbatim from spec lines 495–549 plus `getRoslynBinaryPath()` from 426–434 and the startup warn log (554–561).

Key deviations: export `RoslynBridge`, accept an `injectedBinaryPath?: string` constructor arg for testability.

- [ ] **Step 3: Run — green**

- [ ] **Step 4: Commit**

```bash
git add src/analyzers/roslyn-bridge.ts tests/analyzers/roslyn-bridge.test.ts
git commit -m "feat(analyzer): RoslynBridge NDJSON + crash guards (N3/EC-4.4/S-5/EC-4.5)"
```

### Task 16: Wire Roslyn into C# Pass 2 with Tier-1 fallback

**Files:**
- Modify: `src/indexer/relation-extractor.ts` OR `src/parser/parser-registry.ts` (whichever dispatches per-language)
- Test: `tests/indexer/csharp-tier-fallback.test.ts` — Roslyn missing → tree-sitter path runs.

- [ ] **Step 1: For `.cs` files, call `roslynBridge.analyze(...)`. If result is `null`, fall through to tree-sitter `.scm` extraction.**

```typescript
// within extractRelations dispatch
if (lang === 'csharp') {
  const roslyn = await this.roslynBridge.analyze({ action:'analyze', files:[filePath], projectRoot:this.repoRoot, repoId:this.repoId });
  if (roslyn) return roslyn.relations.map(r => ({
    sourceId: sourceResolver(/* file+name lookup via mm */) ?? '',
    targetName: r.targetName, type: r.type, language: 'csharp', targetFile: r.targetFile ?? undefined,
  })).filter(e => e.sourceId);
  // fall through to tree-sitter
}
```

- [ ] **Step 2: Partial-class merge** — if `roslyn.partialMerges` is non-empty, the indexer merges symbols sharing a `partialClassGroup` into one row (reuse a single `symbol_id` across files). Record a note: _"MVP simplification: keep separate symbol rows, but add a `partial_group` TEXT column in a future migration. Not required for v1."_  Emit an info log for now.

- [ ] **Step 3: Commit**

```bash
git add src/parser/parser-registry.ts src/indexer/relation-extractor.ts tests/indexer/csharp-tier-fallback.test.ts
git commit -m "feat(indexer): C# Tier-2 Roslyn with automatic Tier-1 fallback"
```

### Task 17: `.gitattributes` + binary placeholders

**Files:**
- Create: `.gitattributes` (append if exists)
- Create (empty placeholders only): `bin/roslyn/win-x64/.gitkeep`, `bin/roslyn/linux-x64/.gitkeep`, `bin/roslyn/darwin-arm64/.gitkeep`
- Create: `scripts/build-roslyn.sh` — stub script with `echo "TODO: publish self-contained Roslyn analyzer"`.
- Create (stub): `roslyn-analyzer/README.md` — document that the C# project lives here and link to spec Section 3.

- [ ] **Step 1: `.gitattributes` content**

```
bin/roslyn/** binary
bin/roslyn/** -diff -merge
```

- [ ] **Step 2: Commit**

```bash
git add .gitattributes bin/roslyn scripts/build-roslyn.sh roslyn-analyzer/README.md
git commit -m "chore: Roslyn binary placeholder + .gitattributes (Tier-2 optional)"
```

_Note:_ Actually building the C# analyzer project is **out of scope for this plan** — Tier-1 tree-sitter is the hard requirement for v1. The Roslyn binary can be built later via `scripts/build-roslyn.sh`.

---

## Chunk 8: ContextEnricher (Tầng 2)

### Task 18: `extractMentions` with dedup (S-6 FIX)

**Files:**
- Create: `src/mcp/context-enricher.ts` (scaffold — only `extractMentions` for now)
- Test: `tests/mcp/extract-mentions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/mcp/extract-mentions.test.ts
import { describe, it, expect } from 'vitest';
import { ContextEnricher } from '../../src/mcp/context-enricher';

describe('ContextEnricher.extractMentions', () => {
  const e = new ContextEnricher('repo-1', {} as any, {} as any);

  it('captures backtick names', () => {
    expect(e.extractMentions('check `processOrder` please')).toContain('processOrder');
  });

  it('captures PascalCase', () => {
    expect(e.extractMentions('the UserController handles it')).toContain('UserController');
  });

  it('captures Vietnamese "hàm X"', () => {
    expect(e.extractMentions('hàm xuLyDonHang chạy chậm')).toContain('xuLyDonHang');
  });

  it('captures English "function X"', () => {
    expect(e.extractMentions('function parseToken broken')).toContain('parseToken');
  });

  it('captures file paths', () => {
    expect(e.extractMentions('see src/utils.ts')).toContain('src/utils.ts');
  });

  it('dedups overlap between patterns (S-6 FIX)', () => {
    // `UserController` matches both backtick AND PascalCase
    const r = e.extractMentions('fix `UserController` now');
    const count = r.filter(x => x === 'UserController').length;
    expect(count).toBe(1);
  });

  it('caps at TOKEN_BUDGET.maxSymbols (5)', () => {
    const msg = '`A1` `A2` `A3` `A4` `A5` `A6` `A7`';
    expect(e.extractMentions(msg).length).toBe(5);
  });
});
```

- [ ] **Step 2: Implement** — copy from spec lines 614–626 (`extractMentions`) + token budget constant.

- [ ] **Step 3: Run — green**

- [ ] **Step 4: Commit**

```bash
git add src/mcp/context-enricher.ts tests/mcp/extract-mentions.test.ts
git commit -m "feat(mcp): ContextEnricher.extractMentions with dedup cap (S-6)"
```

### Task 19: `resolveSymbols` — exact then FTS fallback (B4 / S11 / N4)

**Files:**
- Modify: `src/mcp/context-enricher.ts`
- Test: `tests/mcp/resolve-symbols.test.ts`

- [ ] **Step 1: Write tests** for (a) exact name hit, (b) FTS fuzzy hit, (c) operator-character in name (`foo+bar`) handled safely, (d) malformed FTS doesn't throw.

```typescript
// tests/mcp/resolve-symbols.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { ContextEnricher } from '../../src/mcp/context-enricher';

describe('ContextEnricher.resolveSymbols', () => {
  let db: Database.Database;
  let e: ContextEnricher;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.exec(`
      INSERT INTO repos(id,name,root_path) VALUES ('R','r','/r');
      INSERT INTO files(id,repo_id,rel_path,language) VALUES ('F','R','a.ts','ts');
      INSERT INTO symbols(id,repo_id,file_id,name,kind,start_line,end_line)
        VALUES ('S1','R','F','processOrder','function',1,2);
      INSERT INTO symbols_fts(rowid, name) SELECT rowid, name FROM symbols;
    `);
    e = new ContextEnricher('R', db, {} as any);
  });

  it('exact match', async () => {
    const r = await (e as any).resolveSymbols(['processOrder']);
    expect(r[0].id).toBe('S1');
  });

  it('FTS fuzzy match', async () => {
    const r = await (e as any).resolveSymbols(['process']);
    expect(r[0]?.id).toBe('S1');
  });

  it('operator char in name does not throw (B4)', async () => {
    const r = await (e as any).resolveSymbols(['bogus+name']);
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement** — copy verbatim from spec lines 628–671. Use FTS5 DDL already added in migration 001 (verify the `content=symbols, content_rowid=rowid` options are present per N4 FIX; if not, amend 001 — but spec assumes Plan 1 already did).

- [ ] **Step 3: Run — green**

- [ ] **Step 4: Commit**

```bash
git add src/mcp/context-enricher.ts tests/mcp/resolve-symbols.test.ts
git commit -m "feat(mcp): resolveSymbols exact+FTS fallback, B4/S11/N4 guards"
```

### Task 20: `fetchSymbolContext` + `batchFetchNames` (N2 error wrap, B2 chunking)

**Files:**
- Modify: `src/mcp/context-enricher.ts`
- Test: `tests/mcp/fetch-symbol-context.test.ts`

- [ ] **Step 1: Write test** — seed graph with A→B→C, fetch context for A depth=2, expect callees `[B, C]` with correct depth/via, callers `[]`.

- [ ] **Step 2: Implement** — copy spec lines 673–731.

- [ ] **Step 3: Test N2 FIX** — simulate `IdMapper.resolve` throwing by priming with orphan int; verify `enrich()` logs warn and continues.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/context-enricher.ts tests/mcp/fetch-symbol-context.test.ts
git commit -m "feat(mcp): fetchSymbolContext + batchFetchNames (N2/B2)"
```

### Task 21: `assembleContext` + `enrich` + impact-warning threshold

**Files:**
- Modify: `src/mcp/context-enricher.ts`
- Test: `tests/mcp/assemble-context.test.ts`

- [ ] **Step 1: Write test** — (a) enriched prompt contains `## Code Context`, (b) impact warning shows when ≥10 edges, (c) token budget cuts off at 2000.

- [ ] **Step 2: Implement** — copy spec lines 733–779.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/context-enricher.ts tests/mcp/assemble-context.test.ts
git commit -m "feat(mcp): assembleContext with token budget + impact warning"
```

---

## Chunk 9: 5 New MCP Tools + app.ts Startup Sequencing

### Task 22: `get_symbol_context` tool

**Files:**
- Create: `src/mcp/tools/get-symbol-context.ts`
- Modify: `src/mcp/server.ts` — register tool
- Test: `tests/mcp/tools/get-symbol-context.test.ts`

- [ ] **Step 1: Zod schema**

```typescript
import { z } from 'zod';
export const getSymbolContextSchema = z.object({
  symbolName: z.string().min(1),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(2),
});
```

- [ ] **Step 2: Handler**

```typescript
export async function getSymbolContext(app: App, input: z.infer<typeof getSymbolContextSchema>) {
  const [resolved] = await app.enricher['resolveSymbols']([input.symbolName]);
  if (!resolved) return { error: 'symbol not found', symbolName: input.symbolName };
  const ctx = app.enricher['fetchSymbolContext'](resolved.id, app.repoId, input.depth);
  return {
    symbol: { name: ctx.name, kind: ctx.kind, filePath: ctx.filePath, line: ctx.line },
    callers: ctx.callers,
    callees: ctx.callees,
    impactCount: ctx.callers.length + ctx.callees.length,
    resolvedAs: resolved.name,
  };
}
```

- [ ] **Step 3: Test** — seed DB, call tool, expect populated structure.

- [ ] **Step 4: Register in `src/mcp/server.ts` tool list.**

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/get-symbol-context.ts src/mcp/server.ts tests/mcp/tools/get-symbol-context.test.ts
git commit -m "feat(mcp): tool get_symbol_context (depth 1-3)"
```

### Task 23: `get_impact_analysis` tool

**Files:**
- Create: `src/mcp/tools/get-impact-analysis.ts`
- Test: `tests/mcp/tools/get-impact-analysis.test.ts`

- [ ] **Step 1: Tool** — resolves symbol, BFS outgoing+incoming depth=3, groups by depth, returns `{ depth1: string[], depth2: string[], depth3: string[], totalCount }`. Use `bfsTraverse` + `batchFetchNames`.

- [ ] **Step 2: Test** — A→B→C→D; impact of A has depth1=[B], depth2=[C], depth3=[D].

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/get-impact-analysis.ts tests/mcp/tools/get-impact-analysis.test.ts src/mcp/server.ts
git commit -m "feat(mcp): tool get_impact_analysis (depth-3 blast radius)"
```

### Task 24: `find_callers` + `find_callees` tools

**Files:**
- Create: `src/mcp/tools/find-callers.ts`
- Create: `src/mcp/tools/find-callees.ts`
- Test: `tests/mcp/tools/find-callers-callees.test.ts`

- [ ] **Step 1: Each tool** calls BFS depth=1 (immediate neighbors) filtered to `via === 'CALLS'`, joins to `symbols` for `{ name, filePath, line }`.

- [ ] **Step 2: Register + test + commit**

```bash
git add src/mcp/tools/find-callers.ts src/mcp/tools/find-callees.ts src/mcp/server.ts tests/mcp/tools/find-callers-callees.test.ts
git commit -m "feat(mcp): tools find_callers and find_callees (direct only)"
```

### Task 25: `get_import_chain` tool

**Files:**
- Create: `src/mcp/tools/get-import-chain.ts`
- Test: `tests/mcp/tools/get-import-chain.test.ts`

- [ ] **Step 1: Implement** — resolve `filePath` → `file_id`, find all symbols in file, BFS `IMPORTS` edges depth=default(2), group results into `chain: [{ file, imports: string[] }]`.

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/get-import-chain.ts tests/mcp/tools/get-import-chain.test.ts src/mcp/server.ts
git commit -m "feat(mcp): tool get_import_chain"
```

### Task 26: `src/app.ts` startup sequencing (EC-1.3, EC-6.1/.2/.4/.5, B-1, S-3, S-4, N1)

**Files:**
- Modify: `src/app.ts`
- Test: `tests/app-startup.test.ts` — fork a subprocess with `REPO_ROOT=/nonexistent`, expect exit code 1.

- [ ] **Step 1: Replace `src/app.ts`** with the startup block from spec lines 1198–1261 adapted to existing module imports. Must:
  1. Read `REPO_ROOT` from env, fall back to `process.cwd()`.
  2. Fail-fast with `logger.fatal` + `process.exit(1)` if `REPO_ROOT` missing (EC-6.1).
  3. Compute `_repoSlug = sha256(normalized)[:8]` inline (N1/B1).
  4. Derive `DB_PATH` with `${slugify(REPO_ROOT)}-${_repoSlug}.db` fallback (S-4).
  5. `mkdirSync(dirname(DB_PATH), { recursive: true })` (EC-6.2).
  6. `await runMigrations(DB_PATH)`; `const repoId = ensureRepo(db, REPO_ROOT)` (EC-6.5 inside).
  7. `graph.setScanInProgress(repoId, true)` → `indexer.runFullScan(REPO_ROOT).then(() => graph.setScanInProgress(false); graph.invalidate(repoId))` with retry-in-60s on error (B-1).
  8. `startMcpTransport()` **after** `repoId` set (EC-1.3).
  9. `setInterval(() => graph.evictStale(), 10*60*1000).unref()` (Chunk 3 deferred task).
  10. Wire `indexer.on('file-indexed', ({ fileId }) => graph.reloadFile(repoId, fileId))`.

- [ ] **Step 2: Test** the fail-fast path with an invalid path.

- [ ] **Step 3: Commit**

```bash
git add src/app.ts tests/app-startup.test.ts
git commit -m "feat(app): startup sequencing — single-repo REPO_ROOT, lazy graph, retry (EC-1.3/6.*/B-1)"
```

### Task 27: `ensureRepo` path normalization (EC-6.5 / S-8)

**Files:**
- Modify: `src/db/repo-registry.ts` (or wherever Plan 1 put it)
- Test: `tests/db/ensure-repo.test.ts`

- [ ] **Step 1: Write test** — (a) same repoId for `E:\x\y` and `e:/x/y`, (b) `ON CONFLICT UPDATE SET name=excluded.name` handles rename.

- [ ] **Step 2: Implement** (copy spec lines 1323–1342, plus `slugify` from 1348–1352 with `|| 'repo'` fallback for M15).

- [ ] **Step 3: Commit**

```bash
git add src/db/repo-registry.ts tests/db/ensure-repo.test.ts
git commit -m "feat(db): ensureRepo path normalize (EC-6.5) + rename handling (S-8/M15)"
```

### Task 28: Tầng 2 MCP transport interception

**Files:**
- Modify: `src/mcp/transport.ts` (or wherever MCP messages are handled)
- Test: `tests/mcp/tang-2-injection.test.ts`

- [ ] **Step 1: Before forwarding a user message to the model, call `enricher.enrich(userMessage)` and replace the message with `enrichedPrompt`. Must be gated by an `ENABLE_TANG_2=true` env (default on).** When disabled, pass-through unchanged.

- [ ] **Step 2: Test** — pass a message mentioning a known symbol; expect the outgoing prompt to contain `## Code Context`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/transport.ts tests/mcp/tang-2-injection.test.ts
git commit -m "feat(mcp): Tầng 2 forced context injection, toggleable via ENABLE_TANG_2"
```

---

## Final Verification Task

### Task 29: End-to-end smoke test on a real repo snapshot

**Files:**
- Create: `tests/e2e/smoke.test.ts`
- Create: `tests/fixtures/e2e-repo/` (tiny 3-file TS repo)

- [ ] **Step 1:** In a temp dir, run migrations, seed 3 TS files with 2 CALL relationships, call `Indexer.runFullScan`, then call each of the 5 new MCP tools, assert response shapes.

- [ ] **Step 2: Run full suite:**

```bash
npx vitest run
```

Expected: all suites green.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.test.ts tests/fixtures/e2e-repo
git commit -m "test(e2e): smoke test — index + all 5 RI tools on fixture repo"
```

---

## Risks & Open Questions

1. **Tree-sitter WASM vs native bindings** — Plan 2 should have locked this in. If WASM, `Query` constructor signature differs slightly; adapt Task 13. If native, memory usage is higher but query perf is better.
2. **Roslyn C# project source** — this plan scaffolds the binary interface and ignore list only. Building the actual `roslyn-analyzer` C# project is a follow-up (see `roslyn-analyzer/README.md`). Tier-1 tree-sitter is the v1 requirement.
3. **ModuleMap cross-file resolution accuracy** — current `findSymbol` returns first match on name collision. For a v1.1, enhance with import-aware resolution (track which files a given file imports, restrict name search to import graph).
4. **Partial class merging (C#)** — v1 keeps separate symbol rows; Roslyn emits `PartialMerge` hints but we log-only. Add a `partial_group` column in migration 003 later.
5. **FTS content table ownership** — assumes Plan 1 migration 001 defined `symbols_fts` with `content=symbols, content_rowid=rowid`. If not, a migration 003 patch is needed (N4 FIX). Verify before Chunk 8 execution.

---

## Done Criteria

- [ ] `npx vitest run` → 100% pass, no skipped specs added by this plan.
- [ ] `npm run lint` → 0 errors.
- [ ] `npm run build` → succeeds; `dist/` contains compiled JS.
- [ ] Manual: start server with `REPO_ROOT=$(pwd)`, call `find_callers` on a known symbol, verify results match DB state.
- [ ] RAM usage on a 5k-file repo ≤ 60 MB steady state (measured via `process.memoryUsage().heapUsed` one minute after full index).
- [ ] C# support: both Roslyn-present and Roslyn-missing paths work (simulate missing via `rm -r bin/roslyn`).
