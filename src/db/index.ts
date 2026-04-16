import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrations/index.js';

export type Db = BetterSqlite3.Database;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new BetterSqlite3(dbPath, {
    verbose: process.env['LOG_LEVEL'] === 'trace' ? console.log : undefined,
  });

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  return db;
}
