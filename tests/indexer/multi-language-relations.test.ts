/**
 * Test cho relation extraction với Python source.
 * Bổ sung cho pass2-e2e.test.ts hiện chỉ test TypeScript.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { Indexer } from '../../src/indexer/indexer.js';

describe('Pass 2: Relation extraction — multi-language', () => {
  it('Python: tạo CALLS edges cho function calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-py-'));
    writeFileSync(
      join(dir, 'main.py'),
      `def greet(name):
    return format_greeting(name)

def format_greeting(name):
    return f"Hello, {name}!"
`,
    );

    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t',?)`).run(dir);
    const indexer = new Indexer(db);
    await indexer.indexRepo('r1', dir);

    const edges = db
      .prepare(
        `SELECT sr.type, s1.name as src, sr.target_name as tgt
         FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = 'r1' AND sr.type = 'CALLS'`,
      )
      .all() as Array<{ type: string; src: string; tgt: string }>;

    const callEdge = edges.find((e) => e.src === 'greet' && e.tgt === 'format_greeting');
    expect(callEdge).toBeDefined();
    db.close();
  });

  it('Python: tạo IMPORTS edges cho import statements', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-py-import-'));
    writeFileSync(join(dir, 'utils.py'), `def helper():\n    pass\n`);
    writeFileSync(
      join(dir, 'main.py'),
      `from utils import helper

def run():
    helper()
`,
    );

    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t',?)`).run(dir);
    const indexer = new Indexer(db);
    await indexer.indexRepo('r1', dir);

    const edges = db
      .prepare(
        `SELECT sr.type, sr.target_name as tgt
         FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = 'r1' AND sr.type = 'IMPORTS'`,
      )
      .all() as Array<{ type: string; tgt: string }>;

    // Should have at least one IMPORTS edge for 'utils' or 'helper'
    expect(edges.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('JavaScript: tạo CALLS và IMPORTS edges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-js-'));
    writeFileSync(
      join(dir, 'helpers.js'),
      `export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }\n`,
    );
    writeFileSync(
      join(dir, 'calc.js'),
      `import { add, multiply } from './helpers';

export function calculate(a, b) {
  return add(a, b) + multiply(a, b);
}
`,
    );

    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t',?)`).run(dir);
    const indexer = new Indexer(db);
    await indexer.indexRepo('r1', dir);

    const edges = db
      .prepare(
        `SELECT sr.type, s1.name as src, sr.target_name as tgt
         FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = 'r1'`,
      )
      .all() as Array<{ type: string; src: string; tgt: string }>;

    // CALLS: calculate → add, calculate → multiply
    const callToAdd = edges.find((e) => e.type === 'CALLS' && e.src === 'calculate' && e.tgt === 'add');
    expect(callToAdd).toBeDefined();

    // IMPORTS edge
    const importEdge = edges.find((e) => e.type === 'IMPORTS');
    expect(importEdge).toBeDefined();

    db.close();
  });
});
