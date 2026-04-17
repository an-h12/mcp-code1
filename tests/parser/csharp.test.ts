import { describe, it, expect } from 'vitest';

const CSHARP_SNIPPET = `
using System;

namespace MyApp.Core
{
    public interface IGreeter
    {
        string Greet(string name);
    }

    public class Greeter : IGreeter
    {
        public Greeter() { }
        public string Name { get; set; }
        public string Greet(string name) => $"Hi {name}";
    }

    public struct Point
    {
        public int X;
        public int Y;
    }

    public record User(string Name, int Age);

    public enum Direction { Up, Down }

    public delegate int Transform(int x);
}
`.trim();

describe('extractSymbols — C# basic', () => {
  it('extracts class, interface, struct, record, enum, method, constructor, property, delegate, namespace', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(CSHARP_SNIPPET, '.cs');
    const names = symbols.map((s) => s.name);

    expect(names).toContain('Greeter');
    expect(names).toContain('IGreeter');
    expect(names).toContain('Point');
    expect(names).toContain('User');
    expect(names).toContain('Direction');
    expect(names).toContain('Greet');
    expect(names).toContain('Transform');
    expect(names.some((n) => n === 'MyApp.Core' || n === 'MyApp')).toBe(true);

    const hasKind = (name: string, kind: string): boolean =>
      symbols.some((s) => s.name === name && s.kind === kind);

    expect(hasKind('Greeter', 'class')).toBe(true);
    expect(hasKind('Greeter', 'method')).toBe(true); // constructor
    expect(hasKind('IGreeter', 'interface')).toBe(true);
    expect(hasKind('Point', 'class')).toBe(true); // struct → class
    expect(hasKind('User', 'class')).toBe(true); // record → class
    expect(hasKind('Direction', 'enum')).toBe(true);
    expect(hasKind('Greet', 'method')).toBe(true);
    expect(hasKind('Transform', 'type')).toBe(true); // delegate → type
  });

  it('returns empty array for malformed C# without throwing', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const syms = extractSymbols('class {', '.cs');
    expect(Array.isArray(syms)).toBe(true);
  });

  it('symbols have valid line numbers', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(CSHARP_SNIPPET, '.cs');
    expect(symbols.length).toBeGreaterThan(0);
    for (const s of symbols) {
      expect(s.startLine).toBeGreaterThanOrEqual(0);
      expect(s.endLine).toBeGreaterThanOrEqual(s.startLine);
    }
  });
});

