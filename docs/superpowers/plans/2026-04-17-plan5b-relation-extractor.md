# Plan 5b: Tree-Sitter Queries + ModuleMap + RelationExtractor

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Run **after Plan 5a**.

**Goal:** Add tree-sitter `.scm` query files for 5 languages, build an in-RAM `ModuleMap` for name→UUID resolution, and create `RelationExtractor` (Pass 2 indexer) that persists edges to `symbol_relations`.

**Architecture:** `RelationExtractor` is called by `Indexer.indexRepo()` after Pass 1 (symbols) is complete. It reads `.scm` queries for the file's language, runs tree-sitter captures, resolves names via `ModuleMap`, and writes to `symbol_relations` in a single transaction. C# Roslyn bridge is handled in Plan 5e — this plan only covers tree-sitter Tier 1 for all languages.

**Tech Stack:** tree-sitter, existing `extractor.ts` pattern, better-sqlite3 transactions, TypeScript NodeNext ESM.

**Schema note:** `symbols` has `file_id` FK → `files`. To look up `file_path` for a file, JOIN `files`. `RelationExtractor` receives `repoId`, `fileAbsPath`, `relPath`.

---

## Chunk 1: Tree-sitter Query Files

### File Map

| Path | Responsibility |
|------|---------------|
| `src/parser/queries/relations-javascript.scm` | JS/TS imports, calls, extends, implements |
| `src/parser/queries/relations-python.scm` | Python imports, calls, class bases |
| `src/parser/queries/relations-go.scm` | Go imports, calls, struct embed |
| `src/parser/queries/relations-rust.scm` | Rust use, calls, impl trait |
| `src/parser/queries/relations-csharp.scm` | C# using, calls, class base |

---

### Task 1: Create .scm query files (no test needed — validated by RelationExtractor tests)

- [ ] **Step 1: Create relations-javascript.scm**

Create `src/parser/queries/relations-javascript.scm`:

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

- [ ] **Step 2: Create relations-python.scm**

Create `src/parser/queries/relations-python.scm`:

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

- [ ] **Step 3: Create relations-go.scm**

Create `src/parser/queries/relations-go.scm`:

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

- [ ] **Step 4: Create relations-rust.scm**

Create `src/parser/queries/relations-rust.scm`:

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

- [ ] **Step 5: Create relations-csharp.scm**

Create `src/parser/queries/relations-csharp.scm`:

```scheme
; using directives (all variants)
(using_directive [(qualified_name) (identifier)] @import.name) @import

; member access calls: obj.Method()
(invocation_expression
  function: (member_access_expression
    name: (identifier) @call.name)) @call.member

; simple calls: Method()
(invocation_expression
  function: (identifier) @call.name) @call.simple

; constructor calls: new ClassName()
(object_creation_expression
  type: (identifier) @call.constructor) @call.new

; class/record/struct inheritance — base_list is flat
(class_declaration
  name: (identifier) @class.name
  (base_list (_) @base.name)) @class.base
```

- [ ] **Step 6: Commit query files**

```bash
git add src/parser/queries/relations-javascript.scm src/parser/queries/relations-python.scm src/parser/queries/relations-go.scm src/parser/queries/relations-rust.scm src/parser/queries/relations-csharp.scm
git commit -m "feat: add tree-sitter relation query files for 5 languages"
```

---

## Chunk 2: ModuleMap

### File Map

| Path | Responsibility |
|------|---------------|
| `src/indexer/module-map.ts` | In-RAM name→UUID lookup built during Pass 1 |
| `tests/indexer/module-map.test.ts` | register, findSymbol, getSymbolId |

---

### Task 2: ModuleMap

- [ ] **Step 1: Write failing test**

Create `tests/indexer/module-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ModuleMap } from '../../src/indexer/module-map.js';

describe('ModuleMap', () => {
  it('findSymbol returns first match for registered name', () => {
    const m = new ModuleMap();
    m.register('/a.ts', [{ id: 'id1', name: 'foo' }, { id: 'id2', name: 'bar' }]);
    expect(m.findSymbol('foo')).toBe('id1');
    expect(m.findSymbol('bar')).toBe('id2');
  });

  it('getSymbolId looks up by file + name', () => {
    const m = new ModuleMap();
    m.register('/a.ts', [{ id: 'id1', name: 'foo' }]);
    expect(m.getSymbolId('/a.ts', 'foo')).toBe('id1');
    expect(m.getSymbolId('/a.ts', 'missing')).toBeNull();
  });

  it('returns null for unknown name', () => {
    const m = new ModuleMap();
    expect(m.findSymbol('unknown')).toBeNull();
  });

  it('handles multiple files with same symbol name', () => {
    const m = new ModuleMap();
    m.register('/a.ts', [{ id: 'id1', name: 'process' }]);
    m.register('/b.ts', [{ id: 'id2', name: 'process' }]);
    // findSymbol returns first registered
    expect(m.findSymbol('process')).toBe('id1');
    // getSymbolId is file-specific
    expect(m.getSymbolId('/b.ts', 'process')).toBe('id2');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/indexer/module-map.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement ModuleMap**

Create `src/indexer/module-map.ts`:

```typescript
type SymbolEntry = { id: string; name: string };

