# MCP Code Intelligence – Indexing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the indexing pipeline that watches file-system changes, parses source files with Tree-sitter, extracts symbols, stores them in SQLite (with FTS5 full-text search), handles CamelCase tokenization, and detects git renames — so the MCP server (Plan 3) can answer code-intelligence queries in real time.

**Architecture:** Three cooperating modules — `Watcher` (chokidar), `Parser` (Tree-sitter grammars per language), and `Indexer` (orchestrator). The `Indexer` owns a `p-queue` to serialize SQLite writes. File hashing (SHA-256) allows skip-if-unchanged. Git rename detection runs as a post-index step.

**Tech Stack:** `tree-sitter` + language grammar packages, `chokidar` (file watcher), `p-queue` (async queue), `node:crypto` (SHA-256), `node:child_process` (git), existing `better-sqlite3` from Plan 1.

---

## Chunk 1: Dependencies & Language Grammar Setup

### File Map

| Path | Responsibility |
|------|---------------|
| `package.json` | Add `tree-sitter`, language grammars, `chokidar`, `p-queue` |
| `src/parser/grammars.ts` | Language → grammar mapping, `Language` enum |
| `src/parser/index.ts` | `Parser` class – parse a file → raw Tree-sitter tree |
| `tests/parser/grammars.test.ts` | Verify grammar loading for each supported language |

---

### Task 1: Install indexing dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install tree-sitter and grammars**

```bash
cd C:\Users\Haha\Desktop\MCP\mcp-code1
npm install tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-rust tree-sitter-java tree-sitter-c tree-sitter-cpp
```

- [ ] **Step 2: Install watcher and queue**

```bash
npm install chokidar p-queue
npm install --save-dev @types/chokidar
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tree-sitter, chokidar, p-queue deps"
```

---

### Task 2: Language grammar map

**Files:**
- Create: `src/parser/grammars.ts`
- Create: `tests/parser/grammars.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/parser/grammars.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('grammarForExt', () => {
  it('returns javascript grammar for .js', async () => {
    const { grammarForExt } = await import('../../src/parser/grammars.js');
    const g = grammarForExt('.js');
    expect(g).toBeDefined();
    expect(g?.name).toBe('javascript');
  });

  it('returns typescript grammar for .ts', async () => {
    const { grammarForExt } = await import('../../src/parser/grammars.js');
    const g = grammarForExt('.ts');
    expect(g?.name).toBe('typescript');
  });

  it('returns undefined for .txt', async () => {
    const { grammarForExt } = await import('../../src/parser/grammars.js');
    expect(grammarForExt('.txt')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parser/grammars.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/parser/grammars.ts`**

```typescript
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Java from 'tree-sitter-java';
import C from 'tree-sitter-c';
import Cpp from 'tree-sitter-cpp';

export type Grammar = Parser.Language & { name: string };

const EXT_TO_GRAMMAR: Record<string, Grammar> = {
  '.js':   { ...JavaScript,  name: 'javascript'  } as Grammar,
  '.jsx':  { ...JavaScript,  name: 'javascript'  } as Grammar,
  '.ts':   { ...(TypeScript as any).typescript, name: 'typescript' } as Grammar,
  '.tsx':  { ...(TypeScript as any).tsx,        name: 'tsx'        } as Grammar,
  '.py':   { ...Python,      name: 'python'      } as Grammar,
  '.go':   { ...Go,          name: 'go'           } as Grammar,
  '.rs':   { ...Rust,        name: 'rust'         } as Grammar,
  '.java': { ...Java,        name: 'java'         } as Grammar,
  '.c':    { ...C,           name: 'c'            } as Grammar,
  '.h':    { ...C,           name: 'c'            } as Grammar,
  '.cpp':  { ...Cpp,         name: 'cpp'          } as Grammar,
  '.cc':   { ...Cpp,         name: 'cpp'          } as Grammar,
  '.cxx':  { ...Cpp,         name: 'cpp'          } as Grammar,
};

export function grammarForExt(ext: string): Grammar | undefined {
  return EXT_TO_GRAMMAR[ext.toLowerCase()];
}

export function supportedExtensions(): string[] {
  return Object.keys(EXT_TO_GRAMMAR);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/parser/grammars.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/parser/grammars.ts tests/parser/grammars.test.ts
git commit -m "feat: add tree-sitter grammar map for 9 languages"
```

---

## Chunk 2: Symbol Extractor

