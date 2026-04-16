# Relationship Intelligence Design

**Date:** 2026-04-16  
**Status:** Approved  
**Feature:** Symbol Relationship Intelligence for MCP Server (mcp-code1)

---

## Overview

Add graph-based symbol relationship intelligence to the existing MCP server so it can understand and traverse CALLS, IMPORTS, EXTENDS, and IMPLEMENTS relationships between code symbols — similar to GitNexus. The feature works across TypeScript/JavaScript, Python, Go, Rust, and C# (day-one support).

---

## Section 1: SQLite Schema & Storage

### New table: `symbol_relations`

```sql
CREATE TABLE symbol_relations (
  id          TEXT PRIMARY KEY,
  repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_id   TEXT,             -- NULL if unresolved at index time
  target_name TEXT NOT NULL,    -- raw name always stored for debug
  target_file TEXT,
  type        TEXT NOT NULL,    -- CALLS | IMPORTS | EXTENDS | IMPLEMENTS
  language    TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 1.0,  -- 1.0 resolved, 0.7 unresolved
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_relations_source   ON symbol_relations(source_id);
CREATE INDEX idx_relations_target   ON symbol_relations(target_id);
CREATE INDEX idx_relations_repo     ON symbol_relations(repo_id);
CREATE INDEX idx_relations_repo_type ON symbol_relations(repo_id, type);  -- composite; single `type` has low selectivity
```

### Design decisions

- **SQLite stores outgoing edges only** (A→B). Incoming edges (B←A) are computed at graph load time by reversing outgoing — one DB read gives two-direction traversal.
- `target_id` is NULL when tree-sitter cannot resolve the target symbol at index time (e.g., external library calls). These rows are still stored with `confidence=0.7` for debugging but excluded from the in-memory graph.
- Migration file: `src/db/migrations/002_relations.ts`

---

## Section 2: In-Memory Graph

### Data structures

```typescript
type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

// In-memory uses integer IDs (not UUID strings) to reduce RAM by ~50%
type IntId = number;

type Edge = {
  targetId: IntId;
  type: EdgeType;
  confidence: number;
};

type GraphNode = {
  outgoing: Edge[];   // edges this symbol emits (A→B)
  incoming: Edge[];   // edges pointing to this symbol (B←A), computed at load
};

// RepoGraph is the single canonical type — a self-contained unit
// that includes the node map, UUID↔integer mapper, and file index.
// All three fields are evicted together when the TTL expires.
type RepoGraph = {
  nodes:     Map<IntId, GraphNode>;
  mapper:    IdMapper;              // UUID↔integer; GC'd with this graph
  fileIndex: Map<string, IntId[]>;  // fileId → list of IntIds in that file
};

// Context returned per symbol by fetchSymbolContext()
type SymbolContext = {
  symbolUuid: string;
  name:       string;
  kind:       string;   // 'function' | 'class' | 'method' | etc.
  filePath:   string;
  line:       number;
  callers:    Array<{ symbolId: string; name: string; depth: number; via: EdgeType }>;
  callees:    Array<{ symbolId: string; name: string; depth: number; via: EdgeType }>;
};

// Enriched context returned by assembleContext()
type EnrichedContext = {
  enrichedPrompt: string;
  symbolCount:    number;
  tokenCount:     number;
};

// Symbol resolved from DB by resolveSymbols()
type ResolvedSymbol = {
  id:       string;   // UUID
  name:     string;
  filePath: string;
  repoId:   string;   // needed to load the correct RepoGraph
};
```

### Why integer IDs in RAM

UUID strings are 36 bytes each. With 1M edges each referencing 2 UUIDs, that is ~144MB just for IDs. Mapping UUID→integer at load time and using integers inside the graph reduces this to ~8MB — an 18x reduction for the ID portion.

SQLite continues to use UUID strings for cross-table compatibility. The mapping table (`uuidToInt`, `intToUuid`) lives only in RAM and is rebuilt at each load.

### Bidirectional traversal without storing incoming in DB

```
DB stores:  A → B  (outgoing only)
            A → C
            D → B

At load time, after building outgoing map:
  For each edge A→B, also add B.incoming.push({ targetId: A, ... })

Result in RAM:
  A.outgoing = [B, C]
  B.incoming = [A, D]   ← derived, not stored in DB
  D.outgoing = [B]
```

