import { describe, it, expect } from 'vitest';

describe('DbPool', () => {
  it('returns the same DB instance on multiple acquires', async () => {
    const { DbPool } = await import('../../src/db/pool.js');
    const pool = new DbPool(':memory:');
    const db1 = pool.acquire();
    const db2 = pool.acquire();
    expect(db1).toBe(db2);
    pool.release();
    pool.release();
    pool.close();
  });

  it('throws after close', async () => {
    const { DbPool } = await import('../../src/db/pool.js');
    const pool = new DbPool(':memory:');
    pool.acquire();
    pool.release();
    pool.close();
    expect(() => pool.acquire()).toThrow('DbPool is closed');
  });
});
