# MCP Completion Design — Code Intelligence Server

**Date:** 2026-04-18  
**Status:** Approved  
**Goal:** Bring the existing MCP server to full compliance with MCP best practices, completing all missing tools, output schemas, naming conventions, and the Prompts primitive.

---

## Context

The codebase (`mcp-code1`) is a local stdio MCP server providing code intelligence over indexed repositories. It currently exposes 13 tools, resources, and a `ContextEnricher` that is implemented but not wired. Two prior analyses identified gaps against the MCP specification and the project's own Plan 5d.

## Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Tool renaming | Breaking rename — all tools get `code_` prefix | Project has no external consumers locked to old names |
| outputSchema | Full — all 13 tools + 3 new tools | Enables typed consumption by modern MCP clients |
| MCP Prompts scope | Minimal — 3 workflow prompts | Iterative hypothesis: prove value before expanding |
| Approach | Incremental chunks (B) | Low-risk delivery; each chunk ships independently |

---

## Architecture — 4 Chunks

```
Chunk 1  →  Chunk 2  →  Chunk 3  →  Chunk 4
Rename      outputSchema  New tools   Prompts
+ descs     + struct      + Enricher
```

Each chunk is independently buildable and testable.

---

## Chunk 1: Tool Rename + Description Polish

### Rename Map

| Old name | New name |
|----------|----------|
| `search_symbols` | `code_search_symbols` |
| `get_symbol_detail` | `code_get_symbol_detail` |
| `list_repos` | `code_list_repos` |
| `register_repo` | `code_register_repo` |
| `index_repo` | `code_index_repo` |
| `find_references` | `code_find_references` |
| `search_files` | `code_search_files` |
| `get_file_symbols` | `code_get_file_symbols` |
| `explain_symbol` | `code_explain_symbol` |
| `get_repo_stats` | `code_get_repo_stats` |
| `remove_repo` | `code_remove_repo` |
| `get_symbol_context` | `code_get_symbol_context` |
| `get_import_chain` | `code_get_import_chain` |

### Description Fixes (`.describe()` additions)

- `FindReferencesSchema.repo_id` → `'Filter by repo. Get IDs from code_list_repos.'`
- `GetSymbolContextSchema.symbol_name` → `'Exact or partial symbol name to look up'`
- `ExplainSymbolSchema.symbol_id` → `'UUID from code_search_symbols or code_find_references'`
- Server display name: `'mcp-code1'` → `'code-intelligence-mcp-server'`
- Update `TOOL_NAMES` const array in `src/mcp/server.ts`

### Files Touched

| File | Change |
|------|--------|
| `src/mcp/server.ts` | Rename server name, update TOOL_NAMES |
| `src/mcp/tools/index.ts` | Rename all 13 `server.registerTool(...)` calls |
| `src/mcp/tool-schemas.ts` | Add missing `.describe()` |
| `tests/mcp/server.test.ts` | Update expected tool names |
| `tests/e2e/cline-scenario.test.ts` | Update tool name refs |
| `tests/e2e/mcp-protocol.test.ts` | Update tool name refs |

---

## Chunk 2: outputSchema + structuredContent

### Pattern

Every tool gets an output Zod schema added to `tool-schemas.ts` and returns `structuredContent` alongside the existing text `content`:

```typescript
server.registerTool('code_search_symbols', {
  inputSchema: SearchSymbolsSchema,
  outputSchema: SearchSymbolsOutputSchema,
  annotations: { ... },
}, async (params) => {
  const results = searchSymbols(...);
  return {
    structuredContent: results,
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  };
});
```

### Output Schemas

| Tool | Shape |
|------|-------|
| `code_search_symbols` | `{ items: SymbolResult[], total_count, has_more, next_offset }` |
| `code_get_symbol_detail` | `{ id, name, kind, filePath, startLine, endLine, signature }` |
| `code_find_references` | `ReferenceResult[]` |
| `code_get_symbol_context` | `{ symbol, callers[], callees[], blastRadius, impactCount }` — `blastRadius` and `impactCount` are computed in the handler: `blastRadius = callers.length`, `impactCount = callers.length + callees.length` (not stored fields — must be added explicitly to the return object) |
| `code_get_import_chain` | `{ file, imports[], depth }` |
| `code_search_files` | `{ items: FileResult[], total_count, has_more, next_offset }` |
| `code_get_file_symbols` | `SymbolResult[]` |
| `code_list_repos` | `RepoResult[]` |
| `code_get_repo_stats` | `{ repoId, fileCount, symbolCount, languages[] }` |
| `code_explain_symbol` | `{ symbolId, explanation: string }` |
| `code_register_repo` | `{ id, name, rootPath, language? }` |
| `code_index_repo` | `{ repoId, fileCount, symbolCount, durationMs }` |
| `code_remove_repo` | `{ repoId, removed: boolean }` |

