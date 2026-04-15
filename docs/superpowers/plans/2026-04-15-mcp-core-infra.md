# MCP Code Intelligence – Core Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the `mcp-code1` TypeScript project with SQLite persistence, config loading, structured logging, error codes, a multi-repo registry, and a connection-pool abstraction — everything that Plans 2, 3, and 4 depend on.

**Architecture:** A Node.js/TypeScript monorepo (single package for now) wired together by a thin `App` class. Persistence lives in SQLite via `better-sqlite3`. Configuration is loaded once at startup from `.env` + environment variables. All modules export plain functions / classes; there is no DI framework.

**Tech Stack:** Node.js 20+, TypeScript 5, `better-sqlite3`, `dotenv`, `pino` (logging), `zod` (env schema validation), Vitest (tests), ESLint + Prettier.

---

## Chunk 1: Project Scaffold & TypeScript Config

### File Map

| Path | Responsibility |
|------|---------------|
| `package.json` | Deps, scripts (`build`, `dev`, `test`, `lint`) |
| `tsconfig.json` | Strict TS, `ESNext` modules, `outDir=dist` |
| `tsconfig.test.json` | Extends base, includes test files |
| `.env.example` | Documentation of every env var |
| `.gitignore` | node_modules, dist, *.db, .env |
| `src/index.ts` | Entry point – instantiates App and starts it |
| `src/app.ts` | `App` class – wires all subsystems |
| `vitest.config.ts` | Vitest configuration |

---

### Task 1: Initialize `package.json` and install dependencies

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mcp-code1",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "node --watch --loader ts-node/esm src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write 'src/**/*.ts' 'tests/**/*.ts'"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.4.5",
    "pino": "^9.2.0",
    "pino-pretty": "^11.2.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.10",
    "@types/node": "^20.14.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "eslint": "^9.5.0",
    "@typescript-eslint/eslint-plugin": "^7.12.0",
    "@typescript-eslint/parser": "^7.12.0",
    "prettier": "^3.3.2"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd C:\Users\Haha\Desktop\MCP\mcp-code1
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.db
*.db-shm
*.db-wal
.env
coverage/
```

- [ ] **Step 4: Create `.env.example`**

```bash
# SQLite database path
DB_PATH=./data/mcp-code1.db

# Log level: trace | debug | info | warn | error | fatal
LOG_LEVEL=info

# MCP server port (used by Plan 3)
MCP_PORT=3000

# Web UI port (used by Plan 4)
UI_PORT=3001

# Optional: OpenAI-compatible API for AI adapter (Plan 3)
AI_API_KEY=
AI_API_BASE_URL=
AI_MODEL=gpt-4o-mini
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: init project scaffold with deps"
```

---

### Task 2: TypeScript & tooling configuration

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `vitest.config.ts`
- Create: `.eslintrc.json`
- Create: `.prettierrc`

- [ ] **Step 1: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
```

- [ ] **Step 4: Create `.eslintrc.json`**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked"
  ],
  "parserOptions": {
    "project": "./tsconfig.test.json"
  },
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

- [ ] **Step 5: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 6: Verify TypeScript compiles (no source yet)**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: error about missing `src/` or no output (OK — no source files yet).

- [ ] **Step 7: Commit**

```bash
git add tsconfig.json tsconfig.test.json vitest.config.ts .eslintrc.json .prettierrc
git commit -m "chore: add TypeScript, Vitest, ESLint, Prettier config"
```

---

## Chunk 2: Config Loading & Logging

### File Map

| Path | Responsibility |
|------|---------------|
| `src/config.ts` | Load `.env`, validate with Zod, export typed `Config` |
| `src/logger.ts` | Create and export `pino` logger instance |
| `tests/config.test.ts` | Unit tests for config validation |
| `tests/logger.test.ts` | Smoke test that logger doesn't throw |

---

