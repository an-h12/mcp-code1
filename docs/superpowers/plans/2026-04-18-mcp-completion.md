# MCP Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the MCP server to full compliance — tool rename with `code_` prefix, `outputSchema`+`structuredContent` for all tools, 3 new graph tools, wire `ContextEnricher`, and add MCP Prompts primitive.

**Architecture:** 4 independent chunks executed in sequence. Each chunk builds on the previous rename (so Chunk 1 must go first), but each is independently buildable and testable. All logic reuses existing BFS infrastructure (`bfsTraverse`, `InMemoryGraph`). No new dependencies needed.

**Tech Stack:** TypeScript 5 strict (NodeNext), `@modelcontextprotocol/sdk ^1.29.0`, Zod, `better-sqlite3`, Vitest

**Spec:** `docs/superpowers/specs/2026-04-18-mcp-completion-design.md`

---

## Chunk 1: Tool Rename + Description Polish

### File Map

| File | Change |
|------|--------|
| `src/mcp/server.ts` | Rename server display name; update `TOOL_NAMES` array |
| `src/mcp/tools/index.ts` | Rename all 13 `server.registerTool(...)` first args |
| `src/mcp/tool-schemas.ts` | Add 3 missing `.describe()` calls |
| `tests/mcp/server.test.ts` | Update 13 expected tool name strings + length assertion |
| `tests/e2e/mcp-protocol.test.ts` | Update any tool name string refs |
| `tests/e2e/cline-scenario.test.ts` | Update any tool name string refs |

---

### Task 1: Update server display name + TOOL_NAMES

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Write failing test**

In `tests/mcp/server.test.ts`, replace all 13 old name assertions and length check:

