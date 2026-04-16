import { randomUUID } from 'node:crypto';
import type { Db } from './db/index.js';
import { AppError, ErrorCode } from './errors.js';

export type Repo = {
  id: string;
  name: string;
  rootPath: string;
  language: string;
  indexedAt: string | null;
  fileCount: number;
  symbolCount: number;
  createdAt: string;
};

type Row = {
  id: string;
  name: string;
  root_path: string;
  language: string;
  indexed_at: string | null;
  file_count: number;
  symbol_count: number;
  created_at: string;
};

function rowToRepo(row: Row): Repo {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    language: row.language,
    indexedAt: row.indexed_at,
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    createdAt: row.created_at,
  };
}

export class RepoRegistry {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  register(opts: { name: string; rootPath: string; language?: string }): Repo {
    const id = randomUUID();
    try {
      this.db
        .prepare(`INSERT INTO repos (id, name, root_path, language) VALUES (?, ?, ?, ?)`)
        .run(id, opts.name, opts.rootPath, opts.language ?? '');
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
        throw new AppError(
          ErrorCode.REPO_ALREADY_EXISTS,
          `Repository "${opts.name}" already exists`,
          e,
        );
      }
      throw new AppError(ErrorCode.DB_ERROR, `Failed to register repo: ${String(e)}`, e);
    }
    return this.getById(id)!;
  }

  list(): Repo[] {
    return (this.db.prepare(`SELECT * FROM repos ORDER BY name`).all() as Row[]).map(rowToRepo);
  }

  getById(id: string): Repo | undefined {
    const row = this.db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id) as Row | undefined;
    return row ? rowToRepo(row) : undefined;
  }

  getByName(name: string): Repo | undefined {
    const row = this.db.prepare(`SELECT * FROM repos WHERE name = ?`).get(name) as Row | undefined;
    return row ? rowToRepo(row) : undefined;
  }

  update(
    id: string,
    patch: Partial<Pick<Repo, 'indexedAt' | 'fileCount' | 'symbolCount' | 'language'>>,
  ): void {
    if (patch.indexedAt !== undefined) {
      this.db.prepare(`UPDATE repos SET indexed_at = ? WHERE id = ?`).run(patch.indexedAt, id);
    }
    if (patch.fileCount !== undefined) {
      this.db.prepare(`UPDATE repos SET file_count = ? WHERE id = ?`).run(patch.fileCount, id);
    }
    if (patch.symbolCount !== undefined) {
      this.db.prepare(`UPDATE repos SET symbol_count = ? WHERE id = ?`).run(patch.symbolCount, id);
    }
    if (patch.language !== undefined) {
      this.db.prepare(`UPDATE repos SET language = ? WHERE id = ?`).run(patch.language, id);
    }
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM repos WHERE id = ?`).run(id);
  }
}
