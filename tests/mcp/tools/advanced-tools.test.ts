import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

type Db = ReturnType<typeof openDb>;

function seedRepo(db: Db, registry: RepoRegistry, name: string) {
  const repo = registry.register({ name, rootPath: `/${name}` });
  const fileId = randomUUID();
  db.prepare(
    `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'main.ts', 'ts', 100, 'abc')`,
  ).run(fileId, repo.id);
  db.prepare(
    `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature) VALUES (?, ?, ?, 'myFn', 'function', 1, 10, 'function myFn()')`,
  ).run(randomUUID(), repo.id, fileId);
  return { repo, fileId };
}

describe('advanced tools', () => {
  let db: Db;
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

  it('findReferences filters by repoId', async () => {
    const { findReferences } = await import('../../../src/mcp/tools/find-references.js');
    const { repo: r1 } = seedRepo(db, registry, 'r1');
    seedRepo(db, registry, 'r2');
    const refs = findReferences(db, { symbolName: 'myFn', repoId: r1.id });
    expect(refs.length).toBe(1);
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

  it('removeRepo throws for unknown id', async () => {
    const { removeRepo } = await import('../../../src/mcp/tools/remove-repo.js');
    expect(() => removeRepo(registry, randomUUID())).toThrow();
  });

  it('explainSymbol returns fallback text without AI', async () => {
    const { explainSymbol } = await import('../../../src/mcp/tools/explain-symbol.js');
    const { repo, fileId } = seedRepo(db, registry, 'r');
    const symRow = db
      .prepare(`SELECT id FROM symbols WHERE repo_id = ? AND file_id = ?`)
      .get(repo.id, fileId) as { id: string };
    const text = await explainSymbol(db, symRow.id, null);
    expect(text).toContain('myFn');
    expect(text).toContain('function');
  });
});
