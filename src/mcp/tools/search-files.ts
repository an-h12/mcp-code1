import type { Db } from '../../db/index.js';

export type SearchFilesParams = {
  query: string;
  repoId: string | null;
  limit?: number;
  offset?: number;
};

export type FileResult = {
  id: string;
  repoId: string;
  relPath: string;
  language: string;
  sizeBytes: number;
  indexedAt: string | null;
};

type Row = {
  id: string;
  repo_id: string;
  rel_path: string;
  language: string;
  size_bytes: number;
  indexed_at: string | null;
};

export type PaginatedFileResult = {
  items: FileResult[];
  total_count: number;
  has_more: boolean;
  next_offset: number;
};

export function searchFiles(db: Db, params: SearchFilesParams): PaginatedFileResult {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const escaped = params.query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

  const repoFilter = params.repoId ? `AND repo_id = ?` : '';
  const filterArgs: unknown[] = [];
  if (params.repoId) filterArgs.push(params.repoId);

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM files WHERE rel_path LIKE ? ESCAPE '\\' ${repoFilter}`)
    .get(`%${escaped}%`, ...filterArgs) as { cnt: number } | undefined;
  const totalCount = countRow?.cnt ?? 0;

  const rows = db
    .prepare(
      `SELECT id, repo_id, rel_path, language, size_bytes, indexed_at
       FROM files
       WHERE rel_path LIKE ? ESCAPE '\\' ${repoFilter}
       ORDER BY rel_path
       LIMIT ? OFFSET ?`,
    )
    .all(`%${escaped}%`, ...filterArgs, limit, offset) as Row[];

  const items = rows.map((r) => ({
    id: r.id,
    repoId: r.repo_id,
    relPath: r.rel_path,
    language: r.language,
    sizeBytes: r.size_bytes,
    indexedAt: r.indexed_at,
  }));

  return {
    items,
    total_count: totalCount,
    has_more: offset + items.length < totalCount,
    next_offset: offset + items.length,
  };
}