This means: "Who calls `processOrder`?" is answered in O(1) from RAM — no DB query needed.

### Depth-3 BFS traversal (blast radius)

```typescript
type TraversalResult = {
  symbolId: IntId;   // integer ID — use IdMapper.resolve() to get UUID
  depth: number;     // 1, 2, or 3
  via: EdgeType;     // which relationship type was traversed
};

function bfsTraverse(
  graph: RepoGraph,
  startId: IntId,
  direction: 'outgoing' | 'incoming',
  maxDepth: number = 3,
): TraversalResult[] {
  const visited = new Set<IntId>([startId]);  // pre-add start to prevent self-loop results
  const queue: Array<{ id: IntId; depth: number }> = [{ id: startId, depth: 0 }];
  const results: TraversalResult[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const node = graph.nodes.get(id);   // graph.nodes (not graph directly)
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

**Note on self-loops:** `startId` is pre-added to `visited`, so self-referencing edges (A→A) are excluded from results. This is the desired behavior for blast radius analysis.

---

## Section 2b: Tree-Sitter Query Files (All Languages)

These `.scm` files drive Pass 2 of the indexer. Each file uses tree-sitter captures to extract raw relationship data.

### JavaScript / TypeScript (`relations-javascript.scm`)

```scheme
; ES module imports: import { foo } from './bar'
(import_statement
  source: (string (string_fragment) @import.path)) @import

; require calls: const x = require('./foo')
(call_expression
  function: (identifier) @_req (#eq? @_req "require")
  arguments: (arguments (string (string_fragment) @import.path))) @import.require

; function/method calls: foo(), obj.foo()
(call_expression
  function: [(identifier) @call.name
             (member_expression property: (property_identifier) @call.name)]) @call

; class extends: class A extends B
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage (identifier) @extends.name)) @class.extends

; interface extends (TypeScript): interface A extends B, C
(interface_declaration
  name: (type_identifier) @interface.name
  (extends_type_clause (type_identifier) @extends.name)) @interface.extends

; implements (TypeScript): class A implements B, C
(class_declaration
  name: (type_identifier) @class.name
  (implements_clause (type_identifier) @implements.name)) @class.implements
```

### Python (`relations-python.scm`)

```scheme
; import module: import os, import os.path
(import_statement (dotted_name) @import.name) @import

; from import: from .models import User
(import_from_statement
  module_name: (dotted_name) @import.module
  name: (dotted_name) @import.name) @import.from

; function calls: foo(), obj.foo()
(call
  function: [(identifier) @call.name
             (attribute attribute: (identifier) @call.name)]) @call

; class inheritance: class A(B, C)
(class_definition
  name: (identifier) @class.name
  (argument_list (identifier) @base.name)) @class.base
```

### Go (`relations-go.scm`)

```scheme
; import: import "fmt", import alias "pkg/path"
(import_spec path: (interpreted_string_literal) @import.path) @import

; function calls: foo(), pkg.Foo()
(call_expression
  function: [(identifier) @call.name
             (selector_expression field: (field_identifier) @call.name)]) @call

