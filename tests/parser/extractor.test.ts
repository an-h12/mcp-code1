import { describe, it, expect } from 'vitest';

const JS_SNIPPET = `
function add(a, b) { return a + b; }
class Calculator {
  multiply(a, b) { return a * b; }
}
`.trim();

const TS_SNIPPET = `
interface Shape { area(): number; }
type Color = 'red' | 'blue';
export enum Direction { Up, Down }
`.trim();

describe('extractSymbols', () => {
  it('extracts functions and classes from JS', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(JS_SNIPPET, '.js');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('Calculator');
    expect(names).toContain('multiply');
  });

  it('extracts interface/type/enum from TS', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(TS_SNIPPET, '.ts');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('Shape');
    expect(names).toContain('Color');
    expect(names).toContain('Direction');
  });

  it('returns empty array for unsupported extension', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    expect(extractSymbols('hello world', '.txt')).toEqual([]);
  });

  it('symbols have line numbers', async () => {
    const { extractSymbols } = await import('../../src/parser/extractor.js');
    const symbols = extractSymbols(JS_SNIPPET, '.js');
    for (const s of symbols) {
      expect(typeof s.startLine).toBe('number');
      expect(typeof s.endLine).toBe('number');
      expect(s.startLine).toBeGreaterThanOrEqual(0);
    }
  });
});
