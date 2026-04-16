import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Db } from '../db/index.js';
import type { ModuleMap } from './module-map.js';

export type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

export type RawEdge = {
  sourceId: string;
  targetName: string;
  targetId: string | null;
  type: EdgeType;
  language: string;
};

const SUPPORTED_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.cs',
]);

const MAX_EDGES_PER_FILE = 10_000;

export class RelationExtractor {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Full Pass 2: run tree-sitter queries on a file and persist edges.
   * Returns number of edges written. Currently a stub — tree-sitter wiring
   * left for follow-up work; this method provides the extension guard and
   * existing tests rely on _insertEdgesForTest for direct edge persistence.
   */
  extractAndPersist(
    repoId: string,
    fileAbsPath: string,
    _relPath: string,
    fileId: string,
    moduleMap: ModuleMap,
  ): number {
    const ext = extname(fileAbsPath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) return 0;
    void moduleMap;
    void fileId;
    void repoId;
    return 0;
  }

  /**
   * Test helper — bypass tree-sitter and directly persist raw edges.
   * Also used by C# Roslyn bridge (Plan 5e).
   */
  _insertEdgesForTest(repoId: string, fileId: string, edges: RawEdge[]): void {
    this._persistEdges(repoId, fileId, edges);
  }

  _persistEdges(repoId: string, fileId: string, edges: RawEdge[]): void {
    let capped = edges;
    if (edges.length > MAX_EDGES_PER_FILE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[RelationExtractor] file ${fileId} has ${edges.length} edges — capping to ${MAX_EDGES_PER_FILE}`,
      );
      capped = edges.slice(0, MAX_EDGES_PER_FILE);
    }

    const deleteStmt = this.db.prepare(`
      DELETE FROM symbol_relations
      WHERE source_id IN (
        SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?
      )
    `);

    const insertStmt = this.db.prepare(`
      INSERT INTO symbol_relations(id, repo_id, source_id, target_id, target_name, type, language, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsert = this.db.transaction(() => {
      deleteStmt.run(fileId, repoId);
      for (const edge of capped) {
        const confidence = edge.targetId !== null ? 1.0 : 0.7;
        insertStmt.run(
          randomUUID(),
          repoId,
          edge.sourceId,
          edge.targetId ?? null,
          edge.targetName,
          edge.type,
          edge.language,
          confidence,
        );
      }
    });

    upsert();
  }
}