; struct embedding (treated as EXTENDS): type A struct { B }
(field_declaration
  type: (type_identifier) @extends.name
  (#not-match? @extends.name "^[a-z]")) @struct.embed

; interface embedding: type I interface { J }
(method_elem
  type: (type_identifier) @extends.name) @interface.embed
```

### Rust (`relations-rust.scm`)

```scheme
; use declarations: use std::io::Write
(use_declaration argument: (scoped_identifier) @import.name) @import
(use_declaration argument: (identifier) @import.name) @import.simple

; function calls: foo(), self.foo(), Struct::foo()
(call_expression
  function: [(identifier) @call.name
             (field_expression field: (field_identifier) @call.name)
             (scoped_identifier name: (identifier) @call.name)]) @call

; impl for trait (IMPLEMENTS): impl Trait for Struct
(impl_item
  trait: (type_identifier) @implements.name
  type: (type_identifier) @class.name) @impl.trait

; struct newtype (EXTENDS): struct A(B)
(struct_item
  name: (type_identifier) @class.name
  body: (ordered_field_declaration_list
    (type_identifier) @extends.name)) @struct.newtype
```

**Known limitations (non-C# languages):**

| Language | Gap | Impact |
|----------|-----|--------|
| JS/TS | Dynamic property access (`obj[key]()`) not captured | Low — static analysis only |
| Python | `__init__.py` re-exports not traced | Medium — import chains may be incomplete |
| Go | Method sets on pointer receivers may be missed | Low |
| Rust | Macro-generated calls (`derive`, `proc_macro`) not captured | Medium — common in Rust codebases |

---

## Section 3: C# Support

### Two-tier approach

C# support uses two tiers based on whether a Roslyn binary is available on the host machine.

| Tier | Method | Accuracy | Requirement |
|------|--------|----------|-------------|
| Tier 1 | tree-sitter-c-sharp@0.23.5 | ~75-80% | npm package only (always available) |
| Tier 2 | Roslyn daemon | ~98% | Pre-built binary in `bin/roslyn/` |

Tier 2 is optional but strongly recommended. The system falls back to Tier 1 automatically if no binary is found.

### Tree-sitter C# queries (`src/parser/queries/relations-csharp.scm`)

```scheme
; using directives (all variants)
(using_directive [(qualified_name) (identifier)] @import.name) @import

; member access calls: obj.Method()
(invocation_expression
  function: (member_access_expression
    name: (identifier) @call.name)) @call.member

; simple calls: Method()  [Gap 1 fix]
(invocation_expression
  function: (identifier) @call.name) @call.simple

; constructor calls: new ClassName()  [Gap 3 fix]
(object_creation_expression
  type: (identifier) @call.constructor) @call.new

; class/record/struct inheritance — base_list is flat
(class_declaration
  name: (identifier) @class.name
  (base_list (_) @base.name)) @class.base
```

### Known tree-sitter limitations (C#)

| Gap | Description | Mitigation |
|-----|-------------|------------|
| EXTENDS vs IMPLEMENTS indistinguishable | `base_list` is flat in tree-sitter | Heuristic: `I` prefix + PascalCase → IMPLEMENTS, else → EXTENDS |
| partial class | Each file seen as separate class | Accepted limitation; Roslyn merges correctly |
| Generic type calls | `List<T>` calls not captured | Low priority for relationship graph |
| Conditional compilation | `#if` blocks not evaluated | Accepted |
| Dynamic dispatch | Runtime polymorphism | Accepted — static analysis only |

### Roslyn daemon

**Binary distribution**: Pre-built self-contained binaries committed directly to git, no installation required for end users.

```
bin/
  roslyn/
    win-x64/roslyn-analyzer.exe      (~20MB)
    linux-x64/roslyn-analyzer        (~20MB)
    darwin-arm64/roslyn-analyzer     (~20MB)
```

`.gitattributes`:
```
bin/roslyn/** binary
bin/roslyn/** -diff -merge
```

**RoslynBridge** (`src/analyzers/roslyn-bridge.ts`):

```typescript
type RoslynRequest = {
  action: 'analyze';
  files: string[];
  projectRoot: string;
  repoId: string;
};

// A single symbol extracted by Roslyn (richer than tree-sitter)
type RoslynSymbol = {
  name: string;
  kind: 'class' | 'method' | 'interface' | 'property' | 'field' | 'enum';
  filePath: string;
  line: number;
  column: number;
  partialClassGroup?: string;  // set when symbol is a partial class member
};

// A directed relationship between two symbols
type RoslynRelation = {
  sourceFile: string;
  sourceName: string;
  targetName: string;
  targetFile: string | null;   // null for external symbols
  type: 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';
  confidence: 1.0;             // Roslyn always resolves — always 1.0
};

// When Roslyn detects partial class spread across multiple files,
// it emits a PartialMerge so the indexer can unify them into one symbol
type PartialMerge = {
  className: string;
  files: string[];             // all files contributing to this partial class
  mergedSymbolId?: string;     // assigned by indexer after merging
};

type RoslynResponse = {
  symbols: RoslynSymbol[];
  relations: RoslynRelation[];
  partialMerges: PartialMerge[];
  errors: string[];
};

function getRoslynBinaryPath(): string | null {
  const platform = process.platform;   // win32 | linux | darwin
  const arch     = process.arch;       // x64 | arm64
  // Normalize platform name to match directory convention: win32→win, linux→linux, darwin→darwin
  const platformDir = platform === 'win32' ? 'win' : platform;
  const name        = platform === 'win32' ? 'roslyn-analyzer.exe' : 'roslyn-analyzer';
  const p = path.join(__dirname, '..', '..', 'bin', 'roslyn', `${platformDir}-${arch}`, name);
  return existsSync(p) ? p : null;
}
```

Communication: JSON over stdin/stdout. The daemon is a long-running subprocess; the bridge reuses it via a persistent child process handle.

---

## Section 4: MCP Tools & Tầng 2 ContextEnricher

### 5 new MCP tools

| Tool | Input | Output |
|------|-------|--------|
| `get_symbol_context` | `{ symbolName: string, repoId: string, depth?: 1\|2\|3 }` | `{ symbol, callers[], callees[], imports[], impactCount }` |
| `get_impact_analysis` | `{ symbolName: string, repoId: string }` | `{ depth1: string[], depth2: string[], depth3: string[], totalCount: number }` |
| `find_callers` | `{ symbolName: string, repoId: string }` | `{ callers: Array<{ name, filePath, line }> }` |
| `find_callees` | `{ symbolName: string, repoId: string }` | `{ callees: Array<{ name, filePath, line }> }` |
| `get_import_chain` | `{ filePath: string, repoId: string, depth?: number }` | `{ chain: Array<{ file, imports: string[] }> }` |

All tools accept `repoId` as required. `symbolName` supports exact match and partial match (uses FTS fallback). All responses include a `resolvedAs` field showing which symbol was matched when disambiguation was needed.

Total tools: 11 existing + 5 new = 16 tools (same count as GitNexus).

### Tầng 2: Forced Pre-fetch Context Injection

Works with **any AI model** regardless of tool-calling capability. The MCP server intercepts user messages before they reach the AI, injects relevant graph context, and forwards the enriched prompt.

```typescript
// src/mcp/context-enricher.ts

export class ContextEnricher {
  async enrich(userMessage: string, repoId?: string): Promise<EnrichedContext> {
    const mentions        = this.extractMentions(userMessage);
    const resolvedSymbols = await this.resolveSymbols(mentions, repoId);
    const symbolContexts  = await Promise.all(
      resolvedSymbols.map(s => this.fetchSymbolContext(s.id, s.repoId, 2))
    );
    return this.assembleContext(symbolContexts, userMessage);
  }

  extractMentions(message: string): string[] {
    return [
      ...message.matchAll(/`([A-Za-z_][A-Za-z0-9_.]*)`/g),     // backtick
      ...message.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g), // PascalCase
      ...message.matchAll(/hàm\s+([A-Za-z_]\w*)/g),              // Vietnamese
      ...message.matchAll(/function\s+([A-Za-z_]\w*)/g),         // English
      ...message.matchAll(/([A-Za-z0-9_/.-]+\.[a-z]{2,4})/g),    // file paths
    ].map(m => m[1]).slice(0, TOKEN_BUDGET.maxSymbols);
  }

  private async resolveSymbols(names: string[], repoId?: string): Promise<ResolvedSymbol[]> {
    const results: ResolvedSymbol[] = [];
    for (const name of names.slice(0, TOKEN_BUDGET.maxSymbols)) {
      // 1. Exact name match in DB (fastest)
      let row = this.db.prepare(
        `SELECT id, name, file_path, kind, repo_id FROM symbols
         WHERE name = ? ${repoId ? 'AND repo_id = ?' : ''}
         LIMIT 1`
      ).get(name, ...(repoId ? [repoId] : []));

      // 2. FTS fuzzy fallback if no exact match
      if (!row) {
        row = this.db.prepare(
          `SELECT s.id, s.name, s.file_path, s.kind, s.repo_id
           FROM symbols_fts fts
           JOIN symbols s ON s.id = fts.rowid
           WHERE symbols_fts MATCH ?
             ${repoId ? 'AND s.repo_id = ?' : ''}
           ORDER BY rank LIMIT 1`
        ).get(name, ...(repoId ? [repoId] : []));
      }

      if (row) results.push({ id: row.id, name: row.name, filePath: row.file_path, repoId: row.repo_id });
    }
    return results;
  }

  private fetchSymbolContext(symbolUuid: string, repoId: string, depth: number): SymbolContext {
    // repoId is passed from resolvedSymbol.repoId in enrich()
    const graph  = this.graph.getGraph(repoId);
    const mapper = graph.mapper;
    const intId  = mapper.intern(symbolUuid);   // intern is idempotent

    // BFS traversal for callers and callees
    const callerRaw = bfsTraverse(graph, intId, 'incoming', depth);
    const calleeRaw = bfsTraverse(graph, intId, 'outgoing', depth);

    // Resolve integer IDs back to UUIDs, then batch-fetch names from DB
    const allUuids = [
      ...callerRaw.map(r => mapper.resolve(r.symbolId)),
      ...calleeRaw.map(r => mapper.resolve(r.symbolId)),
    ];
    const nameMap = this.batchFetchNames(allUuids);  // Map<uuid, { name, kind, filePath }>

    const callers = callerRaw.map(r => {
      const uuid = mapper.resolve(r.symbolId);
      return { symbolId: uuid, name: nameMap.get(uuid)?.name ?? uuid, depth: r.depth, via: r.via };
    });
    const callees = calleeRaw.map(r => {
      const uuid = mapper.resolve(r.symbolId);
      return { symbolId: uuid, name: nameMap.get(uuid)?.name ?? uuid, depth: r.depth, via: r.via };
    });

    // Fetch own symbol metadata
    const own = this.db.prepare(
      `SELECT name, kind, file_path, line FROM symbols WHERE id = ?`
    ).get(symbolUuid) as { name: string; kind: string; file_path: string; line: number };

    return {
      symbolUuid,
      name:     own?.name     ?? symbolUuid,
      kind:     own?.kind     ?? 'unknown',
      filePath: own?.file_path ?? '',
      line:     own?.line      ?? 0,
      callers,
      callees,
    };
  }

  // Batch fetch symbol metadata to avoid N+1 queries in BFS results
  private batchFetchNames(uuids: string[]): Map<string, { name: string; kind: string; filePath: string }> {
    if (uuids.length === 0) return new Map();
    const placeholders = uuids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT id, name, kind, file_path FROM symbols WHERE id IN (${placeholders})`
    ).all(...uuids) as Array<{ id: string; name: string; kind: string; file_path: string }>;
    return new Map(rows.map(r => [r.id, { name: r.name, kind: r.kind, filePath: r.file_path }]));
  }

  assembleContext(symbolContexts: SymbolContext[], userMessage: string): EnrichedContext {
    // 1. Sort contexts by impact count desc (most impactful first)
    const sorted = symbolContexts.sort((a, b) =>
      (b.callers.length + b.callees.length) - (a.callers.length + a.callees.length)
    );

    const sections: string[] = [];
    let tokenCount = 0;

    for (const ctx of sorted) {
      if (tokenCount >= TOKEN_BUDGET.maxTotalTokens) break;

      const callerNames  = ctx.callers.slice(0, TOKEN_BUDGET.maxCallersPerSymbol).map(c => `\`${c.name}\``);
      const calleeNames  = ctx.callees.slice(0, TOKEN_BUDGET.maxCalleesPerSymbol).map(c => `\`${c.name}\``);
      const impactCount  = ctx.callers.length + ctx.callees.length;
      const impactWarn   = impactCount >= IMPACT_WARN_THRESHOLD
        ? `⚠️ **Impact warning:** Changing this affects ${impactCount} symbols\n` : '';

      const section = [
        `### \`${ctx.name}\` (${ctx.kind}) — ${ctx.filePath}:${ctx.line}`,
        callerNames.length ? `**Called by:** ${callerNames.join(', ')}` : '',
        calleeNames.length ? `**Calls:** ${calleeNames.join(', ')}` : '',
        impactWarn,
      ].filter(Boolean).join('\n');

      sections.push(section);
      tokenCount += Math.ceil(section.length / 4);  // rough token estimate
    }

    return {
      enrichedPrompt: `## Code Context\n\n${sections.join('\n\n---\n\n')}\n\n---\n${userMessage}`,
      symbolCount: sorted.length,
      tokenCount,
    };
  }
}