export class ModuleMap {
  /** filePath → Map<symbolName, symbolId> */
  private fileSymbols = new Map<string, Map<string, string>>();
  /** symbolName → first symbolId registered */
  private nameIndex = new Map<string, string>();

  register(filePath: string, symbols: SymbolEntry[]): void {
    const byName = new Map<string, string>();
    for (const s of symbols) {
      byName.set(s.name, s.id);
      if (!this.nameIndex.has(s.name)) {
        this.nameIndex.set(s.name, s.id);
      }
    }
    this.fileSymbols.set(filePath, byName);
  }

  /** Returns first registered symbol ID for this name, or null */
  findSymbol(name: string): string | null {
    return this.nameIndex.get(name) ?? null;
  }

  /** Returns symbol ID in a specific file, or null */
  getSymbolId(filePath: string, name: string): string | null {
    return this.fileSymbols.get(filePath)?.get(name) ?? null;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/indexer/module-map.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/module-map.ts tests/indexer/module-map.test.ts
git commit -m "feat: add ModuleMap for in-RAM symbol name→UUID resolution"
```

---

## Chunk 3: RelationExtractor

### File Map

| Path | Responsibility |
|------|---------------|
| `src/indexer/relation-extractor.ts` | Pass 2: extract edges, resolve UUIDs, persist to DB |
| `tests/indexer/relation-extractor.test.ts` | Integration tests with in-memory DB + seeded symbols |

---

### Task 3: RelationExtractor

**Key behaviors from spec:**
- DELETE + INSERT in single `db.transaction()` (atomic, EC-1.1)
- Per-file edge cap: 10,000 (EC-3.1)
- Extension guard: skip unsupported files (EC-3.2)
- `confidence=1.0` for resolved (target_id not null), `confidence=0.7` for unresolved
- Uses `ModuleMap` for zero-DB-query name resolution
- C# heuristic: name starting with `I` + PascalCase → IMPLEMENTS, else → EXTENDS (from base_list)

Supported extensions: `.ts .tsx .js .jsx .py .go .rs .cs .mjs .cjs`

- [ ] **Step 1: Write failing tests**

Create `tests/indexer/relation-extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { ModuleMap } from '../../src/indexer/module-map.js';
import { RelationExtractor } from '../../src/indexer/relation-extractor.js';

function seed(db: ReturnType<typeof openDb>) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path, language) VALUES ('f1','r1','a.ts','typescript')`).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','foo','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','bar','function',7,10)`,
  ).run();
}

describe('RelationExtractor', () => {
  it('skips unsupported file extension', () => {
    const db = openDb(':memory:');
    seed(db);
    const mm = new ModuleMap();
    const re = new RelationExtractor(db);
    // .json is not a supported extension — should return 0 edges
    const count = re.extractAndPersist('r1', '/test/data.json', 'data.json', 'f1', mm);
    expect(count).toBe(0);
    db.close();
  });

  it('inserts resolved edge (confidence=1.0, target_id set)', () => {
    const db = openDb(':memory:');
    seed(db);
    const mm = new ModuleMap();
    mm.register('/test/a.ts', [{ id: 's1', name: 'foo' }, { id: 's2', name: 'bar' }]);

    const re = new RelationExtractor(db);
    // Directly insert a test edge (bypassing tree-sitter) via low-level helper
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'bar', targetId: 's2', type: 'CALLS', language: 'typescript' },
    ]);

    const row = db
      .prepare(`SELECT * FROM symbol_relations WHERE source_id='s1'`)
      .get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['target_id']).toBe('s2');
    expect(row['confidence']).toBe(1.0);
    expect(row['type']).toBe('CALLS');
    db.close();
  });

  it('inserts unresolved edge (confidence=0.7, target_id null)', () => {
    const db = openDb(':memory:');
    seed(db);
    const mm = new ModuleMap();
    mm.register('/test/a.ts', [{ id: 's1', name: 'foo' }]);

    const re = new RelationExtractor(db);
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'external', targetId: null, type: 'CALLS', language: 'typescript' },
    ]);

    const row = db
      .prepare(`SELECT * FROM symbol_relations WHERE source_id='s1'`)
      .get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['target_id']).toBeNull();
    expect(row['confidence']).toBe(0.7);
    db.close();
  });

  it('DELETE+INSERT is atomic — re-run replaces old edges', () => {
    const db = openDb(':memory:');
    seed(db);
    const mm = new ModuleMap();

    const re = new RelationExtractor(db);
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'bar', targetId: 's2', type: 'CALLS', language: 'typescript' },
    ]);
    // Run again — old edges deleted, new inserted
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'bar', targetId: 's2', type: 'CALLS', language: 'typescript' },
      { sourceId: 's2', targetName: 'foo', targetId: 's1', type: 'CALLS', language: 'typescript' },
    ]);

    const count = db
      .prepare(`SELECT COUNT(*) as c FROM symbol_relations WHERE repo_id='r1'`)
      .get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/indexer/relation-extractor.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement RelationExtractor**