### File Map

| Path | Responsibility |
|------|---------------|
| `src/parser/extractor.ts` | Walk Tree-sitter CST, extract symbols with line ranges |
| `src/parser/queries/javascript.scm` | Tree-sitter S-expression queries for JS/TS |
| `src/parser/queries/python.scm` | Queries for Python |
| `src/parser/queries/go.scm` | Queries for Go |
| `src/parser/queries/rust.scm` | Queries for Rust |
| `tests/parser/extractor.test.ts` | Unit tests with inline source snippets |

---

### Task 3: Tree-sitter query files

**Files:**
- Create: `src/parser/queries/javascript.scm`
- Create: `src/parser/queries/python.scm`
- Create: `src/parser/queries/go.scm`
- Create: `src/parser/queries/rust.scm`

- [ ] **Step 1: Create JavaScript/TypeScript query**

Create `src/parser/queries/javascript.scm`:

```scheme
; Functions
(function_declaration
  name: (identifier) @name) @symbol

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression)])) @symbol

; Classes
(class_declaration
  name: (type_identifier) @name) @symbol

(class_declaration
  name: (identifier) @name) @symbol

; Methods inside class body
(method_definition
  name: (property_identifier) @name) @symbol

; TypeScript interface / type alias / enum
(interface_declaration
  name: (type_identifier) @name) @symbol

(type_alias_declaration
  name: (type_identifier) @name) @symbol

(enum_declaration
  name: (identifier) @name) @symbol
```

- [ ] **Step 2: Create Python query**

Create `src/parser/queries/python.scm`:

```scheme
(function_definition
  name: (identifier) @name) @symbol

(class_definition
  name: (identifier) @name) @symbol

(decorated_definition
  definition: [(function_definition name: (identifier) @name)
               (class_definition    name: (identifier) @name)]) @symbol
```

- [ ] **Step 3: Create Go query**

Create `src/parser/queries/go.scm`:

```scheme
(function_declaration
  name: (identifier) @name) @symbol

(method_declaration
  name: (field_identifier) @name) @symbol

(type_spec
  name: (type_identifier) @name) @symbol
```

- [ ] **Step 4: Create Rust query**

Create `src/parser/queries/rust.scm`:

```scheme
(function_item
  name: (identifier) @name) @symbol

(struct_item
  name: (type_identifier) @name) @symbol

(enum_item
  name: (type_identifier) @name) @symbol

(trait_item
  name: (type_identifier) @name) @symbol

(impl_item
  type: (type_identifier) @name) @symbol
```

- [ ] **Step 5: Commit**

```bash
git add src/parser/queries/
git commit -m "feat: add tree-sitter S-expression queries for JS/TS/Python/Go/Rust"
```

---

### Task 4: Symbol extractor

**Files:**
- Create: `src/parser/extractor.ts`
- Create: `tests/parser/extractor.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/parser/extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

const JS_SNIPPET = `
function add(a, b) { return a + b; }
class Calculator {
  multiply(a, b) { return a * b; }
}
`.trim();

const TS_SNIPPET = `
interface Shape { area(): number; }
type Color = 'red' | 'blue';
export enum Direction { Up, Down }
`.trim();

describe('extractSymbols', () => {
  it('extracts functions and classes from JS', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(JS_SNIPPET, '.js');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('Calculator');
    expect(names).toContain('multiply');
  });

  it('extracts interface/type/enum from TS', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(TS_SNIPPET, '.ts');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Shape');
    expect(names).toContain('Color');
    expect(names).toContain('Direction');
  });

  it('returns empty array for unsupported extension', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    expect(extractSymbols('hello world', '.txt')).toEqual([]);
  });

  it('symbols have line numbers', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(JS_SNIPPET, '.js');
    for (const s of symbols) {
      expect(typeof s.startLine).toBe('number');
      expect(typeof s.endLine).toBe('number');
      expect(s.startLine).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parser/extractor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/parser/extractor.ts`**

