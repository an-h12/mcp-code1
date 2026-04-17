/**
 * Test cho InMemoryGraph.reloadFile() — incremental update khi file thay đổi.
 * Quan trọng vì Cline sẽ trigger reindex khi user edit code.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';

type Db = ReturnType<typeof openDb>;

function seedForReload(db: Db) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f2','r1','b.ts')`).run();

  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','alpha','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','beta','function',7,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s3','r1','f2','gamma','function',1,5)`,
  ).run();

  // alpha CALLS beta, beta CALLS gamma
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel1','r1','s1','s2','beta','CALLS','typescript',1.0)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
     VALUES ('rel2','r1','s2','s3','gamma','CALLS','typescript',1.0)`,
  ).run();
}

describe('InMemoryGraph.reloadFile', () => {
  let db: Db;
  let graph: InMemoryGraph;

  beforeEach(() => {
    db = openDb(':memory:');
    seedForReload(db);
    graph = new InMemoryGraph(db);
  });

  afterEach(() => {
    graph.stopEviction();
    db.close();
  });

  it('reloadFile cập nhật graph sau khi thêm edge mới trong DB', () => {
    // Load initial graph
    const g1 = graph.getGraph('r1');
    const s3int = g1.mapper.intern('s3');
    const s3node = g1.nodes.get(s3int);
    // gamma ban đầu không gọi ai
    expect(s3node?.outgoing.length ?? 0).toBe(0);

    // Thêm symbol và edge mới trong DB (mô phỏng reindex sau edit)
    db.prepare(
      `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
       VALUES ('s4','r1','f2','delta','function',7,12)`,
    ).run();
    db.prepare(
      `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
       VALUES ('rel3','r1','s3','s4','delta','CALLS','typescript',1.0)`,
    ).run();

    // Reload file f2
    graph.reloadFile('r1', 'f2');

    // Verify graph updated
    const g2 = graph.getGraph('r1');
    const s3int2 = g2.mapper.intern('s3');
    const s3node2 = g2.nodes.get(s3int2);
    expect(s3node2?.outgoing.length).toBe(1);
  });

  it('reloadFile xóa edge cũ khi symbol bị remove', () => {
    // Load initial graph
    const g1 = graph.getGraph('r1');
    const s1int = g1.mapper.intern('s1');
    expect(g1.nodes.get(s1int)?.outgoing.length).toBe(1); // alpha → beta

    // Xóa relation trong DB (mô phỏng symbol đã bị xóa khỏi file)
    db.prepare(`DELETE FROM symbol_relations WHERE id = 'rel1'`).run();

    // Reload file f1
    graph.reloadFile('r1', 'f1');

    const g2 = graph.getGraph('r1');
    const s1int2 = g2.mapper.intern('s1');
    expect(g2.nodes.get(s1int2)?.outgoing.length).toBe(0); // edge đã bị xóa
  });

  it('reloadFile cho file không nằm trong graph — không crash', () => {
    graph.getGraph('r1'); // load initial
    // file f99 không tồn tại
    expect(() => graph.reloadFile('r1', 'f99')).not.toThrow();
  });

  it('reloadFile cho repo chưa load — không crash', () => {
    // Chưa gọi getGraph → cache trống
    expect(() => graph.reloadFile('r1', 'f1')).not.toThrow();
  });
});
