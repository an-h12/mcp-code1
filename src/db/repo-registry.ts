import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { Db } from './index.js';

function slugify(p: string): string {
  return p.replace(/[^\w]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo';
}

export { slugify };

export function ensureRepo(db: Db, rootPath: string): string {
  // Normalize slashes for both storage and hash
  const normalizedSlashes = rootPath.replace(/\\/g, '/');
  // Only lowercase for hash input on Windows (case-insensitive FS);
  // preserve original case for root_path column to keep cross-platform accuracy.
  const hashInput = process.platform === 'win32'
    ? normalizedSlashes.toLowerCase()
    : normalizedSlashes;
  const repoId = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  db.prepare(
    `INSERT INTO repos (id, name, root_path)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       root_path = excluded.root_path`,
  ).run(repoId, basename(rootPath), normalizedSlashes);

  return repoId;
}