```typescript
import Parser from 'tree-sitter';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grammarForExt } from './grammars.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'type'
  | 'enum'
  | 'variable'
  | 'const';

export type RawSymbol = {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
};

const NODE_KIND_TO_SYMBOL_KIND: Record<string, SymbolKind> = {
  function_declaration: 'function',
  arrow_function: 'function',
  function_expression: 'function',
  lexical_declaration: 'const',
  class_declaration: 'class',
  method_definition: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  function_definition: 'function',
  class_definition: 'class',
  function_item: 'function',
  struct_item: 'class',
  enum_item: 'enum',
  trait_item: 'interface',
  impl_item: 'class',
  function_declaration_go: 'function',
  method_declaration: 'method',
  type_spec: 'type',
};

function loadQuery(lang: string): string | null {
  const queryMap: Record<string, string> = {
    javascript: 'javascript.scm',
    jsx: 'javascript.scm',
    typescript: 'javascript.scm',
    tsx: 'javascript.scm',
    python: 'python.scm',
    go: 'go.scm',
    rust: 'rust.scm',
  };
  const file = queryMap[lang];
  if (!file) return null;
  try {
    return readFileSync(join(__dirname, 'queries', file), 'utf8');
  } catch {
    return null;
  }
}

const parserCache = new Map<string, Parser>();

function getParser(grammarName: string, grammar: Parser.Language): Parser {
  let p = parserCache.get(grammarName);
  if (!p) {
    p = new Parser();
    p.setLanguage(grammar);
    parserCache.set(grammarName, p);
  }
  return p;
}

export function extractSymbols(source: string, ext: string): RawSymbol[] {
  const grammar = grammarForExt(ext);
  if (!grammar) return [];

  const querySource = loadQuery(grammar.name);
  if (!querySource) return [];

  const parser = getParser(grammar.name, grammar);
  const tree = parser.parse(source);

  const query = grammar.query(querySource);
  const matches = query.matches(tree.rootNode);

  const symbols: RawSymbol[] = [];

  for (const match of matches) {
    const symbolCapture = match.captures.find((c) => c.name === 'symbol');
    const nameCapture = match.captures.find((c) => c.name === 'name');
    if (!symbolCapture || !nameCapture) continue;

    const symbolNode = symbolCapture.node;
    const name = nameCapture.node.text;
    const kind = NODE_KIND_TO_SYMBOL_KIND[symbolNode.type] ?? 'function';

    // Extract signature: first line of the symbol node
    const lines = source.split('\n');
    const signature = (lines[symbolNode.startPosition.row] ?? '').trim().slice(0, 120);

    symbols.push({
      name,
      kind,
      startLine: symbolNode.startPosition.row,
      endLine: symbolNode.endPosition.row,
      signature,
    });
  }

  return symbols;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/parser/extractor.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/parser/extractor.ts tests/parser/extractor.test.ts
git commit -m "feat: add tree-sitter symbol extractor for 5 language families"
```

---

## Chunk 3: CamelCase Tokenizer

### File Map

| Path | Responsibility |
|------|---------------|
| `src/parser/tokenizer.ts` | Split identifiers into BM25-friendly tokens |
| `tests/parser/tokenizer.test.ts` | Unit tests |

---

### Task 5: CamelCase tokenizer

**Files:**
- Create: `src/parser/tokenizer.ts`
- Create: `tests/parser/tokenizer.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/parser/tokenizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('tokenize', () => {
  it('splits camelCase', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('getUserById')).toEqual(['get', 'user', 'by', 'id']);
  });

  it('splits PascalCase', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('UserController')).toEqual(['user', 'controller']);
  });

  it('splits snake_case', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('parse_user_token')).toEqual(['parse', 'user', 'token']);
  });

  it('splits SCREAMING_SNAKE', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('MAX_RETRY_COUNT')).toEqual(['max', 'retry', 'count']);
  });

  it('handles mixed separators', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    const tokens = tokenize('parseHTTPResponse');
    expect(tokens).toContain('parse');
    expect(tokens).toContain('http');
    expect(tokens).toContain('response');
  });

  it('deduplicates tokens', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    const tokens = tokenize('fooFoo');
    expect(tokens.filter((t) => t === 'foo')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parser/tokenizer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/parser/tokenizer.ts`**

