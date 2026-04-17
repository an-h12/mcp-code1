import type Database from 'better-sqlite3';
import { version as v1, name as n1, up as up1 } from './001_initial.js';
import { version as v2, name as n2, up as up2 } from './002_relations.js';
import { version as v3, name as n3, up as up3 } from './003_extractor_version.js';

const MIGRATIONS = [
  { version: v1, name: n1, up: up1 },
  { version: v2, name: n2, up: up2 },
  { version: v3, name: n3, up: up3 },
] as const;

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
