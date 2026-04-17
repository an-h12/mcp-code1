/**
 * Unit tests cho get_import_chain tool.
 * Tool này giúp Cline hiểu dependency chain của một file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';
import { getImportChain } from '../../../src/mcp/tools/get-import-chain.js';

type Db = ReturnType<typeof openDb>;

function seedImportGraph(db: Db) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','app.ts')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f2','r1','service.ts')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f3','r1','utils.ts')`).run();

  // Symbols in each file
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','App','class',1,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f2','Service','class',1,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s3','r1','f3','helper','function',1,5)`,
  ).run();

  // app.ts IMPORTS service.ts, service.ts IMPORTS utils.ts
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel1','r1','s1','s2','Service','IMPORTS','typescript',1.0)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel2','r1','s2','s3','helper','IMPORTS','typescript',1.0)`,
  ).run();
}

describe('getImportChain', () => {
  let db: Db;
  let graph: InMemoryGraph;

  beforeEach(() => {
    db = openDb(':memory:');
    seedImportGraph(db);
    graph = new InMemoryGraph(db);
  });

  afterEach(() => {
    graph.stopEviction();
    db.close();
  });

  it('trả về chain từ app.ts → service.ts → utils.ts', () => {
    const result = getImportChain(db, graph, 'r1', 'app.ts', 3);
    expect(result).not.toBeNull();
    expect(result!.resolvedAs).toBe('app.ts');
    expect(result!.chain.length).toBeGreaterThanOrEqual(1);

    // Hop 1: app.ts imports service.ts
    const hop1 = result!.chain.find((c) => c.file === 'app.ts');
    expect(hop1).toBeDefined();
    expect(hop1!.imports).toContain('service.ts');

    // Hop 2: service.ts imports utils.ts
    const hop2 = result!.chain.find((c) => c.file === 'service.ts');
    expect(hop2).toBeDefined();
    expect(hop2!.imports).toContain('utils.ts');
  });

  it('depth=1 chỉ trả về import trực tiếp', () => {
    const result = getImportChain(db, graph, 'r1', 'app.ts', 1);
    expect(result).not.toBeNull();
    // Chỉ hop đầu tiên
    expect(result!.chain.length).toBe(1);
    expect(result!.chain[0]!.file).toBe('app.ts');
    expect(result!.chain[0]!.imports).toContain('service.ts');
  });

  it('file leaf (utils.ts) không import gì → chain trống', () => {
    const result = getImportChain(db, graph, 'r1', 'utils.ts', 3);
    expect(result).not.toBeNull();
    expect(result!.chain.length).toBe(0); // không import gì
  });

  it('trả về null cho file không tồn tại', () => {
    const result = getImportChain(db, graph, 'r1', 'nonexistent.ts', 3);
    expect(result).toBeNull();
  });
});