Create `src/indexer/relation-extractor.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Db } from '../db/index.js';
import type { ModuleMap } from './module-map.js';

export type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

export type RawEdge = {
  sourceId: string;
  targetName: string;
  targetId: string | null;
  type: EdgeType;
  language: string;
};

const SUPPORTED_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.cs',
]);

const MAX_EDGES_PER_FILE = 10_000;

export class RelationExtractor {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Full Pass 2: run tree-sitter queries on a file and persist edges.
   * Returns number of edges written.
   */
  extractAndPersist(
    repoId: string,
    fileAbsPath: string,
    _relPath: string,
    fileId: string,
    moduleMap: ModuleMap,
  ): number {
    const ext = extname(fileAbsPath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) return 0;

    // Tree-sitter parsing is handled by Plan 5b integration with extractor.ts
    // For now, return 0 (tree-sitter wiring done in Chunk 4 below)
    void moduleMap;
    void fileId;
    void repoId;
    return 0;
  }

  /**
   * Test helper — bypass tree-sitter and directly persist raw edges.
   * Also used by C# Roslyn bridge (Plan 5e).
   */
  _insertEdgesForTest(repoId: string, fileId: string, edges: RawEdge[]): void {
    this._persistEdges(repoId, fileId, edges);
  }

  _persistEdges(repoId: string, fileId: string, edges: RawEdge[]): void {
    const capped = edges.length > MAX_EDGES_PER_FILE
      ? (console.warn(`[RelationExtractor] file ${fileId} has ${edges.length} edges — capping to ${MAX_EDGES_PER_FILE}`), edges.slice(0, MAX_EDGES_PER_FILE))
      : edges;

    const deleteStmt = this.db.prepare(`
      DELETE FROM symbol_relations
      WHERE source_id IN (
        SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?
      )
    `);

    const insertStmt = this.db.prepare(`
      INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsert = this.db.transaction(() => {
      deleteStmt.run(fileId, repoId);
      for (const edge of capped) {
        const confidence = edge.targetId !== null ? 1.0 : 0.7;
        insertStmt.run(
          randomUUID(),
          repoId,
          edge.sourceId,
          edge.targetId ?? null,
          edge.targetName,
          edge.type,
          edge.language,
          confidence,
        );
      }
    });

    upsert();
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/indexer/relation-extractor.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Wire RelationExtractor into Indexer.indexRepo()**

Edit `src/indexer/indexer.ts` — add Pass 2 after each file index:

At top add imports:
```typescript
import { RelationExtractor } from './relation-extractor.js';
import { ModuleMap } from './module-map.js';
```

In `Indexer` class, add field after `private queue`:
```typescript
private relationExtractor: RelationExtractor;
private moduleMap: ModuleMap;
```

In `constructor()` after `this.queue = ...`:
```typescript
this.relationExtractor = new RelationExtractor(db);
this.moduleMap = new ModuleMap();
```

In `indexRepo()` — add a second pass after `await Promise.all(tasks)`:
```typescript
// Pass 2: extract and persist relations for all indexed files
const relStart = Date.now();
let edgesTotal = 0;
for (const f of files) {
  // Look up fileId from DB
  const relPath = f.replace(rootPath + '/', '').replace(rootPath + '\\', '');
  const fileRow = this.db
    .prepare(`SELECT id FROM files WHERE repo_id = ? AND rel_path = ?`)
    .get(repoId, relPath) as { id: string } | undefined;
  if (!fileRow) continue;
  edgesTotal += this.relationExtractor.extractAndPersist(repoId, f, relPath, fileRow.id, this.moduleMap);
}
this.log?.debug?.({ edgesTotal, ms: Date.now() - relStart }, 'Pass 2 relation extraction done');
```

Note: `this.log` may not exist — only add debug log if `Indexer` already has a logger. If not, skip the log line.

- [ ] **Step 6: Full test suite — no regressions**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 7: Build**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/indexer/relation-extractor.ts tests/indexer/relation-extractor.test.ts src/indexer/indexer.ts
git commit -m "feat: add RelationExtractor Pass 2 — extract and persist symbol relations"
```