```typescript
it('exposes expected tool names', async () => {
  const { TOOL_NAMES } = await import('../../src/mcp/server.js');
  expect(TOOL_NAMES).toContain('code_search_symbols');
  expect(TOOL_NAMES).toContain('code_get_symbol_detail');
  expect(TOOL_NAMES).toContain('code_list_repos');
  expect(TOOL_NAMES).toContain('code_register_repo');
  expect(TOOL_NAMES).toContain('code_index_repo');
  expect(TOOL_NAMES).toContain('code_find_references');
  expect(TOOL_NAMES).toContain('code_search_files');
  expect(TOOL_NAMES).toContain('code_get_file_symbols');
  expect(TOOL_NAMES).toContain('code_explain_symbol');
  expect(TOOL_NAMES).toContain('code_get_repo_stats');
  expect(TOOL_NAMES).toContain('code_remove_repo');
  expect(TOOL_NAMES).toContain('code_get_symbol_context');
  expect(TOOL_NAMES).toContain('code_get_import_chain');
  expect(TOOL_NAMES).toHaveLength(13);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: FAIL — `expected [ 'search_symbols', ... ] to contain 'code_search_symbols'`

- [ ] **Step 3: Update `src/mcp/server.ts`**

Change the `TOOL_NAMES` array and server display name:

```typescript
export const TOOL_NAMES = [
  'code_search_symbols',
  'code_get_symbol_detail',
  'code_list_repos',
  'code_register_repo',
  'code_index_repo',
  'code_find_references',
  'code_search_files',
  'code_get_file_symbols',
  'code_explain_symbol',
  'code_get_repo_stats',
  'code_remove_repo',
  'code_get_symbol_context',
  'code_get_import_chain',
] as const;
```

And in the `McpServer` constructor, change the name string:
```typescript
this.server = new McpServer(
  { name: 'code-intelligence-mcp-server', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: PASS

---

### Task 2: Rename all 13 registerTool calls

**Files:**
- Modify: `src/mcp/tools/index.ts`

- [ ] **Step 1: Rename all 13 tool registrations in `src/mcp/tools/index.ts`**

Replace each `server.registerTool('old_name', ...)` with the new `code_` prefix name. All 13 replacements — find each string and prepend `code_`:

```
'search_symbols'      → 'code_search_symbols'
'get_symbol_detail'   → 'code_get_symbol_detail'
'list_repos'          → 'code_list_repos'
'register_repo'       → 'code_register_repo'
'index_repo'          → 'code_index_repo'
'find_references'     → 'code_find_references'
'search_files'        → 'code_search_files'
'get_file_symbols'    → 'code_get_file_symbols'
'explain_symbol'      → 'code_explain_symbol'
'get_repo_stats'      → 'code_get_repo_stats'
'remove_repo'         → 'code_remove_repo'
'get_symbol_context'  → 'code_get_symbol_context'
'get_import_chain'    → 'code_get_import_chain'
```

- [ ] **Step 2: Run unit + integration tests (not e2e) to verify no regressions**

```bash
npx vitest run tests/mcp/ tests/db/
```

Expected: all unit/integration tests pass. E2e tests in `tests/e2e/` will fail with tool-not-found errors until Task 3 Step 3 fixes the name refs — do NOT run e2e yet.

---

### Task 3: Fix description gaps in tool-schemas.ts

**Files:**
- Modify: `src/mcp/tool-schemas.ts`

- [ ] **Step 1: Add missing `.describe()` calls**

In `src/mcp/tool-schemas.ts`, make these 3 targeted edits:

```typescript
// FindReferencesSchema — add describe to repo_id:
repo_id: z.string().optional().nullable().describe('Filter by repo. Get IDs from code_list_repos.'),

// GetSymbolContextSchema — add describe to symbol_name:
symbol_name: z.string().min(1).describe('Exact or partial symbol name to look up'),

// ExplainSymbolSchema — add describe to symbol_id:
symbol_id: z.string().min(1).describe('UUID from code_search_symbols or code_find_references'),
```

- [ ] **Step 2: Run build to verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors

- [ ] **Step 3: Update e2e test files for any old tool name refs**

Search for old names in test files:

```bash
grep -rn "\"search_symbols\"\|\"get_symbol_detail\"\|\"list_repos\"\|\"find_references\"\|\"search_files\"\|\"get_file_symbols\"\|\"explain_symbol\"\|\"get_repo_stats\"\|\"remove_repo\"\|\"get_symbol_context\"\|\"get_import_chain\"\|\"register_repo\"\|\"index_repo\"" tests/
```

Replace any found occurrences with the `code_` prefixed versions in `tests/e2e/mcp-protocol.test.ts` and `tests/e2e/cline-scenario.test.ts`.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 5: Commit Chunk 1**

```bash
git add src/mcp/server.ts src/mcp/tools/index.ts src/mcp/tool-schemas.ts tests/mcp/server.test.ts tests/e2e/mcp-protocol.test.ts tests/e2e/cline-scenario.test.ts
git commit -m "feat: rename all MCP tools with code_ prefix (breaking change)

- All 13 tools now prefixed: search_symbols → code_search_symbols etc.
- Server display name: mcp-code1 → code-intelligence-mcp-server
- Add missing .describe() to FindReferences, GetSymbolContext, ExplainSymbol schemas"
```

---

## Chunk 2: outputSchema + structuredContent

### File Map

| File | Change |
|------|--------|
| `src/mcp/tool-schemas.ts` | Add 13 output Zod schemas |
| `src/mcp/tools/index.ts` | Add `outputSchema` + `structuredContent` to all 13 registrations |
| `tests/mcp/server.test.ts` | Add structuredContent assertions |

---

### Task 4: Add output Zod schemas

**Files:**
- Modify: `src/mcp/tool-schemas.ts`

- [ ] **Step 1: Append 13 output schemas to `src/mcp/tool-schemas.ts`**

Add at the bottom of the file:

```typescript
// ── Output schemas ─────────────────────────────────────────────────────────

const SymbolResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  repoId: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  signature: z.string(),
});

const PaginatedSymbolsSchema = z.object({
  items: z.array(SymbolResultSchema),
  total_count: z.number(),
  has_more: z.boolean(),
  next_offset: z.number(),
});

export const SearchSymbolsOutputSchema = PaginatedSymbolsSchema;

export const GetSymbolDetailOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  signature: z.string(),
});

const ReferenceResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  repoId: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  referenceType: z.enum(['definition', 'caller']),
});

export const FindReferencesOutputSchema = z.array(ReferenceResultSchema);

const GraphNodeSchema = z.object({
  symbolId: z.string(),
  name: z.string(),
  filePath: z.string(),
  line: z.number(),
  depth: z.number(),
  via: z.string(),
});

export const GetSymbolContextOutputSchema = z.object({
  symbol: z.object({ id: z.string(), name: z.string(), kind: z.string(), filePath: z.string(), line: z.number() }),
  callers: z.array(GraphNodeSchema),
  callees: z.array(GraphNodeSchema),
  blastRadius: z.number(),
  impactCount: z.number(),
  resolvedAs: z.string(),
});

const ImportChainEntrySchema = z.object({
  file: z.string(),
  imports: z.array(z.string()),
});

// Shape matches what getImportChain() in src/mcp/tools/get-import-chain.ts actually returns:
// { chain: Array<{ file, imports[] }>, resolvedAs: string }
// Note: spec table listed shorthand "{ file, imports[], depth }" — actual shape is the chain-of-entries
// structure. No top-level depth field; each entry is one file and its direct imports.
export const GetImportChainOutputSchema = z.object({
  chain: z.array(ImportChainEntrySchema),
  resolvedAs: z.string(),
});

const FileResultSchema = z.object({
  id: z.string(),
  repo_id: z.string(),
  rel_path: z.string(),
  language: z.string().nullable(),
  size_bytes: z.number().nullable(),
});

export const SearchFilesOutputSchema = z.object({
  items: z.array(FileResultSchema),
  total_count: z.number(),
  has_more: z.boolean(),
  next_offset: z.number(),
});

export const GetFileSymbolsOutputSchema = z.array(SymbolResultSchema);

const RepoResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  language: z.string().optional(),
});

export const ListReposOutputSchema = z.array(RepoResultSchema);

export const GetRepoStatsOutputSchema = z.object({
  repoId: z.string(),
  fileCount: z.number(),
  symbolCount: z.number(),
  languages: z.array(z.object({ language: z.string().nullable(), count: z.number() })),
});

export const ExplainSymbolOutputSchema = z.object({
  symbolId: z.string(),
  explanation: z.string(),
});

export const RegisterRepoOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  language: z.string().optional(),
});

export const IndexRepoOutputSchema = z.object({
  repoId: z.string(),
  fileCount: z.number(),
  symbolCount: z.number(),
  durationMs: z.number(),
});

export const RemoveRepoOutputSchema = z.object({
  repoId: z.string(),
  removed: z.boolean(),
});
```

- [ ] **Step 2: Run build to verify no TypeScript errors**

```bash
npm run build
```

Expected: no errors

---

### Task 5: Add outputSchema + structuredContent to all 13 tool registrations

**Files:**
- Modify: `src/mcp/tools/index.ts`

- [ ] **Step 1: Update imports in `src/mcp/tools/index.ts`**

Add the 13 new output schema imports to the top import block:

```typescript
import {
  SearchSymbolsSchema,
  GetSymbolDetailSchema,
  RegisterRepoSchema,
  IndexRepoSchema,
  FindReferencesSchema,
  SearchFilesSchema,
  GetFileSymbolsSchema,
  ExplainSymbolSchema,
  GetRepoStatsSchema,
  RemoveRepoSchema,
  GetSymbolContextSchema,
  GetImportChainSchema,
  // output schemas:
  SearchSymbolsOutputSchema,
  GetSymbolDetailOutputSchema,
  FindReferencesOutputSchema,
  GetSymbolContextOutputSchema,
  GetImportChainOutputSchema,
  SearchFilesOutputSchema,
  GetFileSymbolsOutputSchema,
  ListReposOutputSchema,
  GetRepoStatsOutputSchema,
  ExplainSymbolOutputSchema,
  RegisterRepoOutputSchema,
  IndexRepoOutputSchema,
  RemoveRepoOutputSchema,
} from '../tool-schemas.js';
```

- [ ] **Step 2: Update each tool registration — add outputSchema and structuredContent**

For each of the 13 tools, add `outputSchema` to the definition and `structuredContent` to the return. Use this pattern:

**`code_search_symbols`:**
```typescript
server.registerTool('code_search_symbols', {
  description: '...',  // unchanged
  inputSchema: SearchSymbolsSchema,
  outputSchema: SearchSymbolsOutputSchema,
  annotations: { ... },  // unchanged
}, async ({ query, repo_id, kind, limit, offset }) => {
  try {
    const results = searchSymbols(opts.db, { query, repoId: repo_id ?? null, kind: kind ?? null, limit, offset });
    return {
      structuredContent: results,
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  } catch (e) {
    return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
  }
});
```

Apply the same `outputSchema` + `structuredContent` pattern to all 13 tools. The `structuredContent` value is the same object already being `JSON.stringify`-ed.

**Explicit mapping for tools not listed as special cases:**

| Tool | `structuredContent` value |
|------|--------------------------|
| `code_get_symbol_detail` | `detail` — the object returned by `getSymbolDetail()` |
| `code_find_references` | `refs` — the `ReferenceResult[]` array returned by `findReferences()` (bare array, not wrapped in object) |
| `code_search_files` | `files` — the paginated object returned by `searchFiles()` |
| `code_get_file_symbols` | `symbols` — the `SymbolResult[]` array returned by `getFileSymbols()` (bare array) |
| `code_get_repo_stats` | `stats` — the object returned by `getRepoStats()` |

Note for array-typed tools (`code_find_references`, `code_get_file_symbols`): `structuredContent` accepts arrays directly — no need to wrap in `{ items: ... }`.

**Special cases:**

- `code_get_symbol_context`: the current `getSymbolContext()` returns `{ symbol, callers, callees, impactCount, blastRadius, resolvedAs }` — `blastRadius` and `impactCount` are already in the return object (verified in `get-symbol-context.ts` line 62-67). Just pass the result directly as `structuredContent`.

- `code_explain_symbol`: wrap the plain string result: `structuredContent: { symbolId: symbol_id, explanation }` where `explanation` is the string returned by `explainSymbol()`.

- `code_remove_repo`: return `structuredContent: { repoId: repo_id, removed: true }`.

- `code_list_repos`: `listRepos()` returns `RepoEntry[]` — pass directly.

- `code_index_repo`: `indexRepo()` returns `{ repoId, fileCount, symbolCount, durationMs }` — pass directly.

- `code_register_repo`: `registerRepo()` returns a repo object — pass directly.

- [ ] **Step 3: Write tests for structuredContent presence**

In `tests/mcp/server.test.ts`, add a new describe block:

```typescript
describe('structuredContent', () => {
  let db: ReturnType<typeof openDb>;
  let sdkServer: ReturnType<typeof getInternalServer>;

  // Helper: access internal handler (same pattern as mcp-protocol.test.ts)
  function getHandlers(server: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (server as any)._requestHandlers as Map<string, any>;
  }

  async function callTool(toolName: string, args: Record<string, unknown>) {
    const { McpServer } = await import('../../src/mcp/server.js');
    const registry = new RepoRegistry(db);
    const indexer = new Indexer(db);
    const graph = new InMemoryGraph(db);
    const server = new McpServer({ db, registry, indexer, aiConfig: null, graph, repoId: '' });
    const internal = server.getInternalServer();
    const handler = getHandlers(internal).get('tools/call');
    const noopExtra = { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => ({}), requestId: 'test', authInfo: undefined };
    return handler({ method: 'tools/call', params: { name: toolName, arguments: args } }, noopExtra);
  }

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  afterEach(() => { db.close(); });

  it('code_search_symbols returns structuredContent with items array (object shape)', async () => {
    const result = await callTool('code_search_symbols', { query: 'test' });
    expect(result).toHaveProperty('structuredContent');
    expect(result.structuredContent).toHaveProperty('items');
    expect(Array.isArray(result.structuredContent.items)).toBe(true);
    expect(result.structuredContent).toHaveProperty('total_count');
  });

  it('code_find_references returns structuredContent as bare array (array shape)', async () => {
    const result = await callTool('code_find_references', { symbol_name: 'nonexistent' });
    expect(result).toHaveProperty('structuredContent');
    expect(Array.isArray(result.structuredContent)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the new test**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit Chunk 2**

```bash
git add src/mcp/tool-schemas.ts src/mcp/tools/index.ts tests/mcp/server.test.ts
git commit -m "feat: add outputSchema + structuredContent to all 13 MCP tools

All tools now return both text content (backward compat) and structuredContent
(typed object) alongside Zod outputSchema declarations for modern MCP clients."
```

---

## Chunk 3: 3 New Tools + Wire ContextEnricher

### File Map

| File | Change |
|------|--------|
| `src/mcp/tools/find-callers.ts` | New — `findCallers()` function |
| `src/mcp/tools/find-callees.ts` | New — `findCallees()` function |
| `src/mcp/tools/get-impact-analysis.ts` | New — `getImpactAnalysis()` function |
| `src/mcp/tool-schemas.ts` | Add 3 input + 3 output schemas |
| `src/mcp/tools/index.ts` | Import + register 3 new tools |
| `src/mcp/server.ts` | Add 3 new names to `TOOL_NAMES`; update `ToolName` type |
| `src/app.ts` | Add `readonly contextEnricher` property; instantiate in constructor |
| `tests/mcp/tools/find-callers.test.ts` | New unit tests |
| `tests/mcp/tools/find-callees.test.ts` | New unit tests |
| `tests/mcp/tools/get-impact-analysis.test.ts` | New unit tests |
| `tests/mcp/app-context-enricher.test.ts` | Integration test |

---

### Task 6: Schemas for 3 new tools

**Files:**
- Modify: `src/mcp/tool-schemas.ts`

- [ ] **Step 1: Add 3 input schemas + 3 output schemas at the bottom of `src/mcp/tool-schemas.ts`**

```typescript
// ── Chunk 3: new graph tools ───────────────────────────────────────────────

export const FindCallersSchema = z.object({
  symbol_name: z.string().min(1).describe('Exact or partial symbol name to find callers for'),
  repo_id: z.string().optional().nullable().describe('Filter by repo. Falls back to server default repo.'),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1).describe('BFS traversal depth. Default 1 = direct callers only.'),
});

export const FindCalleesSchema = z.object({
  symbol_name: z.string().min(1).describe('Exact or partial symbol name to find callees for'),
  repo_id: z.string().optional().nullable().describe('Filter by repo. Falls back to server default repo.'),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1).describe('BFS traversal depth. Default 1 = direct callees only.'),
});

