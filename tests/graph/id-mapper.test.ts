import { describe, it, expect } from 'vitest';
import { IdMapper } from '../../src/graph/id-mapper.js';

describe('IdMapper', () => {
  it('interns UUIDs to sequential integers starting at 0', () => {
    const m = new IdMapper();
    expect(m.intern('uuid-a')).toBe(0);
    expect(m.intern('uuid-b')).toBe(1);
    expect(m.intern('uuid-c')).toBe(2);
  });

  it('intern is idempotent — same UUID returns same int', () => {
    const m = new IdMapper();
    const id1 = m.intern('uuid-x');
    const id2 = m.intern('uuid-x');
    expect(id1).toBe(id2);
  });

  it('resolve returns the UUID for a known int', () => {
    const m = new IdMapper();
    const intId = m.intern('uuid-a');
    expect(m.resolve(intId)).toBe('uuid-a');
  });

  it('resolve throws for unknown int (out-of-bounds guard)', () => {
    const m = new IdMapper();
    expect(() => m.resolve(999)).toThrow(/unknown IntId/);
  });

  it('size reports number of interned UUIDs', () => {
    const m = new IdMapper();
    m.intern('a');
    m.intern('b');
    m.intern('a');
    expect(m.size).toBe(2);
  });
});
