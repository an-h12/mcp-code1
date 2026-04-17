/**
 * C# end-to-end indexer tests. Exercises the full walk → indexFile → pass 2
 * pipeline for .cs sources. Complements:
 *  - tests/parser/csharp.test.ts (symbol extraction only)
 *  - tests/indexer/relations-csharp.test.ts (relation edges only)
 *
 * Focus: bugs that are specific to C# flowing through the indexer:
 *  - .cs files discovered by walk()
 *  - C# ignore patterns (obj/, bin/, AssemblyInfo.cs, *.g.cs, etc.)
 *  - hash-based skip on re-scan
 *  - orphan cleanup when a .cs file is deleted
 *  - EXTRACTOR_VERSION invalidation forces re-parse
 *  - extractor_version column persists after upsert
 */
import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';

function seedCsRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-e2e-'));
  writeFileSync(
    join(dir, 'Animal.cs'),
    `namespace Zoo;
public class Animal { public virtual void Speak() { } }
public class Dog : Animal { public override void Speak() { } }
`,
  );
  mkdirSync(join(dir, 'Services'));
  writeFileSync(
    join(dir, 'Services', 'Logger.cs'),
    `namespace Zoo.Services;
public class Logger { public void Info(string s) { } }
`,
  );
  return dir;
}

