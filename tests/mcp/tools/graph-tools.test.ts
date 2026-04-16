import { describe, it, expect } from 'vitest';
import { openDb } from '../../../src/db/index.js';
import { InMemoryGraph } from '../../../src/graph/in-memory-graph.js';

function seedGraphDb(db: ReturnType<typeof openDb>) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t','/t')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','alpha','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','beta','function',7,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language)
     VALUES ('rel1','r1','s1','s2','beta','CALLS','typescript')`,
  ).run();
}

describe('graph tools — DB integration', () => {
  it('InMemoryGraph loads edges and derives incoming', () => {
    const db = openDb(':memory:');
    seedGraphDb(db);
    const graph = new InMemoryGraph(db);
    const g = graph.getGraph('r1');
    const s1int = g.mapper.intern('s1');
    const s2int = g.mapper.intern('s2');
    expect(g.nodes.get(s1int)?.outgoing.length).toBe(1);
    expect(g.nodes.get(s2int)?.incoming.length).toBe(1);
    db.close();
  });
});
