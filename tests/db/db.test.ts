import { describe, it, expect } from 'vitest';

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
