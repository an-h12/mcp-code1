import type Database from 'better-sqlite3';

export const version = 2;
export const name = 'symbol_relations';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_relations (
      id          TEXT PRIMARY KEY,
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      source_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
      target_id   TEXT,
      target_name TEXT NOT NULL,
      target_file TEXT,
      type        TEXT NOT NULL CHECK(type IN ('CALLS','IMPORTS','EXTENDS','IMPLEMENTS')),
      language    TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 1.0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_relations_source
      ON symbol_relations(source_id);

    CREATE INDEX IF NOT EXISTS idx_relations_target
      ON symbol_relations(target_id);

    CREATE INDEX IF NOT EXISTS idx_relations_repo
      ON symbol_relations(repo_id);

    CREATE INDEX IF NOT EXISTS idx_relations_repo_type
      ON symbol_relations(repo_id, type);
  `);
}