describe('C# indexer — end-to-end', () => {
  it('walks and indexes .cs files (filesIndexed reflects .cs count)', async () => {
    const dir = seedCsRepo();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repo.id, dir);
    expect(result.filesIndexed).toBe(2);
    expect(result.symbolsAdded).toBeGreaterThanOrEqual(4); // Animal, Dog, Speak(x2), Logger, Info...
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips C# generated / auto-generated files by name+suffix', async () => {
    const dir = seedCsRepo();
    // These should be ignored per CS_IGNORE_NAMES / CS_IGNORE_SUFFIXES in Indexer
    writeFileSync(
      join(dir, 'AssemblyInfo.cs'),
      `[assembly: System.Reflection.AssemblyTitle("x")]`,
    );
    writeFileSync(join(dir, 'Views.g.cs'), `public class Generated { }`);
    writeFileSync(
      join(dir, 'Form.Designer.cs'),
      `public partial class Form { }`,
    );
    writeFileSync(
      join(dir, 'Thing.generated.cs'),
      `public class Thing { }`,
    );
    writeFileSync(
      join(dir, 'GlobalUsings.g.cs'),
      `global using System;`,
    );

    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repo.id, dir);
    // Only the 2 real files — all 5 generated ones ignored.
    expect(result.filesIndexed).toBe(2);

    const rows = db
      .prepare(`SELECT rel_path FROM files WHERE repo_id = ?`)
      .all(repo.id) as Array<{ rel_path: string }>;
    for (const r of rows) {
      expect(r.rel_path).not.toContain('AssemblyInfo.cs');
      expect(r.rel_path).not.toMatch(/\.g\.cs$/);
      expect(r.rel_path).not.toMatch(/\.Designer\.cs$/);
      expect(r.rel_path).not.toMatch(/\.generated\.cs$/);
    }
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips obj/ and bin/ directories (NuGet / build output)', async () => {
    const dir = seedCsRepo();
    mkdirSync(join(dir, 'obj'));
    writeFileSync(
      join(dir, 'obj', 'NetCore.AssemblyAttributes.cs'),
      `public class Attr { }`,
    );
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'BuildOutput.cs'), `public class B { }`);
    mkdirSync(join(dir, '.vs'));
    writeFileSync(join(dir, '.vs', 'stuff.cs'), `public class S { }`);

    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    const result = await indexer.indexRepo(repo.id, dir);
    expect(result.filesIndexed).toBe(2);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('second scan skips unchanged .cs files (hash cache hit)', async () => {
    const dir = seedCsRepo();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);

    await indexer.indexRepo(repo.id, dir);
    const second = await indexer.indexRepo(repo.id, dir);
    expect(second.filesSkipped).toBe(2);
    expect(second.filesIndexed).toBe(0);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('changed .cs content triggers re-parse and symbol replacement', async () => {
    const dir = seedCsRepo();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    await indexer.indexRepo(repo.id, dir);

    writeFileSync(
      join(dir, 'Animal.cs'),
      `namespace Zoo;
public class Animal { public virtual void Speak() { } }
public class Cat : Animal { public override void Speak() { } }
`,
    );
    const second = await indexer.indexRepo(repo.id, dir);
    expect(second.filesIndexed).toBe(1); // Animal.cs re-parsed
    expect(second.filesSkipped).toBe(1); // Logger.cs hash unchanged

    // 'Dog' must be gone, 'Cat' must exist
    const dogRows = db
      .prepare(
        `SELECT COUNT(*) as c FROM symbols WHERE repo_id = ? AND name = 'Dog'`,
      )
      .get(repo.id) as { c: number };
    expect(dogRows.c).toBe(0);
    const catRows = db
      .prepare(
        `SELECT COUNT(*) as c FROM symbols WHERE repo_id = ? AND name = 'Cat'`,
      )
      .get(repo.id) as { c: number };
    expect(catRows.c).toBe(1);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('deleting .cs file offline → next scan cleans up orphans (P0 fix)', async () => {
    const dir = seedCsRepo();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    await indexer.indexRepo(repo.id, dir);

    unlinkSync(join(dir, 'Animal.cs'));
    await indexer.indexRepo(repo.id, dir);

    const fileRow = db
      .prepare(
        `SELECT COUNT(*) as c FROM files WHERE repo_id = ? AND rel_path = 'Animal.cs'`,
      )
      .get(repo.id) as { c: number };
    expect(fileRow.c).toBe(0);

    const dogSymbol = db
      .prepare(
        `SELECT COUNT(*) as c FROM symbols WHERE repo_id = ? AND name = 'Dog'`,
      )
      .get(repo.id) as { c: number };
    expect(dogSymbol.c).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('EXTRACTOR_VERSION mismatch forces re-parse of all .cs files', async () => {
    const dir = seedCsRepo();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);

    await indexer.indexRepo(repo.id, dir);

    // Simulate pre-upgrade state: set extractor_version = 0 on all files.
    db.prepare(`UPDATE files SET extractor_version = 0 WHERE repo_id = ?`).run(
      repo.id,
    );

    const second = await indexer.indexRepo(repo.id, dir);
    // All 2 files must be re-parsed even though the hash hasn't changed.
    expect(second.filesIndexed).toBe(2);
    expect(second.filesSkipped).toBe(0);

    // extractor_version bumped back to current.
    const rows = db
      .prepare(`SELECT extractor_version FROM files WHERE repo_id = ?`)
      .all(repo.id) as Array<{ extractor_version: number }>;
    for (const r of rows) expect(r.extractor_version).toBeGreaterThanOrEqual(1);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('indexing records language="cs" on files table', async () => {
    const dir = seedCsRepo();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    await indexer.indexRepo(repo.id, dir);

    const rows = db
      .prepare(`SELECT language FROM files WHERE repo_id = ?`)
      .all(repo.id) as Array<{ language: string }>;
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.language).toBe('cs');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('mixed C# + TypeScript repo: both languages indexed, edges per language', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-mixed-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public class App
{
    public void Run() { Start(); }
    public void Start() { }
}
`,
    );
    writeFileSync(
      join(dir, 'app.ts'),
      `export function run() { start(); }\nexport function start() {}`,
    );

    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    await indexer.indexRepo(repo.id, dir);

    const edges = db
      .prepare(
        `SELECT sr.type, sr.language, s1.name as src, sr.target_name as tgt
         FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = ? AND sr.type = 'CALLS'`,
      )
      .all(repo.id) as Array<{ type: string; language: string; src: string; tgt: string }>;

    expect(
      edges.find((e) => e.language === 'csharp' && e.src === 'Run' && e.tgt === 'Start'),
    ).toBeDefined();
    expect(
      edges.find((e) => e.language === 'typescript' && e.src === 'run' && e.tgt === 'start'),
    ).toBeDefined();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C# KNOWN GAP: single-line source breaks line-based source-symbol attribution', async () => {
    // findSourceSymbolId() in relation-extractor.ts uses line-containment only
    // (ignores column). When multiple methods sit on ONE line, the innermost
    // (smallest span) wins — often the WRONG method. The call then looks like
    // self-recursion and is dropped by the `targetId === sourceId` guard.
    // Real-world C# is never on one line, so this is low-impact — but worth
    // documenting. Flip this test if findSourceSymbolId gains column awareness.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-oneline-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public class App { public void Run() { Start(); } public void Start() { } }`,
    );
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 't', rootPath: dir });
    const indexer = new Indexer(db);
    await indexer.indexRepo(repo.id, dir);

    const edges = db
      .prepare(
        `SELECT sr.type, s1.name as src, sr.target_name as tgt
         FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = ? AND sr.type = 'CALLS' AND s1.name = 'Run' AND sr.target_name = 'Start'`,
      )
      .all(repo.id);
    // Currently empty — attribution fails on single-line sources.
    expect(edges.length).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
