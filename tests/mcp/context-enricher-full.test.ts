/**
 * Unit tests cho ContextEnricher — component giúp enrich message
 * của user với context từ code graph trước khi gửi cho AI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import { ContextEnricher } from '../../src/mcp/context-enricher.js';

type Db = ReturnType<typeof openDb>;

function seedEnricherDb(db: Db) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','auth.ts')`).run();

  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line, signature)
     VALUES ('s1','r1','f1','AuthService','class',1,50,'class AuthService')`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line, signature)
     VALUES ('s2','r1','f1','validateToken','function',52,60,'function validateToken()')`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line, signature)
     VALUES ('s3','r1','f1','hashPassword','function',62,70,'function hashPassword()')`,
  ).run();

  // AuthService CALLS validateToken, validateToken CALLS hashPassword
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel1','r1','s1','s2','validateToken','CALLS','typescript',1.0)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel2','r1','s2','s3','hashPassword','CALLS','typescript',1.0)`,
  ).run();
}

describe('ContextEnricher', () => {
  let db: Db;
  let graph: InMemoryGraph;
  let enricher: ContextEnricher;

  beforeEach(() => {
    db = openDb(':memory:');
    seedEnricherDb(db);
    graph = new InMemoryGraph(db);
    enricher = new ContextEnricher('r1', db, graph);
  });

  afterEach(() => {
    graph.stopEviction();
    db.close();
  });

  // ─── extractMentions ─────────────────────────────────────────
  it('extractMentions tìm backtick-quoted symbols', () => {
    const mentions = enricher.extractMentions('Tôi muốn sửa `AuthService` và `validateToken`');
    expect(mentions).toContain('AuthService');
    expect(mentions).toContain('validateToken');
  });

  it('extractMentions tìm PascalCase symbols', () => {
    const mentions = enricher.extractMentions('AuthService có vấn đề gì?');
    expect(mentions).toContain('AuthService');
  });

  it('extractMentions giới hạn 5 symbols', () => {
    const msg = '`a` `b` `c` `d` `e` `f` `g`';
    const mentions = enricher.extractMentions(msg);
    expect(mentions.length).toBeLessThanOrEqual(5);
  });

  it('extractMentions loại bỏ URL và email', () => {
    const mentions = enricher.extractMentions(
      'Xem https://AuthService.com và user@AuthService.com nhé',
    );
    // AuthService ở trong URL/email nên không nên match
    expect(mentions).not.toContain('AuthService.com');
  });

  it('extractMentions dedup', () => {
    const mentions = enricher.extractMentions('`AuthService` rồi lại `AuthService`');
    const unique = [...new Set(mentions)];
    expect(mentions.length).toBe(unique.length);
  });

  // ─── enrich (full pipeline) ──────────────────────────────────
  it('enrich trả về context đúng khi mention symbol có trong DB', async () => {
    const result = await enricher.enrich('Giải thích `AuthService` cho tôi');
    expect(result.symbolCount).toBeGreaterThanOrEqual(1);
    expect(result.enrichedPrompt).toContain('AuthService');
    expect(result.enrichedPrompt).toContain('Code Context');
  });

  it('enrich trả về message gốc khi không tìm thấy symbol nào', async () => {
    const msg = 'something random without code symbols';
    const result = await enricher.enrich(msg);
    expect(result.enrichedPrompt).toContain(msg);
    expect(result.symbolCount).toBe(0);
  });

  // ─── assembleContext ─────────────────────────────────────────
  it('assembleContext thêm impact warning khi ≥10 connections', () => {
    // Tạo symbol context giả với nhiều callers
    const manyCallers = Array.from({ length: 12 }, (_, i) => ({
      symbolId: `c${i}`,
      name: `caller${i}`,
      depth: 1,
      via: 'CALLS' as const,
    }));

    const ctx = {
      symbolUuid: 's1',
      name: 'AuthService',
      kind: 'class',
      filePath: 'auth.ts',
      line: 1,
      callers: manyCallers,
      callees: [],
    };

    const result = enricher.assembleContext([ctx], 'test message');
    expect(result.enrichedPrompt).toContain('Impact warning');
  });
});
