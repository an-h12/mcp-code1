/**
 * Live LLM integration test — gọi thật endpoint OpenAI-compatible.
 *
 * TỰ SKIP khi không có env vars (default behavior).
 *
 * Để chạy test này:
 *   export AI_API_KEY="sk-your-token"
 *   export AI_API_BASE_URL="http://localhost:11434/v1"   # Ollama
 *   # hoặc "http://localhost:1234/v1"                    # LM Studio
 *   export AI_MODEL="qwen2.5-coder:7b"                   # optional
 *   npm test -- tests/live-llm.test.ts
 *
 * Nếu Cline của bạn chỉ cung cấp API token (không có baseUrl), hãy hỏi
 * admin / provider của token đó để biết endpoint OpenAI-compatible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb } from '../src/db/index.js';
import { RepoRegistry } from '../src/registry.js';
import { createAiAdapter } from '../src/mcp/ai-adapter.js';
import { randomUUID } from 'node:crypto';

type Db = ReturnType<typeof openDb>;

const HAS_LIVE_LLM = !!process.env['AI_API_KEY'];
const describeLive = HAS_LIVE_LLM ? describe : describe.skip;

describeLive('Live LLM integration (AI_API_KEY set)', () => {
  let db: Db;
  let symbolId: string;

  beforeAll(() => {
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'live-test', rootPath: '/tmp/live-test' });
    const fileId = randomUUID();
    symbolId = randomUUID();

    db.prepare(
      `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash)
       VALUES (?, ?, 'auth.ts', 'typescript', 500, 'abc')`,
    ).run(fileId, repo.id);

    db.prepare(
      `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature, doc_comment)
       VALUES (?, ?, ?, 'validateToken', 'function', 10, 25,
               'function validateToken(token: string): boolean',
               'Validates JWT token signature and expiry')`,
    ).run(symbolId, repo.id, fileId);
  });

  it('createAiAdapter trả về adapter khi có API key', () => {
    const adapter = createAiAdapter({
      apiKey: process.env['AI_API_KEY']!,
      baseUrl: process.env['AI_API_BASE_URL'] ?? '',
      model: process.env['AI_MODEL'] ?? 'gpt-4o-mini',
    });
    expect(adapter).not.toBeNull();
    expect(typeof adapter!.explain).toBe('function');
  });

  it('explain() gọi endpoint thật và trả text non-empty', async () => {
    const adapter = createAiAdapter({
      apiKey: process.env['AI_API_KEY']!,
      baseUrl: process.env['AI_API_BASE_URL'] ?? '',
      model: process.env['AI_MODEL'] ?? 'gpt-4o-mini',
    });
    expect(adapter).not.toBeNull();

    const text = await adapter!.explain(
      'Name: validateToken\nKind: function\nSignature: function validateToken(token: string): boolean\nDoc: Validates JWT token',
      'What does validateToken do?',
    );

    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // LLM response thường đề cập đến JWT / token / validate
    expect(text.toLowerCase()).toMatch(/token|validate|jwt|function/);
  }, 30_000);

  it('explain_symbol end-to-end với live LLM', async () => {
    const { explainSymbol } = await import('../src/mcp/tools/explain-symbol.js');
    const adapter = createAiAdapter({
      apiKey: process.env['AI_API_KEY']!,
      baseUrl: process.env['AI_API_BASE_URL'] ?? '',
      model: process.env['AI_MODEL'] ?? 'gpt-4o-mini',
    });

    const text = await explainSymbol(db, symbolId, adapter);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(20);
  }, 30_000);

  it('không crash khi prompt rất dài (test context limit)', async () => {
    const adapter = createAiAdapter({
      apiKey: process.env['AI_API_KEY']!,
      baseUrl: process.env['AI_API_BASE_URL'] ?? '',
      model: process.env['AI_MODEL'] ?? 'gpt-4o-mini',
    });

    const longContext = 'class Foo { method() {} }\n'.repeat(100);
    try {
      const text = await adapter!.explain(longContext, 'Summarize this class.');
      expect(typeof text).toBe('string');
    } catch (e) {
      // Một số model reject nếu vượt context — nhưng không được crash Node process
      expect(e).toBeDefined();
    }
  }, 30_000);
});

describe('Live LLM — fallback khi không có key', () => {
  it('createAiAdapter trả null khi apiKey rỗng', () => {
    const adapter = createAiAdapter({ apiKey: '', baseUrl: '', model: 'anything' });
    expect(adapter).toBeNull();
  });

  it('thông báo cho user khi thiếu AI_API_KEY', () => {
    if (!HAS_LIVE_LLM) {
      console.log(
        '\n  ℹ️  Live LLM tests SKIPPED — để chạy, set AI_API_KEY (và AI_API_BASE_URL nếu có)\n' +
        '     Ví dụ Ollama: AI_API_BASE_URL=http://localhost:11434/v1\n' +
        '     Ví dụ LM Studio: AI_API_BASE_URL=http://localhost:1234/v1\n',
      );
    }
    // Test này chỉ để log hint — luôn pass
    expect(true).toBe(true);
  });
});
