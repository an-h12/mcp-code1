import { readdirSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
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
  private scanInProgress = new Set<string>();
  private pendingRescan = new Map<string, string>(); // repoId -> rootPath

  constructor(db: Db, concurrency = 4) {
    this.db = db;
    this.queue = new PQueue({ concurrency });
    this.supportedExts = new Set(supportedExtensions());
    this.relationExtractor = new RelationExtractor(db);
    this.moduleMap = new ModuleMap();
  }

  async indexRepo(repoId: string, rootPath: string): Promise<IndexRepoResult> {
    // If a scan is already running, remember that another scan was requested
    // and let the running one pick it up when it finishes. Avoids silently
    // dropping file changes that arrive during a long scan.
    if (this.scanInProgress.has(repoId)) {
      this.pendingRescan.set(repoId, rootPath);
      // eslint-disable-next-line no-console
      console.warn(`[Indexer] scan already in progress for ${repoId} — queued follow-up scan`);
      return {
        repoId,
        filesIndexed: 0,
        filesSkipped: 0,
        symbolsAdded: 0,
        symbolsRemoved: 0,
        durationMs: 0,
      };
    }

    this.scanInProgress.add(repoId);
    try {
      const result = await this._doIndexRepo(repoId, rootPath);

      // Drain any rescans that were requested while this one was running.
      // Loop because another rescan may be queued during the follow-up too.
      while (this.pendingRescan.has(repoId)) {
        const nextRoot = this.pendingRescan.get(repoId)!;
        this.pendingRescan.delete(repoId);
        // eslint-disable-next-line no-console
        console.warn(`[Indexer] running queued follow-up scan for ${repoId}`);
        await this._doIndexRepo(repoId, nextRoot);
      }

      return result;
    } finally {
      this.scanInProgress.delete(repoId);
    }
  }

  /**
   * Re-index a single file. Used by the watcher on 'change' / 'add' events
   * so we don't walk the whole repo for one edit.
   */
  async indexSingleFile(repoId: string, absPath: string, rootPath: string): Promise<void> {
    const ext = extname(absPath);
    if (!this.supportedExts.has(ext)) return;
    await indexFile(this.db, repoId, absPath, rootPath);
  }

  /**
   * Remove a file (and cascade its symbols via FK ON DELETE CASCADE) from the
   * index. Used by the watcher on 'unlink' and by the orphan cleanup pass.
   */
  removeFile(repoId: string, relPath: string): void {
    this.db
      .prepare(`DELETE FROM files WHERE repo_id = ? AND rel_path = ?`)
      .run(repoId, relPath);
  }

  private async _doIndexRepo(repoId: string, rootPath: string): Promise<IndexRepoResult> {
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

    // Orphan cleanup: files present in DB but no longer on disk are deleted
    // here. Covers the "user deleted files while MCP server / VS Code was
    // closed" case. symbols and relations cascade via FK ON DELETE CASCADE.
    const onDiskRelPaths = new Set(
      files.map((f) =>
        sep === '\\' ? relative(rootPath, f).split('\\').join('/') : relative(rootPath, f),
      ),
    );
    const dbRows = this.db
      .prepare(`SELECT id, rel_path FROM files WHERE repo_id = ?`)
      .all(repoId) as Array<{ id: string; rel_path: string }>;
    const orphanIds: string[] = [];
    for (const row of dbRows) {
      if (!onDiskRelPaths.has(row.rel_path)) orphanIds.push(row.id);
    }
    if (orphanIds.length > 0) {
      const deleteOrphans = this.db.transaction((ids: string[]) => {
        const stmt = this.db.prepare(`DELETE FROM files WHERE id = ?`);
        for (const id of ids) stmt.run(id);
      });
      deleteOrphans(orphanIds);
      // eslint-disable-next-line no-console
      console.warn(`[Indexer] cleaned ${orphanIds.length} orphan file row(s)`);
    }

    // Populate ModuleMap from DB (all symbols in repo, keyed by rel_path)
    this.moduleMap = new ModuleMap();
    const symRows = this.db
      .prepare(
        `SELECT s.id, s.name, f.rel_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.repo_id = ?`,
      )
      .all(repoId) as Array<{ id: string; name: string; rel_path: string }>;
    const byFile = new Map<string, Array<{ id: string; name: string }>>();
    for (const r of symRows) {
      const list = byFile.get(r.rel_path) ?? [];
      list.push({ id: r.id, name: r.name });
      byFile.set(r.rel_path, list);
    }
    for (const [relPath, syms] of byFile) {
      this.moduleMap.register(relPath, syms);
    }

    // Pass 2: extract and persist relations for all indexed files
    let edgesTotal = 0;
    for (const f of files) {
      const relPath = sep === '\\' ? relative(rootPath, f).split('\\').join('/') : relative(rootPath, f);
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
