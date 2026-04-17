import type { Db } from '../../db/index.js';

export type SearchSymbolsParams = {
  query: string;
  repoId: string | null;
  kind?: string | null;
  limit?: number;
  offset?: number;
};

export type SymbolResult = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
};

export type PaginatedResult<T> = {
  items: T[];
  total_count: number;
  has_more: boolean;
  next_offset: number;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  repo_id: string;
  rel_path: string;
  start_line: number;
  end_line: number;
  signature: string;
};

function mapRow(r: Row): SymbolResult {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    repoId: r.repo_id,
    filePath: r.rel_path,
    startLine: r.start_line,
    endLine: r.end_line,
    signature: r.signature,
  };
}

export function searchSymbols(db: Db, params: SearchSymbolsParams): PaginatedResult<SymbolResult> {
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;

  const ftsQuery = params.query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' OR ');

  let whereExtra = '';
  const filterArgs: unknown[] = [];
  if (params.kind) {
    whereExtra += ' AND s.kind = ?';
    filterArgs.push(params.kind);
  }
  if (params.repoId) {
    whereExtra += ' AND s.repo_id = ?';
    filterArgs.push(params.repoId);
  }

  // Try FTS first
  try {
    const countSql = `
      SELECT COUNT(*) as cnt
      FROM symbols_fts fts
      JOIN symbols s ON s.rowid = fts.rowid
      WHERE symbols_fts MATCH ?${whereExtra}
    `;
    const countRow = db.prepare(countSql).get(ftsQuery, ...filterArgs) as { cnt: number } | undefined;
    const totalCount = countRow?.cnt ?? 0;

    const ftsSql = `
      SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature
      FROM symbols_fts fts
      JOIN symbols s ON s.rowid = fts.rowid
      JOIN files f ON f.id = s.file_id
      WHERE symbols_fts MATCH ?${whereExtra}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    const rows = db.prepare(ftsSql).all(ftsQuery, ...filterArgs, limit, offset) as Row[];
    if (rows.length > 0 || offset > 0) {
      return {
        items: rows.map(mapRow),
        total_count: totalCount,
        has_more: offset + rows.length < totalCount,
        next_offset: offset + rows.length,
      };
    }
  } catch {
    // fall through to LIKE fallback
  }

  // LIKE fallback
  const escapedQuery = params.query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

  const countSql = `
    SELECT COUNT(*) as cnt
    FROM symbols s
    WHERE s.name LIKE ? ESCAPE '\\'${whereExtra}
  `;
  const countRow = db.prepare(countSql).get(`%${escapedQuery}%`, ...filterArgs) as { cnt: number } | undefined;
  const totalCount = countRow?.cnt ?? 0;

  const likeSql = `
    SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature
    FROM symbols s
    JOIN files f ON f.id = s.file_id
    WHERE s.name LIKE ? ESCAPE '\\'${whereExtra}
    ORDER BY s.name
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(likeSql).all(`%${escapedQuery}%`, ...filterArgs, limit, offset) as Row[];
  return {
    items: rows.map(mapRow),
    total_count: totalCount,
    has_more: offset + rows.length < totalCount,
    next_offset: offset + rows.length,
  };
}