// Impact warning threshold: show warning when symbol affects >= 10 others
const IMPACT_WARN_THRESHOLD = 10;

const TOKEN_BUDGET = {
  maxSymbols:          5,
  maxCallersPerSymbol: 5,
  maxCalleesPerSymbol: 5,
  maxTotalTokens:      2000,
};
```

**Output format** (injected as system context before user message):

```markdown
## Code Context

### `processOrder` (function) — src/orders/processor.ts:45
**Called by:** `OrderController.submit`, `BatchProcessor.run`, `RetryHandler.retry`
**Calls:** `validateOrder`, `chargePayment`, `sendConfirmation`
⚠️ **Impact warning:** Changing this affects 47 symbols across 12 files (depth-3)

---
[Original user question follows]
```

---

## Section 5: Indexing Pipeline Integration

### Two-pass indexing per file

```
Indexer.indexFile(filePath)
  │
  ├── Pass 1: extractSymbols()        ← existing (Plan 2)
  │     └── INSERT INTO symbols
  │     └── ModuleMap.register(filePath, symbols)
  │
  ├── Pass 2: extractRelations()      ← NEW
  │     ├── DELETE old relations for this file
  │     ├── tree-sitter query with relations-{lang}.scm
  │     ├── resolve target names → UUIDs via ModuleMap
  │     └── INSERT INTO symbol_relations
  │
  └── Emit event: 'file-indexed'
        └── InMemoryGraph.reloadFile(repoId, fileId)  // 2 arguments required