### Files Touched

| File | Change |
|------|--------|
| `src/mcp/tool-schemas.ts` | Add 13 output Zod schemas |
| `src/mcp/tools/index.ts` | Add `outputSchema` to all 13 registrations; return `structuredContent` |

---

## Chunk 3: 3 New Tools + Wire ContextEnricher

### Important: IntId → UUID Resolution

`bfsTraverse` returns `TraversalResult[]` where `symbolId` is `IntId` (internal integer). All three new tools **must** call `g.mapper.resolve(r.symbolId)` to obtain the UUID string before DB lookups or returning results. See `src/mcp/tools/get-symbol-context.ts` for the reference pattern.

### New Tool: `code_find_callers`

```
Purpose: Focused incoming-only BFS (simpler than code_get_symbol_context)
Input:   { symbol_name: string, repo_id?: string, depth: 1|2|3 = 1 }
         repo_id: optional, falls back to opts.repoId from McpServerOptions
Output:  { symbol, callers[], blastRadius: number }
         callers[]: [{ symbolId (UUID), name, filePath, line, depth, via }]
         blastRadius: callers.length
Logic:   1. DB lookup symbol by name (+ repoId filter)
         2. g.mapper.intern(uuid) → intId
         3. bfsTraverse(g, intId, 'incoming', depth) → TraversalResult[]
         4. g.mapper.resolve(r.symbolId) for each result → UUID
         5. Batch DB lookup for names/paths
File:    src/mcp/tools/find-callers.ts
```

### New Tool: `code_find_callees`

```
Purpose: Focused outgoing-only BFS
Input:   { symbol_name: string, repo_id?: string, depth: 1|2|3 = 1 }
         repo_id: optional, falls back to opts.repoId
Output:  { symbol, callees[], dependencyCount: number }
         callees[]: [{ symbolId (UUID), name, filePath, line, depth, via }]
         dependencyCount: callees.length
Logic:   Same as code_find_callers but direction = 'outgoing'
File:    src/mcp/tools/find-callees.ts
```

### New Tool: `code_get_impact_analysis`

```
Purpose: Blast radius with tiered risk classification
Input:   { symbol_name: string, repo_id?: string }
         repo_id: optional, falls back to opts.repoId
Output:  {
  symbol,
  risk: 'LOW' | 'MEDIUM' | 'HIGH',   // <4 / 4-9 / 10+ direct callers
  direct:    { symbols[], count },     // d=1 only — WILL BREAK
  indirect:  { symbols[], count },     // d=2 exclusive — LIKELY AFFECTED
  transitive:{ symbols[], count },     // d=3 exclusive — MAY NEED TESTING
  totalImpact: number
}
BFS tiering algorithm (IMPORTANT — sets are exclusive, not cumulative):
  d1Set = Set of UUIDs from bfsTraverse(g, intId, 'incoming', 1)
  d2Set = Set of UUIDs from bfsTraverse(g, intId, 'incoming', 2)
  d3Set = Set of UUIDs from bfsTraverse(g, intId, 'incoming', 3)
  direct    = d1Set
  indirect  = d2Set - d1Set          // exclusive to depth 2
  transitive = d3Set - d2Set         // exclusive to depth 3
  risk = 'LOW' if d1Set.size < 4, 'MEDIUM' if < 10, else 'HIGH'
  totalImpact = d3Set.size           // all reachable at any depth
File:    src/mcp/tools/get-impact-analysis.ts
```

### Wire ContextEnricher

`ContextEnricher` is fully implemented in `src/mcp/context-enricher.ts` but never instantiated. The `App` class in `src/app.ts` has a `this.repoId: string` property (set by `ensureRepo()`) — use that, NOT `config.repoId` which does not exist.

```typescript
// src/app.ts — changes required:

// 1. Add property declaration to App class body:
readonly contextEnricher: ContextEnricher;

// 2. Instantiate after graph loads (in constructor or start(), after ensureRepo()):
this.contextEnricher = new ContextEnricher(this.repoId, this.db, this.graph);
```

`ContextEnricher` is **not** added to `McpServerOptions` — it is instantiated on `App` for internal use only. (Deferring McpServerOptions exposure until a concrete consumer exists.)

### Files Touched

