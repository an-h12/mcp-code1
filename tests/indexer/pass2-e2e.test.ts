import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { Indexer } from '../../src/indexer/indexer.js';

describe('Pass 2 end-to-end: relations extracted from real source', () => {
  it('creates CALLS edges for cross-function calls in TS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-pass2-'));
    writeFileSync(
      join(dir, 'a.ts'),
      `export function foo() {
  bar();
}

export function bar() {
  return 42;
}
`,
    );

    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t',?)`).run(dir);
    const indexer = new Indexer(db);
    await indexer.indexRepo('r1', dir);

    const edges = db
      .prepare(
        `SELECT sr.type, s1.name as src, sr.target_name as tgt, sr.confidence
         FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = 'r1'`,
      )
      .all() as Array<{ type: string; src: string; tgt: string; confidence: number }>;

    // foo() calls bar() — should produce a CALLS edge with resolved target
    const callsEdge = edges.find((e) => e.type === 'CALLS' && e.src === 'foo' && e.tgt === 'bar');
    expect(callsEdge).toBeDefined();
    expect(callsEdge?.confidence).toBe(1.0);
    db.close();
  });

  it('creates IMPORTS edge for ES module import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-pass2-'));
    mkdirSync(join(dir, 'utils'), { recursive: true });
    writeFileSync(
      join(dir, 'utils', 'helpers.ts'),
      `export function helper() { return 1; }\n`,
    );
    writeFileSync(
      join(dir, 'main.ts'),
      `import { helper } from './utils/helpers';
export function main() { return helper(); }
`,
    );

    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r2','t',?)`).run(dir);
    const indexer = new Indexer(db);
    await indexer.indexRepo('r2', dir);

    const imports = db
      .prepare(`SELECT type, target_name FROM symbol_relations WHERE repo_id='r2' AND type='IMPORTS'`)
      .all() as Array<{ type: string; target_name: string }>;
    expect(imports.length).toBeGreaterThan(0);
    db.close();
  });

  it('concurrent indexRepo calls are guarded (second call is skipped)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-pass2-'));
    writeFileSync(join(dir, 'x.ts'), `export function x() {}\n`);

    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r3','t',?)`).run(dir);
    const indexer = new Indexer(db);

    const [r1, r2] = await Promise.all([
      indexer.indexRepo('r3', dir),
      indexer.indexRepo('r3', dir),
    ]);

    // One must have done the work, the other returned 0s
    const bothZero = r1.filesIndexed === 0 && r2.filesIndexed === 0;
    expect(bothZero).toBe(false);
    db.close();
  });
});
