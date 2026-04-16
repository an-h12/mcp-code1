import { describe, it, expect, vi, afterEach } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';

function seedGraph(db: ReturnType<typeof openDb>) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t','/t')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','foo','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','bar','function',7,10)`,
  ).run();
  db.prepare(
    `INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language)
     VALUES ('rel1','r1','s1','s2','bar','CALLS','typescript')`,
  ).run();
}

describe('InMemoryGraph', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getGraph loads from DB on first access', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const graph = g.getGraph('r1');
    expect(graph.nodes.size).toBeGreaterThan(0);
    const s1int = graph.mapper.intern('s1');
    const node = graph.nodes.get(s1int);
    expect(node?.outgoing.length).toBe(1);
    db.close();
  });

  it('getGraph caches — second call returns same object reference', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const g1 = g.getGraph('r1');
    const g2 = g.getGraph('r1');
    expect(g1).toBe(g2);
    db.close();
  });

  it('invalidate removes cached graph — next getGraph reloads', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const g1 = g.getGraph('r1');
    g.invalidate('r1');
    const g2 = g.getGraph('r1');
    expect(g1).not.toBe(g2);
    db.close();
  });

  it('getGraph returns fresh empty graph when scan in progress', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    g.setScanInProgress('r1', true);
    const graph = g.getGraph('r1');
    expect(graph.nodes.size).toBe(0);
    const graph2 = g.getGraph('r1');
    expect(graph).not.toBe(graph2);
    db.close();
  });

  it('derived incoming edges are set at load time', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    const graph = g.getGraph('r1');
    const s2int = graph.mapper.intern('s2');
    const node = graph.nodes.get(s2int);
    expect(node?.incoming.length).toBe(1);
    db.close();
  });

  it('evictStale removes graphs idle beyond TTL', () => {
    const db = openDb(':memory:');
    seedGraph(db);
    const g = new InMemoryGraph(db);
    g.getGraph('r1');

    // Manually set lastAccess to past to trigger eviction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (g as any).lastAccess.set('r1', Date.now() - 31 * 60 * 1000);
    g.evictStale();

    const graph = g.getGraph('r1');
    expect(graph.nodes.size).toBeGreaterThan(0);
    db.close();
  });
});