| File | Change |
|------|--------|
| `src/mcp/tools/find-callers.ts` | New |
| `src/mcp/tools/find-callees.ts` | New |
| `src/mcp/tools/get-impact-analysis.ts` | New |
| `src/mcp/tool-schemas.ts` | Add 3 input + 3 output schemas; add `repo_id?` to FindCallersSchema, FindCalleesSchema, GetImpactAnalysisSchema |
| `src/mcp/tools/index.ts` | Register 3 new tools |
| `src/mcp/server.ts` | Update `TOOL_NAMES` with 3 new names |
| `src/app.ts` | Add `readonly contextEnricher: ContextEnricher` property; instantiate after `ensureRepo()` |

---

## Chunk 4: MCP Prompts (3 prompts)

### Infrastructure Change

`src/mcp/server.ts` — add `prompts: {}` to capabilities:

```typescript
{ capabilities: { tools: {}, resources: {}, prompts: {} } }
```

### New File: `src/mcp/prompts/index.ts`

Exports `registerPrompts(server: McpServer, opts: McpServerOptions): void`

### Prompt 1: `code_analyze_symbol_impact`

```
Arguments: symbol_name (required, string)
Template:  Instructs agent to:
           1. Call code_get_impact_analysis({ symbol_name })
           2. Read risk level + tiered breakdown
           3. List d=1 symbols that WILL BREAK
           4. Suggest safe refactoring steps based on blast radius
```

### Prompt 2: `code_onboard_repo`

```
Arguments: name (required), root_path (required), language (optional)
Template:  Instructs agent to:
           1. Call code_register_repo({ name, root_path, language })
           2. Call code_index_repo({ repo_id }) — may take time
           3. Call code_get_repo_stats({ repo_id })
           4. Present summary: file count, language breakdown, symbol count
```

### Prompt 3: `code_explain_codebase`

```
Arguments: (none — repo_id is embedded from opts.repoId at registration time)
Wiring:    registerPrompts receives opts: McpServerOptions which contains opts.repoId.
           The prompt template string is constructed at registration time with
           opts.repoId interpolated directly into the tool call instructions.
Template:  Instructs agent to:
           1. Call code_get_repo_stats({ repo_id: "<opts.repoId>" })
           2. Call code_search_symbols({ query: "class", repo_id: "<opts.repoId>" })
              and again with "service", "handler"
           3. Call code_get_import_chain({ file_path: "<entry>", repo_id: "<opts.repoId>" })
              where entry is discovered from stats results
           4. Synthesize markdown architecture overview
```

### Files Touched

| File | Change |
|------|--------|
| `src/mcp/prompts/index.ts` | New — registerPrompts function |
| `src/mcp/server.ts` | Add prompts capability; call registerPrompts |

---

## Error Handling (unchanged pattern)

All tools continue using the existing `errText(e)` helper with `isError: true`. No change to error handling strategy.

## Testing Strategy

Each chunk ships with corresponding test updates:
- **Chunk 1:** Update `tests/mcp/server.test.ts`, `tests/e2e/cline-scenario.test.ts`, `tests/e2e/mcp-protocol.test.ts` for new tool names
- **Chunk 2:** In `tests/mcp/server.test.ts` add assertions that `structuredContent` is present and matches `outputSchema` shape
- **Chunk 3:**
  - `tests/mcp/tools/find-callers.test.ts` — unit tests for `findCallers()` function
  - `tests/mcp/tools/find-callees.test.ts` — unit tests for `findCallees()` function
  - `tests/mcp/tools/get-impact-analysis.test.ts` — unit tests for `getImpactAnalysis()`, including BFS tier diffing
  - `tests/mcp/app-context-enricher.test.ts` — integration test: `App` instantiation wires `contextEnricher` (assert `app.contextEnricher instanceof ContextEnricher`)
- **Chunk 4:** `tests/e2e/mcp-protocol.test.ts` — add test that `prompts/list` RPC returns 3 prompts with correct names and argument schemas

> **Note on `ToolName` type:** `TOOL_NAMES as const` drives the `ToolName` union type in `src/mcp/server.ts`. Adding 3 new names in Chunk 3 automatically extends this union — TypeScript exhaustiveness checks on `switch (toolName)` will catch any gaps at compile time.

## Non-Goals

- No HTTP transport (remains stdio)
- No authentication layer
- No rate limiting
- No `response_format: "markdown" | "json"` parameter (deferred — YAGNI until agent feedback)
- No ContextEnricher MCP exposure as a tool (internal middleware only)
