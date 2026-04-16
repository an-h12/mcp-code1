import type { Db } from '../../db/index.js';

export type GetFileSymbolsParams = {
  repoId: string;
  relPath: string;
};

export type FileSymbol = {
  id: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature: string;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  signature: string;
};

export function getFileSymbols(db: Db, params: GetFileSymbolsParams): FileSymbol[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.start_line, s.end_line, s.signature
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE f.repo_id = ? AND f.rel_path = ?
       ORDER BY s.start_line`,
    )
    .all(params.repoId, params.relPath) as Row[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    startLine: r.start_line,
    endLine: r.end_line,
    signature: r.signature,
  }));
}