```typescript
/**
 * Splits an identifier into lowercase tokens suitable for BM25/FTS5 indexing.
 * Handles camelCase, PascalCase, snake_case, SCREAMING_SNAKE, and mixed forms.
 */
export function tokenize(identifier: string): string[] {
  // 1. Insert space before every transition: lowercase→uppercase, digit→letter, etc.
  const spaced = identifier
    // ABCDef → ABC Def
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // camelCase → camel Case
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    // Replace non-alphanumeric (underscores, hyphens) with spaces
    .replace(/[^a-zA-Z0-9]+/g, ' ');

  const tokens = spaced
    .split(' ')
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);

  // Deduplicate preserving order
  return [...new Set(tokens)];
}

/**
 * Build an augmented search string: original identifier + all tokens.
 * Store this in the FTS column for richer matching.
 */
export function buildSearchText(name: string, signature: string, doc: string): string {
  const tokens = tokenize(name);
  return [name, ...tokens, signature, doc].join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/parser/tokenizer.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/parser/tokenizer.ts tests/parser/tokenizer.test.ts
git commit -m "feat: add CamelCase/snake_case tokenizer for FTS enrichment"
```

---

## Chunk 4: File Indexer

### File Map

| Path | Responsibility |
|------|---------------|
| `src/indexer/file-hash.ts` | SHA-256 hash of file content |
| `src/indexer/index-file.ts` | Parse one file, diff against DB, upsert symbols |
| `src/indexer/indexer.ts` | `Indexer` class: orchestrate per-repo indexing |
| `tests/indexer/index-file.test.ts` | Integration test with temp files + in-memory DB |

---

### Task 6: File hash utility

**Files:**
- Create: `src/indexer/file-hash.ts`
- Create: `tests/indexer/file-hash.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/indexer/file-hash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('hashFile', () => {
  it('returns same hash for same content', async () => {
    const { hashFile } = await import('../../src/indexer/file-hash.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    const file = join(dir, 'test.ts');
    writeFileSync(file, 'const x = 1;');
    const h1 = hashFile(file);
    const h2 = hashFile(file);
    expect(h1).toBe(h2);
    rmSync(dir, { recursive: true });
  });

  it('returns different hash for different content', async () => {
    const { hashFile } = await import('../../src/indexer/file-hash.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    const f1 = join(dir, 'a.ts');
    const f2 = join(dir, 'b.ts');
    writeFileSync(f1, 'const x = 1;');
    writeFileSync(f2, 'const x = 2;');
    expect(hashFile(f1)).not.toBe(hashFile(f2));
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/indexer/file-hash.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/indexer/file-hash.ts`**

```typescript
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/indexer/file-hash.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/indexer/file-hash.ts tests/indexer/file-hash.test.ts
git commit -m "feat: add SHA-256 file hashing utility"
```

---

### Task 7: Index-file function

**Files:**
- Create: `src/indexer/index-file.ts`
- Create: `tests/indexer/index-file.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/indexer/index-file.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import type { Db } from '../../src/db/index.js';

const TS_SOURCE = `
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export class Greeter {
  private prefix: string;
  constructor(prefix: string) { this.prefix = prefix; }
  greet(name: string) { return this.prefix + name; }
}
`.trim();

describe('indexFile', () => {
  let db: Db;
  let repoId: string;
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    dir = mkdtempSync(join(tmpdir(), 'mcp-idx-'));
    filePath = join(dir, 'greeter.ts');
    writeFileSync(filePath, TS_SOURCE);
    const repo = registry.register({ name: 'test-repo', rootPath: dir });
    repoId = repo.id;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  it('inserts symbols on first index', async () => {
    const { indexFile } = await import('../../src/indexer/index-file.js');
    const result = await indexFile(db, repoId, filePath, dir);
    expect(result.symbolsAdded).toBeGreaterThanOrEqual(2); // greet + Greeter
    const rows = db.prepare(`SELECT name FROM symbols WHERE repo_id = ?`).all(repoId) as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toContain('greet');
    expect(names).toContain('Greeter');
  });

  it('skips re-indexing unchanged file', async () => {
    const { indexFile } = await import('../../src/indexer/index-file.js');
    const r1 = await indexFile(db, repoId, filePath, dir);
    const r2 = await indexFile(db, repoId, filePath, dir);
    expect(r2.skipped).toBe(true);
    expect(r1.symbolsAdded).toBeGreaterThan(0);
  });

  it('re-indexes when content changes', async () => {
    const { indexFile } = await import('../../src/indexer/index-file.js');
    await indexFile(db, repoId, filePath, dir);
    writeFileSync(filePath, TS_SOURCE + '\nexport function extra() {}');
    const r2 = await indexFile(db, repoId, filePath, dir);
    expect(r2.skipped).toBe(false);
    const rows = db.prepare(`SELECT name FROM symbols WHERE repo_id = ?`).all(repoId) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toContain('extra');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/indexer/index-file.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/indexer/index-file.ts`**