```

### RelationExtractor (`src/indexer/relation-extractor.ts`)

Key behaviors:
- **Deletes stale relations before inserting new ones** (prevents duplicates on file change). Because `symbol_relations` has no `source_file` column, the delete requires a subquery joining through `symbols`:
  ```sql
  DELETE FROM symbol_relations
  WHERE source_id IN (
    SELECT id FROM symbols WHERE file_path = ? AND repo_id = ?
  )
  ```
  `RelationExtractor` therefore needs access to both `symbols` and `symbol_relations` tables.
- Uses `db.transaction()` (better-sqlite3 sync API) for atomic bulk insert
- Sets `confidence=1.0` for resolved edges, `confidence=0.7` for unresolved (target_id NULL)

### ModuleMap (`src/indexer/module-map.ts`)

In-RAM lookup table built during Pass 1 to avoid DB queries during Pass 2:

```typescript
class ModuleMap {
  // filePath → Map<symbolName, symbolId>
  private fileSymbols = new Map<string, Map<string, string>>();
  // symbolName → symbolId[] (multiple symbols with same name)
  private nameIndex   = new Map<string, string[]>();

  register(filePath: string, symbols: Symbol[]): void { ... }
  findSymbol(name: string): string | null { ... }     // returns first match
  getSymbolId(filePath: string, name: string): string | null { ... }
}
```

Performance benefit: Avoids N DB queries per file (one query per edge name resolution). For a file with 50 edges, this is 50 DB queries → 0 DB queries.

---

## Section 6: Graph Loading Lifecycle (with Memory Optimizations)

### Startup sequence

```
Server start
  │
  ├── DbPool.open()
  ├── InMemoryGraph.initialize()
  │     (graphs are empty — loaded lazily on first access)
  │
  └── Server ready ✓  [fast startup — no blocking load]

