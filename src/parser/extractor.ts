import Parser from 'tree-sitter';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grammarForExt, type Grammar } from './grammars.js';

const here = dirname(fileURLToPath(import.meta.url));

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'type'
  | 'enum'
  | 'variable'
  | 'const';

export type RawSymbol = {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
};

const NODE_KIND_TO_SYMBOL_KIND: Record<string, SymbolKind> = {
  function_declaration: 'function',
  arrow_function: 'function',
  function_expression: 'function',
  lexical_declaration: 'const',
  class_declaration: 'class',
  method_definition: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  function_definition: 'function',
  class_definition: 'class',
  decorated_definition: 'function',
  function_item: 'function',
  struct_item: 'class',
  enum_item: 'enum',
  trait_item: 'interface',
  impl_item: 'class',
  method_declaration: 'method',
  type_spec: 'type',
};

const QUERY_MAP: Record<string, string> = {
  javascript: 'javascript.scm',
  typescript: 'typescript.scm',
  tsx: 'typescript.scm',
  python: 'python.scm',
  go: 'go.scm',
  rust: 'rust.scm',
};

const queryCache = new Map<string, string>();

function loadQuery(lang: string): string | null {
  const file = QUERY_MAP[lang];
  if (!file) return null;
  const cached = queryCache.get(file);
  if (cached !== undefined) return cached;
  try {
    const src = readFileSync(join(here, 'queries', file), 'utf8');
    queryCache.set(file, src);
    return src;
  } catch {
    return null;
  }
}

const parserCache = new Map<string, Parser>();

function getParser(grammar: Grammar): Parser {
  let p = parserCache.get(grammar.name);
  if (!p) {
    p = new Parser();
    // tree-sitter 0.21: setLanguage accepts a Language object directly
    p.setLanguage(grammar.language as never);
    parserCache.set(grammar.name, p);
  }
  return p;
}

export function extractSymbols(source: string, ext: string): RawSymbol[] {
  const grammar = grammarForExt(ext);
  if (!grammar) return [];

  const querySource = loadQuery(grammar.name);
  if (!querySource) return [];

  const parser = getParser(grammar);
  const tree = parser.parse(source);

  // tree-sitter 0.21: Query is constructed from Language + source
  const QueryCtor = (Parser as unknown as { Query: new (lang: unknown, src: string) => unknown })
    .Query;
  const query = new QueryCtor(grammar.language, querySource) as {
    matches: (node: unknown) => Array<{
      captures: Array<{
        name: string;
        node: {
          type: string;
          text: string;
          startPosition: { row: number; column: number };
          endPosition: { row: number; column: number };
        };
      }>;
    }>;
  };

  const matches = query.matches(tree.rootNode);
  const symbols: RawSymbol[] = [];
  const lines = source.split('\n');

  for (const match of matches) {
    const symbolCapture = match.captures.find((c) => c.name === 'symbol');
    const nameCapture = match.captures.find((c) => c.name === 'name');
    if (!symbolCapture || !nameCapture) continue;

    const symbolNode = symbolCapture.node;
    const name = nameCapture.node.text;
    const kind = NODE_KIND_TO_SYMBOL_KIND[symbolNode.type] ?? 'function';

    const signature = (lines[symbolNode.startPosition.row] ?? '').trim().slice(0, 120);

    symbols.push({
      name,
      kind,
      startLine: symbolNode.startPosition.row,
      endLine: symbolNode.endPosition.row,
      signature,
    });
  }

  return symbols;
}
