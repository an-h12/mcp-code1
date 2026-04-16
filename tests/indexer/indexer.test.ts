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
    rmSync(dir, { recursive: true, force: true });
  });

  it('indexes all TypeScript files in a directory tree', async () => {
    const { Indexer } = await import('../../src/indexer/indexer.js');
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repoId, dir);
    expect(result.filesIndexed).toBe(3);
    expect(result.symbolsAdded).toBeGreaterThanOrEqual(2);
  });

  it('respects ignore patterns', async () => {
    const { Indexer } = await import('../../src/indexer/indexer.js');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'dep.ts'), `export function dep() {}`);
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repoId, dir);
    expect(result.filesIndexed).toBe(3);
  });
});
