import type { Db } from '../../db/index.js';

export type SearchSymbolsParams = {
  query: string;
  repoId: string | null;
  kind?: string | null;
  limit?: number;
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

export function searchSymbols(db: Db, params: SearchSymbolsParams): SymbolResult[] {
  const limit = Math.min(params.limit ?? 20, 100);

  const ftsQuery = params.query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' OR ');

  const args: unknown[] = [];
  let whereExtra = '';
  if (params.kind) {
    whereExtra += ' AND s.kind = ?';
  }
  if (params.repoId) {
    whereExtra += ' AND s.repo_id = ?';
  }

  const ftsSql = `
    SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature
    FROM symbols_fts fts
    JOIN symbols s ON s.rowid = fts.rowid
    JOIN files f ON f.id = s.file_id
    WHERE symbols_fts MATCH ?${whereExtra}
    ORDER BY rank
    LIMIT ?
  `;

  try {
    const ftsArgs: unknown[] = [ftsQuery];
    if (params.kind) ftsArgs.push(params.kind);
    if (params.repoId) ftsArgs.push(params.repoId);
    ftsArgs.push(limit);
    const rows = db.prepare(ftsSql).all(...ftsArgs) as Row[];
    if (rows.length > 0) return rows.map(mapRow);
  } catch {
    // fall through to LIKE fallback
  }

  // LIKE fallback (also used when FTS yields no matches)
  // Escape LIKE wildcards (% _) so queries like `__init__` don't match too broadly.
  const escapedQuery = params.query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const likeSql = `
    SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature
    FROM symbols s
    JOIN files f ON f.id = s.file_id
    WHERE s.name LIKE ? ESCAPE '\\'${whereExtra}
    ORDER BY s.name
    LIMIT ?
  `;
  const likeArgs: unknown[] = [`%${escapedQuery}%`];
  if (params.kind) likeArgs.push(params.kind);
  if (params.repoId) likeArgs.push(params.repoId);
  likeArgs.push(limit);
  const rows = db.prepare(likeSql).all(...likeArgs) as Row[];
  return rows.map(mapRow);
}
