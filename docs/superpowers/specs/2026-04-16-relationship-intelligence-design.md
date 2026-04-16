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
- **M16 FIX — `PRAGMA foreign_keys = ON`**: SQLite disables FK enforcement by default. The migration runner must execute `PRAGMA foreign_keys = ON` on every new connection before any DML. Without this, `ON DELETE CASCADE` on `symbol_relations` is silently inert — deleting a repo would not cascade-delete its relations. Add this to the `DbPool.open()` connection setup:
  ```typescript
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');  // already required for concurrent reads
  ```

---

## Section 2: In-Memory Graph

### Data structures

```typescript
type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

// In-memory uses integer IDs (not UUID strings) to reduce RAM by ~50%
type IntId = number;

type Edge = {
  targetId: IntId;    // ⚠️ naming note: in an *outgoing* list, targetId = destination;
                      // in an *incoming* list (derived at load), targetId = source that points TO this node.
                      // This dual meaning is intentional (single Edge type) but callers must be aware.
                      // Direction is always clear from which list the edge lives in (node.outgoing vs node.incoming).
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
  repoId:   string;   // always equals process-level app.repoId in single-repo model;
                      // kept for internal consistency (fetchSymbolContext uses it to call getGraph)
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

### C# ignore patterns (EC-4.3)

The following paths **must** be excluded from indexing for C# projects. They are the C# equivalents of `node_modules/` — indexing them would take hours and flood the graph with framework symbols:

```typescript
// Add to IGNORE_PATTERNS (from Plan 2 indexer config)
const CSHARP_IGNORE_PATTERNS = [
  '**/obj/**',           // MSBuild output (generated .cs files)
  '**/bin/**',           // compiled output
  '**/packages/**',      // NuGet packages (legacy non-SDK projects)
  '**/.vs/**',           // Visual Studio metadata
  '**/*.Designer.cs',    // WinForms/WPF generated UI code (EC-4.2)
  '**/*.g.cs',           // Roslyn source generators
  '**/*.generated.cs',   // code generators (EF, gRPC, etc.)
  '**/AssemblyInfo.cs',  // assembly metadata
  '**/GlobalUsings.g.cs',
];
```

These patterns are applied in the Watcher and in `runFullScan` before any file is passed to the indexer.

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
  confidence: number;          // always 1.0 from Roslyn; use number not literal for forward compat
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

**Framing protocol:** Newline-delimited JSON (NDJSON). Each request is one JSON line on stdin; each response is one JSON line on stdout. The bridge accumulates stdout chunks in a buffer and resolves the pending promise when a complete `\n`-terminated line arrives.

```typescript
// B5 FIX: sendRequest with NDJSON framing + partial-JSON crash guard
private sendRequest(daemon: ChildProcess, req: RoslynRequest): Promise<RoslynResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const cleanup = () => {
      daemon.stdout!.off('data', onData);
      daemon.stdout!.off('error', onError);
      daemon.stdout!.off('close', onClose);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;  // incomplete line — wait for more data

      const line = buffer.slice(0, newlineIdx);
      cleanup();

      try {
        resolve(JSON.parse(line) as RoslynResponse);
      } catch (e) {
        reject(new Error(`Roslyn response JSON parse failed: ${e}. Raw: ${line.slice(0, 200)}`));
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    // N3 FIX: handle daemon stdout close before newline (daemon crashed mid-response).
    // Without this, the Promise hangs until the 30s analyze() timeout fires.
    const onClose = () => {
      cleanup();
      reject(new Error(`Roslyn daemon stdout closed before response (partial: ${buffer.slice(0, 100)})`));
    };

    daemon.stdout!.on('data', onData);
    daemon.stdout!.once('error', onError);
    daemon.stdout!.once('close', onClose);

    // Write request as a single NDJSON line
    daemon.stdin!.write(JSON.stringify(req) + '\n');
  });
}
```

**EC-4.4 FIX — Daemon crash recovery:**

```typescript
// src/analyzers/roslyn-bridge.ts