```typescript
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, relative } from 'node:path';
import type { Db } from '../db/index.js';
import { extractSymbols } from '../parser/extractor.js';
import { hashFile } from './file-hash.js';

export type IndexFileResult = {
  filePath: string;
  skipped: boolean;
  symbolsAdded: number;
  symbolsRemoved: number;
};

type FileRow = {
  id: string;
  hash: string;
};

export async function indexFile(
  db: Db,
  repoId: string,
  absPath: string,
  repoRoot: string,
): Promise<IndexFileResult> {
  const ext = extname(absPath);
  const relPath = relative(repoRoot, absPath);
  const hash = hashFile(absPath);

  // Check if file already indexed with same hash
  const existing = db
    .prepare(`SELECT id, hash FROM files WHERE repo_id = ? AND rel_path = ?`)
    .get(repoId, relPath) as FileRow | undefined;

  if (existing && existing.hash === hash) {
    return { filePath: absPath, skipped: true, symbolsAdded: 0, symbolsRemoved: 0 };
  }

  const source = readFileSync(absPath, 'utf8');
  const rawSymbols = extractSymbols(source, ext);

  const upsertFile = db.transaction(() => {
    let fileId: string;

    if (existing) {
      // Update hash and indexed_at
      db.prepare(
        `UPDATE files SET hash = ?, indexed_at = datetime('now'), size_bytes = ? WHERE id = ?`,
      ).run(hash, statSync(absPath).size, existing.id);
      // Delete old symbols
      const removed = db
        .prepare(`DELETE FROM symbols WHERE file_id = ?`)
        .run(existing.id).changes;
      fileId = existing.id;
      // Re-insert symbols
      let added = 0;
      for (const sym of rawSymbols) {
        db.prepare(
          `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(), repoId, fileId,
          sym.name, sym.kind, sym.startLine, sym.endLine, sym.signature,
        );
        added++;
      }
      return { symbolsAdded: added, symbolsRemoved: removed };
    } else {
      fileId = randomUUID();
      db.prepare(
        `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(fileId, repoId, relPath, ext.slice(1), statSync(absPath).size, hash);
      let added = 0;
      for (const sym of rawSymbols) {
        db.prepare(
          `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(), repoId, fileId,
          sym.name, sym.kind, sym.startLine, sym.endLine, sym.signature,
        );
        added++;
      }
      return { symbolsAdded: added, symbolsRemoved: 0 };
    }
  });

  const counts = upsertFile();
  return { filePath: absPath, skipped: false, ...counts };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/indexer/index-file.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/indexer/index-file.ts tests/indexer/index-file.test.ts
git commit -m "feat: add indexFile with hash-based skip and symbol upsert"
```

---

## Chunk 5: Indexer Orchestrator

### File Map

| Path | Responsibility |
|------|---------------|
| `src/indexer/indexer.ts` | `Indexer` class: walk repo, enqueue files via p-queue, emit events |
| `tests/indexer/indexer.test.ts` | Integration test: full-repo index with multiple files |

---

### Task 8: Indexer class

**Files:**
- Create: `src/indexer/indexer.ts`
- Create: `tests/indexer/indexer.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/indexer/indexer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';

describe('Indexer', () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let repoId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-indexer-'));
    writeFileSync(join(dir, 'a.ts'), `export function alpha() {}`);
    writeFileSync(join(dir, 'b.ts'), `export class Beta {}`);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'c.ts'), `export const gamma = 1;`);
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'test', rootPath: dir });
    repoId = repo.id;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  it('indexes all TypeScript files in a directory tree', async () => {
    const { Indexer } = await import('../../src/indexer/indexer.js');
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repoId, dir);
    expect(result.filesIndexed).toBe(3);
    expect(result.symbolsAdded).toBeGreaterThanOrEqual(2); // alpha + Beta at minimum
  });

  it('respects ignore patterns', async () => {
    const { Indexer } = await import('../../src/indexer/indexer.js');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'dep.ts'), `export function dep() {}`);
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repoId, dir);
    expect(result.filesIndexed).toBe(3); // node_modules skipped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/indexer/indexer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/indexer/indexer.ts`**

