import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import PQueue from 'p-queue';
import type { Db } from '../db/index.js';
import { supportedExtensions } from '../parser/grammars.js';
import { indexFile } from './index-file.js';
import { RelationExtractor } from './relation-extractor.js';
import { ModuleMap } from './module-map.js';

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
  // C# specific
  'obj',
  'bin',
  'packages',
  '.vs',
]);

const CS_IGNORE_SUFFIXES = ['.Designer.cs', '.g.cs', '.generated.cs'];
const CS_IGNORE_NAMES = new Set(['AssemblyInfo.cs', 'GlobalUsings.g.cs']);

export class Indexer {
  private db: Db;
  private queue: PQueue;
  private supportedExts: Set<string>;
  private relationExtractor: RelationExtractor;
  private moduleMap: ModuleMap;

  constructor(db: Db, concurrency = 4) {
    this.db = db;
    this.queue = new PQueue({ concurrency });
    this.supportedExts = new Set(supportedExtensions());
    this.relationExtractor = new RelationExtractor(db);
    this.moduleMap = new ModuleMap();
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

    // Pass 2: extract and persist relations for all indexed files
    let edgesTotal = 0;
    for (const f of files) {
      const relPath = f.replace(rootPath + '/', '').replace(rootPath + '\\', '');
      const fileRow = this.db
        .prepare(`SELECT id FROM files WHERE repo_id = ? AND rel_path = ?`)
        .get(repoId, relPath) as { id: string } | undefined;
      if (!fileRow) continue;
      edgesTotal += this.relationExtractor.extractAndPersist(
        repoId,
        f,
        relPath,
        fileRow.id,
        this.moduleMap,
      );
    }
    void edgesTotal;

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
        if (CS_IGNORE_NAMES.has(entry) || CS_IGNORE_SUFFIXES.some((s) => entry.endsWith(s))) {
          continue;
        }
        if (this.supportedExts.has(extname(full))) {
          out.push(full);
        }
      }
    }
  }
}
