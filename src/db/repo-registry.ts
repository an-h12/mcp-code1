import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { Db } from './index.js';

function slugify(p: string): string {
  return p.replace(/[^\w]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo';
}

export { slugify };

export function ensureRepo(db: Db, rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, '/').toLowerCase();
  const repoId = createHash('sha256').update(normalized).digest('hex').slice(0, 16);

  db.prepare(
    `INSERT INTO repos (id, name, root_path)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name`,
  ).run(repoId, basename(rootPath), normalized);

  return repoId;
}