First request for repoId X
  │
  └── InMemoryGraph.getGraph('X')
        → loadFromDb('X')
              SELECT source_id, target_id, type, confidence
              FROM symbol_relations
              WHERE repo_id = 'X'
                AND target_id IS NOT NULL      -- skip unresolved
                AND confidence >= 0.5          -- confidence filter
              
              → assign integer IDs (UUID→int mapping)
              → build outgoing edges
              → derive incoming edges (reverse pass)
              → cache in this.graphs Map
```

### Memory optimization 1: Lazy loading + TTL eviction

```typescript
class InMemoryGraph {
  private graphs     = new Map<string, RepoGraph>();
  private lastAccess = new Map<string, number>();
  private readonly TTL_MS = 30 * 60 * 1000;  // 30 minutes

  getGraph(repoId: string): RepoGraph {
    this.lastAccess.set(repoId, Date.now());
    if (!this.graphs.has(repoId)) {
      this.graphs.set(repoId, this.loadFromDb(repoId));
    }
    return this.graphs.get(repoId)!;
  }

  // Called by setInterval every 10 minutes
  evictStale(): void {
    const now = Date.now();
    for (const [repoId, lastUsed] of this.lastAccess) {
      if (now - lastUsed > this.TTL_MS) {
        this.graphs.delete(repoId);
        this.lastAccess.delete(repoId);
        logger.info({ repoId }, 'graph evicted — inactive 30 min');
      }
    }
  }
}
```

### Memory optimization 2: Compact integer IDs

Each `RepoGraph` owns its own `IdMapper`. When `evictStale()` removes a `RepoGraph`, its `IdMapper` is removed together — no separate lifecycle needed.

```typescript
// RepoGraph is a self-contained unit (illustration — see Section 2 for canonical definition)
type RepoGraph = {
  nodes:     Map<IntId, GraphNode>;
  mapper:    IdMapper;              // owned by this graph; GC'd together
  fileIndex: Map<string, IntId[]>;  // fileId → IntIds (for reloadFile)
};