### Task 3: Config module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('loadConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it('returns defaults when optional vars are absent', async () => {
    process.env['DB_PATH'] = './test.db';
    process.env['LOG_LEVEL'] = 'info';
    process.env['MCP_PORT'] = '3000';
    process.env['UI_PORT'] = '3001';
    process.env['AI_API_KEY'] = '';
    process.env['AI_API_BASE_URL'] = '';
    process.env['AI_MODEL'] = '';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.dbPath).toBe('./test.db');
    expect(config.mcpPort).toBe(3000);
    expect(config.uiPort).toBe(3001);
    expect(config.aiModel).toBe('gpt-4o-mini');
  });

  it('throws when DB_PATH is missing', async () => {
    delete process.env['DB_PATH'];
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Create `src/config.ts`**

```typescript
import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DB_PATH: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MCP_PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  UI_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  AI_API_KEY: z.string().default(''),
  AI_API_BASE_URL: z.string().default(''),
  AI_MODEL: z.string().default('gpt-4o-mini'),
});

export type Config = {
  dbPath: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  mcpPort: number;
  uiPort: number;
  ai: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
};

export function loadConfig(): Config {
  const parsed = EnvSchema.parse(process.env);
  return {
    dbPath: parsed.DB_PATH,
    logLevel: parsed.LOG_LEVEL,
    mcpPort: parsed.MCP_PORT,
    uiPort: parsed.UI_PORT,
    ai: {
      apiKey: parsed.AI_API_KEY,
      baseUrl: parsed.AI_API_BASE_URL,
      model: parsed.AI_MODEL,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/config.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loader with Zod validation"
```

---

### Task 4: Logger module

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/logger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('createLogger', () => {
  it('returns a pino logger with the given level', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger('warn');
    expect(log.level).toBe('warn');
  });

  it('returns a logger with child() method', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger('info');
    const child = log.child({ component: 'test' });
    expect(typeof child.info).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/logger.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/logger.ts`**

```typescript
import pino from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export function createLogger(level: LogLevel = 'info') {
  return pino({
    level,
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/logger.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add pino logger factory"
```

---

## Chunk 3: Error Codes

### File Map

| Path | Responsibility |
|------|---------------|
| `src/errors.ts` | `AppError` class, `ErrorCode` enum, helpers |
| `tests/errors.test.ts` | Unit tests |

---

### Task 5: Error codes & AppError class

**Files:**
- Create: `src/errors.ts`
- Create: `tests/errors.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('AppError', () => {
  it('carries an error code', async () => {
    const { AppError, ErrorCode } = await import('../src/errors.js');
    const err = new AppError(ErrorCode.REPO_NOT_FOUND, 'repo "x" not found');
    expect(err.code).toBe(ErrorCode.REPO_NOT_FOUND);
    expect(err.message).toBe('repo "x" not found');
    expect(err instanceof Error).toBe(true);
  });

  it('isAppError returns true for AppError', async () => {
    const { AppError, isAppError, ErrorCode } = await import('../src/errors.js');
    const err = new AppError(ErrorCode.DB_ERROR, 'db fail');
    expect(isAppError(err)).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/errors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/errors.ts`**

```typescript
export enum ErrorCode {
  // Repository errors
  REPO_NOT_FOUND = 'REPO_NOT_FOUND',
  REPO_ALREADY_EXISTS = 'REPO_ALREADY_EXISTS',
  REPO_INVALID_PATH = 'REPO_INVALID_PATH',

  // Database errors
  DB_ERROR = 'DB_ERROR',
  DB_MIGRATION_ERROR = 'DB_MIGRATION_ERROR',

  // Indexing errors
  INDEX_PARSE_ERROR = 'INDEX_PARSE_ERROR',
  INDEX_FILE_NOT_FOUND = 'INDEX_FILE_NOT_FOUND',
  INDEX_NOT_READY = 'INDEX_NOT_READY',

  // MCP / tool errors
  TOOL_INVALID_PARAMS = 'TOOL_INVALID_PARAMS',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',

  // Internal
  INTERNAL = 'INTERNAL',
}

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  const msg = value instanceof Error ? value.message : String(value);
  return new AppError(ErrorCode.INTERNAL, msg, value);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/errors.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: add AppError and ErrorCode enum"
```

---

## Chunk 4: SQLite Schema & Migrations

### File Map

| Path | Responsibility |
|------|---------------|
| `src/db/index.ts` | Open DB, run migrations, export `Db` type alias |
| `src/db/migrations/001_initial.ts` | CREATE TABLE statements |
| `src/db/migrations/index.ts` | Migration runner |
| `tests/db/db.test.ts` | Integration tests (temp in-memory DB) |

---

### Task 6: Database open & migration runner

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/migrations/001_initial.ts`
- Create: `src/db/migrations/index.ts`
- Create: `tests/db/db.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/db/db.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const TEST_DB = ':memory:';

describe('openDb', () => {
  it('creates tables via migration runner', async () => {
    const { openDb } = await import('../../src/db/index.js');
    const db = openDb(TEST_DB);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    const names = tables.map((t) => t.name);
    expect(names).toContain('repos');
    expect(names).toContain('symbols');
    expect(names).toContain('files');
    expect(names).toContain('schema_migrations');

    db.close();
  });

  it('is idempotent – running twice does not throw', async () => {
    const { openDb } = await import('../../src/db/index.js');
    expect(() => {
      const db = openDb(TEST_DB);
      db.close();
      const db2 = openDb(TEST_DB);
      db2.close();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/db.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create migration 001**

Create `src/db/migrations/001_initial.ts`:

```typescript
import type Database from 'better-sqlite3';

export const version = 1;
export const name = 'initial_schema';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT    NOT NULL,
      applied_at TEXT   NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS repos (
      id          TEXT PRIMARY KEY,        -- UUID
      name        TEXT NOT NULL UNIQUE,
      root_path   TEXT NOT NULL UNIQUE,
      language    TEXT NOT NULL DEFAULT '',
      indexed_at  TEXT,                    -- ISO-8601 or NULL
      file_count  INTEGER NOT NULL DEFAULT 0,
      symbol_count INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id          TEXT PRIMARY KEY,        -- UUID
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      rel_path    TEXT NOT NULL,
      language    TEXT NOT NULL DEFAULT '',
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      hash        TEXT NOT NULL DEFAULT '', -- SHA-256 of content
      indexed_at  TEXT,
      UNIQUE(repo_id, rel_path)
    );
    CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repo_id);

    CREATE TABLE IF NOT EXISTS symbols (
      id          TEXT PRIMARY KEY,        -- UUID
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL,  -- function | class | interface | method | variable | type | enum | const
      start_line  INTEGER NOT NULL,
      end_line    INTEGER NOT NULL,
      signature   TEXT NOT NULL DEFAULT '',
      doc_comment TEXT NOT NULL DEFAULT '',
      parent_id   TEXT REFERENCES symbols(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_symbols_repo  ON symbols(repo_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_file  ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_name  ON symbols(name);

    CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
      name,
      signature,
      doc_comment,
      content='symbols',
      content_rowid='rowid',
      tokenize='unicode61 tokenchars "_-"'
    );

    CREATE TRIGGER IF NOT EXISTS symbols_fts_insert AFTER INSERT ON symbols BEGIN
      INSERT INTO symbols_fts(rowid, name, signature, doc_comment)
      VALUES (new.rowid, new.name, new.signature, new.doc_comment);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_fts_delete AFTER DELETE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc_comment)
      VALUES ('delete', old.rowid, old.name, old.signature, old.doc_comment);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_fts_update AFTER UPDATE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc_comment)
      VALUES ('delete', old.rowid, old.name, old.signature, old.doc_comment);
      INSERT INTO symbols_fts(rowid, name, signature, doc_comment)
      VALUES (new.rowid, new.name, new.signature, new.doc_comment);
    END;
  `);
}
```

- [ ] **Step 4: Create migration runner**

Create `src/db/migrations/index.ts`:

```typescript
import type Database from 'better-sqlite3';
import { version as v1, name as n1, up as up1 } from './001_initial.js';

const MIGRATIONS = [{ version: v1, name: n1, up: up1 }] as const;

export function runMigrations(db: Database.Database): void {
  // Ensure the tracking table exists first (chicken-and-egg handled by IF NOT EXISTS in 001)
  up1(db);

  const applied = new Set(
    (
      db
        .prepare(`SELECT version FROM schema_migrations`)
        .all() as Array<{ version: number }>
    ).map((r) => r.version),
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      const run = db.transaction(() => {
        migration.up(db);
        db.prepare(`INSERT INTO schema_migrations(version, name) VALUES (?, ?)`).run(
          migration.version,
          migration.name,
        );
      });
      run();
    }
  }
}
```

- [ ] **Step 5: Create `src/db/index.ts`**

```typescript
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { runMigrations } from './migrations/index.js';

export type Db = BetterSqlite3.Database;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new BetterSqlite3(dbPath, {
    verbose: process.env['LOG_LEVEL'] === 'trace' ? console.log : undefined,
  });

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  return db;
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/db/db.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/db/ tests/db/
git commit -m "feat: add SQLite schema with FTS5 and migration runner"
```

---

## Chunk 5: Multi-Repo Registry

### File Map

| Path | Responsibility |
|------|---------------|
| `src/registry.ts` | CRUD for repos in SQLite; `RepoRegistry` class |
| `tests/registry.test.ts` | Integration tests using in-memory DB |

---

### Task 7: RepoRegistry class

**Files:**
- Create: `src/registry.ts`
- Create: `tests/registry.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db/index.js';
import type { Db } from '../src/db/index.js';

describe('RepoRegistry', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('registers a new repo', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'my-app', rootPath: '/home/user/my-app' });
    expect(repo.id).toBeTruthy();
    expect(repo.name).toBe('my-app');
    expect(repo.rootPath).toBe('/home/user/my-app');
  });

  it('lists all repos', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    registry.register({ name: 'a', rootPath: '/a' });
    registry.register({ name: 'b', rootPath: '/b' });
    const all = registry.list();
    expect(all).toHaveLength(2);
  });

  it('throws REPO_ALREADY_EXISTS on duplicate name', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const { AppError, ErrorCode } = await import('../src/errors.js');
    const registry = new RepoRegistry(db);
    registry.register({ name: 'dup', rootPath: '/dup' });
    expect(() => registry.register({ name: 'dup', rootPath: '/dup2' })).toThrow(AppError);
    try {
      registry.register({ name: 'dup', rootPath: '/dup3' });
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.REPO_ALREADY_EXISTS);
    }
  });

  it('gets a repo by id', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    const created = registry.register({ name: 'find-me', rootPath: '/find' });
    const found = registry.getById(created.id);
    expect(found?.name).toBe('find-me');
  });

  it('removes a repo', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    const r = registry.register({ name: 'rm-me', rootPath: '/rm' });
    registry.remove(r.id);
    expect(registry.getById(r.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/registry.ts`**

```typescript
import { randomUUID } from 'node:crypto';
import type { Db } from './db/index.js';
import { AppError, ErrorCode } from './errors.js';

export type Repo = {
  id: string;
  name: string;
  rootPath: string;
  language: string;
  indexedAt: string | null;
  fileCount: number;
  symbolCount: number;
  createdAt: string;
};

type Row = {
  id: string;
  name: string;
  root_path: string;
  language: string;
  indexed_at: string | null;
  file_count: number;
  symbol_count: number;
  created_at: string;
};

function rowToRepo(row: Row): Repo {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    language: row.language,
    indexedAt: row.indexed_at,
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    createdAt: row.created_at,
  };
}

export class RepoRegistry {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  register(opts: { name: string; rootPath: string; language?: string }): Repo {
    const id = randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO repos (id, name, root_path, language) VALUES (?, ?, ?, ?)`,
        )
        .run(id, opts.name, opts.rootPath, opts.language ?? '');
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
        throw new AppError(
          ErrorCode.REPO_ALREADY_EXISTS,
          `Repository "${opts.name}" already exists`,
          e,
        );
      }
      throw new AppError(ErrorCode.DB_ERROR, `Failed to register repo: ${String(e)}`, e);
    }
    return this.getById(id)!;
  }

  list(): Repo[] {
    return (this.db.prepare(`SELECT * FROM repos ORDER BY name`).all() as Row[]).map(rowToRepo);
  }

  getById(id: string): Repo | undefined {
    const row = this.db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id) as Row | undefined;
    return row ? rowToRepo(row) : undefined;
  }

  getByName(name: string): Repo | undefined {
    const row = this.db.prepare(`SELECT * FROM repos WHERE name = ?`).get(name) as Row | undefined;
    return row ? rowToRepo(row) : undefined;
  }

  update(id: string, patch: Partial<Pick<Repo, 'indexedAt' | 'fileCount' | 'symbolCount' | 'language'>>): void {
    if (patch.indexedAt !== undefined) {
      this.db.prepare(`UPDATE repos SET indexed_at = ? WHERE id = ?`).run(patch.indexedAt, id);
    }
    if (patch.fileCount !== undefined) {
      this.db.prepare(`UPDATE repos SET file_count = ? WHERE id = ?`).run(patch.fileCount, id);
    }
    if (patch.symbolCount !== undefined) {
      this.db.prepare(`UPDATE repos SET symbol_count = ? WHERE id = ?`).run(patch.symbolCount, id);
    }
    if (patch.language !== undefined) {
      this.db.prepare(`UPDATE repos SET language = ? WHERE id = ?`).run(patch.language, id);
    }
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM repos WHERE id = ?`).run(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/registry.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts tests/registry.test.ts
git commit -m "feat: add RepoRegistry with CRUD operations"
```

---

## Chunk 6: Connection Pool & App Entry Point

### File Map

| Path | Responsibility |
|------|---------------|
| `src/db/pool.ts` | `DbPool` – single shared DB instance with reference counting |
| `src/app.ts` | `App` class that wires config + DB + registry |
| `src/index.ts` | Entry point: loads config, creates App, starts it |
| `tests/db/pool.test.ts` | Unit test for pool acquire/release |

---

### Task 8: DbPool

**Files:**
- Create: `src/db/pool.ts`
- Create: `tests/db/pool.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/db/pool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('DbPool', () => {
  it('returns the same DB instance on multiple acquires', async () => {
    const { DbPool } = await import('../../src/db/pool.js');
    const pool = new DbPool(':memory:');
    const db1 = pool.acquire();
    const db2 = pool.acquire();
    expect(db1).toBe(db2);
    pool.release();
    pool.release();
    pool.close();
  });

  it('throws after close', async () => {
    const { DbPool } = await import('../../src/db/pool.js');
    const pool = new DbPool(':memory:');
    pool.acquire();
    pool.release();
    pool.close();
    expect(() => pool.acquire()).toThrow('DbPool is closed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/pool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/db/pool.ts`**

```typescript
import { openDb } from './index.js';
import type { Db } from './index.js';

/**
 * DbPool wraps a single SQLite connection shared across the process.
 * SQLite is not truly concurrent, but this pool provides a clean lifecycle
 * (acquire / release / close) that other modules can depend on.
 */
export class DbPool {
  private db: Db | null = null;
  private refCount = 0;
  private closed = false;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  acquire(): Db {
    if (this.closed) throw new Error('DbPool is closed');
    if (!this.db) this.db = openDb(this.dbPath);
    this.refCount++;
    return this.db;
  }

  release(): void {
    if (this.refCount > 0) this.refCount--;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.closed = true;
    this.refCount = 0;
  }

  get isOpen(): boolean {
    return !this.closed && this.db !== null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/db/pool.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/pool.ts tests/db/pool.test.ts
git commit -m "feat: add DbPool for shared SQLite lifecycle"
```

---

### Task 9: App class & entry point

**Files:**
- Create: `src/app.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/app.ts`**

```typescript
import { loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { DbPool } from './db/pool.js';
import { RepoRegistry } from './registry.js';

export class App {
  readonly config: Config;
  readonly log: Logger;
  readonly pool: DbPool;
  readonly registry: RepoRegistry;

  constructor() {
    this.config = loadConfig();
    this.log = createLogger(this.config.logLevel);
    this.pool = new DbPool(this.config.dbPath);
    const db = this.pool.acquire();
    this.registry = new RepoRegistry(db);
  }

  async start(): Promise<void> {
    this.log.info({ dbPath: this.config.dbPath }, 'App starting');
    // Plans 2 and 3 will attach subsystems here
  }

  async stop(): Promise<void> {
    this.log.info('App stopping');
    this.pool.close();
  }
}
```

- [ ] **Step 2: Create `src/index.ts`**

```typescript
import { App } from './app.js';

const app = new App();

process.on('SIGINT', () => void app.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void app.stop().then(() => process.exit(0)));

await app.start();
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (or only minor config warnings).

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/index.ts
git commit -m "feat: add App class and entry point"
```

---

## Final Verification

- [ ] Run full test suite:

```bash
npx vitest run --coverage
```

Expected: all tests pass, coverage report generated.

- [ ] Build TypeScript:

```bash
npx tsc
```

Expected: `dist/` directory created, no errors.

- [ ] Commit final state:

```bash
git add -A
git commit -m "chore: core infrastructure complete – all tests green"
```

---

**Plan complete. Hand off to Plan 2: Indexing Pipeline.**