export const GetImpactAnalysisSchema = z.object({
  symbol_name: z.string().min(1).describe('Symbol to analyze blast radius for'),
  repo_id: z.string().optional().nullable().describe('Filter by repo. Falls back to server default repo.'),
});

// Output schemas

const ImpactTierSchema = z.object({
  symbols: z.array(z.object({
    symbolId: z.string(),
    name: z.string(),
    filePath: z.string(),
    line: z.number(),
    via: z.string(),
  })),
  count: z.number(),
});

export const FindCallersOutputSchema = z.object({
  symbol: z.object({ id: z.string(), name: z.string(), kind: z.string(), filePath: z.string(), line: z.number() }),
  callers: z.array(z.object({ symbolId: z.string(), name: z.string(), filePath: z.string(), line: z.number(), depth: z.number(), via: z.string() })),
  blastRadius: z.number(),
});

export const FindCalleesOutputSchema = z.object({
  symbol: z.object({ id: z.string(), name: z.string(), kind: z.string(), filePath: z.string(), line: z.number() }),
  callees: z.array(z.object({ symbolId: z.string(), name: z.string(), filePath: z.string(), line: z.number(), depth: z.number(), via: z.string() })),
  dependencyCount: z.number(),
});

export const GetImpactAnalysisOutputSchema = z.object({
  symbol: z.object({ id: z.string(), name: z.string(), kind: z.string(), filePath: z.string(), line: z.number() }),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  direct: ImpactTierSchema,
  indirect: ImpactTierSchema,
  transitive: ImpactTierSchema,
  totalImpact: z.number(),
});
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: no errors

