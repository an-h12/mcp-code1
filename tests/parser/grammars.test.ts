import { describe, it, expect } from 'vitest';

describe('grammarForExt', () => {
  it('returns javascript grammar for .js', async () => {
    const { grammarForExt } = await import('../../src/parser/grammars.js');
    const g = grammarForExt('.js');
    expect(g).toBeDefined();
    expect(g?.name).toBe('javascript');
  });

  it('returns typescript grammar for .ts', async () => {
    const { grammarForExt } = await import('../../src/parser/grammars.js');
    const g = grammarForExt('.ts');
    expect(g?.name).toBe('typescript');
  });

  it('returns undefined for .txt', async () => {
    const { grammarForExt } = await import('../../src/parser/grammars.js');
    expect(grammarForExt('.txt')).toBeUndefined();
  });
});
