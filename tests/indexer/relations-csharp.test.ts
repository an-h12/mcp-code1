/**
 * Relation extraction tests for C# (Tier 1 tree-sitter).
 * Covers: IMPORTS (using), EXTENDS (: Base), IMPLEMENTS (: IFoo),
 * CALLS (simple + member-access + static), and known Tier-1 gaps.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { Indexer } from '../../src/indexer/indexer.js';

type Edge = { type: string; src: string; tgt: string };

async function indexAndQueryEdges(dir: string, where = "sr.repo_id = 'r1'"): Promise<Edge[]> {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t',?)`).run(dir);
  const indexer = new Indexer(db);
  await indexer.indexRepo('r1', dir);
  const rows = db
    .prepare(
      `SELECT sr.type, s1.name as src, sr.target_name as tgt
       FROM symbol_relations sr
       LEFT JOIN symbols s1 ON s1.id = sr.source_id
       WHERE ${where}`,
    )
    .all() as Edge[];
  db.close();
  return rows;
}

describe('Pass 2: Relation extraction — C# basic', () => {
  it('C#: emits IMPORTS edges for using directives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-using-'));
    writeFileSync(
      join(dir, 'Program.cs'),
      `using System;
using System.Collections.Generic;

namespace App
{
    public class Program
    {
        public void Run() { }
    }
}
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const imports = edges.filter((e) => e.type === 'IMPORTS');
    expect(imports.length).toBeGreaterThanOrEqual(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: emits EXTENDS edge for class base (Dog : Animal)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-extends-'));
    writeFileSync(
      join(dir, 'Animal.cs'),
      `public class Animal { public virtual void Speak() { } }
public class Dog : Animal { public override void Speak() { } }
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const dogExtendsAnimal = edges.find(
      (e) => e.type === 'EXTENDS' && e.src === 'Dog' && e.tgt === 'Animal',
    );
    expect(dogExtendsAnimal).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: emits CALLS edges for simple method invocations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-calls-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public class App
{
    public void Run() { Start(); }
    public void Start() { }
}
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const runCallsStart = edges.find(
      (e) => e.type === 'CALLS' && e.src === 'Run' && e.tgt === 'Start',
    );
    expect(runCallsStart).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Pass 2: Relation extraction — C# edge cases', () => {
  it('C#: emits CALLS for member-access invocation (obj.Method())', async () => {
    // relations-csharp.scm captures member_access_expression's name as call.name.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-memberacc-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public class Logger { public void Info(string s) { } }

public class App
{
    public void Run()
    {
        var log = new Logger();
        log.Info("hello");
    }
}
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const runCallsInfo = edges.find(
      (e) => e.type === 'CALLS' && e.src === 'Run' && e.tgt === 'Info',
    );
    expect(runCallsInfo).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: emits CALLS for static method access (Foo.Bar())', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-static-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public static class Helper { public static void Log(string s) { } }

public class App
{
    public void Run() { Helper.Log("hi"); }
}
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const runCallsLog = edges.find(
      (e) => e.type === 'CALLS' && e.src === 'Run' && e.tgt === 'Log',
    );
    expect(runCallsLog).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: emits multiple EXTENDS/IMPLEMENTS for `class X : Base, IOne, ITwo`', async () => {
    // relations-csharp.scm uses `base_list (_) @base.name` which captures ALL
    // members in the base list — including interfaces. RelationExtractor
    // classifies them all as EXTENDS (Tier-1 limitation; distinguishing
    // class-vs-interface needs semantic info only Roslyn has).
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-multi-base-'));
    writeFileSync(
      join(dir, 'Multi.cs'),
      `public class Base { }
public interface IOne { }
public interface ITwo { }
public class Derived : Base, IOne, ITwo { }
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const derivedEdges = edges.filter(
      (e) => e.src === 'Derived' && (e.type === 'EXTENDS' || e.type === 'IMPLEMENTS'),
    );
    const targets = derivedEdges.map((e) => e.tgt);
    expect(targets).toContain('Base');
    expect(targets).toContain('IOne');
    expect(targets).toContain('ITwo');
    rmSync(dir, { recursive: true, force: true });
  });

  it('C# KNOWN GAP: global using in symbol-less file does NOT emit IMPORTS edge', async () => {
    // RelationExtractor (line ~202-203) uses the first top-level symbol of the
    // file as the IMPORTS source. A file that contains ONLY `global using`
    // directives has no symbols — IMPORTS edges are silently dropped.
    // This is a Tier-1 limitation shared by every language; documenting here
    // so the gap is visible and flippable when fixed.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-globalusing-'));
    writeFileSync(
      join(dir, 'GlobalUsings.cs'),
      `global using System;
global using System.IO;
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const imports = edges.filter((e) => e.type === 'IMPORTS');
    expect(imports.length).toBe(0); // currently 0; flip when fixed
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: global using in file that also declares a class DOES emit IMPORTS', async () => {
    // Workaround for the gap above: if the same file also has a symbol, the
    // using directive is attributable.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-globalusing2-'));
    writeFileSync(
      join(dir, 'GlobalUsings.cs'),
      `global using System;
global using System.IO;

public class GlobalUsingsAnchor { }
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const imports = edges.filter((e) => e.type === 'IMPORTS');
    expect(imports.length).toBeGreaterThanOrEqual(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: file-scoped namespace does not break relation extraction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-filescoped-'));
    writeFileSync(
      join(dir, 'Service.cs'),
      `using System;

namespace Foo.Bar;

public class Service
{
    public void Run() { Start(); }
    public void Start() { }
}
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const callEdge = edges.find(
      (e) => e.type === 'CALLS' && e.src === 'Run' && e.tgt === 'Start',
    );
    expect(callEdge).toBeDefined();
    const importEdge = edges.find((e) => e.type === 'IMPORTS');
    expect(importEdge).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: IMPLEMENTS vs EXTENDS heuristic distinguishes `IFoo` from `Base`', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-impl-'));
    writeFileSync(
      join(dir, 'X.cs'),
      `public class Base { }
public interface IOne { }
public interface ITwo { }
public class Derived : Base, IOne, ITwo { }
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const derivedEdges = edges.filter((e) => e.src === 'Derived');
    const extendsBase = derivedEdges.find((e) => e.type === 'EXTENDS' && e.tgt === 'Base');
    const impOne = derivedEdges.find((e) => e.type === 'IMPLEMENTS' && e.tgt === 'IOne');
    const impTwo = derivedEdges.find((e) => e.type === 'IMPLEMENTS' && e.tgt === 'ITwo');
    expect(extendsBase).toBeDefined();
    expect(impOne).toBeDefined();
    expect(impTwo).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: IMPLEMENTS heuristic trusts DB kind over naming when both available', async () => {
    // `Idea` starts with 'I' but not followed by uppercase — should be EXTENDS.
    // `Animal` class starts with uppercase — should be EXTENDS.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-impl2-'));
    writeFileSync(
      join(dir, 'X.cs'),
      `public class Idea { }
public class Dog : Idea { }
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const e = edges.find((r) => r.src === 'Dog');
    expect(e?.type).toBe('EXTENDS');
    expect(e?.tgt).toBe('Idea');
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: re-index does NOT duplicate relations (persist DELETE-before-INSERT)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-reindex-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public class App
{
    public void A() { B(); }
    public void B() { }
}
`,
    );
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t',?)`).run(dir);
    const indexer = new Indexer(db);
    await indexer.indexRepo('r1', dir);
    await indexer.indexRepo('r1', dir); // second scan — same content

    const rows = db
      .prepare(
        `SELECT COUNT(*) as c FROM symbol_relations sr
         JOIN symbols s1 ON s1.id = sr.source_id
         WHERE sr.repo_id = 'r1' AND sr.type = 'CALLS'
           AND s1.name = 'A' AND sr.target_name = 'B'`,
      )
      .get() as { c: number };
    expect(rows.c).toBe(1);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: generic base `class X : Base<T,U>` captures only the type name, not the generics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-genbase-'));
    writeFileSync(
      join(dir, 'Repo.cs'),
      `public class BaseRepository<TEntity, TId> { }
public class CustomerRepo : BaseRepository<Customer, System.Guid> { }
public class Customer { }
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const edge = edges.find(
      (e) => e.type === 'EXTENDS' && e.src === 'CustomerRepo',
    );
    expect(edge).toBeDefined();
    // Must be exactly "BaseRepository" — not "BaseRepository<Customer, System.Guid>"
    expect(edge?.tgt).toBe('BaseRepository');
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: record inherit `record Dog(string N) : Animal(N)` captures base class name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-recinherit-'));
    writeFileSync(
      join(dir, 'R.cs'),
      `public record Animal(string Name);
public record Dog(string Name) : Animal(Name);
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const edge = edges.find(
      (e) => e.type === 'EXTENDS' && e.src === 'Dog',
    );
    expect(edge).toBeDefined();
    expect(edge?.tgt).toBe('Animal');
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: `new Foo()` (object_creation_expression) emits CALLS edge', async () => {
    // Fixed in P0-2: RelationExtractor now recognises `call.constructor` capture
    // emitted by relations-csharp.scm for object_creation_expression.
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-newexpr-'));
    writeFileSync(
      join(dir, 'App.cs'),
      `public class Foo { }

public class App
{
    public void Run()
    {
        var f = new Foo();
    }
}
`,
    );
    const edges = await indexAndQueryEdges(dir);
    const newFoo = edges.find(
      (e) => e.type === 'CALLS' && e.src === 'Run' && e.tgt === 'Foo',
    );
    expect(newFoo).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C#: malformed source does not crash Pass 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cs-malformed-'));
    writeFileSync(join(dir, 'Bad.cs'), `public class {{{ broken`);
    // Should not throw — indexer continues.
    const edges = await indexAndQueryEdges(dir);
    expect(Array.isArray(edges)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