describe('extractSymbols — C# edge cases', () => {
  it('handles file-scoped namespace (C# 10+ `namespace Foo.Bar;`)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `namespace Foo.Bar;

public class Service
{
    public void Run() { }
}
`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    // File-scoped namespace should be captured
    expect(names.some((n) => n === 'Foo.Bar' || n === 'Foo')).toBe(true);
    expect(names).toContain('Service');
    expect(names).toContain('Run');
  });

  it('handles nested classes (inner declared inside outer)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Outer
{
    public class Inner
    {
        public void DoWork() { }
    }
}
`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Outer');
    expect(names).toContain('Inner');
    expect(names).toContain('DoWork');
  });

  it('handles generic classes (e.g. Box<T>)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Box<T>
{
    public T Value { get; set; }
    public void Put(T item) { }
}
`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Box');
    expect(names).toContain('Put');
    expect(names).toContain('Value');
  });

  it('handles partial classes (two declarations with same name)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public partial class Foo
{
    public void MethodA() { }
}

public partial class Foo
{
    public void MethodB() { }
}
`;
    const symbols = extractSymbols(src, '.cs');
    const fooClasses = symbols.filter((s) => s.name === 'Foo' && s.kind === 'class');
    // Tier-1 tree-sitter emits both partials as separate symbols.
    // (Merging is a Tier-2 Roslyn feature, out of scope here.)
    expect(fooClasses.length).toBe(2);
    expect(symbols.some((s) => s.name === 'MethodA')).toBe(true);
    expect(symbols.some((s) => s.name === 'MethodB')).toBe(true);
  });

  it('handles empty source without throwing', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    expect(extractSymbols('', '.cs')).toEqual([]);
    expect(extractSymbols('   \n\n  ', '.cs')).toEqual([]);
  });

  it('handles source with only using directives (no symbols)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols('using System;\nusing System.IO;\n', '.cs');
    expect(symbols).toEqual([]);
  });

  it('handles CRLF line endings (Windows default)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = 'public class Crlf\r\n{\r\n    public void M() { }\r\n}\r\n';
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Crlf');
    expect(names).toContain('M');
  });

  it('handles UTF-8 BOM at start of file', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = '\uFEFFpublic class WithBom\n{\n    public void Run() { }\n}\n';
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('WithBom');
    expect(names).toContain('Run');
  });

  it('handles Unicode identifiers', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Người { public void Chạy() { } }`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Người');
    expect(names).toContain('Chạy');
  });

  it('case-insensitive extension: .CS vs .cs', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class A { }`;
    // grammarForExt lowercases the ext — uppercase should still match.
    expect(extractSymbols(src, '.CS').map((s) => s.name)).toContain('A');
  });

  it('does not emit field_declaration symbols (kept intentionally out of scope)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    // Fields are noisy; plan excludes them from symbol list.
    const src = `public class F { public int Count; public string Name = "x"; }`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('F');
    // Fields NOT emitted — Count and Name should NOT be in the symbol list.
    expect(names).not.toContain('Count');
    expect(names).not.toContain('Name');
  });

  it('extracts delegate with correct kind mapping', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public delegate void Handler(int code);`;
    const symbols = extractSymbols(src, '.cs');
    const handler = symbols.find((s) => s.name === 'Handler');
    expect(handler).toBeDefined();
    expect(handler?.kind).toBe('type');
  });

  it('extracts property with variable kind', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class P { public int Count { get; set; } }`;
    const symbols = extractSymbols(src, '.cs');
    const count = symbols.find((s) => s.name === 'Count' && s.kind === 'variable');
    expect(count).toBeDefined();
  });

  it('extracts event field `public event EventHandler Changed;`', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Publisher {
    public event System.EventHandler Changed;
    public event System.EventHandler<int> ValueChanged;
}
`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Changed');
    expect(names).toContain('ValueChanged');
    const changed = symbols.find((s) => s.name === 'Changed');
    expect(changed?.kind).toBe('variable');
  });

  it('extracts event property with add/remove accessors', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class P {
    public event System.EventHandler Renamed {
        add { }
        remove { }
    }
}
`;
    const symbols = extractSymbols(src, '.cs');
    const renamed = symbols.find((s) => s.name === 'Renamed');
    expect(renamed).toBeDefined();
    expect(renamed?.kind).toBe('variable');
  });

  it('extracts indexer with fallback name "this"', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Collection {
    public int this[int i] { get => 0; set { } }
}`;
    const symbols = extractSymbols(src, '.cs');
    const indexer = symbols.find((s) => s.name === 'this' && s.kind === 'method');
    expect(indexer).toBeDefined();
  });

  it('extracts operator overload with fallback name', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Vec {
    public static Vec operator+(Vec a, Vec b) => a;
    public static Vec operator-(Vec a, Vec b) => a;
}`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('operator +');
    expect(names).toContain('operator -');
  });

  it('extracts conversion operator (implicit/explicit)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Money {
    public static implicit operator decimal(Money m) => 0m;
    public static explicit operator int(Money m) => 0;
}`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('implicit operator decimal');
    expect(names).toContain('explicit operator int');
  });

  it('extracts destructor / finalizer', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Resource {
    public Resource() { }
    ~Resource() { }
}`;
    const symbols = extractSymbols(src, '.cs');
    // Destructor `~Resource` emits name "Resource" (identifier after ~),
    // kind=method. There should now be 2 method symbols named "Resource":
    // constructor + destructor.
    const methods = symbols.filter((s) => s.name === 'Resource' && s.kind === 'method');
    expect(methods.length).toBe(2);
  });

  it('extracts local functions inside methods', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class App {
    public void Run() {
        int Helper(int x) => x + 1;
        void Another() { }
        Helper(1);
    }
}`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Helper');
    expect(names).toContain('Another');
    const helper = symbols.find((s) => s.name === 'Helper');
    expect(helper?.kind).toBe('function');
  });

  it('extracts record positional parameters as property-like symbols', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public record Money(decimal Amount, string Currency);
public record Customer(System.Guid Id, string Name, int Age);
`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Amount');
    expect(names).toContain('Currency');
    expect(names).toContain('Name');
    expect(names).toContain('Age');
    const amount = symbols.find((s) => s.name === 'Amount');
    expect(amount?.kind).toBe('variable');
  });

  it('does NOT emit method parameters as symbols (only record params)', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const src = `public class Calc {
    public int Sum(int a, int b) => a + b;
}`;
    const symbols = extractSymbols(src, '.cs');
    const names = symbols.map((s) => s.name);
    // Method parameters should NOT appear — only the class + method.
    expect(names).not.toContain('a');
    expect(names).not.toContain('b');
    expect(names).toContain('Calc');
    expect(names).toContain('Sum');
  });

  it('large file: handles many symbols without crashing', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    // Generate a file with 200 classes each with a method.
    const parts: string[] = [];
    for (let i = 0; i < 200; i++) {
      parts.push(`public class C${i} { public void M${i}() { } }`);
    }
    const src = parts.join('\n');
    const symbols = extractSymbols(src, '.cs');
    // 200 classes + 200 methods = 400
    expect(symbols.length).toBeGreaterThanOrEqual(400);
  });
});
