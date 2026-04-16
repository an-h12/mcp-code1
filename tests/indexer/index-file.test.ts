import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import type { Db } from '../../src/db/index.js';

const TS_SOURCE = `
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export class Greeter {
  private prefix: string;
  constructor(prefix: string) { this.prefix = prefix; }
  greet(name: string) { return this.prefix + name; }
}
`.trim();

describe('indexFile', () => {
  let db: Db;
  let repoId: string;
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    dir = mkdtempSync(join(tmpdir(), 'mcp-idx-'));
    filePath = join(dir, 'greeter.ts');
    writeFileSync(filePath, TS_SOURCE);
    const repo = registry.register({ name: 'test-repo', rootPath: dir });
    repoId = repo.id;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts symbols on first index', async () => {
    const { indexFile } = await import('../../src/indexer/index-file.js');
    const result = await indexFile(db, repoId, filePath, dir);
    expect(result.symbolsAdded).toBeGreaterThanOrEqual(2);
    const rows = db
      .prepare(`SELECT name FROM symbols WHERE repo_id = ?`)
      .all(repoId) as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toContain('greet');
    expect(names).toContain('Greeter');
  });

  it('skips re-indexing unchanged file', async () => {
    const { indexFile } = await import('../../src/indexer/index-file.js');
    const r1 = await indexFile(db, repoId, filePath, dir);
    const r2 = await indexFile(db, repoId, filePath, dir);
    expect(r2.skipped).toBe(true);
    expect(r1.symbolsAdded).toBeGreaterThan(0);
  });

  it('re-indexes when content changes', async () => {
    const { indexFile } = await import('../../src/indexer/index-file.js');
    await indexFile(db, repoId, filePath, dir);
    writeFileSync(filePath, TS_SOURCE + '\nexport function extra() {}');
    const r2 = await indexFile(db, repoId, filePath, dir);
    expect(r2.skipped).toBe(false);
    const rows = db
      .prepare(`SELECT name FROM symbols WHERE repo_id = ?`)
      .all(repoId) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toContain('extra');
  });
});
