/**
 * Splits an identifier into lowercase tokens suitable for BM25/FTS5 indexing.
 * Handles camelCase, PascalCase, snake_case, SCREAMING_SNAKE, and mixed forms.
 */
export function tokenize(identifier: string): string[] {
  const spaced = identifier
    // ABCDef → ABC Def
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // camelCase → camel Case
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    // Replace non-alphanumeric with spaces
    .replace(/[^a-zA-Z0-9]+/g, ' ');

  const tokens = spaced
    .split(' ')
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);

  return [...new Set(tokens)];
}

/**
 * Build an augmented search string: original identifier + all tokens.
 * Store this in the FTS column for richer matching.
 */
export function buildSearchText(name: string, signature: string, doc: string): string {
  const tokens = tokenize(name);
  return [name, ...tokens, signature, doc].join(' ');
}
