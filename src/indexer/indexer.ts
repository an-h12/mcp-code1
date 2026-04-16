import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import PQueue from 'p-queue';
import type { Db } from '../db/index.js';
import { supportedExtensions } from '../parser/grammars.js';
import { indexFile } from './index-file.js';

export type IndexRepoResult = {
  repoId: string;
  filesIndexed: number;
  filesSkipped: number;
  symbolsAdded: number;
  symbolsRemoved: number;
  durationMs: number;
};

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  'vendor',
  '.idea',
  '.vscode',
]);

export class Indexer {
  private db: Db;
  private queue: PQueue;
  private supportedExts: Set<string>;

  constructor(db: Db, concurrency = 4) {
    this.db = db;
    this.queue = new PQueue({ concurrency });
    this.supportedExts = new Set(supportedExtensions());
  }

  async indexRepo(repoId: string, rootPath: string): Promise<IndexRepoResult> {
    const start = Date.now();
    const files = this.collectFiles(rootPath);

    let filesIndexed = 0;
    let filesSkipped = 0;
    let symbolsAdded = 0;
    let symbolsRemoved = 0;

    const tasks = files.map((f) =>
      this.queue.add(async () => {
        const result = await indexFile(this.db, repoId, f, rootPath);
        if (result.skipped) {
          filesSkipped++;
        } else {
          filesIndexed++;
          symbolsAdded += result.symbolsAdded;
          symbolsRemoved += result.symbolsRemoved;
        }
      }),
    );

    await Promise.all(tasks);

    return {
      repoId,
      filesIndexed,
      filesSkipped,
      symbolsAdded,
      symbolsRemoved,
      durationMs: Date.now() - start,
    };
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    this.walk(dir, results);
    return results;
  }

  private walk(dir: string, out: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') && entry !== '.') continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (IGNORE_DIRS.has(entry)) continue;
        this.walk(full, out);
      } else if (stat.isFile()) {
        if (this.supportedExts.has(extname(full))) {
          out.push(full);
        }
      }
    }
  }
}
