# MCP Code Intelligence – MCP Server & Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the indexed code data through an MCP-compliant server offering **11 tools** and **5 resources**, with a startup sequence, optional AI adapter (OpenAI-compatible), structured error responses, and graceful shutdown.

**Architecture:** A single `McpServer` class wraps the MCP SDK transport (stdio or HTTP/SSE). Each tool handler is a thin function that calls into the existing `RepoRegistry`, `Indexer`, and DB layer. The AI adapter is optional — if `AI_API_KEY` is set, it enriches results; otherwise tools work purely from SQLite.

**Tech Stack:** `@modelcontextprotocol/sdk`, `zod` (tool param validation), `openai` (optional AI adapter), existing infrastructure from Plans 1 & 2.

---

## Chunk 1: MCP SDK Setup & Transport

### File Map

| Path | Responsibility |
|------|---------------|
| `package.json` | Add `@modelcontextprotocol/sdk`, `openai` |
| `src/mcp/server.ts` | `McpServer` class – register tools/resources, start transport |
| `src/mcp/transport.ts` | Stdio vs HTTP transport selection |
| `tests/mcp/server.test.ts` | Smoke test: server starts, lists tools |

---

### Task 1: Install MCP SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd C:\Users\Haha\Desktop\MCP\mcp-code1
npm install @modelcontextprotocol/sdk openai
```

Expected: packages added to `node_modules/`, no errors.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and openai"
```

---

### Task 2: MCP Server class & transport

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/transport.ts`
- Create: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/server.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';

describe('McpServer', () => {
  it('can be instantiated without throwing', async () => {
    const { McpServer } = await import('../../src/mcp/server.js');
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const indexer = new Indexer(db);
    expect(() => new McpServer({ db, registry, indexer, aiConfig: null })).not.toThrow();
    db.close();
  });

  it('exposes expected tool names', async () => {
    const { McpServer, TOOL_NAMES } = await import('../../src/mcp/server.js');
    expect(TOOL_NAMES).toContain('search_symbols');
    expect(TOOL_NAMES).toContain('get_symbol_detail');
    expect(TOOL_NAMES).toContain('list_repos');
    expect(TOOL_NAMES).toContain('register_repo');
    expect(TOOL_NAMES).toContain('index_repo');
    expect(TOOL_NAMES).toContain('find_references');
    expect(TOOL_NAMES).toContain('search_files');
    expect(TOOL_NAMES).toContain('get_file_symbols');
    expect(TOOL_NAMES).toContain('explain_symbol');
    expect(TOOL_NAMES).toContain('get_repo_stats');
    expect(TOOL_NAMES).toContain('remove_repo');
    expect(TOOL_NAMES).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/transport.ts`**

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export type TransportMode = 'stdio' | 'sse';

export function createTransport(mode: TransportMode, port?: number): Transport {
  if (mode === 'stdio') {
    return new StdioServerTransport();
  }
  // SSE transport used by Web UI (Plan 4)
  throw new Error('SSE transport requires HTTP server — wire in McpServer.startHttp()');
}
```

- [ ] **Step 4: Create `src/mcp/server.ts` (skeleton with tool registration)**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { RepoRegistry } from '../registry.js';
import type { Indexer } from '../indexer/indexer.js';
import { registerToolHandlers } from './tools/index.js';
import { registerResourceHandlers } from './resources/index.js';
import type { AiAdapter } from './ai-adapter.js';

export const TOOL_NAMES = [
  'search_symbols',
  'get_symbol_detail',
  'list_repos',
  'register_repo',
  'index_repo',
  'find_references',
  'search_files',
  'get_file_symbols',
  'explain_symbol',
  'get_repo_stats',
  'remove_repo',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type McpServerOptions = {
  db: Db;
  registry: RepoRegistry;
  indexer: Indexer;
  aiConfig: { apiKey: string; baseUrl: string; model: string } | null;
};

export class McpServer {
  private server: Server;
  private opts: McpServerOptions;

  constructor(opts: McpServerOptions) {
    this.opts = opts;
    this.server = new Server(
      { name: 'mcp-code1', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    registerToolHandlers(this.server, opts);
    registerResourceHandlers(this.server, opts);
  }

  async connectStdio(): Promise<void> {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
```

- [ ] **Step 5: Create stub files so imports resolve**

Create `src/mcp/tools/index.ts`:

```typescript
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { McpServerOptions } from '../server.js';

export function registerToolHandlers(_server: Server, _opts: McpServerOptions): void {
  // Stub – implementations follow in Tasks 3-9
}
```

Create `src/mcp/resources/index.ts`:

```typescript
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { McpServerOptions } from '../server.js';

export function registerResourceHandlers(_server: Server, _opts: McpServerOptions): void {
  // Stub – implementations follow in Task 10
}
```

Create `src/mcp/ai-adapter.ts`:

```typescript
export type AiAdapter = {
  explain(context: string, question: string): Promise<string>;
};

export function createAiAdapter(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): AiAdapter | null {
  if (!config.apiKey) return null;
  return {
    async explain(context, question) {
      // Lazy import so the openai package is optional
      const { OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined });
      const res = await client.chat.completions.create({
        model: config.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a code intelligence assistant. Answer concisely.' },
          { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
        ],
        max_tokens: 512,
      });
      return res.choices[0]?.message.content ?? '';
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/mcp/server.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/mcp/ tests/mcp/server.test.ts
git commit -m "feat: add McpServer skeleton with tool/resource registration stubs"
```

---

## Chunk 2: Core Search Tools (Tools 1-4)

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/tools/search-symbols.ts` | `search_symbols` – FTS5 query over `symbols_fts` |
| `src/mcp/tools/get-symbol-detail.ts` | `get_symbol_detail` – fetch one symbol by ID |
| `src/mcp/tools/list-repos.ts` | `list_repos` – return all registered repos |
| `src/mcp/tools/register-repo.ts` | `register_repo` – add a new repo and trigger index |
| `tests/mcp/tools/search-symbols.test.ts` | Unit tests with seeded in-memory DB |

---

### Task 3: `search_symbols` tool

**Files:**
- Create: `src/mcp/tools/search-symbols.ts`
- Create: `tests/mcp/tools/search-symbols.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/tools/search-symbols.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