---

### Task 7: Implement `find-callers.ts`

**Files:**
- Create: `src/mcp/tools/find-callers.ts`
- Create: `tests/mcp/tools/find-callers.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/tools/find-callers.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { runMigrations } from '../../../src/db/migrations/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';
import { findCallers } from '../../../src/mcp/tools/find-callers.js';

describe('findCallers', () => {
  let db: ReturnType<typeof openDb>;
  let graph: InMemoryGraph;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    graph = new InMemoryGraph(db);
  });

  it('returns null for unknown symbol', () => {
    const result = findCallers(db, graph, 'defaultRepo', { symbolName: 'nonexistent', repoId: null, depth: 1 });
    expect(result).toBeNull();
  });

  it('returns symbol with empty callers when no incoming edges', () => {
    // Insert minimal fixture: repo, file, symbol
    db.prepare("INSERT INTO repos VALUES ('r1', 'test', '/test', 'ts', datetime('now'))").run();
    db.prepare("INSERT INTO files VALUES ('f1', 'r1', 'src/a.ts', 'ts', 100, datetime('now'))").run();
    db.prepare("INSERT INTO symbols VALUES ('s1', 'r1', 'f1', 'myFunc', 'function', 1, 10, 'function myFunc()', datetime('now'))").run();

    const result = findCallers(db, graph, 'r1', { symbolName: 'myFunc', repoId: 'r1', depth: 1 });
    expect(result).not.toBeNull();
    expect(result!.symbol.name).toBe('myFunc');
    expect(result!.callers).toHaveLength(0);
    expect(result!.blastRadius).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/tools/find-callers.test.ts
```

Expected: FAIL — `Cannot find module 'find-callers.js'`

- [ ] **Step 3: Implement `src/mcp/tools/find-callers.ts`**

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export type FindCallersParams = {
  symbolName: string;
  repoId: string | null;
  depth: 1 | 2 | 3;
};

