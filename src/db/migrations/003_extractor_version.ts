import type Database from 'better-sqlite3';

export const version = 3;
export const name = 'extractor_version';

/**
 * Adds an `extractor_version` column to the `files` table so we can invalidate
 * cached parse results when the symbol extractor logic changes. Without this
 * column the hash-only skip in indexFile() keeps stale symbols forever after
 * an upgrade that changes grammar / query / kind-mapping.
 */
export function up(db: Database.Database): void {
  const cols = db
    .prepare(`PRAGMA table_info(files)`)
    .all() as Array<{ name: string }>;
  const has = cols.some((c) => c.name === 'extractor_version');
  if (!has) {
    db.exec(`ALTER TABLE files ADD COLUMN extractor_version INTEGER NOT NULL DEFAULT 0`);
  }
}
