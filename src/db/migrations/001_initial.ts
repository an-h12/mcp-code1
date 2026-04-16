import type Database from 'better-sqlite3';

export const version = 1;
export const name = 'initial_schema';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT    NOT NULL,
      applied_at TEXT   NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS repos (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      root_path   TEXT NOT NULL UNIQUE,
      language    TEXT NOT NULL DEFAULT '',
      indexed_at  TEXT,
      file_count  INTEGER NOT NULL DEFAULT 0,
      symbol_count INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id          TEXT PRIMARY KEY,
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      rel_path    TEXT NOT NULL,
      language    TEXT NOT NULL DEFAULT '',
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      hash        TEXT NOT NULL DEFAULT '',
      indexed_at  TEXT,
      UNIQUE(repo_id, rel_path)
    );
    CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repo_id);

    CREATE TABLE IF NOT EXISTS symbols (
      id          TEXT PRIMARY KEY,
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      start_line  INTEGER NOT NULL,
      end_line    INTEGER NOT NULL,
      signature   TEXT NOT NULL DEFAULT '',
      doc_comment TEXT NOT NULL DEFAULT '',
      parent_id   TEXT REFERENCES symbols(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_symbols_repo  ON symbols(repo_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_file  ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_name  ON symbols(name);

    CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
      name,
      signature,
      doc_comment,
      content='symbols',
      content_rowid='rowid',
      tokenize="unicode61 tokenchars '_-'"
    );

    CREATE TRIGGER IF NOT EXISTS symbols_fts_insert AFTER INSERT ON symbols BEGIN
      INSERT INTO symbols_fts(rowid, name, signature, doc_comment)
      VALUES (new.rowid, new.name, new.signature, new.doc_comment);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_fts_delete AFTER DELETE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc_comment)
      VALUES ('delete', old.rowid, old.name, old.signature, old.doc_comment);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_fts_update AFTER UPDATE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc_comment)
      VALUES ('delete', old.rowid, old.name, old.signature, old.doc_comment);
      INSERT INTO symbols_fts(rowid, name, signature, doc_comment)
      VALUES (new.rowid, new.name, new.signature, new.doc_comment);
    END;
  `);
}
