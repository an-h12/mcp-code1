import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import type { Db } from '../db/index.js';
import { extractSymbols } from '../parser/extractor.js';
import { hashFile } from './file-hash.js';

export type IndexFileResult = {
  filePath: string;
  skipped: boolean;
  symbolsAdded: number;
  symbolsRemoved: number;
};

type FileRow = {
  id: string;
  hash: string;
};

/**
 * Normalize path to forward-slash form so DB lookups work cross-platform.
 * Windows returns "src\foo\bar.ts" from path.relative() — but LLMs / Cline
 * always use "src/foo/bar.ts". We store the normalized form in DB.
 */
function toPosixPath(p: string): string {
  return sep === '\\' ? p.split('\\').join('/') : p;
}

export async function indexFile(
  db: Db,
  repoId: string,
  absPath: string,
  repoRoot: string,
): Promise<IndexFileResult> {
  const ext = extname(absPath);
  const relPath = toPosixPath(relative(repoRoot, absPath));
  const hash = hashFile(absPath);

  const existing = db
    .prepare(`SELECT id, hash FROM files WHERE repo_id = ? AND rel_path = ?`)
    .get(repoId, relPath) as FileRow | undefined;

  if (existing && existing.hash === hash) {
    return { filePath: absPath, skipped: true, symbolsAdded: 0, symbolsRemoved: 0 };
  }

  const source = readFileSync(absPath, 'utf8');
  const rawSymbols = extractSymbols(source, ext);

  const upsertFile = db.transaction((): { symbolsAdded: number; symbolsRemoved: number } => {
    let fileId: string;
    let removed = 0;

    if (existing) {
      db.prepare(
        `UPDATE files SET hash = ?, indexed_at = datetime('now'), size_bytes = ? WHERE id = ?`,
      ).run(hash, statSync(absPath).size, existing.id);
      removed = db.prepare(`DELETE FROM symbols WHERE file_id = ?`).run(existing.id).changes;
      fileId = existing.id;
    } else {
      fileId = randomUUID();
      db.prepare(
        `INSERT INTO files (id, repo_id, rel_path, language, size_bytes, hash, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(fileId, repoId, relPath, ext.slice(1), statSync(absPath).size, hash);
    }

    const insertStmt = db.prepare(
      `INSERT INTO symbols (id, repo_id, file_id, name, kind, start_line, end_line, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    for (const sym of rawSymbols) {
      insertStmt.run(
        randomUUID(),
        repoId,
        fileId,
        sym.name,
        sym.kind,
        sym.startLine,
        sym.endLine,
        sym.signature,
      );
      added++;
    }
    return { symbolsAdded: added, symbolsRemoved: removed };
  });

  const counts = upsertFile();
  return { filePath: absPath, skipped: false, ...counts };
}
