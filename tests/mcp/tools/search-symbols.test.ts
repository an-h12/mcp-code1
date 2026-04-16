import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

type Db = ReturnType<typeof openDb>;

function seedSymbol(db: Db, repoId: string, fileId: string, name: string, kind: string) {
  db.prepare(
    `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(randomUUID(), repoId, fileId, name, kind, `${kind} ${name}()`);
}

describe('searchSymbols', () => {
  let db: Db;
  let repoId: string;
  let fileId: string;

  beforeEach(() => {
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    repoId = repo.id;
    fileId = randomUUID();
    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'a.ts', 'ts', 0, '')`,
    ).run(fileId, repoId);
    seedSymbol(db, repoId, fileId, 'getUserById', 'function');
    seedSymbol(db, repoId, fileId, 'UserController', 'class');
    seedSymbol(db, repoId, fileId, 'createUser', 'function');
  });

  afterEach(() => db.close());

  it('finds symbols by name prefix', async () => {
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
