/**
 * Test cho explainSymbol với AI adapter mock.
 * Mô phỏng kịch bản: user cấu hình local LLM (Ollama/LM Studio) qua OpenAI-compatible API.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { RepoRegistry } from '../../../src/registry.js';
import { randomUUID } from 'node:crypto';
import type { AiAdapter } from '../../../src/mcp/ai-adapter.js';

type Db = ReturnType<typeof openDb>;

function seedSymbol(db: Db, repoId: string) {
  const fileId = randomUUID();
  const symId = randomUUID();
  db.prepare(
    `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash)
     VALUES (?, ?, 'auth.ts', 'typescript', 500, 'abc')`,
  ).run(fileId, repoId);
  db.prepare(
    `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature, doc_comment)
     VALUES (?, ?, ?, 'validateToken', 'function', 10, 25, 'function validateToken(token: string): boolean', 'Validates JWT token')`,
  ).run(symId, repoId, fileId);
  return symId;
}

describe('explainSymbol', () => {
  let db: Db;
  let registry: RepoRegistry;

  beforeEach(() => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
  });

  afterEach(() => db.close());

  it('trả về AI explanation khi adapter có sẵn', async () => {
    const { explainSymbol } = await import('../../../src/mcp/tools/explain-symbol.js');
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    const symId = seedSymbol(db, repo.id);

    const mockAi: AiAdapter = {
      explain: vi.fn().mockResolvedValue('This function validates JWT tokens by checking the signature and expiry.'),
    };

    const text = await explainSymbol(db, symId, mockAi);
    expect(text).toContain('validates JWT tokens');
    expect(mockAi.explain).toHaveBeenCalledOnce();
  });

  it('truyền context và question đúng cho AI adapter', async () => {
    const { explainSymbol } = await import('../../../src/mcp/tools/explain-symbol.js');
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    const symId = seedSymbol(db, repo.id);

    const mockAi: AiAdapter = {
      explain: vi.fn().mockResolvedValue('mock response'),
    };

    await explainSymbol(db, symId, mockAi);

    const [context, question] = (mockAi.explain as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(context).toContain('validateToken');
    expect(context).toContain('function');
    expect(typeof question).toBe('string');
  });

  it('throw khi AI adapter gặp lỗi (caller phải catch)', async () => {
    const { explainSymbol } = await import('../../../src/mcp/tools/explain-symbol.js');
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    const symId = seedSymbol(db, repo.id);

    const failingAi: AiAdapter = {
      explain: vi.fn().mockRejectedValue(new Error('API timeout')),
    };

    // explainSymbol không catch AI error — MCP tool handler switch/catch sẽ bắt
    await expect(explainSymbol(db, symId, failingAi)).rejects.toThrow('API timeout');
  });

  it('trả về fallback khi adapter là null', async () => {
    const { explainSymbol } = await import('../../../src/mcp/tools/explain-symbol.js');
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    const symId = seedSymbol(db, repo.id);

    const text = await explainSymbol(db, symId, null);
    expect(text).toContain('validateToken');
    expect(text).toContain('function');
  });

  it('trả về "Symbol not found." cho symbol_id không tồn tại', async () => {
    const { explainSymbol } = await import('../../../src/mcp/tools/explain-symbol.js');
    registry.register({ name: 'r', rootPath: '/r' });

    const text = await explainSymbol(db, 'nonexistent-id', null);
    expect(text).toBe('Symbol not found.');
  });
});
