import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

type Db = ReturnType<typeof openDb>;

describe('basic tools', () => {
  let db: Db;
  let registry: RepoRegistry;

  beforeEach(() => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
  });

  afterEach(() => db.close());

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
    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'f.ts', 'ts', 0, '')`,
    ).run(fileId, repo.id);
    db.prepare(
      `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature) VALUES (?, ?, ?, 'myFn', 'function', 1, 5, 'function myFn()')`,
    ).run(symId, repo.id, fileId);
    const detail = getSymbolDetail(db, symId);
    expect(detail?.name).toBe('myFn');
    expect(detail?.startLine).toBe(1);
  });

  it('getSymbolDetail returns null for unknown id', async () => {
    const { getSymbolDetail } = await import('../../../src/mcp/tools/get-symbol-detail.js');
    expect(getSymbolDetail(db, randomUUID())).toBeNull();
  });

  it('registerRepo delegates to registry', async () => {
    const { registerRepo } = await import('../../../src/mcp/tools/register-repo.js');
    // use tmp dir so existsSync passes
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = os.tmpdir();
    const repo = registerRepo(registry, { name: 'xyz', rootPath: path.resolve(tmp) });
    expect(repo.name).toBe('xyz');
  });

  it('registerRepo throws on bad path', async () => {
    const { registerRepo } = await import('../../../src/mcp/tools/register-repo.js');
    expect(() => registerRepo(registry, { name: 'bad', rootPath: '/does/not/exist/xyz' })).toThrow();
  });
});
