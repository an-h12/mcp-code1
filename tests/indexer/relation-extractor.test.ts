import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { ModuleMap } from '../../src/indexer/module-map.js';
import { RelationExtractor } from '../../src/indexer/relation-extractor.js';

function seed(db: ReturnType<typeof openDb>) {
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
  db.prepare(`INSERT INTO files(id, repo_id, rel_path, language) VALUES ('f1','r1','a.ts','typescript')`).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s1','r1','f1','foo','function',1,5)`,
  ).run();
  db.prepare(
    `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
     VALUES ('s2','r1','f1','bar','function',7,10)`,
  ).run();
}

describe('RelationExtractor', () => {
  it('skips unsupported file extension', () => {
    const db = openDb(':memory:');
    seed(db);
    const mm = new ModuleMap();
    const re = new RelationExtractor(db);
    const count = re.extractAndPersist('r1', '/test/data.json', 'data.json', 'f1', mm);
    expect(count).toBe(0);
    db.close();
  });

  it('inserts resolved edge (confidence=1.0, target_id set)', () => {
    const db = openDb(':memory:');
    seed(db);

    const re = new RelationExtractor(db);
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'bar', targetId: 's2', type: 'CALLS', language: 'typescript' },
    ]);

    const row = db
      .prepare(`SELECT * FROM symbol_relations WHERE source_id='s1'`)
      .get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['target_id']).toBe('s2');
    expect(row['confidence']).toBe(1.0);
    expect(row['type']).toBe('CALLS');
    db.close();
  });

  it('inserts unresolved edge (confidence=0.7, target_id null)', () => {
    const db = openDb(':memory:');
    seed(db);

    const re = new RelationExtractor(db);
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'external', targetId: null, type: 'CALLS', language: 'typescript' },
    ]);

    const row = db
      .prepare(`SELECT * FROM symbol_relations WHERE source_id='s1'`)
      .get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['target_id']).toBeNull();
    expect(row['confidence']).toBe(0.7);
    db.close();
  });

  it('DELETE+INSERT is atomic — re-run replaces old edges', () => {
    const db = openDb(':memory:');
    seed(db);

    const re = new RelationExtractor(db);
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'bar', targetId: 's2', type: 'CALLS', language: 'typescript' },
    ]);
    re._insertEdgesForTest('r1', 'f1', [
      { sourceId: 's1', targetName: 'bar', targetId: 's2', type: 'CALLS', language: 'typescript' },
      { sourceId: 's2', targetName: 'foo', targetId: 's1', type: 'CALLS', language: 'typescript' },
    ]);

    const count = db
      .prepare(`SELECT COUNT(*) as c FROM symbol_relations WHERE repo_id='r1'`)
      .get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });
});