export class RoslynBridge {
  private daemon: ChildProcess | null = null;
  private readonly TIMEOUT_MS = 30_000;
  private _cleanupRegistered = false;  // S-5 FIX: register process cleanup only once

  private ensureDaemon(): ChildProcess | null {
    if (this.daemon && !this.daemon.killed) return this.daemon;

    const binPath = getRoslynBinaryPath();
    if (!binPath) return null;  // fall back to Tier 1

    this.daemon = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    // Pipe stderr to server logger for diagnostics
    this.daemon.stderr!.on('data', d =>
      logger.warn({ roslyn: 'stderr' }, d.toString())
    );

    // On unexpected exit: clear handle so next call respawns
    this.daemon.on('exit', (code) => {
      logger.warn({ code }, 'Roslyn daemon exited — will respawn on next request');
      this.daemon = null;
    });

    // S-5 FIX: Register process-level cleanup ONCE per RoslynBridge instance lifetime
    // Using _cleanupRegistered flag prevents MaxListenersExceededWarning on repeated respawns
    if (!this._cleanupRegistered) {
      this._cleanupRegistered = true;
      const cleanup = () => this.daemon?.kill();
      process.once('exit', cleanup);
      process.once('SIGTERM', () => { cleanup(); process.exit(0); });
      process.once('SIGINT',  () => { cleanup(); process.exit(0); });
    }

    return this.daemon;
  }

  async analyze(req: RoslynRequest): Promise<RoslynResponse | null> {
    const daemon = this.ensureDaemon();
    if (!daemon) return null;  // Tier 1 fallback

    return Promise.race([
      this.sendRequest(daemon, req),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Roslyn timeout')), this.TIMEOUT_MS)
      ),
    ]).catch(err => {
      logger.warn({ err }, 'Roslyn analysis failed — falling back to Tier 1');
      this.daemon?.kill();
      this.daemon = null;
      return null;  // Tier 1 fallback
    });
  }
}
```

**Roslyn binary missing — startup log (EC-4.5):**
```typescript
// In getRoslynBinaryPath(), after returning null:
if (!binaryPath) {
  logger.warn(
    { platform: process.platform, arch: process.arch },
    'Roslyn binary not found — C# analysis will use tree-sitter Tier 1 (~75-80% accuracy). ' +
    'Run scripts/build-roslyn.sh to build for your platform.'
  );
}
```

---

## Section 4: MCP Tools & Tầng 2 ContextEnricher

### 5 new MCP tools

| Tool | Input | Output |
|------|-------|--------|
| `get_symbol_context` | `{ symbolName: string, depth?: 1\|2\|3 }` | `{ symbol, callers[], callees[], impactCount }` |
| `get_impact_analysis` | `{ symbolName: string }` | `{ depth1: string[], depth2: string[], depth3: string[], totalCount: number }` |
| `find_callers` | `{ symbolName: string }` | `{ callers: Array<{ name, filePath, line }> }` |
| `find_callees` | `{ symbolName: string }` | `{ callees: Array<{ name, filePath, line }> }` |
| `get_import_chain` | `{ filePath: string, depth?: number }` | `{ chain: Array<{ file, imports: string[] }> }` |

`repoId` is **not required** in any tool call — the server resolves it automatically from `REPO_ROOT` at startup (see Section 7). All responses include a `resolvedAs` field showing which symbol was matched when disambiguation was needed.

Total tools: 11 existing + 5 new = 16 tools (same count as GitNexus).

### Tầng 2: Forced Pre-fetch Context Injection

Works with **any AI model** regardless of tool-calling capability. The MCP server intercepts user messages before they reach the AI, injects relevant graph context, and forwards the enriched prompt.

```typescript
// src/mcp/context-enricher.ts

