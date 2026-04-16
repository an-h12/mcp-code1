import { describe, it, expect } from 'vitest';

describe('tokenize', () => {
  it('splits camelCase', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('getUserById')).toEqual(['get', 'user', 'by', 'id']);
  });

  it('splits PascalCase', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('UserController')).toEqual(['user', 'controller']);
  });

  it('splits snake_case', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('parse_user_token')).toEqual(['parse', 'user', 'token']);
  });

  it('splits SCREAMING_SNAKE', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    expect(tokenize('MAX_RETRY_COUNT')).toEqual(['max', 'retry', 'count']);
  });

  it('handles mixed separators', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    const tokens = tokenize('parseHTTPResponse');
    expect(tokens).toContain('parse');
    expect(tokens).toContain('http');
    expect(tokens).toContain('response');
  });

  it('deduplicates tokens', async () => {
    const { tokenize } = await import('../../src/parser/tokenizer.js');
    const tokens = tokenize('fooFoo');
    expect(tokens.filter((t) => t === 'foo')).toHaveLength(1);
  });
});