export function findCallers(
  db: Db,
  graph: InMemoryGraph,
  defaultRepoId: string,
  params: FindCallersParams,
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
  const callerRaw = bfsTraverse(g, intId, 'incoming', params.depth);

  const allUuids = callerRaw.map((r) => g.mapper.resolve(r.symbolId));
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

  const callers = callerRaw.map((r) => {
    const uuid = g.mapper.resolve(r.symbolId);
    const info = nameMap.get(uuid);
    return { symbolId: uuid, name: info?.name ?? uuid, filePath: info?.rel_path ?? '', line: info?.start_line ?? 0, depth: r.depth, via: r.via };
  });

  return {
    symbol: { id: row.id, name: row.name, kind: row.kind, filePath: row.rel_path, line: row.start_line },
    callers,
    blastRadius: callers.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mcp/tools/find-callers.test.ts
```

Expected: PASS

---

### Task 8: Implement `find-callees.ts`

**Files:**
- Create: `src/mcp/tools/find-callees.ts`
- Create: `tests/mcp/tools/find-callees.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/tools/find-callees.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { runMigrations } from '../../../src/db/migrations/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';
import { findCallees } from '../../../src/mcp/tools/find-callees.js';

describe('findCallees', () => {
  let db: ReturnType<typeof openDb>;
  let graph: InMemoryGraph;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    graph = new InMemoryGraph(db);
  });

  it('returns null for unknown symbol', () => {
    const result = findCallees(db, graph, 'defaultRepo', { symbolName: 'nonexistent', repoId: null, depth: 1 });
    expect(result).toBeNull();
  });

  it('returns symbol with empty callees when no outgoing edges', () => {
    db.prepare("INSERT INTO repos VALUES ('r1', 'test', '/test', 'ts', datetime('now'))").run();
    db.prepare("INSERT INTO files VALUES ('f1', 'r1', 'src/a.ts', 'ts', 100, datetime('now'))").run();
    db.prepare("INSERT INTO symbols VALUES ('s1', 'r1', 'f1', 'myFunc', 'function', 1, 10, 'function myFunc()', datetime('now'))").run();

    const result = findCallees(db, graph, 'r1', { symbolName: 'myFunc', repoId: 'r1', depth: 1 });
    expect(result).not.toBeNull();
    expect(result!.symbol.name).toBe('myFunc');
    expect(result!.callees).toHaveLength(0);
    expect(result!.dependencyCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/tools/find-callees.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/mcp/tools/find-callees.ts`**

```typescript
import type { Db } from '../../db/index.js';
import type { InMemoryGraph } from '../../graph/in-memory-graph.js';
import { bfsTraverse } from '../../graph/bfs.js';

export type FindCalleesParams = {
  symbolName: string;
  repoId: string | null;
  depth: 1 | 2 | 3;
};

export function findCallees(
  db: Db,
  graph: InMemoryGraph,
  defaultRepoId: string,
  params: FindCalleesParams,
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
  const calleeRaw = bfsTraverse(g, intId, 'outgoing', params.depth);

  const allUuids = calleeRaw.map((r) => g.mapper.resolve(r.symbolId));
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

  const callees = calleeRaw.map((r) => {
    const uuid = g.mapper.resolve(r.symbolId);
    const info = nameMap.get(uuid);
    return { symbolId: uuid, name: info?.name ?? uuid, filePath: info?.rel_path ?? '', line: info?.start_line ?? 0, depth: r.depth, via: r.via };
  });

  return {
    symbol: { id: row.id, name: row.name, kind: row.kind, filePath: row.rel_path, line: row.start_line },
    callees,
    dependencyCount: callees.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mcp/tools/find-callees.test.ts
```

Expected: PASS

---

### Task 9: Implement `get-impact-analysis.ts`

**Files:**
- Create: `src/mcp/tools/get-impact-analysis.ts`
- Create: `tests/mcp/tools/get-impact-analysis.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/tools/get-impact-analysis.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { runMigrations } from '../../../src/db/migrations/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';
import { getImpactAnalysis } from '../../../src/mcp/tools/get-impact-analysis.js';

describe('getImpactAnalysis', () => {
  let db: ReturnType<typeof openDb>;
  let graph: InMemoryGraph;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    graph = new InMemoryGraph(db);
  });

  it('returns null for unknown symbol', () => {
    const result = getImpactAnalysis(db, graph, 'defaultRepo', { symbolName: 'nonexistent', repoId: null });
    expect(result).toBeNull();
  });

  it('returns LOW risk and empty tiers when no callers', () => {
    db.prepare("INSERT INTO repos VALUES ('r1', 'test', '/test', 'ts', datetime('now'))").run();
    db.prepare("INSERT INTO files VALUES ('f1', 'r1', 'src/a.ts', 'ts', 100, datetime('now'))").run();
    db.prepare("INSERT INTO symbols VALUES ('s1', 'r1', 'f1', 'myFunc', 'function', 1, 10, 'function myFunc()', datetime('now'))").run();

    const result = getImpactAnalysis(db, graph, 'r1', { symbolName: 'myFunc', repoId: 'r1' });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe('LOW');
    expect(result!.direct.count).toBe(0);
    expect(result!.indirect.count).toBe(0);
    expect(result!.transitive.count).toBe(0);
    expect(result!.totalImpact).toBe(0);
  });

  it('tiered sets are exclusive (no symbol in both direct and indirect)', () => {
    // This test verifies set subtraction logic — even with empty graph it confirms structure
    db.prepare("INSERT INTO repos VALUES ('r1', 'test', '/test', 'ts', datetime('now'))").run();
    db.prepare("INSERT INTO files VALUES ('f1', 'r1', 'src/a.ts', 'ts', 100, datetime('now'))").run();
    db.prepare("INSERT INTO symbols VALUES ('s1', 'r1', 'f1', 'myFunc', 'function', 1, 10, 'function myFunc()', datetime('now'))").run();

    const result = getImpactAnalysis(db, graph, 'r1', { symbolName: 'myFunc', repoId: 'r1' });
    const directIds = new Set(result!.direct.symbols.map((s) => s.symbolId));
    const indirectIds = new Set(result!.indirect.symbols.map((s) => s.symbolId));
    const transitiveIds = new Set(result!.transitive.symbols.map((s) => s.symbolId));

    // No overlap between tiers
    for (const id of indirectIds) expect(directIds.has(id)).toBe(false);
    for (const id of transitiveIds) expect(directIds.has(id)).toBe(false);
    for (const id of transitiveIds) expect(indirectIds.has(id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/tools/get-impact-analysis.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/mcp/tools/get-impact-analysis.ts`**

```typescript
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

  // BFS at each depth — results are cumulative (depth N includes all depths 1..N)
  const d1Raw = bfsTraverse(g, intId, 'incoming', 1);
  const d2Raw = bfsTraverse(g, intId, 'incoming', 2);
  const d3Raw = bfsTraverse(g, intId, 'incoming', 3);

  // Convert to UUID sets for set-subtraction
  const d1Map = new Map(d1Raw.map((r) => [g.mapper.resolve(r.symbolId), r.via]));
  const d2Map = new Map(d2Raw.map((r) => [g.mapper.resolve(r.symbolId), r.via]));
  const d3Map = new Map(d3Raw.map((r) => [g.mapper.resolve(r.symbolId), r.via]));

  // Exclusive tiers via set subtraction
  const directUuids = [...d1Map.entries()];
  const indirectUuids = [...d2Map.entries()].filter(([uuid]) => !d1Map.has(uuid));
  const transitiveUuids = [...d3Map.entries()].filter(([uuid]) => !d2Map.has(uuid));

  // Batch DB lookup for names/paths
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mcp/tools/get-impact-analysis.test.ts
```

Expected: PASS

---

### Task 10: Register 3 new tools + update TOOL_NAMES

**Files:**
- Modify: `src/mcp/tools/index.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/mcp/server.test.ts`

- [ ] **Step 1: Update TOOL_NAMES in `src/mcp/server.ts`**

Replace the full `TOOL_NAMES` array (do not use placeholders):

```typescript
export const TOOL_NAMES = [
  'code_search_symbols',
  'code_get_symbol_detail',
  'code_list_repos',
  'code_register_repo',
  'code_index_repo',
  'code_find_references',
  'code_search_files',
  'code_get_file_symbols',
  'code_explain_symbol',
  'code_get_repo_stats',
  'code_remove_repo',
  'code_get_symbol_context',
  'code_get_import_chain',
  'code_find_callers',
  'code_find_callees',
  'code_get_impact_analysis',
] as const;
```

- [ ] **Step 2: Update `tests/mcp/server.test.ts` length assertion**

Change `expect(TOOL_NAMES).toHaveLength(13)` to `expect(TOOL_NAMES).toHaveLength(16)` and add 3 new name assertions:

```typescript
expect(TOOL_NAMES).toContain('code_find_callers');
expect(TOOL_NAMES).toContain('code_find_callees');
expect(TOOL_NAMES).toContain('code_get_impact_analysis');
expect(TOOL_NAMES).toHaveLength(16);
```

- [ ] **Step 3: Add imports + register 3 tools in `src/mcp/tools/index.ts`**

Add these 3 new function imports after the existing function imports (after `import { getImportChain } ...`):

```typescript
import { findCallers } from './find-callers.js';
import { findCallees } from './find-callees.js';
import { getImpactAnalysis } from './get-impact-analysis.js';
```

In the existing schema import block from `'../tool-schemas.js'`, add these 6 new names to the existing list:

```typescript
// Add to the existing import block:
FindCallersSchema,
FindCalleesSchema,
GetImpactAnalysisSchema,
FindCallersOutputSchema,
FindCalleesOutputSchema,
GetImpactAnalysisOutputSchema,
```

Register at the end of `registerTools()`, before the closing brace:

```typescript
server.registerTool('code_find_callers', {
  description: 'Focused incoming-only BFS: returns who calls this symbol up to the given depth. Use depth=1 for direct callers only. Simpler than code_get_symbol_context when you only need callers.',
  inputSchema: FindCallersSchema,
  outputSchema: FindCallersOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ symbol_name, repo_id, depth }) => {
  try {
    const result = findCallers(opts.db, opts.graph, opts.repoId, { symbolName: symbol_name, repoId: repo_id ?? null, depth: depth ?? 1 });
    if (!result) return { content: [{ type: 'text' as const, text: `Symbol not found: ${symbol_name}` }], isError: true };
    return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
  }
});

server.registerTool('code_find_callees', {
  description: 'Focused outgoing-only BFS: returns what this symbol calls up to the given depth. Use depth=1 for direct dependencies only.',
  inputSchema: FindCalleesSchema,
  outputSchema: FindCalleesOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ symbol_name, repo_id, depth }) => {
  try {
    const result = findCallees(opts.db, opts.graph, opts.repoId, { symbolName: symbol_name, repoId: repo_id ?? null, depth: depth ?? 1 });
    if (!result) return { content: [{ type: 'text' as const, text: `Symbol not found: ${symbol_name}` }], isError: true };
    return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
  }
});

server.registerTool('code_get_impact_analysis', {
  description: 'Blast radius analysis: returns risk level (LOW/MEDIUM/HIGH) and tiered callers — d=1 WILL BREAK, d=2 LIKELY AFFECTED, d=3 MAY NEED TESTING. Use before modifying any symbol.',
  inputSchema: GetImpactAnalysisSchema,
  outputSchema: GetImpactAnalysisOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ symbol_name, repo_id }) => {
  try {
    const result = getImpactAnalysis(opts.db, opts.graph, opts.repoId, { symbolName: symbol_name, repoId: repo_id ?? null });
    if (!result) return { content: [{ type: 'text' as const, text: `Symbol not found: ${symbol_name}` }], isError: true };
    return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
  }
});
```

- [ ] **Step 4: Run test suite**

```bash
npx vitest run
```

Expected: all tests pass

---

### Task 11: Wire ContextEnricher in App

**Files:**
- Modify: `src/app.ts`
- Create: `tests/mcp/app-context-enricher.test.ts`

- [ ] **Step 1: Wire ContextEnricher into `src/app.ts` first**

Add import at top of `src/app.ts`:

```typescript
import { ContextEnricher } from './mcp/context-enricher.js';
```

Add property declaration in the `App` class body (after `readonly graph: InMemoryGraph;`):

```typescript
readonly contextEnricher: ContextEnricher;
```

Add instantiation in the constructor (after `this.repoId = ensureRepo(this.db, this.repoRoot);`):

```typescript
this.contextEnricher = new ContextEnricher(this.repoId, this.db, this.graph);
```

- [ ] **Step 2: Run build to verify no TypeScript errors**

```bash
npm run build
```

Expected: no errors

- [ ] **Step 3: Write integration test that verifies App actually wires contextEnricher**

Create `tests/mcp/app-context-enricher.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { ContextEnricher } from '../../src/mcp/context-enricher.js';

describe('App wires ContextEnricher', () => {
  // Test that App.contextEnricher is a real ContextEnricher instance after construction.
  // This test must instantiate App (or a minimal shim matching its constructor) to verify
  // the wiring — a standalone ContextEnricher test would pass even before any App changes.
  it('App.contextEnricher is a ContextEnricher instance after construction', async () => {
    // Set minimal env so App constructor doesn't process.exit
    const origEnv = process.env['REPO_ROOT'];
    process.env['REPO_ROOT'] = process.cwd();

    try {
      const { App } = await import('../../src/app.js');
      const app = new App();
      expect(app.contextEnricher).toBeInstanceOf(ContextEnricher);
      await app.stop();
    } finally {
      if (origEnv === undefined) {
        delete process.env['REPO_ROOT'];
      } else {
        process.env['REPO_ROOT'] = origEnv;
      }
    }
  });
});
```

- [ ] **Step 4: Run the new test to verify it passes**

```bash
npx vitest run tests/mcp/app-context-enricher.test.ts
```

Expected: PASS — `app.contextEnricher` is a `ContextEnricher` instance

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit Chunk 3**

```bash
git add src/mcp/tools/find-callers.ts src/mcp/tools/find-callees.ts src/mcp/tools/get-impact-analysis.ts src/mcp/tool-schemas.ts src/mcp/tools/index.ts src/mcp/server.ts src/app.ts tests/mcp/tools/find-callers.test.ts tests/mcp/tools/find-callees.test.ts tests/mcp/tools/get-impact-analysis.test.ts tests/mcp/app-context-enricher.test.ts
git commit -m "feat: add 3 new graph tools + wire ContextEnricher

- code_find_callers: focused incoming-only BFS with blastRadius
- code_find_callees: focused outgoing-only BFS with dependencyCount
- code_get_impact_analysis: tiered blast radius (LOW/MEDIUM/HIGH) with
  exclusive d=1/d=2/d=3 sets via BFS set subtraction
- App.contextEnricher: ContextEnricher now instantiated on startup
- All 3 tools include outputSchema + structuredContent"
```

---

## Chunk 4: MCP Prompts (3 prompts)

### File Map

| File | Change |
|------|--------|
| `src/mcp/prompts/index.ts` | New — `registerPrompts(server, opts)` |
| `src/mcp/server.ts` | Add `prompts: {}` to capabilities; call `registerPrompts` |
| `tests/e2e/mcp-protocol.test.ts` | Add prompts/list test |

---

### Task 12: Write failing prompts test first (TDD)

**Files:**
- Modify: `tests/e2e/mcp-protocol.test.ts`

- [ ] **Step 1: Write the failing prompts test**

Inside the existing `describe('MCP Protocol Compliance', ...)` block in `tests/e2e/mcp-protocol.test.ts`, add a new describe block after the last existing test:

```typescript
describe('Prompts', () => {
  it('prompts/list returns 3 prompts', async () => {
    const result = await rpc(sdkServer, 'prompts/list');
    expect(result).toHaveProperty('prompts');
    const prompts = (result as { prompts: Array<{ name: string }> }).prompts;
    expect(prompts).toHaveLength(3);
    const names = prompts.map((p) => p.name);
    expect(names).toContain('code_analyze_symbol_impact');
    expect(names).toContain('code_onboard_repo');
    expect(names).toContain('code_explain_codebase');
  });

  it('code_analyze_symbol_impact has required argument', async () => {
    const result = await rpc(sdkServer, 'prompts/list');
    const prompts = (result as { prompts: Array<{ name: string; arguments?: Array<{ name: string; required?: boolean }> }> }).prompts;
    const analyzePrompt = prompts.find((p) => p.name === 'code_analyze_symbol_impact');
    expect(analyzePrompt).toBeDefined();
    const args = analyzePrompt!.arguments ?? [];
    const symbolArg = args.find((a) => a.name === 'symbol_name');
    expect(symbolArg).toBeDefined();
    expect(symbolArg!.required).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/e2e/mcp-protocol.test.ts
```

Expected: FAIL — `prompts` property not found or empty (server has no Prompts capability yet)

---

### Task 13: Implement registerPrompts

**Files:**
- Create: `src/mcp/prompts/index.ts`

> **Note on Prompt 3 (`code_explain_codebase`) vs spec:** The spec listed 4 steps with `code_get_import_chain` in step 3. The plan below implements 6 steps and replaces that with `code_search_files` (query="index") for finding entry points — a richer workflow. The `code_get_import_chain` tool requires a known file path which isn't available at prompt invocation time; `code_search_files` is more practical as a discovery step. This is an intentional improvement over the spec shorthand.

- [ ] **Step 1: Create `src/mcp/prompts/index.ts`**

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpServerOptions } from '../server.js';

export function registerPrompts(server: McpServer, opts: McpServerOptions): void {
  // Prompt 1: Analyze symbol impact
  server.prompt(
    'code_analyze_symbol_impact',
    { symbol_name: z.string().min(1).describe('Name of the symbol to analyze') },
    ({ symbol_name }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Analyze the blast radius of changing the symbol \`${symbol_name}\`:

1. Call \`code_get_impact_analysis\` with symbol_name="${symbol_name}"
2. Report the risk level (LOW/MEDIUM/HIGH) and explain what it means
3. List the d=1 "direct" symbols that WILL BREAK if \`${symbol_name}\` changes — these must be updated
4. List the d=2 "indirect" symbols that are LIKELY AFFECTED and should be tested
5. Suggest specific safe refactoring steps based on the blast radius size`,
          },
        },
      ],
    }),
  );

  // Prompt 2: Onboard a new repository
  server.prompt(
    'code_onboard_repo',
    {
      name: z.string().min(1).describe('Human-readable name for the repository'),
      root_path: z.string().min(1).describe('Absolute path to the repository root directory'),
      language: z.string().optional().describe('Primary language hint (e.g. typescript, python)'),
    },
    ({ name, root_path, language }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Onboard the repository at \`${root_path}\`:

1. Call \`code_register_repo\` with name="${name}", root_path="${root_path}"${language ? `, language="${language}"` : ''}
   — save the returned repo_id for subsequent calls
2. Call \`code_index_repo\` with the returned repo_id (this may take a moment for large repos)
3. Call \`code_get_repo_stats\` with the repo_id
4. Present a summary showing:
   - Total files indexed
   - Symbol count
   - Language breakdown
   - Any warnings from the indexing process`,
          },
        },
      ],
    }),
  );

  // Prompt 3: Explain codebase architecture (repo_id embedded at registration time)
  const repoId = opts.repoId;

  server.prompt(
    'code_explain_codebase',
    {},
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Provide an architecture overview of the indexed codebase (repo: ${repoId}):

1. Call \`code_get_repo_stats\` with repo_id="${repoId}" to get file count, symbol count, and language breakdown
2. Call \`code_search_symbols\` with query="class", repo_id="${repoId}", limit=20 to find top-level classes
3. Call \`code_search_symbols\` with query="service", repo_id="${repoId}", limit=20 to find service layers
4. Call \`code_search_symbols\` with query="handler", repo_id="${repoId}", limit=20 to find request handlers
5. Call \`code_search_files\` with query="index", repo_id="${repoId}", limit=10 to find entry points
6. Synthesize a markdown architecture overview covering:
   - Tech stack and languages
   - Main modules/layers discovered
   - Key entry points
   - Notable patterns observed`,
          },
        },
      ],
    }),
  );
}
```

- [ ] **Step 2: Run build to verify no TypeScript errors**

```bash
npm run build
```

Expected: no errors

---

### Task 14: Wire prompts into McpServer + add capabilities, then verify

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Update `src/mcp/server.ts`**

Add import:

```typescript
import { registerPrompts } from './prompts/index.js';
```

Update capabilities to include `prompts`:

```typescript
this.server = new McpServer(
  { name: 'code-intelligence-mcp-server', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);
```

Add `registerPrompts` call after `registerResources`:

```typescript
registerTools(this.server, opts);
registerResources(this.server, opts);
registerPrompts(this.server, opts);
```

- [ ] **Step 2: Run build to verify no TypeScript errors**

```bash
npm run build
```

Expected: no errors

- [ ] **Step 3: Run the failing prompts test to verify it now passes**

```bash
npx vitest run tests/e2e/mcp-protocol.test.ts
```

Expected: PASS — both prompts/list tests pass

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 5: Commit Chunk 4**

```bash
git add src/mcp/prompts/index.ts src/mcp/server.ts tests/e2e/mcp-protocol.test.ts
git commit -m "feat: add MCP Prompts primitive (3 workflow prompts)

- code_analyze_symbol_impact: guided blast radius + refactoring workflow
- code_onboard_repo: guided repo registration + indexing + stats summary
- code_explain_codebase: guided architecture overview via tool composition
- Server capabilities updated: { tools, resources, prompts }"
```

---

## Final Verification

- [ ] **Run full test suite one last time**

```bash
npx vitest run
```

Expected: all tests pass, 0 failures

- [ ] **Run build**

```bash
npm run build
```

Expected: no TypeScript errors

- [ ] **Verify tool count**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: `TOOL_NAMES` has length 16, all `code_` prefixed names present
