/**
 * Test cho getRepoStats — kiểm tra language breakdown.
 * Cline hiển thị stats cho user biết repo đã index xong chưa.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';

type Db = ReturnType<typeof openDb>;

describe('getRepoStats — language breakdown', () => {
  let db: Db;
  let registry: RepoRegistry;

  beforeEach(() => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
  });

  afterEach(() => db.close());

  it('trả về language breakdown từ files table', async () => {
    const { getRepoStats } = await import('../../../src/mcp/tools/get-repo-stats.js');
    const repo = registry.register({ name: 'r', rootPath: '/r' });

    // Seed files with different languages
    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'a.ts', 'typescript', 100, 'h1')`,
    ).run(randomUUID(), repo.id);
    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'b.ts', 'typescript', 200, 'h2')`,
    ).run(randomUUID(), repo.id);
    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash) VALUES (?, ?, 'c.py', 'python', 150, 'h3')`,
    ).run(randomUUID(), repo.id);

    const stats = getRepoStats(db, repo.id);
    expect(stats.fileCount).toBe(3);
    expect(stats.languageBreakdown).toBeDefined();
    expect(stats.languageBreakdown['typescript']).toBe(2);
    expect(stats.languageBreakdown['python']).toBe(1);
  });

  it('repo trống trả về counts = 0', async () => {
    const { getRepoStats } = await import('../../../src/mcp/tools/get-repo-stats.js');
    const repo = registry.register({ name: 'empty', rootPath: '/empty' });

    const stats = getRepoStats(db, repo.id);
    expect(stats.fileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
  });
});