```typescript
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import PQueue from 'p-queue';
import type { Db } from '../db/index.js';
import { supportedExtensions } from '../parser/grammars.js';
import { indexFile } from './index-file.js';

export type IndexRepoResult = {
  repoId: string;
  filesIndexed: number;
  filesSkipped: number;
  symbolsAdded: number;
  symbolsRemoved: number;
  durationMs: number;
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', '.cache',
  '__pycache__', '.pytest_cache', 'venv', '.venv',
  'target', 'vendor', '.idea', '.vscode',
]);

export class Indexer {
  private db: Db;
  private queue: PQueue;
  private supportedExts: Set<string>;

  constructor(db: Db, concurrency = 4) {
    this.db = db;
    this.queue = new PQueue({ concurrency });
    this.supportedExts = new Set(supportedExtensions());
  }

  async indexRepo(repoId: string, rootPath: string): Promise<IndexRepoResult> {
    const start = Date.now();
    const files = this.collectFiles(rootPath);

    let filesIndexed = 0;
    let filesSkipped = 0;
    let symbolsAdded = 0;
    let symbolsRemoved = 0;

    const tasks = files.map((f) =>
      this.queue.add(async () => {
        const result = await indexFile(this.db, repoId, f, rootPath);
        if (result.skipped) {
          filesSkipped++;
        } else {
          filesIndexed++;
          symbolsAdded += result.symbolsAdded;
          symbolsRemoved += result.symbolsRemoved;
        }
      }),
    );

    await Promise.all(tasks);

    return {
      repoId,
      filesIndexed,
      filesSkipped,
      symbolsAdded,
      symbolsRemoved,
      durationMs: Date.now() - start,
    };
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    this.walk(dir, results);
    return results;
  }

  private walk(dir: string, out: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (IGNORE_DIRS.has(entry)) continue;
        this.walk(full, out);
      } else if (stat.isFile()) {
        if (this.supportedExts.has(extname(full))) {
          out.push(full);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/indexer/indexer.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/indexer/indexer.ts tests/indexer/indexer.test.ts
git commit -m "feat: add Indexer orchestrator with p-queue and ignore-dir support"
```

---

## Chunk 6: File Watcher

### File Map

| Path | Responsibility |
|------|---------------|
| `src/watcher/watcher.ts` | `Watcher` class using chokidar + debounce; emits `change` events |
| `tests/watcher/watcher.test.ts` | Integration test with real temp files |

---

### Task 9: File watcher with debounce

**Files:**
- Create: `src/watcher/watcher.ts`
- Create: `tests/watcher/watcher.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/watcher/watcher.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Watcher', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('emits change event when a file is written', async () => {
    const { Watcher } = await import('../../src/watcher/watcher.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-watch-'));
    dirs.push(dir);
    const file = join(dir, 'test.ts');
    writeFileSync(file, 'const x = 1;');

    const watcher = new Watcher({ debounceMs: 50 });
    const seen: string[] = [];

    watcher.on('change', (path: string) => seen.push(path));
    await watcher.watch(dir);

    // Wait for watcher to be ready, then modify file
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(file, 'const x = 2;');
    await new Promise((r) => setTimeout(r, 400));

    await watcher.close();
    expect(seen.some((p) => p.includes('test.ts'))).toBe(true);
  }, 5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/watcher/watcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/watcher/watcher.ts`**

