import { describe, it, expect } from 'vitest';

describe('resource handlers', () => {
  it('can be imported without error', async () => {
    const { registerResourceHandlers } = await import('../../src/mcp/resources/index.js');
    expect(typeof registerResourceHandlers).toBe('function');
  });
});
