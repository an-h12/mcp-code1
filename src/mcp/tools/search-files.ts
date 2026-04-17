import type { Db } from '../../db/index.js';

export type SearchFilesParams = {
  query: string;
  repoId: string | null;
  limit?: number;
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

export function searchFiles(db: Db, params: SearchFilesParams): FileResult[] {
  const limit = Math.min(params.limit ?? 50, 200);
  // Escape LIKE wildcards so queries with % or _ don't match too broadly.
  const escaped = params.query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const args: unknown[] = [`%${escaped}%`];
  const repoFilter = params.repoId ? `AND repo_id = ?` : '';
  if (params.repoId) args.push(params.repoId);
  args.push(limit);

  const rows = db
    .prepare(
      `SELECT id, repo_id, rel_path, language, size_bytes, indexed_at
       FROM files
       WHERE rel_path LIKE ? ESCAPE '\\' ${repoFilter}
       ORDER BY rel_path
       LIMIT ?`,
    )
    .all(...args) as Row[];

  return rows.map((r) => ({
    id: r.id,
    repoId: r.repo_id,
    relPath: r.rel_path,
    language: r.language,
    sizeBytes: r.size_bytes,
    indexedAt: r.indexed_at,
  }));
}
