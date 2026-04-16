import type { Db } from '../../db/index.js';

export type RepoStats = {
  repoId: string;
  fileCount: number;
  symbolCount: number;
  lastIndexedAt: string | null;
  languageBreakdown: Record<string, number>;
};

type CountsRow = {
  file_count: number;
  symbol_count: number;
  indexed_at: string | null;
};

type LangRow = { language: string; cnt: number };

export function getRepoStats(db: Db, repoId: string): RepoStats {
  const counts = db
    .prepare(`SELECT file_count, symbol_count, indexed_at FROM repos WHERE id = ?`)
    .get(repoId) as CountsRow | undefined;

  const fileCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM files WHERE repo_id = ?`)
    .get(repoId) as { cnt: number };
  const symCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM symbols WHERE repo_id = ?`)
    .get(repoId) as { cnt: number };

  const langRows = db
    .prepare(`SELECT language, COUNT(*) as cnt FROM files WHERE repo_id = ? GROUP BY language`)
    .all(repoId) as LangRow[];

  const languageBreakdown: Record<string, number> = {};
  for (const row of langRows) languageBreakdown[row.language] = row.cnt;

  return {
    repoId,
    fileCount: counts?.file_count || fileCountRow.cnt,
    symbolCount: counts?.symbol_count || symCountRow.cnt,
    lastIndexedAt: counts?.indexed_at ?? null,
    languageBreakdown,
  };
}
