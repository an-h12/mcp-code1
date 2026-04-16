import type { Db } from '../../db/index.js';

export type FindReferencesParams = {
  symbolName: string;
  repoId: string | null;
};

export type ReferenceResult = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  repo_id: string;
  rel_path: string;
  start_line: number;
};

export function findReferences(db: Db, params: FindReferencesParams): ReferenceResult[] {
  const args: unknown[] = [params.symbolName];
  const repoFilter = params.repoId ? `AND s.repo_id = ?` : '';
  if (params.repoId) args.push(params.repoId);

  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.name = ? ${repoFilter}
       ORDER BY f.rel_path, s.start_line
       LIMIT 200`,
    )
    .all(...args) as Row[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    repoId: r.repo_id,
    filePath: r.rel_path,
    startLine: r.start_line,
  }));
}
