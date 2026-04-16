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
    expect(id1).toBe(id2);
    db.close();
  });

  it('updates name on conflict (repo rename)', () => {
    const db = openDb(':memory:');
    ensureRepo(db, '/projects/old-name');
    const id = ensureRepo(db, '/projects/old-name');
    const row = db.prepare(`SELECT name FROM repos WHERE id = ?`).get(id) as { name: string };
    expect(row.name).toBe('old-name');
    db.close();
  });
});
