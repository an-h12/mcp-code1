# Plan 5a: DB Migration — symbol_relations table

> **For agentic workers:** Use superpowers:executing-plans to implement this plan.

**Goal:** Add `symbol_relations` table via migration 002, verify `PRAGMA foreign_keys = ON` is already set, and update migration runner to register 002.

**Architecture:** Adds one new migration file following the existing pattern in `src/db/migrations/`. The `db/index.ts` already sets `foreign_keys = ON` and `journal_mode = WAL` — no change needed there. The migration runner `src/db/migrations/index.ts` must be updated to include migration 002.

**Tech Stack:** better-sqlite3, TypeScript NodeNext ESM, existing migration pattern.

**Schema note:** `symbols` table uses `file_id` FK (not `file_path` column). The `symbol_relations` table references `symbols(id)` — this is consistent with the existing schema.

---

## Chunk 1: Migration file + runner update

### File Map

| Path | Responsibility |
|------|---------------|
| `src/db/migrations/002_relations.ts` | CREATE TABLE symbol_relations + 4 indexes |
| `src/db/migrations/index.ts` | Register migration 002 |
| `tests/db/migration-002.test.ts` | Verify table + indexes created, FK cascade works |

---

### Task 1: Write migration 002

**Files:**
- Create: `src/db/migrations/002_relations.ts`
- Modify: `src/db/migrations/index.ts`
- Create: `tests/db/migration-002.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/db/migration-002.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';

describe('migration 002 — symbol_relations', () => {
  it('creates symbol_relations table with all columns', () => {
    const db = openDb(':memory:');
    const cols = db
      .prepare(`PRAGMA table_info(symbol_relations)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('repo_id');
    expect(names).toContain('source_id');
    expect(names).toContain('target_id');
    expect(names).toContain('target_name');
    expect(names).toContain('target_file');
    expect(names).toContain('type');
    expect(names).toContain('language');
    expect(names).toContain('confidence');
    expect(names).toContain('created_at');
    db.close();
  });

  it('creates all 4 indexes', () => {
    const db = openDb(':memory:');
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='symbol_relations'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_relations_source');
    expect(names).toContain('idx_relations_target');
    expect(names).toContain('idx_relations_repo');
    expect(names).toContain('idx_relations_repo_type');
    db.close();
  });

  it('enforces ON DELETE CASCADE from repos', () => {
    const db = openDb(':memory:');

    // Insert a repo, file, symbol, then a relation
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
    db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
    db.prepare(
      `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
       VALUES ('s1','r1','f1','foo','function',1,5)`,
    ).run();
    db.prepare(
      `INSERT INTO symbol_relations(id, repo_id, source_id, target_name, type, language)
       VALUES ('rel1','r1','s1','bar','CALLS','typescript')`,
    ).run();

    // Delete the repo — cascade should remove relation
    db.prepare(`DELETE FROM repos WHERE id='r1'`).run();
    const remaining = db.prepare(`SELECT COUNT(*) as c FROM symbol_relations`).get() as { c: number };
    expect(remaining.c).toBe(0);
    db.close();
  });

  it('stores default confidence=1.0', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
    db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
    db.prepare(
      `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
       VALUES ('s1','r1','f1','foo','function',1,5)`,
    ).run();
    db.prepare(
      `INSERT INTO symbol_relations(id, repo_id, source_id, target_name, type, language)
       VALUES ('rel1','r1','s1','bar','CALLS','typescript')`,
    ).run();
    const row = db.prepare(`SELECT confidence FROM symbol_relations WHERE id='rel1'`).get() as {
      confidence: number;
    };
    expect(row.confidence).toBe(1.0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (table not found)**

```bash
cd E:\Code\MCP-web\mcp-code1
npx vitest run tests/db/migration-002.test.ts
```

Expected: FAIL — "no such table: symbol_relations"

- [ ] **Step 3: Create migration 002**

Create `src/db/migrations/002_relations.ts`:

```typescript
import type Database from 'better-sqlite3';

export const version = 2;
export const name = 'symbol_relations';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_relations (
      id          TEXT PRIMARY KEY,
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      source_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
      target_id   TEXT,
      target_name TEXT NOT NULL,
      target_file TEXT,
      type        TEXT NOT NULL CHECK(type IN ('CALLS','IMPORTS','EXTENDS','IMPLEMENTS')),
      language    TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 1.0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_relations_source
      ON symbol_relations(source_id);

    CREATE INDEX IF NOT EXISTS idx_relations_target
      ON symbol_relations(target_id);

    CREATE INDEX IF NOT EXISTS idx_relations_repo
      ON symbol_relations(repo_id);

    CREATE INDEX IF NOT EXISTS idx_relations_repo_type
      ON symbol_relations(repo_id, type);
  `);
}
```

- [ ] **Step 4: Register migration 002 in runner**

Edit `src/db/migrations/index.ts` — replace the entire file:

```typescript
import type Database from 'better-sqlite3';
import { version as v1, name as n1, up as up1 } from './001_initial.js';
import { version as v2, name as n2, up as up2 } from './002_relations.js';

const MIGRATIONS = [
  { version: v1, name: n1, up: up1 },
  { version: v2, name: n2, up: up2 },
] as const;

export function runMigrations(db: Database.Database): void {
  // Ensure the tracking table exists first (handled by IF NOT EXISTS in 001)
  up1(db);

  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_migrations`).all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
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

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/db/migration-002.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Run full test suite — verify no regressions**

```bash
npx vitest run
```

Expected: all existing tests still PASS.

- [ ] **Step 7: Build**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/002_relations.ts src/db/migrations/index.ts tests/db/migration-002.test.ts
git commit -m "feat: add migration 002 — symbol_relations table with cascade indexes"
```
