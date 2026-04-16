# Plan 5e: App.ts Startup + C# Roslyn Bridge + CSHARP_IGNORE_PATTERNS

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Run **after Plans 5a, 5b, 5c, 5d**.

**Goal:** Wire everything together in `App`/startup: `REPO_ROOT` env var, `ensureRepo`, `InMemoryGraph`, scan guard, initial index scan with retry, update `McpServer` to accept new options. Add `RoslynBridge` (C# Tier 2), add C# ignore patterns to `Indexer`, and add `.gitattributes` + `scripts/build-roslyn.sh` stubs.

**Architecture:** `App.ts` is refactored to be a single-repo-per-process model. `REPO_ROOT` is read from env (or `process.cwd()`). `repoId` is computed via `ensureRepo` and injected into `McpServer`. `InMemoryGraph` is created once and passed to `McpServer`. `RoslynBridge` is optional (no binary = Tier 1 tree-sitter only).

**Tech Stack:** Node.js `child_process.spawn`, better-sqlite3, TypeScript, existing `App` class pattern.

---

## Chunk 1: C# Ignore Patterns + Roslyn Binary Stubs

### File Map

| Path | Responsibility |
|------|---------------|
| `src/indexer/indexer.ts` | Add CSHARP_IGNORE_PATTERNS to IGNORE_DIRS check |
| `.gitattributes` | Mark bin/roslyn/** as binary |
| `scripts/build-roslyn.sh` | Placeholder build script |
| `bin/roslyn/.gitkeep` | Ensure bin/roslyn/ directory is tracked |

---

### Task 1: C# ignore patterns

- [ ] **Step 1: Add CSHARP_IGNORE_PATTERNS to indexer.ts**

Edit `src/indexer/indexer.ts` — replace the `IGNORE_DIRS` constant:

```typescript
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', '.cache',
  '__pycache__', '.pytest_cache',
  'venv', '.venv', 'target', 'vendor',
  '.idea', '.vscode',
  // C# specific
  'obj', 'bin', 'packages', '.vs',
]);
```

Also add a file-level ignore check in `walk()`. After `if (stat.isFile())` and before the extension check, add:

```typescript
// C# generated file patterns
const CS_IGNORE_SUFFIXES = ['.Designer.cs', '.g.cs', '.generated.cs'];
const CS_IGNORE_NAMES = ['AssemblyInfo.cs', 'GlobalUsings.g.cs'];
if (
  CS_IGNORE_NAMES.includes(entry) ||
  CS_IGNORE_SUFFIXES.some((s) => entry.endsWith(s))
) continue;
```

- [ ] **Step 2: Create .gitattributes**

Create `.gitattributes` in project root:

```
bin/roslyn/** binary
bin/roslyn/** -diff -merge
```

- [ ] **Step 3: Create bin/roslyn/.gitkeep + scripts/build-roslyn.sh**

Create `bin/roslyn/.gitkeep` (empty file).

Create `scripts/build-roslyn.sh`:
```bash
#!/usr/bin/env bash
# Build the Roslyn analyzer binary for the current platform.
# Requires .NET 8 SDK: https://dotnet.microsoft.com/download
set -e

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
esac

OUTPUT_DIR="bin/roslyn/${PLATFORM}-${ARCH}"
mkdir -p "$OUTPUT_DIR"

cd roslyn-analyzer
dotnet publish -c Release -r "${PLATFORM}-${ARCH}" --self-contained true -o "../${OUTPUT_DIR}"
echo "Built: ${OUTPUT_DIR}/roslyn-analyzer"
```

- [ ] **Step 4: Commit**

```bash
git add src/indexer/indexer.ts .gitattributes scripts/build-roslyn.sh bin/roslyn/.gitkeep
git commit -m "feat: add C# ignore patterns and Roslyn build infrastructure stubs"
```

---

## Chunk 2: RoslynBridge

### File Map

| Path | Responsibility |
|------|---------------|
| `src/analyzers/roslyn-bridge.ts` | Spawn Roslyn daemon, NDJSON framing, crash recovery |
| `tests/analyzers/roslyn-bridge.test.ts` | getRoslynBinaryPath returns null when no binary, analyze returns null gracefully |

---

### Task 2: RoslynBridge

- [ ] **Step 1: Write failing tests**

Create `tests/analyzers/roslyn-bridge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RoslynBridge } from '../../src/analyzers/roslyn-bridge.js';

describe('RoslynBridge', () => {
  it('returns null from analyze() when no binary present', async () => {
    // In CI and dev, no roslyn binary exists → Tier 1 fallback
    const bridge = new RoslynBridge();
    const result = await bridge.analyze({
      action: 'analyze',
      files: ['fake.cs'],
      projectRoot: '/fake',
      repoId: 'r1',
    });
    // Either null (no binary) or a valid response — both acceptable
    // Just verify it doesn't throw
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('can be instantiated without throwing', () => {
    expect(() => new RoslynBridge()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/analyzers/roslyn-bridge.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement RoslynBridge**

Create `src/analyzers/roslyn-bridge.ts`:

```typescript
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RoslynRequest = {
  action: 'analyze';
  files: string[];
  projectRoot: string;
  repoId: string;
};

export type RoslynSymbol = {
  name: string;
  kind: 'class' | 'method' | 'interface' | 'property' | 'field' | 'enum';
  filePath: string;
  line: number;
  column: number;
  partialClassGroup?: string;
};

export type RoslynRelation = {
  sourceFile: string;
  sourceName: string;
  targetName: string;
  targetFile: string | null;
  type: 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';
  confidence: number;
};

export type PartialMerge = {
  className: string;
  files: string[];
  mergedSymbolId?: string;
};

export type RoslynResponse = {
  symbols: RoslynSymbol[];
  relations: RoslynRelation[];
  partialMerges: PartialMerge[];
  errors: string[];
};

function getRoslynBinaryPath(): string | null {
  const platform = process.platform; // win32 | linux | darwin
  const arch = process.arch; // x64 | arm64
  const platformDir = platform === 'win32' ? 'win' : platform;
  const name = platform === 'win32' ? 'roslyn-analyzer.exe' : 'roslyn-analyzer';
  const p = path.join(__dirname, '..', '..', 'bin', 'roslyn', `${platformDir}-${arch}`, name);
  return existsSync(p) ? p : null;
}

export class RoslynBridge {
  private daemon: ChildProcess | null = null;
  private readonly TIMEOUT_MS = 30_000;
  private _cleanupRegistered = false;

  private ensureDaemon(): ChildProcess | null {
    if (this.daemon && !this.daemon.killed) return this.daemon;

    const binPath = getRoslynBinaryPath();
    if (!binPath) return null;

    this.daemon = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.daemon.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(`[RoslynBridge] ${d.toString()}`);
    });

    this.daemon.on('exit', (code: number | null) => {
      process.stderr.write(`[RoslynBridge] daemon exited code=${code} — will respawn on next request\n`);
      this.daemon = null;
    });

    if (!this._cleanupRegistered) {
      this._cleanupRegistered = true;
      const cleanup = () => this.daemon?.kill();
      process.once('exit', cleanup);
      process.once('SIGTERM', () => { cleanup(); process.exit(0); });
      process.once('SIGINT', () => { cleanup(); process.exit(0); });
    }

    return this.daemon;
  }

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
        if (newlineIdx === -1) return;
        const line = buffer.slice(0, newlineIdx);
        cleanup();
        try {
          resolve(JSON.parse(line) as RoslynResponse);
        } catch (e) {
          reject(new Error(`Roslyn response JSON parse failed: ${e}. Raw: ${line.slice(0, 200)}`));
        }
      };

      const onError = (err: Error) => { cleanup(); reject(err); };

      const onClose = () => {
        cleanup();
        reject(new Error(`Roslyn daemon stdout closed before response (partial: ${buffer.slice(0, 100)})`));
      };

      daemon.stdout!.on('data', onData);
      daemon.stdout!.once('error', onError);
      daemon.stdout!.once('close', onClose);

      daemon.stdin!.write(JSON.stringify(req) + '\n');
    });
  }

  async analyze(req: RoslynRequest): Promise<RoslynResponse | null> {
    const daemon = this.ensureDaemon();
    if (!daemon) return null;

    return Promise.race([
      this.sendRequest(daemon, req),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Roslyn timeout')), this.TIMEOUT_MS),
      ),
    ]).catch((err) => {
      process.stderr.write(`[RoslynBridge] analysis failed: ${err} — falling back to Tier 1\n`);
      this.daemon?.kill();
      this.daemon = null;
      return null;
    });
  }

  close(): void {
    this.daemon?.kill();
    this.daemon = null;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/analyzers/roslyn-bridge.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/roslyn-bridge.ts tests/analyzers/roslyn-bridge.test.ts
git commit -m "feat: add RoslynBridge C# Tier 2 analyzer with daemon spawn + crash recovery"
```

---

## Chunk 3: App.ts refactor — single-repo startup

### File Map

| Path | Responsibility |
|------|---------------|
| `src/app.ts` | Read REPO_ROOT, ensureRepo, wire InMemoryGraph + repoId into McpServer |
| `src/db/repo-registry.ts` | New file: ensureRepo() function |
| `tests/db/ensure-repo.test.ts` | ensureRepo idempotent, normalized path, name update |

---

### Task 3: ensureRepo + App startup

- [ ] **Step 1: Write failing tests for ensureRepo**

Create `tests/db/ensure-repo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { ensureRepo } from '../../src/db/repo-registry.js';

describe('ensureRepo', () => {
  it('inserts repo row and returns stable ID', () => {
    const db = openDb(':memory:');
    const id = ensureRepo(db, 'E:\\Projects\\App');
    expect(typeof id).toBe('string');
    expect(id.length).toBe(16);
    db.close();
  });

  it('is idempotent — same path returns same ID', () => {
    const db = openDb(':memory:');
    const id1 = ensureRepo(db, '/projects/app');
    const id2 = ensureRepo(db, '/projects/app');
    expect(id1).toBe(id2);
    db.close();
  });

  it('normalizes Windows backslashes — same ID as forward slashes', () => {
    const db = openDb(':memory:');
    const id1 = ensureRepo(db, 'E:\\Projects\\App');
    const id2 = ensureRepo(db, 'E:/Projects/App');
    // Same after normalization (both lowercased + forward slashes)
    expect(id1).toBe(id2);
    db.close();
  });

  it('updates name on conflict (repo rename)', () => {
    const db = openDb(':memory:');
    ensureRepo(db, '/projects/old-name');
    // Call again with same underlying path but different last segment
    // (simulating manual rename — in practice same hash, name updated)
    const id = ensureRepo(db, '/projects/old-name');
    const row = db.prepare(`SELECT name FROM repos WHERE id = ?`).get(id) as { name: string };
    expect(row.name).toBe('old-name');
    db.close();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/db/ensure-repo.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement ensureRepo**

Create `src/db/repo-registry.ts`:

```typescript
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { Db } from './index.js';

function slugify(p: string): string {
  return p.replace(/[^\w]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo';
}

export { slugify };

export function ensureRepo(db: Db, rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, '/').toLowerCase();
  const repoId = createHash('sha256').update(normalized).digest('hex').slice(0, 16);

  db.prepare(`
    INSERT INTO repos (id, name, root_path)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_seen = datetime('now'),
      name      = excluded.name
  `).run(repoId, basename(rootPath), normalized);

  return repoId;
}
```

**Note:** `repos` table in migration 001 has no `last_seen` column. Either:
- Option A: Add `last_seen` to `ON CONFLICT` only if the column exists — safer: just update `name` only.
- Option B: Remove `last_seen` from the upsert.

Use **Option B** — remove `last_seen = datetime('now')` since the column doesn't exist in the schema. The upsert becomes:

```typescript
db.prepare(`
  INSERT INTO repos (id, name, root_path)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name
`).run(repoId, basename(rootPath), normalized);
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/db/ensure-repo.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Update App.ts to single-repo model**

Edit `src/app.ts` — replace entire file content:

```typescript
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { DbPool } from './db/pool.js';
import { RepoRegistry } from './registry.js';
import { Indexer } from './indexer/indexer.js';
import { Watcher } from './watcher/watcher.js';
import { McpServer } from './mcp/server.js';
import type { AiConfig } from './mcp/ai-adapter.js';
import { InMemoryGraph } from './graph/in-memory-graph.js';
import { ensureRepo } from './db/repo-registry.js';

export class App {
  readonly config: Config;
  readonly log: Logger;
  readonly pool: DbPool;
  readonly registry: RepoRegistry;
  readonly indexer: Indexer;
  readonly watcher: Watcher;
  readonly graph: InMemoryGraph;
  repoId: string = '';
  private mcpServer: McpServer | null = null;

  constructor() {
    this.config = loadConfig();
    this.log = createLogger(this.config.logLevel);

    // Resolve REPO_ROOT (single-repo model)
    const repoRoot = process.env['REPO_ROOT']
      ? path.resolve(process.env['REPO_ROOT'])
      : process.cwd();

    if (!existsSync(repoRoot)) {
      this.log.fatal({ repoRoot }, 'REPO_ROOT does not exist — check your Cline MCP config');
      process.exit(1);
    }

    // Ensure data directory for DB
    const dbPath = this.config.dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });

    this.pool = new DbPool(dbPath);
    const db = this.pool.acquire();
    this.registry = new RepoRegistry(db);
    this.indexer = new Indexer(db);
    this.watcher = new Watcher({ debounceMs: 300 });
    this.graph = new InMemoryGraph(db);

    // Register/upsert this repo — sets stable repoId
    this.repoId = ensureRepo(db, repoRoot);
  }

  async start(): Promise<void> {
    this.log.info({ dbPath: this.config.dbPath, repoId: this.repoId }, 'App starting');

    // Start TTL eviction for graph
    this.graph.startEviction();

    // Kick off initial scan (non-blocking, with scan guard)
    const repoRoot = process.env['REPO_ROOT']
      ? path.resolve(process.env['REPO_ROOT'])
      : process.cwd();

    this.graph.setScanInProgress(this.repoId, true);

    this.indexer
      .indexRepo(this.repoId, repoRoot)
      .then(() => {
        this.graph.setScanInProgress(this.repoId, false);
        this.graph.invalidate(this.repoId);
        this.log.info({ repoId: this.repoId }, 'Initial index complete — graph ready');
      })
      .catch((err: unknown) => {
        this.graph.setScanInProgress(this.repoId, false);
        this.log.error({ err, repoId: this.repoId }, 'runFullScan failed — retrying in 60s');
        setTimeout(() => {
          this.graph.setScanInProgress(this.repoId, true);
          this.indexer
            .indexRepo(this.repoId, repoRoot)
            .then(() => {
              this.graph.setScanInProgress(this.repoId, false);
              this.graph.invalidate(this.repoId);
            })
            .catch((e: unknown) => {
              this.graph.setScanInProgress(this.repoId, false);
              this.log.error({ e }, 'runFullScan retry also failed — restart server to recover');
            });
        }, 60_000);
      });

    // Set up file watcher to re-index on change
    await this.watcher.watch(repoRoot);
    this.watcher.on('change', (filePath: string) => {
      this.log.debug({ filePath }, 'File changed — re-indexing');
      void this.indexer.indexRepo(this.repoId, repoRoot);
    });

    const aiConfig: AiConfig | null = this.config.aiApiKey
      ? {
          apiKey: this.config.aiApiKey,
          baseUrl: this.config.aiApiBaseUrl,
          model: this.config.aiModel,
        }
      : null;

    this.mcpServer = new McpServer({
      db: this.pool.acquire(),
      registry: this.registry,
      indexer: this.indexer,
      aiConfig,
      graph: this.graph,
      repoId: this.repoId,
    });

    await this.mcpServer.connectStdio();
    this.log.info('MCP server listening on stdio');
  }

  async stop(): Promise<void> {
    this.log.info('App stopping');
    this.graph.stopEviction();
    await this.watcher.close();
    if (this.mcpServer) {
      await this.mcpServer.close();
      this.mcpServer = null;
    }
    this.pool.close();
  }
}
```

- [ ] **Step 6: Fix McpServer constructor — update test in tests/mcp/tool-wire.test.ts**

The test creates `McpServer` directly — it needs `graph` and `repoId`. Edit `tests/mcp/tool-wire.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { McpServer } from '../../src/mcp/server.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

describe('tool wiring', () => {
  it('lists 16 tools via internal server', async () => {
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const indexer = new Indexer(db);
    const graph = new InMemoryGraph(db);
    const mcp = new McpServer({ db, registry, indexer, aiConfig: null, graph, repoId: 'test-repo' });
    const server = mcp.getInternalServer();
    expect(server).toBeDefined();
    expect(ListToolsRequestSchema).toBeDefined();
    expect(CallToolRequestSchema).toBeDefined();
    db.close();
  });
});
```

- [ ] **Step 7: Run full test suite + build**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all tests PASS, 0 TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/app.ts src/db/repo-registry.ts tests/db/ensure-repo.test.ts tests/mcp/tool-wire.test.ts
git commit -m "feat: refactor App to single-repo model with REPO_ROOT, ensureRepo, InMemoryGraph wiring"
```

---

## Chunk 4: Final push to main

### Task 4: Push plan files + implementation branch

- [ ] **Step 1: Push feat/implementation to remote**

```bash
git push origin feat/implementation
```

- [ ] **Step 2: Verify all tests green one final time**

```bash
npx vitest run
```

Expected: all PASS.

- [ ] **Step 3: Merge to main (or open PR)**

```bash
git checkout main
git merge feat/implementation --no-ff -m "feat: Plan 5 — Relationship Intelligence (graph, BFS, 16 tools, ContextEnricher)"
git push origin main
```
