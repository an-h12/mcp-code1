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
  // C# specific (class_declaration / interface_declaration / enum_declaration /
  // method_declaration reuse the entries above — tree-sitter-c-sharp happens to
  // emit the same node type names and the existing mappings are already correct
  // for C#).
  struct_declaration: 'class',
  record_declaration: 'class',
  constructor_declaration: 'method',
  property_declaration: 'variable',
  delegate_declaration: 'type',
  namespace_declaration: 'type',
  file_scoped_namespace_declaration: 'type',
  event_declaration: 'variable',
  event_field_declaration: 'variable',
  indexer_declaration: 'method',
  operator_declaration: 'method',
  conversion_operator_declaration: 'method',
  destructor_declaration: 'method',
  local_function_statement: 'function',
};

const QUERY_MAP: Record<string, string> = {
  javascript: 'javascript.scm',
  typescript: 'typescript.scm',
  tsx: 'typescript.scm',
  python: 'python.scm',
  go: 'go.scm',
  rust: 'rust.scm',
  csharp: 'csharp.scm',
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
    // Primary: generic @symbol capture. Secondary: C# record positional params
    // use @symbol.record_param so they don't collide with method-parameter
    // nodes in normal member signatures.
    const symbolCapture =
      match.captures.find((c) => c.name === 'symbol') ??
      match.captures.find((c) => c.name === 'symbol.record_param');
    if (!symbolCapture) continue;
    const symbolNode = symbolCapture.node;

    // Preferred: explicit @name capture from the query.
    const nameCapture = match.captures.find((c) => c.name === 'name');
    let name = nameCapture?.node.text;

    // Fallback names for constructs that have no user-defined identifier:
    //   indexer_declaration     → "this"   (C# indexer: this[int i])
    //   operator_declaration    → "operator <op>"    (e.g. "operator +")
    //   conversion_operator_declaration → "implicit/explicit operator <T>"
    if (!name) {
      if (symbolNode.type === 'indexer_declaration') {
        name = 'this';
      } else if (symbolNode.type === 'operator_declaration') {
        const m = symbolNode.text.match(/operator\s*([^\s(]+)/);
        name = m ? `operator ${m[1]}` : 'operator';
      } else if (symbolNode.type === 'conversion_operator_declaration') {
        const m = symbolNode.text.match(/(implicit|explicit)\s+operator\s+([^\s(]+)/);
        name = m ? `${m[1]} operator ${m[2]}` : 'operator';
      }
    }
    if (!name) continue;

    // Record positional parameters are not in NODE_KIND_TO_SYMBOL_KIND (their
    // tree-sitter node type is "parameter" which would collide with method
    // parameters in other languages). Detect by the dedicated capture tag.
    const isRecordParam = symbolCapture.name === 'symbol.record_param';
    const kind: SymbolKind = isRecordParam
      ? 'variable'
      : NODE_KIND_TO_SYMBOL_KIND[symbolNode.type] ?? 'function';

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
