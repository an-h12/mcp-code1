import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';

describe('migration 002 — symbol_relations', () => {
  it('creates symbol_relations table with all columns', () => {
    const db = openDb(':memory:');
    const cols = db
      .prepare(`PRAGMA table_info(symbol_relations)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('repo_id');
    expect(names).toContain('source_id');
    expect(names).toContain('target_id');
    expect(names).toContain('target_name');
    expect(names).toContain('target_file');
    expect(names).toContain('type');
    expect(names).toContain('language');
    expect(names).toContain('confidence');
    expect(names).toContain('created_at');
    db.close();
  });

  it('creates all 4 indexes', () => {
    const db = openDb(':memory:');
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='symbol_relations'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_relations_source');
    expect(names).toContain('idx_relations_target');
    expect(names).toContain('idx_relations_repo');
    expect(names).toContain('idx_relations_repo_type');
    db.close();
  });

  it('enforces ON DELETE CASCADE from repos', () => {
    const db = openDb(':memory:');

    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
    db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
    db.prepare(
      `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
       VALUES ('s1','r1','f1','foo','function',1,5)`,
    ).run();
    db.prepare(
      `INSERT INTO symbol_relations(id, repo_id, source_id, target_name, type, language)
       VALUES ('rel1','r1','s1','bar','CALLS','typescript')`,
    ).run();

    db.prepare(`DELETE FROM repos WHERE id='r1'`).run();
    const remaining = db.prepare(`SELECT COUNT(*) as c FROM symbol_relations`).get() as { c: number };
    expect(remaining.c).toBe(0);
    db.close();
  });

  it('stores default confidence=1.0', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','test','/test')`).run();
    db.prepare(`INSERT INTO files(id, repo_id, rel_path) VALUES ('f1','r1','a.ts')`).run();
    db.prepare(
      `INSERT INTO symbols(id, repo_id, file_id, name, kind, start_line, end_line)
       VALUES ('s1','r1','f1','foo','function',1,5)`,
    ).run();
    db.prepare(
      `INSERT INTO symbol_relations(id, repo_id, source_id, target_name, type, language)
       VALUES ('rel1','r1','s1','bar','CALLS','typescript')`,
    ).run();
    const row = db.prepare(`SELECT confidence FROM symbol_relations WHERE id='rel1'`).get() as {
      confidence: number;
    };
    expect(row.confidence).toBe(1.0);
    db.close();
  });
});