export class ContextEnricher {
  // repoId injected at construction time from app.repoId (process-level constant)
  // No repoId parameter in any public method — single-repo-per-process model (see Section 7)
  constructor(
    private readonly repoId: string,
    private readonly db: Database,
    private readonly graph: InMemoryGraph,
  ) {}

  async enrich(userMessage: string): Promise<EnrichedContext> {
    const mentions        = this.extractMentions(userMessage);
    const resolvedSymbols = await this.resolveSymbols(mentions);
    // N2 FIX: fetchSymbolContext is synchronous — a throw from IdMapper.resolve()
    // (e.g. race between graph load and symbol delete) propagates out of .map().
    // Wrap each call individually so one bad symbol doesn't drop all context.
    const symbolContexts: SymbolContext[] = [];
    for (const s of resolvedSymbols) {
      try {
        symbolContexts.push(this.fetchSymbolContext(s.id, s.repoId, 2));
      } catch (err) {
        logger.warn({ err, symbolId: s.id }, 'fetchSymbolContext failed — skipping symbol');
      }
    }
    return this.assembleContext(symbolContexts, userMessage);
  }

  extractMentions(message: string): string[] {
    const raw = [
      ...message.matchAll(/`([A-Za-z_][A-Za-z0-9_.]*)`/g),     // backtick
      ...message.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g), // PascalCase
      ...message.matchAll(/hàm\s+([A-Za-z_]\w*)/g),              // Vietnamese
      ...message.matchAll(/function\s+([A-Za-z_]\w*)/g),         // English
      ...message.matchAll(/([A-Za-z0-9_/.-]+\.[a-z]{2,4})/g),    // file paths
    ].map(m => m[1]);
    // S-6 FIX: deduplicate before applying budget cap
    // A symbol like `processOrder` matching both backtick AND PascalCase regex
    // would otherwise consume 2 of the 5 maxSymbols slots for the same name.
    return [...new Set(raw)].slice(0, TOKEN_BUDGET.maxSymbols);
  }

  private async resolveSymbols(names: string[]): Promise<ResolvedSymbol[]> {
    const results: ResolvedSymbol[] = [];
    for (const name of names.slice(0, TOKEN_BUDGET.maxSymbols)) {
      // 1. Exact name match in DB (fastest)
      let row = this.db.prepare(
        `SELECT id, name, file_path, kind, repo_id FROM symbols
         WHERE name = ? AND repo_id = ?
         LIMIT 1`
      ).get(name, this.repoId);

      // 2. FTS fuzzy fallback if no exact match.
      // B4 FIX: FTS5 MATCH treats +, -, *, ", (, ), ^ as operators — symbol names
      // containing these chars cause a SqliteError. Wrap in try/catch and quote the
      // search term as an FTS5 string literal to neutralize all operator characters.
      // S11 FIX: The FTS virtual table must be defined with `content=symbols` so that
      // `fts.rowid` maps to `symbols.rowid` (the implicit integer rowid, NOT the UUID id).
      // The JOIN below uses `s.rowid = fts.rowid` — requires symbols_fts to be a
      // content FTS5 table over the symbols table.
      // N4 FIX: Exact DDL required in migration 001 (src/db/migrations/001_initial.ts):
      //   CREATE VIRTUAL TABLE symbols_fts USING fts5(
      //     name, content=symbols, content_rowid=rowid
      //   );
      // Without content_rowid=rowid, fts.rowid is an independent auto-increment
      // and the JOIN s.rowid = fts.rowid would return wrong rows.
      if (!row) {
        try {
          // Escape FTS5 string literal: replace " with "" inside the quoted value
          const safeName = `"${name.replace(/"/g, '""')}"`;
          row = this.db.prepare(
            `SELECT s.id, s.name, s.file_path, s.kind, s.repo_id
             FROM symbols_fts fts
             JOIN symbols s ON s.rowid = fts.rowid
             WHERE symbols_fts MATCH ? AND s.repo_id = ?
             ORDER BY rank LIMIT 1`
          ).get(safeName, this.repoId);
        } catch {
          // FTS syntax error (e.g., malformed name) — skip fuzzy fallback, continue
        }
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

  // Batch fetch symbol metadata to avoid N+1 queries in BFS results.
  // B2 FIX: Chunk queries to 500 to avoid both SQLite SQLITE_MAX_VARIABLE_NUMBER
  // and JS call-stack argument limit from the spread operator on large BFS result sets.
  private batchFetchNames(uuids: string[]): Map<string, { name: string; kind: string; filePath: string }> {
    if (uuids.length === 0) return new Map();
    const CHUNK = 500;
    const result = new Map<string, { name: string; kind: string; filePath: string }>();
    for (let i = 0; i < uuids.length; i += CHUNK) {
      const batch = uuids.slice(i, i + CHUNK);
      const placeholders = batch.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT id, name, kind, file_path FROM symbols WHERE id IN (${placeholders})`
      ).all(...batch) as Array<{ id: string; name: string; kind: string; file_path: string }>;
      rows.forEach(r => result.set(r.id, { name: r.name, kind: r.kind, filePath: r.file_path }));
    }
    return result;
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
- **DELETE + INSERT are wrapped in a single `db.transaction()`** — they are atomic. A crash between delete and insert is impossible; SQLite WAL rolls back the entire transaction on next open. This is the fix for EC-1.1.
  ```typescript
  const upsertRelations = db.transaction((filePath: string, edges: EdgeRow[]) => {
    // DELETE inside the same transaction as INSERT
    db.prepare(`
      DELETE FROM symbol_relations
      WHERE source_id IN (
        SELECT id FROM symbols WHERE file_path = ? AND repo_id = ?
      )
    `).run(filePath, app.repoId);

    for (const edge of edges) insertStmt.run(edge);
  });
  upsertRelations(filePath, edges);  // atomic — all or nothing
  ```
  `RelationExtractor` therefore needs access to both `symbols` and `symbol_relations` tables.
- Sets `confidence=1.0` for resolved edges, `confidence=0.7` for unresolved (target_id NULL)
- **Per-file edge cap**: if `edges.length > 10_000`, log a warning and truncate to 10_000. This prevents minified/generated files from flooding the DB (EC-3.1).
- **Extension guard**: return early if `path.extname(filePath)` is not in `['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.cs', '.mjs', '.cjs']`. Prevents binary files from reaching tree-sitter (EC-3.2).
- **S7 FIX — Duplicate scan guard**: `Indexer` tracks an in-flight scan promise. If `runFullScan` is called while a scan is already running, it returns the existing promise instead of starting a second scan (which would produce duplicate DB writes):
  ```typescript
  class Indexer {
    private _scanPromise: Promise<void> | null = null;

    async runFullScan(repoRoot: string): Promise<void> {
      if (this._scanPromise) return this._scanPromise;  // dedup: return in-flight promise
      this._scanPromise = this._doFullScan(repoRoot).finally(() => {
        this._scanPromise = null;
      });
      return this._scanPromise;
    }

    private async _doFullScan(repoRoot: string): Promise<void> {
      // ... actual scan logic
    }
  }
  ```
- **S6 FIX — `reloadFile` called on a never-yet-indexed file**: When a brand-new file is created and the watcher fires `reloadFile` before Pass 1 has committed the symbols to DB, `currentRows` will be empty and `graph.fileIndex.set(fileId, [])` stores an empty array. The second `reloadFile` call (after Pass 1 commits) correctly re-syncs because it re-queries `symbols WHERE file_id = ?`. This is safe: the debounce (300ms) plus the transaction commit time means Pass 1 almost always commits before `reloadFile` runs. For the rare race case, the empty `fileIndex` entry is harmless — the next `reloadFile` will re-populate it correctly. No additional fix needed beyond the existing B-2 re-sync logic.

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

  // S10 FIX: guard against out-of-bounds IDs (orphaned FK rows from symbol deletes
  // that occurred between loadFromDb and now, before PRAGMA foreign_keys = ON is set)
  resolve(id: number): string {
    const uuid = this.intToUuid[id];
    if (uuid === undefined) throw new Error(`IdMapper: unknown IntId ${id} — possible orphaned edge`);
    return uuid;
  }
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

**Debounce (EC-3.4):** Chokidar events are debounced 300ms per file before triggering `indexFile`. If a file fires 20 change events in 100ms (hot-reload, format-on-save), only the last event triggers indexing. This prevents duplicate edges from concurrent `reloadFile` calls.

```typescript
// src/indexer/watcher.ts
const debounceMap = new Map<string, NodeJS.Timeout>();

watcher.on('change', (filePath) => {
  clearTimeout(debounceMap.get(filePath));
  debounceMap.set(filePath, setTimeout(() => {
    debounceMap.delete(filePath);
    indexer.indexFile(filePath);          // Pass 1 + Pass 2 + reloadFile
  }, 300));
});
```

```
Developer edits file A.cs
  → chokidar detects change (debounced 300ms)
  → Indexer.indexFile('A.cs')           ← single call after debounce
       Pass 1: re-extract symbols (DELETE + INSERT symbols in one tx)
       Pass 2: DELETE + INSERT relations in same tx  ← EC-1.1 fix
  → InMemoryGraph.reloadFile(repoId, fileId)
       remove old outgoing + prune incoming
       prune ghost nodes for deleted symbols  ← EC-5.1 fix
       re-add fresh edges from DB
       RAM stays stable — no accumulation over time ✅
```

**`reloadFile` algorithm** — this is non-trivial because incoming edges are scattered:

```typescript
reloadFile(repoId: string, fileId: string): void {
  const graph = this.graphs.get(repoId);
  if (!graph) return;  // graph not loaded — nothing to do, next getGraph() will load fresh

  // 1. Find all IntIds belonging to this file
  const affectedIntIds = graph.fileIndex.get(fileId) ?? [];

  // 2. Collect stale outgoing targets, then clear outgoing
  const staleTgtIds = new Set<IntId>();
  for (const intId of affectedIntIds) {
    const node = graph.nodes.get(intId);
    if (!node) continue;
    node.outgoing.forEach(e => staleTgtIds.add(e.targetId));
    node.outgoing = [];
  }

  // 3. Remove stale incoming edges from all targets
  // S-1 FIX: Set instead of Array.includes() — O(1) vs O(n) per edge
  const affectedSet = new Set<IntId>(affectedIntIds);
  for (const tgtId of staleTgtIds) {
    const tgtNode = graph.nodes.get(tgtId);
    if (!tgtNode) continue;
    tgtNode.incoming = tgtNode.incoming.filter(
      e => !affectedSet.has(e.targetId)
    );
  }

  // EC-5.1: Prune ghost nodes for symbols deleted/renamed in this file.
  const affectedUuids = affectedIntIds.map(id => graph.mapper.resolve(id));
  const CHUNK = 500;
  const stillExistingUuids = new Set<string>();
  for (let i = 0; i < affectedUuids.length; i += CHUNK) {
    const batch = affectedUuids.slice(i, i + CHUNK);
    const rows = this.db.prepare(
      `SELECT id FROM symbols WHERE id IN (${batch.map(() => '?').join(',')})`
    ).all(...batch) as Array<{ id: string }>;
    rows.forEach(r => stillExistingUuids.add(r.id));
  }
  // Iterate backwards so splice doesn't shift indices
  const list = graph.fileIndex.get(fileId) ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const intId = list[i];
    const uuid  = graph.mapper.resolve(intId);
    if (!stillExistingUuids.has(uuid)) {
      graph.nodes.delete(intId);
      list.splice(i, 1);
    }
  }

  // B-2 FIX: Re-sync fileIndex with CURRENT DB state — captures NEW symbols added to this file.
  // Without this, newly-added functions are invisible in the graph until the 30-min TTL eviction.
  const currentRows = this.db.prepare(
    `SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?`
  ).all(fileId, repoId) as Array<{ id: string }>;

  const updatedIntIds: IntId[] = [];
  for (const row of currentRows) {
    const intId = graph.mapper.intern(row.id);   // idempotent for existing UUIDs
    if (!graph.nodes.has(intId)) {
      graph.nodes.set(intId, { outgoing: [], incoming: [] });  // new symbol
    }
    updatedIntIds.push(intId);
  }
  graph.fileIndex.set(fileId, updatedIntIds);  // authoritative current set

  // 4. Re-load edges for ALL current symbols (surviving + newly added) — chunked (EC-3.1)
  const allCurrentUuids = currentRows.map(r => r.id);
  const freshRows: any[] = [];
  for (let i = 0; i < allCurrentUuids.length; i += CHUNK) {
    const batch = allCurrentUuids.slice(i, i + CHUNK);
    const rows = this.db.prepare(`
      SELECT source_id, target_id, type, confidence
      FROM symbol_relations
      WHERE source_id IN (${batch.map(() => '?').join(',')})
        AND target_id IS NOT NULL
    `).all(...batch);
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

**Thread safety note:** Node.js is single-threaded and `better-sqlite3` calls are synchronous. `reloadFile` contains no `await` points — it is naturally atomic within the event loop. Two rapid change events for the same file are serialized; the debounce (300ms) ensures only one actually runs.

**`CHUNK = 500`** caps all `IN (?)` queries to 500 placeholders — well below SQLite's `SQLITE_MAX_VARIABLE_NUMBER` default of 32766, and safe for large files (EC-3.1).

---

## Section 7: Deployment Model — Cline + Local Model

### Design decision: 1 MCP server instance per project

The MCP server is designed to run as **one process per project**, not as a shared multi-repo server. This is the natural model for Cline (VS Code extension) and eliminates all multi-repo isolation complexity.

```
VS Code Window A (backend)         VS Code Window B (frontend)
        │                                    │
  Cline MCP config                    Cline MCP config
  "mcp-backend" entry                 "mcp-frontend" entry
        │                                    │
  node server.js                      node server.js
  cwd = /projects/backend             cwd = /projects/frontend
  DB  = data/backend.db               DB  = data/frontend.db
        │                                    │
  Graph: backend only                 Graph: frontend only
  RAM:  ~30-50 MB                     RAM:  ~30-50 MB (isolated)
```

Each server instance knows exactly one repo — the one it was started for. There is no `repoId` resolution logic, no cross-repo leakage, and no shared DB.

### How the server knows which repo it serves

At startup, the server reads `REPO_ROOT` from environment (set by Cline config) or falls back to `process.cwd()`:

```typescript
// src/app.ts — server startup

import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';  // N1 FIX: required for _repoSlug inline hash

const REPO_ROOT = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : process.cwd();

// EC-6.1 FIX: Fail fast with clear error if REPO_ROOT doesn't exist
if (!existsSync(REPO_ROOT)) {
  logger.fatal({ REPO_ROOT }, 'REPO_ROOT does not exist — check your Cline MCP config');
  process.exit(1);
}

// B1 FIX: Compute repoId-based slug BEFORE opening DB.
// ensureRepo() uses the same algorithm internally — pre-computing here avoids
// a chicken-and-egg: we need the DB filename to open the DB, but we'd need the
// DB open to call ensureRepo(). Solution: hash the path inline.
const _normalizedRoot = path.resolve(REPO_ROOT).replace(/\\/g, '/').toLowerCase();
const _repoSlug = createHash('sha256').update(_normalizedRoot).digest('hex').slice(0, 8);

const DB_PATH = process.env.DB_PATH
  // S-4 FIX: append repoId slice to slugified name to prevent collision between
  // similarly-named repos (e.g. /projects/frontend and /projects-frontend → same slug)
  ?? path.join(__dirname, '..', 'data', `${slugify(REPO_ROOT)}-${_repoSlug}.db`);

// EC-6.2 FIX: Ensure DB directory exists before opening (fresh clone / first run)
mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Run migrations, then register repo — MCP transport starts AFTER this block
// EC-1.3 FIX: Server does not accept connections until repoId is resolved
await runMigrations(DB_PATH);
const repoId = ensureRepo(db, REPO_ROOT);  // synchronous (better-sqlite3)

// EC-6.4 FIX + B-1 FIX: Trigger initial index scan with error handling + invalidate on complete.
// S-3 FIX: Set scanInProgress flag so reloadFile() is a no-op during scan (avoids partial patches).
graph.setScanInProgress(repoId, true);
indexer.runFullScan(REPO_ROOT)
  .then(() => {
    graph.setScanInProgress(repoId, false);
    graph.invalidate(repoId);   // evict any empty/partial graph → next getGraph() loads full data
    logger.info({ repoId }, 'Initial index complete — graph ready');
  })
  .catch(err => {
    // B-1 FIX: never swallow runFullScan errors
    graph.setScanInProgress(repoId, false);
    logger.error({ err, repoId }, 'runFullScan failed — graph may be incomplete. Retrying in 60s');
    setTimeout(() => {
      graph.setScanInProgress(repoId, true);
      indexer.runFullScan(REPO_ROOT)
        .then(() => { graph.setScanInProgress(repoId, false); graph.invalidate(repoId); })
        .catch(e => logger.error({ e }, 'runFullScan retry also failed — restart server to recover'));
    }, 60_000);
  });

// repoId is a module-level constant for this process lifetime
app.repoId = repoId;

// NOW start the MCP transport — repoId is guaranteed to be set
startMcpTransport();
```

**Startup sequencing rule:** `startMcpTransport()` is called **after** `ensureRepo` and migrations complete. Tools cannot be called before `app.repoId` is set (EC-1.3).

**`InMemoryGraph.invalidate(repoId)`** implementation:
```typescript
private scanInProgress = new Set<string>();  // repoIds currently being scanned

setScanInProgress(repoId: string, inProgress: boolean): void {
  if (inProgress) this.scanInProgress.add(repoId);
  else this.scanInProgress.delete(repoId);
}

invalidate(repoId: string): void {
  this.graphs.delete(repoId);
  this.lastAccess.delete(repoId);
  // Next call to getGraph(repoId) triggers a fresh loadFromDb()
}

getGraph(repoId: string): RepoGraph {
  // S-3 FIX: return empty sentinel during scan — don't cache a partial graph
  // B3 FIX: return a FRESH empty graph each time (not a singleton) to prevent
  // callers from mutating shared state via mapper.intern() during scan.
  // The cost is a trivial object allocation; no IdMapper/Map growth can persist.
  if (this.scanInProgress.has(repoId)) return makeEmptyRepoGraph();
  this.lastAccess.set(repoId, Date.now());
  if (!this.graphs.has(repoId)) {
    this.graphs.set(repoId, this.loadFromDb(repoId));
  }
  return this.graphs.get(repoId)!;
}

// B3 FIX: factory function instead of singleton constant
function makeEmptyRepoGraph(): RepoGraph {
  return { nodes: new Map(), mapper: new IdMapper(), fileIndex: new Map() };
}
```

`ensureRepo` inserts a row into `repos` if not already present, using the hash of `REPO_ROOT` as the stable ID across restarts.

### `repos` table schema

The `repos` table (referenced as FK in Section 1) has this structure:

```sql
CREATE TABLE IF NOT EXISTS repos (
  id         TEXT PRIMARY KEY,   -- stable ID: SHA-256(normalized REPO_ROOT), truncated to 16 hex chars
  name       TEXT NOT NULL,      -- basename of REPO_ROOT (e.g. "backend")
  root_path  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `ensureRepo` implementation

```typescript
// src/db/repo-registry.ts

import { createHash } from 'crypto';
import { basename } from 'path';

export function ensureRepo(db: Database, rootPath: string): string {
  // EC-6.5 FIX: Normalize path before hashing AND before storing.
  // Converts backslashes to forward slashes and lowercases the entire path.
  // This ensures E:\Projects\App and e:/projects/app produce the same repoId
  // and the same root_path in DB — preventing duplicate repo rows on Windows.
  const normalized = rootPath.replace(/\\/g, '/').toLowerCase();

  // Stable ID: first 16 chars of SHA-256(normalized path)
  const repoId = createHash('sha256').update(normalized).digest('hex').slice(0, 16);

  db.prepare(`
    INSERT INTO repos (id, name, root_path)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_seen = datetime('now'),
      name      = excluded.name   -- S8 FIX: update name on conflict (handles repo renames)
  `).run(repoId, basename(rootPath), normalized);  // store normalized path, not raw rootPath

  return repoId;
}
```

**`slugify` for DB filename** (used in `DB_PATH` default):

```typescript
// Converts "/projects/company/backend" → "projects-company-backend"
// M15 FIX: fallback to 'repo' if result is empty (e.g. input '/' → '')
function slugify(p: string): string {
  return p.replace(/[^\w]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo';
}
```

`ensureRepo` inserts a row into `repos` if not already present, using the hash of `REPO_ROOT` as the stable ID across restarts.

### Cline MCP settings (2 projects example)

```json
{
  "mcpServers": {
    "mcp-backend": {
      "command": "node",
      "args": ["E:/Code/MCP-web/mcp-code1/dist/server.js"],
      "cwd": "E:/Code/company/backend",
      "env": {
        "REPO_ROOT": "E:/Code/company/backend",
        "DB_PATH":   "E:/Code/MCP-web/mcp-code1/data/backend.db"
      }
    },
    "mcp-frontend": {
      "command": "node",
      "args": ["E:/Code/MCP-web/mcp-code1/dist/server.js"],
      "cwd": "E:/Code/company/frontend",
      "env": {
        "REPO_ROOT": "E:/Code/company/frontend",
        "DB_PATH":   "E:/Code/MCP-web/mcp-code1/data/frontend.db"
      }
    }
  }
}
```

Same binary, two independent processes, two isolated databases.

### Impact on tool signatures

Because `repoId` is resolved at startup and stored as a process-level constant, **all 5 new MCP tools drop `repoId` from their required parameters**:

| Tool | Before (multi-repo) | After (single-repo per process) |
|------|--------------------|---------------------------------|
| `get_symbol_context` | `{ symbolName, repoId, depth? }` | `{ symbolName, depth? }` |
| `get_impact_analysis` | `{ symbolName, repoId }` | `{ symbolName }` |
| `find_callers` | `{ symbolName, repoId }` | `{ symbolName }` |
| `find_callees` | `{ symbolName, repoId }` | `{ symbolName }` |
| `get_import_chain` | `{ filePath, repoId, depth? }` | `{ filePath, depth? }` |

This also simplifies `ContextEnricher.resolveSymbols` — no `repoId?` parameter needed, the server always knows its own repo.

### Local model on Cline

Cline supports any OpenAI-compatible API endpoint as a custom provider. The local model connects via:

```json
{
  "apiProvider": "openai-compatible",
  "apiBaseUrl": "http://localhost:11434/v1",
  "apiKey": "local",
  "model": "your-local-model-name"
}
```

The MCP tools are called by Cline's agent loop on behalf of the model — **the local model does not need native tool-calling capability**. Cline handles tool dispatch. The Tầng 2 ContextEnricher injects graph context directly into the prompt before the model sees it, so relationship intelligence works regardless of model capability.

### Files to add

| File | Purpose |
|------|---------|
| `src/app.ts` (update) | Read `REPO_ROOT` / `DB_PATH` from env at startup, set process-level `repoId` |
| `data/` (gitignored dir) | Per-project SQLite databases |

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
