import { openDb } from './index.js';
import type { Db } from './index.js';

/**
 * DbPool wraps a single SQLite connection shared across the process.
 * SQLite is not truly concurrent, but this pool provides a clean lifecycle
 * (acquire / release / close) that other modules can depend on.
 */
export class DbPool {
  private db: Db | null = null;
  private refCount = 0;
  private closed = false;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  acquire(): Db {
    if (this.closed) throw new Error('DbPool is closed');
    if (!this.db) this.db = openDb(this.dbPath);
    this.refCount++;
    return this.db;
  }

  release(): void {
    if (this.refCount > 0) this.refCount--;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.closed = true;
    this.refCount = 0;
  }

  get isOpen(): boolean {
    return !this.closed && this.db !== null;
  }
}