function seedSymbol(db: ReturnType<typeof openDb>, repoId: string, fileId: string, name: string, kind: string) {
  db.prepare(
    `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(randomUUID(), repoId, fileId, name, kind, `${kind} ${name}()`);
}

describe('searchSymbols', () => {
  let db: ReturnType<typeof openDb>;
  let repoId: string;
  let fileId: string;

  beforeEach(() => {
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    repoId = repo.id;
    fileId = randomUUID();
    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'a.ts', 'ts', 0, '')`
    ).run(fileId, repoId);
    seedSymbol(db, repoId, fileId, 'getUserById', 'function');
    seedSymbol(db, repoId, fileId, 'UserController', 'class');
    seedSymbol(db, repoId, fileId, 'createUser', 'function');
  });

  it('finds symbols by exact name prefix', async () => {
    const { searchSymbols } = await import('../../../src/mcp/tools/search-symbols.js');
    const results = searchSymbols(db, { query: 'user', repoId: null, limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by repoId', async () => {
    const { searchSymbols } = await import('../../../src/mcp/tools/search-symbols.js');
    const results = searchSymbols(db, { query: 'user', repoId, limit: 10 });
    expect(results.every((r) => r.repoId === repoId)).toBe(true);
  });

  it('respects limit', async () => {
    const { searchSymbols } = await import('../../../src/mcp/tools/search-symbols.js');
    const results = searchSymbols(db, { query: 'user', repoId: null, limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/tools/search-symbols.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/mcp/tools/search-symbols.ts`**

```typescript
import type { Db } from '../../db/index.js';

export type SearchSymbolsParams = {
  query: string;
  repoId: string | null;
  kind?: string | null;
  limit?: number;
};

export type SymbolResult = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  repo_id: string;
  rel_path: string;
  start_line: number;
  end_line: number;
  signature: string;
};

export function searchSymbols(db: Db, params: SearchSymbolsParams): SymbolResult[] {
  const limit = Math.min(params.limit ?? 20, 100);
  const ftsQuery = params.query
    .trim()
    .split(/\s+/)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' OR ');

  const kindFilter = params.kind ? `AND s.kind = '${params.kind}'` : '';
  const repoFilter = params.repoId ? `AND s.repo_id = '${params.repoId}'` : '';

  const sql = `
    SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature
    FROM symbols_fts fts
    JOIN symbols s ON s.rowid = fts.rowid
    JOIN files f ON f.id = s.file_id
    WHERE symbols_fts MATCH ?
    ${kindFilter}
    ${repoFilter}
    ORDER BY rank
    LIMIT ?
  `;

  try {
    const rows = db.prepare(sql).all(ftsQuery, limit) as Row[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      repoId: r.repo_id,
      filePath: r.rel_path,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
    }));
  } catch {
    // FTS syntax error – fall back to LIKE search
    const fallbackSql = `
      SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature
      FROM symbols s
      JOIN files f ON f.id = s.file_id
      WHERE s.name LIKE ? ${kindFilter} ${repoFilter}
      ORDER BY s.name
      LIMIT ?
    `;
    const rows = db.prepare(fallbackSql).all(`%${params.query}%`, limit) as Row[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      repoId: r.repo_id,
      filePath: r.rel_path,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mcp/tools/search-symbols.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/search-symbols.ts tests/mcp/tools/search-symbols.test.ts
git commit -m "feat: add search_symbols tool with FTS5 + LIKE fallback"
```

---

### Task 4: `get_symbol_detail`, `list_repos`, `register_repo` tools

**Files:**
- Create: `src/mcp/tools/get-symbol-detail.ts`
- Create: `src/mcp/tools/list-repos.ts`
- Create: `src/mcp/tools/register-repo.ts`
- Create: `tests/mcp/tools/basic-tools.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/tools/basic-tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

describe('basic tools', () => {
  let db: ReturnType<typeof openDb>;
  let registry: RepoRegistry;

  beforeEach(() => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
  });

  it('listRepos returns all repos', async () => {
    const { listRepos } = await import('../../../src/mcp/tools/list-repos.js');
    registry.register({ name: 'a', rootPath: '/a' });
    registry.register({ name: 'b', rootPath: '/b' });
    expect(listRepos(registry)).toHaveLength(2);
  });

  it('getSymbolDetail returns symbol by ID', async () => {
    const { getSymbolDetail } = await import('../../../src/mcp/tools/get-symbol-detail.js');
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    const fileId = randomUUID();
    const symId = randomUUID();
    db.prepare(`INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'f.ts', 'ts', 0, '')`).run(fileId, repo.id);
    db.prepare(`INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature) VALUES (?, ?, ?, 'myFn', 'function', 1, 5, 'function myFn()')`).run(symId, repo.id, fileId);
    const detail = getSymbolDetail(db, symId);
    expect(detail?.name).toBe('myFn');
    expect(detail?.startLine).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/tools/basic-tools.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/mcp/tools/list-repos.ts`**

```typescript
import type { RepoRegistry, Repo } from '../../registry.js';

export function listRepos(registry: RepoRegistry): Repo[] {
  return registry.list();
}
```

- [ ] **Step 4: Create `src/mcp/tools/get-symbol-detail.ts`**

```typescript
import type { Db } from '../../db/index.js';

export type SymbolDetail = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  docComment: string;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  repo_id: string;
  rel_path: string;
  start_line: number;
  end_line: number;
  signature: string;
  doc_comment: string;
};

export function getSymbolDetail(db: Db, symbolId: string): SymbolDetail | null {
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature, s.doc_comment
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.id = ?`,
    )
    .get(symbolId) as Row | undefined;

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    repoId: row.repo_id,
    filePath: row.rel_path,
    startLine: row.start_line,
    endLine: row.end_line,
    signature: row.signature,
    docComment: row.doc_comment,
  };
}
```

- [ ] **Step 5: Create `src/mcp/tools/register-repo.ts`**

```typescript
import type { RepoRegistry, Repo } from '../../registry.js';
import { AppError, ErrorCode } from '../../errors.js';
import { existsSync } from 'node:fs';

export type RegisterRepoParams = {
  name: string;
  rootPath: string;
  language?: string;
};

export function registerRepo(registry: RepoRegistry, params: RegisterRepoParams): Repo {
  if (!existsSync(params.rootPath)) {
    throw new AppError(
      ErrorCode.REPO_INVALID_PATH,
      `Path does not exist: ${params.rootPath}`,
    );
  }
  return registry.register(params);
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/mcp/tools/basic-tools.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools/get-symbol-detail.ts src/mcp/tools/list-repos.ts src/mcp/tools/register-repo.ts tests/mcp/tools/basic-tools.test.ts
git commit -m "feat: add get_symbol_detail, list_repos, register_repo tools"
```

---

## Chunk 3: Advanced Tools (Tools 5-11)

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/tools/index-repo.ts` | `index_repo` – trigger indexer on demand |
| `src/mcp/tools/find-references.ts` | `find_references` – find symbols with same name |
| `src/mcp/tools/search-files.ts` | `search_files` – LIKE search on rel_path |
| `src/mcp/tools/get-file-symbols.ts` | `get_file_symbols` – all symbols in a file |
| `src/mcp/tools/explain-symbol.ts` | `explain_symbol` – AI or fallback to signature |
| `src/mcp/tools/get-repo-stats.ts` | `get_repo_stats` – counts, last indexed time |
| `src/mcp/tools/remove-repo.ts` | `remove_repo` – deregister a repo |
| `tests/mcp/tools/advanced-tools.test.ts` | Unit tests for all above |

---

### Task 5: Remaining tool implementations

**Files:** (as listed above)

- [ ] **Step 1: Write failing test**

Create `tests/mcp/tools/advanced-tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

function seedRepo(db: ReturnType<typeof openDb>, registry: RepoRegistry, name: string) {
  const repo = registry.register({ name, rootPath: `/${name}` });
  const fileId = randomUUID();
  db.prepare(`INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'main.ts', 'ts', 100, 'abc')`).run(fileId, repo.id);
  db.prepare(`INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature) VALUES (?, ?, ?, 'myFn', 'function', 1, 10, 'function myFn()')`).run(randomUUID(), repo.id, fileId);
  return { repo, fileId };
}

describe('advanced tools', () => {
  let db: ReturnType<typeof openDb>;
  let registry: RepoRegistry;

  beforeEach(() => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
  });

  afterEach(() => db.close());

  it('findReferences returns symbols with same name', async () => {
    const { findReferences } = await import('../../../src/mcp/tools/find-references.js');
    seedRepo(db, registry, 'r1');
    seedRepo(db, registry, 'r2');
    const refs = findReferences(db, { symbolName: 'myFn', repoId: null });
    expect(refs.length).toBe(2);
  });

  it('searchFiles finds by path fragment', async () => {
    const { searchFiles } = await import('../../../src/mcp/tools/search-files.js');
    const { repo } = seedRepo(db, registry, 'r');
    const results = searchFiles(db, { query: 'main', repoId: repo.id });
    expect(results.some((f) => f.relPath.includes('main'))).toBe(true);
  });

  it('getFileSymbols returns all symbols in a file', async () => {
    const { getFileSymbols } = await import('../../../src/mcp/tools/get-file-symbols.js');
    const { repo } = seedRepo(db, registry, 'r');
    const symbols = getFileSymbols(db, { repoId: repo.id, relPath: 'main.ts' });
    expect(symbols.length).toBe(1);
    expect(symbols[0]?.name).toBe('myFn');
  });

  it('getRepoStats returns counts', async () => {
    const { getRepoStats } = await import('../../../src/mcp/tools/get-repo-stats.js');
    const { repo } = seedRepo(db, registry, 'r');
    const stats = getRepoStats(db, repo.id);
    expect(stats.fileCount).toBeGreaterThanOrEqual(1);
    expect(stats.symbolCount).toBeGreaterThanOrEqual(1);
  });

  it('removeRepo deletes from registry', async () => {
    const { removeRepo } = await import('../../../src/mcp/tools/remove-repo.js');
    const { repo } = seedRepo(db, registry, 'to-remove');
    removeRepo(registry, repo.id);
    expect(registry.getById(repo.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mcp/tools/advanced-tools.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create the 7 tool files**

Create `src/mcp/tools/index-repo.ts`:

```typescript
import type { Indexer } from '../../indexer/indexer.js';
import type { RepoRegistry } from '../../registry.js';
import { AppError, ErrorCode } from '../../errors.js';

export async function indexRepo(
  registry: RepoRegistry,
  indexer: Indexer,
  repoId: string,
) {
  const repo = registry.getById(repoId);
  if (!repo) throw new AppError(ErrorCode.REPO_NOT_FOUND, `Repo ${repoId} not found`);
  const result = await indexer.indexRepo(repoId, repo.rootPath);
  registry.update(repoId, {
    indexedAt: new Date().toISOString(),
    fileCount: result.filesIndexed + result.filesSkipped,
    symbolCount: result.symbolsAdded,
  });
  return result;
}
```

Create `src/mcp/tools/find-references.ts`:

```typescript
import type { Db } from '../../db/index.js';

export type FindReferencesParams = {
  symbolName: string;
  repoId: string | null;
};

export type ReferenceResult = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  repo_id: string;
  rel_path: string;
  start_line: number;
};

export function findReferences(db: Db, params: FindReferencesParams): ReferenceResult[] {
  const repoFilter = params.repoId ? `AND s.repo_id = ?` : '';
  const args: unknown[] = [params.symbolName];
  if (params.repoId) args.push(params.repoId);

  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.name = ? ${repoFilter}
       ORDER BY f.rel_path, s.start_line
       LIMIT 200`,
    )
    .all(...args) as Row[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    repoId: r.repo_id,
    filePath: r.rel_path,
    startLine: r.start_line,
  }));
}
```

Create `src/mcp/tools/search-files.ts`:

```typescript
import type { Db } from '../../db/index.js';

export type SearchFilesParams = {
  query: string;
  repoId: string | null;
  limit?: number;
};

export type FileResult = {
  id: string;
  repoId: string;
  relPath: string;
  language: string;
  sizeBytes: number;
  indexedAt: string | null;
};

type Row = {
  id: string;
  repo_id: string;
  rel_path: string;
  language: string;
  size_bytes: number;
  indexed_at: string | null;
};

export function searchFiles(db: Db, params: SearchFilesParams): FileResult[] {
  const limit = Math.min(params.limit ?? 50, 200);
  const repoFilter = params.repoId ? `AND repo_id = ?` : '';
  const args: unknown[] = [`%${params.query}%`];
  if (params.repoId) args.push(params.repoId);
  args.push(limit);

  const rows = db
    .prepare(
      `SELECT id, repo_id, rel_path, language, size_bytes, indexed_at
       FROM files
       WHERE rel_path LIKE ? ${repoFilter}
       ORDER BY rel_path
       LIMIT ?`,
    )
    .all(...args) as Row[];

  return rows.map((r) => ({
    id: r.id,
    repoId: r.repo_id,
    relPath: r.rel_path,
    language: r.language,
    sizeBytes: r.size_bytes,
    indexedAt: r.indexed_at,
  }));
}
```

Create `src/mcp/tools/get-file-symbols.ts`:

```typescript
import type { Db } from '../../db/index.js';

export type GetFileSymbolsParams = {
  repoId: string;
  relPath: string;
};

export type FileSymbol = {
  id: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature: string;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  signature: string;
};

export function getFileSymbols(db: Db, params: GetFileSymbolsParams): FileSymbol[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.start_line, s.end_line, s.signature
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE f.repo_id = ? AND f.rel_path = ?
       ORDER BY s.start_line`,
    )
    .all(params.repoId, params.relPath) as Row[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    startLine: r.start_line,
    endLine: r.end_line,
    signature: r.signature,
  }));
}
```

Create `src/mcp/tools/explain-symbol.ts`:

```typescript
import type { Db } from '../../db/index.js';
import type { AiAdapter } from '../ai-adapter.js';
import { getSymbolDetail } from './get-symbol-detail.js';

export async function explainSymbol(
  db: Db,
  symbolId: string,
  ai: AiAdapter | null,
): Promise<string> {
  const detail = getSymbolDetail(db, symbolId);
  if (!detail) return 'Symbol not found.';

  const context = `Name: ${detail.name}\nKind: ${detail.kind}\nFile: ${detail.filePath}\nLines: ${detail.startLine}-${detail.endLine}\nSignature: ${detail.signature}\n${detail.docComment ? 'Doc: ' + detail.docComment : ''}`;

  if (ai) {
    return await ai.explain(context, `Explain what ${detail.name} does.`);
  }

  // Fallback: return structured text
  return `**${detail.name}** (${detail.kind})\n\nFile: \`${detail.filePath}\` lines ${detail.startLine}–${detail.endLine}\n\nSignature: \`${detail.signature}\`${detail.docComment ? '\n\n' + detail.docComment : ''}`;
}
```

Create `src/mcp/tools/get-repo-stats.ts`:

```typescript
import type { Db } from '../../db/index.js';

export type RepoStats = {
  repoId: string;
  fileCount: number;
  symbolCount: number;
  lastIndexedAt: string | null;
  languageBreakdown: Record<string, number>;
};

export function getRepoStats(db: Db, repoId: string): RepoStats {
  const counts = db
    .prepare(`SELECT file_count, symbol_count, indexed_at FROM repos WHERE id = ?`)
    .get(repoId) as { file_count: number; symbol_count: number; indexed_at: string | null } | undefined;

  const langRows = db
    .prepare(`SELECT language, COUNT(*) as cnt FROM files WHERE repo_id = ? GROUP BY language`)
    .all(repoId) as Array<{ language: string; cnt: number }>;

  const languageBreakdown: Record<string, number> = {};
  for (const row of langRows) languageBreakdown[row.language] = row.cnt;

  return {
    repoId,
    fileCount: counts?.file_count ?? 0,
    symbolCount: counts?.symbol_count ?? 0,
    lastIndexedAt: counts?.indexed_at ?? null,
    languageBreakdown,
  };
}
```

Create `src/mcp/tools/remove-repo.ts`:

```typescript
import type { RepoRegistry } from '../../registry.js';
import { AppError, ErrorCode } from '../../errors.js';

export function removeRepo(registry: RepoRegistry, repoId: string): void {
  const repo = registry.getById(repoId);
  if (!repo) throw new AppError(ErrorCode.REPO_NOT_FOUND, `Repo ${repoId} not found`);
  registry.remove(repoId);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mcp/tools/advanced-tools.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/ tests/mcp/tools/advanced-tools.test.ts
git commit -m "feat: add 7 advanced MCP tools (index, refs, files, stats, remove, explain)"
```

---

## Chunk 4: Wire Tool Handlers into MCP SDK

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/tools/index.ts` | Replace stub with real `registerToolHandlers` |
| `src/mcp/tool-schemas.ts` | Zod schemas for each tool's input |
| `tests/mcp/tool-wire.test.ts` | End-to-end: call tool via MCP server object |

---

### Task 6: Tool handler registration

**Files:**
- Modify: `src/mcp/tools/index.ts`
- Create: `src/mcp/tool-schemas.ts`
- Create: `tests/mcp/tool-wire.test.ts`

- [ ] **Step 1: Create `src/mcp/tool-schemas.ts`**

```typescript
import { z } from 'zod';

export const SearchSymbolsSchema = z.object({
  query: z.string().min(1).describe('Symbol name or keyword to search for'),
  repo_id: z.string().optional().nullable().describe('Filter to a specific repo ID'),
  kind: z.string().optional().nullable().describe('Symbol kind filter: function, class, etc.'),
  limit: z.number().int().min(1).max(100).default(20),
});

export const GetSymbolDetailSchema = z.object({
  symbol_id: z.string().uuid().describe('UUID of the symbol'),
});

export const RegisterRepoSchema = z.object({
  name: z.string().min(1).describe('Unique human-readable repo name'),
  root_path: z.string().min(1).describe('Absolute path to the repository root'),
  language: z.string().optional().describe('Primary language hint'),
});

export const IndexRepoSchema = z.object({
  repo_id: z.string().uuid().describe('UUID of the repo to (re)index'),
});

export const FindReferencesSchema = z.object({
  symbol_name: z.string().min(1).describe('Exact symbol name to find'),
  repo_id: z.string().optional().nullable(),
});

export const SearchFilesSchema = z.object({
  query: z.string().min(1).describe('Partial file path to search'),
  repo_id: z.string().optional().nullable(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const GetFileSymbolsSchema = z.object({
  repo_id: z.string().uuid(),
  rel_path: z.string().min(1).describe('Relative file path within the repo'),
});

export const ExplainSymbolSchema = z.object({
  symbol_id: z.string().uuid(),
});

export const GetRepoStatsSchema = z.object({
  repo_id: z.string().uuid(),
});

export const RemoveRepoSchema = z.object({
  repo_id: z.string().uuid(),
});

// list_repos takes no parameters
export const ListReposSchema = z.object({});
```

- [ ] **Step 2: Replace stub in `src/mcp/tools/index.ts`**

```typescript
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerOptions } from '../server.js';
import {
  SearchSymbolsSchema, GetSymbolDetailSchema, RegisterRepoSchema,
  IndexRepoSchema, FindReferencesSchema, SearchFilesSchema,
  GetFileSymbolsSchema, ExplainSymbolSchema, GetRepoStatsSchema,
  RemoveRepoSchema, ListReposSchema,
} from '../tool-schemas.js';
import { searchSymbols } from './search-symbols.js';
import { getSymbolDetail } from './get-symbol-detail.js';
import { listRepos } from './list-repos.js';
import { registerRepo } from './register-repo.js';
import { indexRepo } from './index-repo.js';
import { findReferences } from './find-references.js';
import { searchFiles } from './search-files.js';
import { getFileSymbols } from './get-file-symbols.js';
import { explainSymbol } from './explain-symbol.js';
import { getRepoStats } from './get-repo-stats.js';
import { removeRepo } from './remove-repo.js';
import { createAiAdapter } from '../ai-adapter.js';
import { isAppError } from '../../errors.js';

export function registerToolHandlers(server: Server, opts: McpServerOptions): void {
  const ai = opts.aiConfig ? createAiAdapter(opts.aiConfig) : null;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'search_symbols',    description: 'Search for code symbols using FTS or LIKE', inputSchema: SearchSymbolsSchema },
      { name: 'get_symbol_detail', description: 'Get details of a symbol by ID',              inputSchema: GetSymbolDetailSchema },
      { name: 'list_repos',        description: 'List all registered repositories',             inputSchema: ListReposSchema },
      { name: 'register_repo',     description: 'Register a new repository for indexing',       inputSchema: RegisterRepoSchema },
      { name: 'index_repo',        description: 'Trigger indexing of a repository',             inputSchema: IndexRepoSchema },
      { name: 'find_references',   description: 'Find all occurrences of a symbol name',        inputSchema: FindReferencesSchema },
      { name: 'search_files',      description: 'Search for files by path fragment',            inputSchema: SearchFilesSchema },
      { name: 'get_file_symbols',  description: 'Get all symbols in a specific file',           inputSchema: GetFileSymbolsSchema },
      { name: 'explain_symbol',    description: 'Get an explanation of a symbol (AI-enhanced)', inputSchema: ExplainSymbolSchema },
      { name: 'get_repo_stats',    description: 'Get indexing statistics for a repository',     inputSchema: GetRepoStatsSchema },
      { name: 'remove_repo',       description: 'Remove a repository from the registry',        inputSchema: RemoveRepoSchema },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    try {
      switch (name) {
        case 'search_symbols': {
          const p = SearchSymbolsSchema.parse(args);
          const results = searchSymbols(opts.db, { query: p.query, repoId: p.repo_id ?? null, kind: p.kind, limit: p.limit });
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        case 'get_symbol_detail': {
          const p = GetSymbolDetailSchema.parse(args);
          const detail = getSymbolDetail(opts.db, p.symbol_id);
          return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
        }
        case 'list_repos': {
          const repos = listRepos(opts.registry);
          return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
        }
        case 'register_repo': {
          const p = RegisterRepoSchema.parse(args);
          const repo = registerRepo(opts.registry, { name: p.name, rootPath: p.root_path, language: p.language });
          return { content: [{ type: 'text', text: JSON.stringify(repo, null, 2) }] };
        }
        case 'index_repo': {
          const p = IndexRepoSchema.parse(args);
          const result = await indexRepo(opts.registry, opts.indexer, p.repo_id);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'find_references': {
          const p = FindReferencesSchema.parse(args);
          const refs = findReferences(opts.db, { symbolName: p.symbol_name, repoId: p.repo_id ?? null });
          return { content: [{ type: 'text', text: JSON.stringify(refs, null, 2) }] };
        }
        case 'search_files': {
          const p = SearchFilesSchema.parse(args);
          const files = searchFiles(opts.db, { query: p.query, repoId: p.repo_id ?? null, limit: p.limit });
          return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
        }
        case 'get_file_symbols': {
          const p = GetFileSymbolsSchema.parse(args);
          const symbols = getFileSymbols(opts.db, { repoId: p.repo_id, relPath: p.rel_path });
          return { content: [{ type: 'text', text: JSON.stringify(symbols, null, 2) }] };
        }
        case 'explain_symbol': {
          const p = ExplainSymbolSchema.parse(args);
          const explanation = await explainSymbol(opts.db, p.symbol_id, ai);
          return { content: [{ type: 'text', text: explanation }] };
        }
        case 'get_repo_stats': {
          const p = GetRepoStatsSchema.parse(args);
          const stats = getRepoStats(opts.db, p.repo_id);
          return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
        }
        case 'remove_repo': {
          const p = RemoveRepoSchema.parse(args);
          removeRepo(opts.registry, p.repo_id);
          return { content: [{ type: 'text', text: `Repo ${p.repo_id} removed.` }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (e) {
      const msg = isAppError(e) ? `[${e.code}] ${e.message}` : String(e);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  });
}
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/index.ts src/mcp/tool-schemas.ts
git commit -m "feat: wire all 11 tool handlers into MCP SDK"
```

---

## Chunk 5: MCP Resources (5 resources)

### File Map

| Path | Responsibility |
|------|---------------|
| `src/mcp/resources/index.ts` | Replace stub with real resource handlers |
| `tests/mcp/resources.test.ts` | Verify resources are listed correctly |

**Resources:**
1. `repos://list` — JSON list of all repos
2. `repo://{id}/stats` — per-repo stats
3. `repo://{id}/files` — file list for a repo
4. `symbols://search?q=...` — search results
5. `repo://{id}/symbols` — all symbols in a repo

---

### Task 7: Resource handlers

**Files:**
- Modify: `src/mcp/resources/index.ts`
- Create: `tests/mcp/resources.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/resources.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';

describe('resource handlers', () => {
  it('can be imported without error', async () => {
    const { registerResourceHandlers } = await import('../../src/mcp/resources/index.js');
    expect(typeof registerResourceHandlers).toBe('function');
  });
});
```

- [ ] **Step 2: Replace `src/mcp/resources/index.ts`**

```typescript
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerOptions } from '../server.js';
import { getRepoStats } from '../tools/get-repo-stats.js';
import { searchSymbols } from '../tools/search-symbols.js';

export function registerResourceHandlers(server: Server, opts: McpServerOptions): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'repos://list',            name: 'All Repositories',   mimeType: 'application/json' },
      { uri: 'repos://stats',           name: 'All Repo Stats',     mimeType: 'application/json' },
      { uri: 'symbols://recent',        name: 'Recent Symbols',     mimeType: 'application/json' },
      { uri: 'symbols://search',        name: 'Symbol Search',      mimeType: 'application/json' },
      { uri: 'files://list',            name: 'All Indexed Files',  mimeType: 'application/json' },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;

    if (uri === 'repos://list') {
      const repos = opts.registry.list();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(repos, null, 2) }] };
    }

    if (uri === 'repos://stats') {
      const repos = opts.registry.list();
      const stats = repos.map((r) => getRepoStats(opts.db, r.id));
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }] };
    }

    if (uri === 'symbols://recent') {
      const rows = opts.db
        .prepare(`SELECT s.id, s.name, s.kind, f.rel_path FROM symbols s JOIN files f ON f.id = s.file_id ORDER BY s.rowid DESC LIMIT 50`)
        .all();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }] };
    }

    if (uri.startsWith('symbols://search')) {
      const url = new URL(uri.replace('symbols://', 'http://x/'));
      const q = url.searchParams.get('q') ?? '';
      const results = searchSymbols(opts.db, { query: q, repoId: null, limit: 50 });
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(results, null, 2) }] };
    }

    if (uri === 'files://list') {
      const rows = opts.db.prepare(`SELECT id, repo_id, rel_path, language, size_bytes FROM files ORDER BY rel_path LIMIT 500`).all();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }] };
    }

    return { contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }] };
  });
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npx vitest run tests/mcp/resources.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add src/mcp/resources/index.ts tests/mcp/resources.test.ts
git commit -m "feat: add 5 MCP resources (repos, stats, symbols, files)"
```

---

## Chunk 6: Startup Sequence & Graceful Shutdown

### File Map

| Path | Responsibility |
|------|---------------|
| `src/app.ts` | Updated to instantiate and start McpServer |
| `src/index.ts` | Handles SIGINT/SIGTERM → app.stop() |

---

### Task 8: Wire McpServer into App lifecycle

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update `src/app.ts`**

```typescript
// Add to imports:
import { McpServer } from './mcp/server.js';
import { createAiAdapter } from './mcp/ai-adapter.js';
import { Indexer } from './indexer/indexer.js';
import { Watcher } from './watcher/watcher.js';

// Add to App class fields:
readonly indexer: Indexer;
readonly watcher: Watcher;
private mcpServer: McpServer | null = null;

// In constructor (after registry):
this.indexer = new Indexer(this.pool.acquire());
this.watcher = new Watcher({ debounceMs: 300 });

// Replace start() body:
async start(): Promise<void> {
  this.log.info({ dbPath: this.config.dbPath }, 'App starting');

  // Index all registered repos
  for (const repo of this.registry.list()) {
    this.log.info({ repo: repo.name }, 'Initial indexing');
    await this.indexer.indexRepo(repo.id, repo.rootPath);
    await this.watcher.watch(repo.rootPath);
    this.watcher.on('change', () => {
      void this.indexer.indexRepo(repo.id, repo.rootPath);
    });
  }

  // Start MCP server
  const aiConfig = this.config.ai.apiKey
    ? { apiKey: this.config.ai.apiKey, baseUrl: this.config.ai.baseUrl, model: this.config.ai.model }
    : null;

  this.mcpServer = new McpServer({
    db: this.pool.acquire(),
    registry: this.registry,
    indexer: this.indexer,
    aiConfig,
  });

  await this.mcpServer.connectStdio();
  this.log.info('MCP server listening on stdio');
}

// Replace stop() body:
async stop(): Promise<void> {
  this.log.info('App stopping');
  await this.watcher.close();
  if (this.mcpServer) await this.mcpServer.close();
  this.pool.close();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat: wire McpServer into App with startup indexing and graceful shutdown"
```

---

## Final Verification

- [ ] Full test run:

```bash
npx vitest run --coverage
```

Expected: all tests pass.

- [ ] Build:

```bash
npx tsc
```

Expected: `dist/` generated, no errors.

- [ ] Final commit:

```bash
git add -A
git commit -m "chore: MCP server complete – 11 tools, 5 resources, graceful shutdown"
```

---

**Plan complete. Hand off to Plan 4: Web UI.**