// At load time, build bidirectional UUID↔integer mapping
class IdMapper {
  private uuidToInt = new Map<string, number>();
  private intToUuid: string[] = [];

  intern(uuid: string): number {
    if (this.uuidToInt.has(uuid)) return this.uuidToInt.get(uuid)!;
    const id = this.intToUuid.length;
    this.intToUuid.push(uuid);
    this.uuidToInt.set(uuid, id);
    return id;
  }

  resolve(id: number): string { return this.intToUuid[id]; }
}
```

When `evictStale()` calls `this.graphs.delete(repoId)`, both the node map and the mapper become unreachable and are GC'd together. No separate cleanup required.

`InMemoryGraph.getMapper(repoId)` returns `this.graphs.get(repoId)!.mapper` for callers that need UUID↔IntId translation (e.g., `ContextEnricher.fetchSymbolContext`).

### Memory optimization 3: Confidence threshold filter

`target_id IS NULL` is the primary exclusion gate for unresolved edges. The `confidence >= 0.5` clause is a secondary forward-compatibility gate (reserved for future partial-confidence edges from heuristic analysis). Currently all stored edges have confidence either 1.0 (resolved) or 0.7 (unresolved with NULL target_id) — so `target_id IS NOT NULL` alone would suffice, but both clauses are kept to be explicit.

```typescript
// Note: better-sqlite3 is used throughout this codebase — all DB calls are
// synchronous (no Promise/await needed). getGraph() is therefore synchronous.
loadFromDb(repoId: string, minConfidence = 0.5): RepoGraph {
  const rows = this.db.prepare(`
    SELECT source_id, target_id, type, confidence
    FROM symbol_relations
    WHERE repo_id = ?
      AND target_id IS NOT NULL
      AND confidence >= ?
  `).all(repoId, minConfidence);

  // Also load fileId→symbolId mapping to support reloadFile()
  const symbolFileRows = this.db.prepare(`
    SELECT id, file_id FROM symbols WHERE repo_id = ?
  `).all(repoId);

  const mapper    = new IdMapper();
  const nodes     = new Map<IntId, GraphNode>();
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
```

### RAM estimates (10,000 files, 1M edges)

| Configuration | RAM Usage |
|---|---|
| No optimizations (baseline) | ~220 MB |
| + Compact integer IDs | ~140 MB |
| + Confidence filter (−25% edges) | ~105 MB |
| + Lazy load (only 1 active repo) | **~30–50 MB** |

For a typical internal deployment with one active repo: **~30–50 MB RAM** — well within acceptable bounds for a continuously running server.

### File change handling (no memory leak)

```
Developer edits file A.cs
  → chokidar detects change
  → Indexer.indexFile('A.cs')
       Pass 1: re-extract symbols
       Pass 2: DELETE old relations, INSERT new ones
  → InMemoryGraph.reloadFile(repoId, fileId)  // 2 arguments required
       remove old outgoing edges for symbols in A
       rebuild incoming edges affected
       RAM stays stable — no accumulation over time ✅
```

**`reloadFile` algorithm** — this is non-trivial because incoming edges are scattered:

```typescript
reloadFile(repoId: string, fileId: string): void {
  const graph = this.graphs.get(repoId);
  if (!graph) return;  // graph not loaded — nothing to do, next getGraph() will load fresh

  // 1. Find all IntIds belonging to this file
  //    (stored in a fileId→IntId[] index maintained during loadFromDb)
  const affectedIntIds = graph.fileIndex.get(fileId) ?? [];

  // 2. For each affected symbol: collect its current outgoing targets
  const staleTgtIds = new Set<IntId>();
  for (const intId of affectedIntIds) {
    const node = graph.nodes.get(intId);
    if (!node) continue;
    node.outgoing.forEach(e => staleTgtIds.add(e.targetId));
    node.outgoing = [];   // clear outgoing
  }

  // 3. Remove stale incoming edges from all targets
  for (const tgtId of staleTgtIds) {
    const tgtNode = graph.nodes.get(tgtId);
    if (!tgtNode) continue;
    tgtNode.incoming = tgtNode.incoming.filter(e => !affectedIntIds.includes(e.targetId));
  }

  // 4. Re-load fresh edges from DB for these symbols
  const uuids = affectedIntIds.map(id => graph.mapper.resolve(id));
  const freshRows = this.db.prepare(`
    SELECT source_id, target_id, type, confidence
    FROM symbol_relations
    WHERE source_id IN (${uuids.map(() => '?').join(',')})
      AND target_id IS NOT NULL
  `).all(...uuids);

  for (const row of freshRows) {
    const srcInt = graph.mapper.intern(row.source_id);
    const tgtInt = graph.mapper.intern(row.target_id);
    if (!graph.nodes.has(tgtInt)) graph.nodes.set(tgtInt, { outgoing: [], incoming: [] });
    graph.nodes.get(srcInt)!.outgoing.push({ targetId: tgtInt, type: row.type, confidence: row.confidence });
    graph.nodes.get(tgtInt)!.incoming.push({ targetId: srcInt, type: row.type, confidence: row.confidence });
  }
}
```

`graph.fileIndex` is a `Map<string, IntId[]>` (fileId → list of integer IDs for symbols in that file) built during `loadFromDb` and updated during `reloadFile`.

---

## Architecture Summary

```
User message
    │
    ▼
ContextEnricher.enrich()          ← Tầng 2: intercepts any message
    │  extractMentions()
    │  resolveSymbols() → DB FTS
    │  fetchSymbolContext() → InMemoryGraph BFS
    │  assembleContext() → enriched markdown
    ▼
AI Model (any format)
    │  optionally calls MCP tools
    ▼
MCP Tools (16 total)
    │  get_symbol_context, get_impact_analysis,
    │  find_callers, find_callees, get_import_chain
    ▼
InMemoryGraph (RAM)               ← lazy-loaded, TTL-evicted, compact IDs
    │  bidirectional BFS, depth-3
    ▼
SQLite symbol_relations           ← outgoing edges only, persisted
    │
    ▲
RelationExtractor (Pass 2)        ← runs after every file index
    │  tree-sitter queries per language
    │  ModuleMap UUID resolution
    │
    ▲
tree-sitter / Roslyn daemon       ← C# dual-tier, JS/TS/Py/Go/Rust tree-sitter
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/db/migrations/002_relations.ts` | SQLite schema migration |
| `src/graph/in-memory-graph.ts` | InMemoryGraph class + IdMapper + TTL eviction |
| `src/indexer/relation-extractor.ts` | Pass 2 — extract & persist edges |
| `src/indexer/module-map.ts` | In-RAM name→UUID resolution |
| `src/analyzers/roslyn-bridge.ts` | Roslyn daemon subprocess bridge |
| `src/mcp/context-enricher.ts` | Tầng 2 forced pre-fetch injector |
| `src/parser/queries/relations-javascript.scm` | JS/TS edge queries |
| `src/parser/queries/relations-python.scm` | Python edge queries |
| `src/parser/queries/relations-go.scm` | Go edge queries |
| `src/parser/queries/relations-rust.scm` | Rust edge queries |
| `src/parser/queries/relations-csharp.scm` | C# edge queries |
| `roslyn-analyzer/` | C# project (~200 lines) for Roslyn daemon |
| `bin/roslyn/win-x64/roslyn-analyzer.exe` | Pre-built binary (committed) |
| `bin/roslyn/linux-x64/roslyn-analyzer` | Pre-built binary (committed) |
| `bin/roslyn/darwin-arm64/roslyn-analyzer` | Pre-built binary (committed) |
| `scripts/build-roslyn.sh` | Script for maintainer to rebuild binaries |
| `.gitattributes` | Mark bin/roslyn/** as binary |

---

## Dependencies to Add

```json
{
  "tree-sitter-c-sharp": "^0.23.5"
}
```

No other new runtime dependencies. Roslyn is distributed as a self-contained binary — no .NET SDK required for end users.
