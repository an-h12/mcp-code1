import type { Db } from '../../db/index.js';

export type SymbolDetail = {
  id: string;
  name: string;
  kind: string;
  repoId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  docComment: string;
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
  doc_comment: string;
};

export function getSymbolDetail(db: Db, symbolId: string): SymbolDetail | null {
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.repo_id, f.rel_path, s.start_line, s.end_line, s.signature, s.doc_comment
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.id = ?`,
    )
    .get(symbolId) as Row | undefined;

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    repoId: row.repo_id,
    filePath: row.rel_path,
    startLine: row.start_line,
    endLine: row.end_line,
    signature: row.signature,
    docComment: row.doc_comment,
  };
}
