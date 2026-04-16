import type Database from 'better-sqlite3';
import { version as v1, name as n1, up as up1 } from './001_initial.js';

const MIGRATIONS = [{ version: v1, name: n1, up: up1 }] as const;

export function runMigrations(db: Database.Database): void {
  // Ensure the tracking table exists first (chicken-and-egg handled by IF NOT EXISTS in 001)
  up1(db);

  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_migrations`).all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      const run = db.transaction(() => {
        migration.up(db);
        db.prepare(`INSERT INTO schema_migrations(version, name) VALUES (?, ?)`).run(
          migration.version,
          migration.name,
        );
      });
      run();
    }
  }
}
