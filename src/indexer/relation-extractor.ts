import Parser from 'tree-sitter';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/index.js';
import type { ModuleMap } from './module-map.js';
import { grammarForExt, type Grammar } from '../parser/grammars.js';

const here = dirname(fileURLToPath(import.meta.url));

export type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

export type RawEdge = {
  sourceId: string;
  targetName: string;
  targetId: string | null;
  type: EdgeType;
  language: string;
};

const SUPPORTED_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.cs',
]);

const MAX_EDGES_PER_FILE = 10_000;

const RELATION_QUERY_MAP: Record<string, string> = {
  javascript: 'relations-javascript.scm',
  typescript: 'relations-typescript.scm',
  tsx: 'relations-typescript.scm',
  python: 'relations-python.scm',
  go: 'relations-go.scm',
  rust: 'relations-rust.scm',
  csharp: 'relations-csharp.scm',
};

const relationQueryCache = new Map<string, string>();

function loadRelationQuery(lang: string): string | null {
  const file = RELATION_QUERY_MAP[lang];
  if (!file) return null;
  const cached = relationQueryCache.get(file);
  if (cached !== undefined) return cached;
  try {
    // Queries live under src/parser/queries/ (co-located with grammar queries)
    const src = readFileSync(join(here, '..', 'parser', 'queries', file), 'utf8');
    relationQueryCache.set(file, src);
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
    p.setLanguage(grammar.language as never);
    parserCache.set(grammar.name, p);
  }
  return p;
}

type QueryCapture = {
  name: string;
  node: {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
  };
};

type QueryMatch = { captures: QueryCapture[] };

/**
 * Resolve an import path fragment (e.g. './utils' or '../foo') to a rel_path
 * that ModuleMap recognises. Pure string manipulation — no filesystem probing
 * (ModuleMap is already populated from DB). Returns normalized rel_path.
 */
