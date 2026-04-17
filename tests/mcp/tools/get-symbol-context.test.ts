/**
 * Unit tests cho get_symbol_context tool.
 * Tool này được Cline dùng nhiều nhất để hiểu impact khi sửa code.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';
import { getSymbolContext } from '../../../src/mcp/tools/get-symbol-context.js';

type Db = ReturnType<typeof openDb>;

function seedCallGraph(db: Db) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f2','r1','b.ts')`).run();

  // Symbols: main → helper → utils
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','main','function',1,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','helper','function',12,20)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s3','r1','f2','utils','function',1,5)`,
  ).run();

  // main CALLS helper, helper CALLS utils
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel1','r1','s1','s2','helper','CALLS','typescript',1.0)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel2','r1','s2','s3','utils','CALLS','typescript',1.0)`,
  ).run();
}

describe('getSymbolContext', () => {
  let db: Db;
  let graph: InMemoryGraph;

  beforeEach(() => {
    db = openDb(':memory:');
    seedCallGraph(db);
    graph = new InMemoryGraph(db);
  });

  afterEach(() => {
    graph.stopEviction();
    db.close();
  });

  it('trả về callers và callees cho symbol ở giữa chain', () => {
    const result = getSymbolContext(db, graph, 'r1', 'helper', 2);
    expect(result).not.toBeNull();
    expect(result!.symbol.name).toBe('helper');
    expect(result!.symbol.kind).toBe('function');

    // helper bị gọi bởi main (1 caller)
    expect(result!.callers.length).toBe(1);
    expect(result!.callers[0]!.name).toBe('main');

    // helper gọi utils (1 callee)
    expect(result!.callees.length).toBe(1);
    expect(result!.callees[0]!.name).toBe('utils');

    expect(result!.blastRadius).toBe(1);
    expect(result!.impactCount).toBe(2);
  });

  it('symbol đầu chain không có callers', () => {
    const result = getSymbolContext(db, graph, 'r1', 'main', 2);
    expect(result).not.toBeNull();
    expect(result!.callers.length).toBe(0);
    expect(result!.callees.length).toBeGreaterThanOrEqual(1);
    expect(result!.blastRadius).toBe(0);
  });

  it('symbol cuối chain không có callees', () => {
    const result = getSymbolContext(db, graph, 'r1', 'utils', 2);
    expect(result).not.toBeNull();
    expect(result!.callees.length).toBe(0);
    expect(result!.callers.length).toBeGreaterThanOrEqual(1);
  });

  it('depth=1 chỉ trả về direct callers/callees', () => {
    const result = getSymbolContext(db, graph, 'r1', 'helper', 1);
    expect(result).not.toBeNull();
    // Depth 1: chỉ trực tiếp
    expect(result!.callers.every((c) => c.depth === 1)).toBe(true);
    expect(result!.callees.every((c) => c.depth === 1)).toBe(true);
  });

  it('trả về null cho symbol không tồn tại', () => {
    const result = getSymbolContext(db, graph, 'r1', 'nonexistent', 2);
    expect(result).toBeNull();
  });

  it('trả về empty khi scan đang chạy', () => {
    graph.setScanInProgress('r1', true);
    const result = getSymbolContext(db, graph, 'r1', 'helper', 2);
    // Khi scan in progress, graph trả về empty → BFS trả về empty arrays
    // nhưng symbol vẫn tìm thấy trong DB
    expect(result).not.toBeNull();
    expect(result!.callers.length).toBe(0);
    expect(result!.callees.length).toBe(0);
    graph.setScanInProgress('r1', false);
  });
});
