import { describe, it, expect, afterEach } from 'vitest';

describe('loadConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it('returns defaults when optional vars are absent', async () => {
    process.env['DB_PATH'] = './test.db';
    process.env['LOG_LEVEL'] = 'info';
    process.env['MCP_PORT'] = '3000';
    process.env['UI_PORT'] = '3001';
    process.env['AI_API_KEY'] = '';
    process.env['AI_API_BASE_URL'] = '';
    process.env['AI_MODEL'] = '';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.dbPath).toBe('./test.db');
    expect(config.mcpPort).toBe(3000);
    expect(config.uiPort).toBe(3001);
    expect(config.aiModel).toBe('gpt-4o-mini');
  });

  it('throws when DB_PATH is missing', async () => {
    delete process.env['DB_PATH'];
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow();
  });
});