function resolveImportPath(
  sourceRelPath: string,
  importPath: string,
  language: string,
): string | null {
  // Strip surrounding quotes if still present
  const cleaned = importPath.replace(/^["'`]|["'`]$/g, '');

  // Relative import
  if (cleaned.startsWith('.')) {
    const sourceDir = dirname(sourceRelPath);
    const joined = resolvePath('/' + sourceDir, cleaned).slice(1);
    return joined.replace(/\\/g, '/');
  }

  // Python dotted: . -> / (handled by relative branch above via ./)
  if (language === 'python') {
    return cleaned.replace(/\./g, '/');
  }

  // Absolute / package import → leave as-is; ModuleMap may or may not match
  return cleaned.replace(/\\/g, '/');
}

export class RelationExtractor {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Pass 2: run tree-sitter relation queries on a file and persist edges.
   * Returns number of edges written. Supports JS/TS/JSX/TSX, Python, Go, Rust
   * via tree-sitter .scm queries. C# is handled separately by RoslynBridge.
   */
  extractAndPersist(
    repoId: string,
    fileAbsPath: string,
    relPath: string,
    fileId: string,
    moduleMap: ModuleMap,
  ): number {
    const ext = extname(fileAbsPath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) return 0;

    const grammar = grammarForExt(ext);
    if (!grammar) return 0;

    const querySource = loadRelationQuery(grammar.name);
    if (!querySource) return 0;

    let source: string;
    try {
      source = readFileSync(fileAbsPath, 'utf8');
    } catch {
      return 0;
    }

    const parser = getParser(grammar);
    let tree;
    try {
      tree = parser.parse(source);
    } catch {
      return 0;
    }

    const QueryCtor = (Parser as unknown as { Query: new (lang: unknown, src: string) => unknown })
      .Query;
    let query: { matches: (node: unknown) => QueryMatch[] };
    try {
      query = new QueryCtor(grammar.language, querySource) as typeof query;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[RelationExtractor] query load failed for ${grammar.name}: ${e}`);
      return 0;
    }

    const matches = query.matches(tree.rootNode);

    // Load symbol ranges in this file, sorted, for line-containment lookup
    const fileSymbols = this.db
      .prepare(
        `SELECT id, name, start_line, end_line
         FROM symbols WHERE file_id = ? AND repo_id = ?
         ORDER BY start_line ASC, end_line DESC`,
      )
      .all(fileId, repoId) as Array<{ id: string; name: string; start_line: number; end_line: number }>;

    // Find innermost containing symbol for a given line (0-indexed)
    const findSourceSymbolId = (line: number): string | null => {
      let match: { id: string; span: number } | null = null;
      for (const s of fileSymbols) {
        if (s.start_line <= line && line <= s.end_line) {
          const span = s.end_line - s.start_line;
          if (!match || span < match.span) match = { id: s.id, span };
        }
      }
      return match?.id ?? null;
    };

    const edges: RawEdge[] = [];

    for (const m of matches) {
      // Classify by looking at captures. Priority: import → extends → implements → call
      const importPath = m.captures.find((c) => c.name === 'import.path');
      const importName = m.captures.find((c) => c.name === 'import.name' || c.name === 'import.module');
      const extendsName = m.captures.find((c) => c.name === 'extends.name' || c.name === 'base.name');
      const implementsName = m.captures.find((c) => c.name === 'implements.name');
      const callName = m.captures.find((c) => c.name === 'call.name');

      if (importPath || importName) {
        const target = (importPath ?? importName)!;
        const pathStr = target.node.text;
        const resolvedPath = resolveImportPath(relPath, pathStr, grammar.name);

        // IMPORTS edges are per-file; source is any symbol in the file (we use
        // the first top-level symbol as a stand-in, or skip if none).
        const firstSym = fileSymbols[0];
        if (!firstSym) continue;

        // Resolve target: look up any symbol in the target file
        let targetId: string | null = null;
        if (resolvedPath) {
          // Try common extensions for JS/TS
          const candidates = [
            resolvedPath,
            `${resolvedPath}.ts`,
            `${resolvedPath}.tsx`,
            `${resolvedPath}.js`,
            `${resolvedPath}.jsx`,
            `${resolvedPath}/index.ts`,
            `${resolvedPath}/index.js`,
            `${resolvedPath}.py`,
            `${resolvedPath}.go`,
            `${resolvedPath}.rs`,
          ];
          for (const c of candidates) {
            const row = this.db
              .prepare(`SELECT id FROM symbols WHERE file_id = (SELECT id FROM files WHERE repo_id = ? AND rel_path = ?) LIMIT 1`)
              .get(repoId, c) as { id: string } | undefined;
            if (row) {
              targetId = row.id;
              break;
            }
          }
        }

        edges.push({
          sourceId: firstSym.id,
          targetName: pathStr,
          targetId,
          type: 'IMPORTS',
          language: grammar.name,
        });
        continue;
      }

      if (extendsName) {
        const line = extendsName.node.startPosition.row;
        const sourceId = findSourceSymbolId(line);
        if (!sourceId) continue;
        const name = extendsName.node.text;
        const targetId = moduleMap.findSymbol(name);
        edges.push({
          sourceId,
          targetName: name,
          targetId,
          type: 'EXTENDS',
          language: grammar.name,
        });
        continue;
      }

      if (implementsName) {
        const line = implementsName.node.startPosition.row;
        const sourceId = findSourceSymbolId(line);
        if (!sourceId) continue;
        const name = implementsName.node.text;
        const targetId = moduleMap.findSymbol(name);
        edges.push({
          sourceId,
          targetName: name,
          targetId,
          type: 'IMPLEMENTS',
          language: grammar.name,
        });
        continue;
      }

      if (callName) {
        const line = callName.node.startPosition.row;
        const sourceId = findSourceSymbolId(line);
        if (!sourceId) continue;
        const name = callName.node.text;
        // Skip self-calls where the call target IS the source symbol (recursion)
        const targetId = moduleMap.findSymbol(name);
        if (targetId === sourceId) continue;
        edges.push({
          sourceId,
          targetName: name,
          targetId,
          type: 'CALLS',
          language: grammar.name,
        });
        continue;
      }
    }

    if (edges.length === 0) {
      // Still clear any stale edges for this file
      this._persistEdges(repoId, fileId, []);
      return 0;
    }

    this._persistEdges(repoId, fileId, edges);
    return Math.min(edges.length, MAX_EDGES_PER_FILE);
  }

  /**
   * Test helper — bypass tree-sitter and directly persist raw edges.
   * Also used by C# Roslyn bridge (Plan 5e).
   */
  _insertEdgesForTest(repoId: string, fileId: string, edges: RawEdge[]): void {
    this._persistEdges(repoId, fileId, edges);
  }

  _persistEdges(repoId: string, fileId: string, edges: RawEdge[]): void {
    let capped = edges;
    if (edges.length > MAX_EDGES_PER_FILE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[RelationExtractor] file ${fileId} has ${edges.length} edges — capping to ${MAX_EDGES_PER_FILE}`,
      );
      capped = edges.slice(0, MAX_EDGES_PER_FILE);
    }

    const deleteStmt = this.db.prepare(`
      DELETE FROM symbol_relations
      WHERE source_id IN (
        SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?
      )
    `);

    const insertStmt = this.db.prepare(`
      INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsert = this.db.transaction(() => {
      deleteStmt.run(fileId, repoId);
      for (const edge of capped) {
        const confidence = edge.targetId !== null ? 1.0 : 0.7;
        insertStmt.run(
          randomUUID(),
          repoId,
          edge.sourceId,
          edge.targetId ?? null,
          edge.targetName,
          edge.type,
          edge.language,
          confidence,
        );
      }
    });

    upsert();
  }
}
