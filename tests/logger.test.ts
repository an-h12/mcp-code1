import { describe, it, expect } from 'vitest';

describe('createLogger', () => {
  it('returns a pino logger with the given level', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger('warn');
    expect(log.level).toBe('warn');
  });

  it('returns a logger with child() method', async () => {
    const { createLogger } = await import('../src/logger.js');
    const log = createLogger('info');
    const child = log.child({ component: 'test' });
    expect(typeof child.info).toBe('function');
  });
});
