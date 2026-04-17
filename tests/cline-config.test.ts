/**
 * Test Cline config validation — mô phỏng các env combinations mà Cline sẽ truyền.
 *
 * Kịch bản thực tế: User paste config vào cline_mcp_settings.json, Cline spawn
 * process với env từ "env" block. Server phải xử lý đúng mọi trường hợp:
 *  - Có/không có AI_API_KEY (user dùng local LLM với token)
 *  - REPO_ROOT valid / invalid / missing
 *  - Optional vars với empty string
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Cline config validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env trước mỗi test
    for (const key of ['DB_PATH', 'LOG_LEVEL', 'AI_API_KEY', 'AI_API_BASE_URL', 'AI_MODEL', 'REPO_ROOT']) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ─── Required env vars ────────────────────────────────────────
  describe('DB_PATH (required)', () => {
    it('throw khi DB_PATH là empty string (Cline set "" accidentally)', async () => {
      process.env['DB_PATH'] = '';
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig()).toThrow();
    });

    it('accept DB_PATH dạng absolute Windows path', async () => {
      process.env['DB_PATH'] = 'E:\\mcp-data\\db.sqlite';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.dbPath).toBe('E:\\mcp-data\\db.sqlite');
    });

    it('accept DB_PATH dạng absolute Unix path', async () => {
      process.env['DB_PATH'] = '/var/lib/mcp/db.sqlite';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.dbPath).toBe('/var/lib/mcp/db.sqlite');
    });

    it('accept DB_PATH dạng relative', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.dbPath).toBe('./data/db.sqlite');
    });

    it('throw khi DB_PATH bị override thành empty', async () => {
      process.env['DB_PATH'] = '';
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig()).toThrow();
    });
  });

  // ─── Kịch bản thực tế: User paste token vào Cline ────────────
  describe('AI config (user paste token vào Cline)', () => {
    it('chỉ có AI_API_KEY, không có BASE_URL → vẫn load được', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['AI_API_KEY'] = 'sk-local-abc123';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.aiApiKey).toBe('sk-local-abc123');
      expect(cfg.aiApiBaseUrl).toBe(''); // empty default
    });

    it('có cả KEY + BASE_URL + MODEL', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['AI_API_KEY'] = 'sk-xxx';
      process.env['AI_API_BASE_URL'] = 'http://localhost:11434/v1';
      process.env['AI_MODEL'] = 'qwen2.5-coder';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.aiApiKey).toBe('sk-xxx');
      expect(cfg.aiApiBaseUrl).toBe('http://localhost:11434/v1');
      expect(cfg.aiModel).toBe('qwen2.5-coder');
    });

    it('không có AI_* → explain_symbol fallback (không crash)', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.aiApiKey).toBe('');
      // aiConfig sẽ được tạo null trong App → explain_symbol fallback về raw metadata
    });

    it('AI_MODEL empty string fallback về qwen2.5-coder default', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['AI_MODEL'] = '';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.aiModel).toBe('qwen2.5-coder');
    });
  });

  // ─── LOG_LEVEL validation ─────────────────────────────────────
  describe('LOG_LEVEL', () => {
    it('default là "info" khi Cline không set', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.logLevel).toBe('info');
    });

    it('accept các level hợp lệ', async () => {
      const valid = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      for (const level of valid) {
        process.env['DB_PATH'] = './data/db.sqlite';
        process.env['LOG_LEVEL'] = level;
        const { loadConfig } = await import('../src/config.js');
        const cfg = loadConfig();
        expect(cfg.logLevel).toBe(level);
      }
    });

    it('throw cho LOG_LEVEL không hợp lệ', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['LOG_LEVEL'] = 'verbose';
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig()).toThrow();
    });
  });

  // ─── Port validation (cho Web UI future) ──────────────────────
  describe('MCP_PORT / UI_PORT', () => {
    it('MCP_PORT default 3000', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.mcpPort).toBe(3000);
    });

    it('coerce MCP_PORT từ string → number', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['MCP_PORT'] = '4000';
      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.mcpPort).toBe(4000);
    });

    it('throw cho port ngoài range (<1024)', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['MCP_PORT'] = '80';
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig()).toThrow();
    });

    it('throw cho port > 65535', async () => {
      process.env['DB_PATH'] = './data/db.sqlite';
      process.env['MCP_PORT'] = '99999';
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig()).toThrow();
    });
  });

  // ─── Cline config fixture (real-world format) ─────────────────
  describe('Mô phỏng cline_mcp_settings.json', () => {
    it('config minimal (chỉ DB_PATH + REPO_ROOT) load được', async () => {
      // Cline truyền env này khi spawn process
      const clineEnv = {
        DB_PATH: 'E:/mcp-data/mcp-code1.db',
        REPO_ROOT: 'E:/Code/my-project',
      };
      Object.assign(process.env, clineEnv);

      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.dbPath).toBe('E:/mcp-data/mcp-code1.db');
    });

    it('config production full (Cline + local LLM token)', async () => {
      const clineEnv = {
        DB_PATH: 'E:/mcp-data/mcp-code1.db',
        REPO_ROOT: 'E:/Code/my-project',
        LOG_LEVEL: 'info',
        AI_API_KEY: 'sk-user-provided-token',
        AI_API_BASE_URL: 'http://localhost:11434/v1',
        AI_MODEL: 'qwen2.5-coder:7b',
      };
      Object.assign(process.env, clineEnv);

      const { loadConfig } = await import('../src/config.js');
      const cfg = loadConfig();
      expect(cfg.dbPath).toBe('E:/mcp-data/mcp-code1.db');
      expect(cfg.aiApiKey).toBe('sk-user-provided-token');
      expect(cfg.aiApiBaseUrl).toBe('http://localhost:11434/v1');
    });
  });
});