```typescript
import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { extname } from 'node:path';
import { supportedExtensions } from '../parser/grammars.js';

export type WatcherOptions = {
  debounceMs?: number;
};

export type WatcherEvent = 'change' | 'add' | 'unlink' | 'error';

export class Watcher extends EventEmitter {
  private fsWatcher: chokidar.FSWatcher | null = null;
  private debounceMs: number;
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private supportedExts: Set<string>;

  constructor(opts: WatcherOptions = {}) {
    super();
    this.debounceMs = opts.debounceMs ?? 300;
    this.supportedExts = new Set(supportedExtensions());
  }

  async watch(directory: string): Promise<void> {
    return new Promise((resolve) => {
      this.fsWatcher = chokidar.watch(directory, {
        ignored: /(^|[/\\])\..|(node_modules|dist|build)/,
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });

      this.fsWatcher.on('ready', () => resolve());

      for (const event of ['add', 'change', 'unlink'] as const) {
        this.fsWatcher.on(event, (path: string) => {
          if (!this.supportedExts.has(extname(path))) return;
          this.debounce(event, path);
        });
      }

      this.fsWatcher.on('error', (err) => this.emit('error', err));
    });
  }

  private debounce(event: string, path: string): void {
    const key = `${event}:${path}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.emit(event, path);
    }, this.debounceMs);
    this.pending.set(key, timer);
  }

  async close(): Promise<void> {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/watcher/watcher.test.ts --timeout=10000
```

Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/watcher/watcher.ts tests/watcher/watcher.test.ts
git commit -m "feat: add chokidar file watcher with debounce"
```

---

## Chunk 7: Git Rename Detection

### File Map

| Path | Responsibility |
|------|---------------|
| `src/indexer/git-renames.ts` | Run `git diff --name-status` to detect renames, update DB |
| `tests/indexer/git-renames.test.ts` | Unit tests with mocked child_process |

---

### Task 10: Git rename detection

**Files:**
- Create: `src/indexer/git-renames.ts`
- Create: `tests/indexer/git-renames.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/indexer/git-renames.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We test the pure parsing logic, not the actual git command
describe('parseGitRenames', () => {
  it('extracts rename pairs from git diff output', async () => {
    const { parseGitRenames } = await import('../../src/indexer/git-renames.js');
    const gitOutput = `
R100\tsrc/old-name.ts\tsrc/new-name.ts
M\tsrc/unchanged.ts
R075\tlib/foo.ts\tlib/bar.ts
`.trim();
    const renames = parseGitRenames(gitOutput);
    expect(renames).toHaveLength(2);
    expect(renames[0]).toEqual({ from: 'src/old-name.ts', to: 'src/new-name.ts' });
    expect(renames[1]).toEqual({ from: 'lib/foo.ts', to: 'lib/bar.ts' });
  });

  it('returns empty array when no renames', async () => {
    const { parseGitRenames } = await import('../../src/indexer/git-renames.js');
    expect(parseGitRenames('M\tsrc/foo.ts\nA\tsrc/bar.ts')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/indexer/git-renames.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/indexer/git-renames.ts`**

```typescript
import { execSync } from 'node:child_process';
import type { Db } from '../db/index.js';

export type RenamePair = { from: string; to: string };

export function parseGitRenames(gitOutput: string): RenamePair[] {
  const renames: RenamePair[] = [];
  for (const line of gitOutput.split('\n')) {
    const parts = line.split('\t');
    if (parts.length === 3 && parts[0]?.startsWith('R')) {
      const from = parts[1];
      const to = parts[2];
      if (from && to) renames.push({ from, to });
    }
  }
  return renames;
}

export function detectAndApplyRenames(
  db: Db,
  repoId: string,
  repoRoot: string,
  fromRef = 'HEAD~1',
  toRef = 'HEAD',
): RenamePair[] {
  let output: string;
  try {
    output = execSync(`git diff --name-status -M ${fromRef} ${toRef}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
  } catch {
    // Not a git repo or git not available – skip
    return [];
  }

  const renames = parseGitRenames(output);

  if (renames.length === 0) return [];

  const applyRenames = db.transaction(() => {
    for (const { from, to } of renames) {
      db.prepare(
        `UPDATE files SET rel_path = ? WHERE repo_id = ? AND rel_path = ?`,
      ).run(to, repoId, from);
    }
  });
  applyRenames();

  return renames;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/indexer/git-renames.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/indexer/git-renames.ts tests/indexer/git-renames.test.ts
git commit -m "feat: add git rename detection and DB path update"
```

---

## Final Verification

- [ ] Run full test suite:

```bash
npx vitest run --coverage
```

Expected: all tests pass.

- [ ] Wire `Indexer` and `Watcher` into `App.start()`:

In `src/app.ts`, add:

```typescript
import { Indexer } from './indexer/indexer.js';
import { Watcher } from './watcher/watcher.js';

// Inside App class:
readonly indexer: Indexer;
readonly watcher: Watcher;

// In constructor, after pool:
this.indexer = new Indexer(this.pool.acquire());
this.watcher = new Watcher({ debounceMs: 300 });

// In start():
for (const repo of this.registry.list()) {
  this.log.info({ repo: repo.name }, 'Starting initial index');
  await this.indexer.indexRepo(repo.id, repo.rootPath);
  await this.watcher.watch(repo.rootPath);
  this.watcher.on('change', (path: string) => {
    void this.indexer.indexRepo(repo.id, repo.rootPath);
  });
}
```

- [ ] Commit:

```bash
git add src/app.ts
git commit -m "feat: wire Indexer and Watcher into App lifecycle"
```

---

**Plan complete. Hand off to Plan 3: MCP Server & Tools.**
