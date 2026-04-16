import type { Db } from '../db/index.js';
import { IdMapper } from './id-mapper.js';
import type { RepoGraph, GraphNode, IntId, EdgeType } from './types.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const EVICT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function makeEmptyRepoGraph(): RepoGraph {
  return { nodes: new Map(), mapper: new IdMapper(), fileIndex: new Map() };
}

export class InMemoryGraph {
  private graphs = new Map<string, RepoGraph>();
  private lastAccess = new Map<string, number>();
  private scanInProgress = new Set<string>();
  private evictTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Db) {}

  startEviction(): void {
    if (this.evictTimer) return;
    const timer = setInterval(() => this.evictStale(), EVICT_INTERVAL_MS);
    if (typeof (timer as NodeJS.Timeout).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }
    this.evictTimer = timer;
  }

  stopEviction(): void {
    if (this.evictTimer) {
      clearInterval(this.evictTimer);
      this.evictTimer = null;
    }
  }

  setScanInProgress(repoId: string, inProgress: boolean): void {
    if (inProgress) this.scanInProgress.add(repoId);
    else this.scanInProgress.delete(repoId);
  }

  invalidate(repoId: string): void {
    this.graphs.delete(repoId);
    this.lastAccess.delete(repoId);
  }

  getGraph(repoId: string): RepoGraph {
    if (this.scanInProgress.has(repoId)) return makeEmptyRepoGraph();
    this.lastAccess.set(repoId, Date.now());
    if (!this.graphs.has(repoId)) {
      this.graphs.set(repoId, this.loadFromDb(repoId));
    }
    return this.graphs.get(repoId)!;
  }

  evictStale(): void {
    const now = Date.now();
    for (const [repoId, lastUsed] of this.lastAccess) {
      if (now - lastUsed > TTL_MS) {
        this.graphs.delete(repoId);
        this.lastAccess.delete(repoId);
      }
    }
  }

  loadFromDb(repoId: string, minConfidence = 0.5): RepoGraph {
    const rows = this.db
      .prepare(
        `SELECT source_id, target_id, type, confidence
         FROM symbol_relations
         WHERE repo_id = ?
           AND target_id IS NOT NULL
           AND confidence >= ?`,
      )
      .all(repoId, minConfidence) as Array<{
      source_id: string;
      target_id: string;
      type: EdgeType;
      confidence: number;
    }>;

    const symbolFileRows = this.db
      .prepare(`SELECT id, file_id FROM symbols WHERE repo_id = ?`)
      .all(repoId) as Array<{ id: string; file_id: string }>;

    const mapper = new IdMapper();
    const nodes = new Map<IntId, GraphNode>();
    const fileIndex = new Map<string, IntId[]>();

    for (const row of symbolFileRows) {
      const intId = mapper.intern(row.id);
      if (!nodes.has(intId)) nodes.set(intId, { outgoing: [], incoming: [] });
      const list = fileIndex.get(row.file_id) ?? [];
      list.push(intId);
      fileIndex.set(row.file_id, list);
    }

    for (const row of rows) {
      const srcInt = mapper.intern(row.source_id);
      const tgtInt = mapper.intern(row.target_id);
      if (!nodes.has(srcInt)) nodes.set(srcInt, { outgoing: [], incoming: [] });
      if (!nodes.has(tgtInt)) nodes.set(tgtInt, { outgoing: [], incoming: [] });
      nodes
        .get(srcInt)!
        .outgoing.push({ targetId: tgtInt, type: row.type, confidence: row.confidence });
    }

    // Derive incoming edges (reverse pass)
    for (const [srcInt, node] of nodes) {
      for (const edge of node.outgoing) {
        nodes
          .get(edge.targetId)!
          .incoming.push({ targetId: srcInt, type: edge.type, confidence: edge.confidence });
      }
    }

    return { nodes, mapper, fileIndex };
  }

  reloadFile(repoId: string, fileId: string): void {
    const graph = this.graphs.get(repoId);
    if (!graph) return;

    const CHUNK = 500;

    const affectedIntIds = graph.fileIndex.get(fileId) ?? [];

    // Collect stale outgoing targets, clear outgoing
    const staleTgtIds = new Set<IntId>();
    for (const intId of affectedIntIds) {
      const node = graph.nodes.get(intId);
      if (!node) continue;
      node.outgoing.forEach((e) => staleTgtIds.add(e.targetId));
      node.outgoing = [];
    }

    // Remove stale incoming edges from targets
    const affectedSet = new Set<IntId>(affectedIntIds);
    for (const tgtId of staleTgtIds) {
      const tgtNode = graph.nodes.get(tgtId);
      if (!tgtNode) continue;
      tgtNode.incoming = tgtNode.incoming.filter((e) => !affectedSet.has(e.targetId));
    }

    // Prune ghost nodes for deleted symbols
    const affectedUuids = affectedIntIds.map((id) => graph.mapper.resolve(id));
    const stillExistingUuids = new Set<string>();
    for (let i = 0; i < affectedUuids.length; i += CHUNK) {
      const batch = affectedUuids.slice(i, i + CHUNK);
      const rows = this.db
        .prepare(`SELECT id FROM symbols WHERE id IN (${batch.map(() => '?').join(',')})`)
        .all(...batch) as Array<{ id: string }>;
      rows.forEach((r) => stillExistingUuids.add(r.id));
    }
    const list = graph.fileIndex.get(fileId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const intId = list[i]!;
      const uuid = graph.mapper.resolve(intId);
      if (!stillExistingUuids.has(uuid)) {
        graph.nodes.delete(intId);
        list.splice(i, 1);
      }
    }

    // Re-sync fileIndex with current DB state
    const currentRows = this.db
      .prepare(`SELECT id FROM symbols WHERE file_id = ? AND repo_id = ?`)
      .all(fileId, repoId) as Array<{ id: string }>;

    const updatedIntIds: IntId[] = [];
    for (const row of currentRows) {
      const intId = graph.mapper.intern(row.id);
      if (!graph.nodes.has(intId)) {
        graph.nodes.set(intId, { outgoing: [], incoming: [] });
      }
      updatedIntIds.push(intId);
    }
    graph.fileIndex.set(fileId, updatedIntIds);

    // Re-load edges for current symbols — chunked
    const allCurrentUuids = currentRows.map((r) => r.id);
    const freshRows: Array<{
      source_id: string;
      target_id: string;
      type: EdgeType;
      confidence: number;
    }> = [];
    for (let i = 0; i < allCurrentUuids.length; i += CHUNK) {
      const batch = allCurrentUuids.slice(i, i + CHUNK);
      const rows = this.db
        .prepare(
          `SELECT source_id, target_id, type, confidence
           FROM symbol_relations
           WHERE source_id IN (${batch.map(() => '?').join(',')})
             AND target_id IS NOT NULL`,
        )
        .all(...batch) as typeof freshRows;
      freshRows.push(...rows);
    }

    for (const row of freshRows) {
      const srcInt = graph.mapper.intern(row.source_id);
      const tgtInt = graph.mapper.intern(row.target_id);
      if (!graph.nodes.has(tgtInt)) graph.nodes.set(tgtInt, { outgoing: [], incoming: [] });
      graph.nodes
        .get(srcInt)!
        .outgoing.push({ targetId: tgtInt, type: row.type, confidence: row.confidence });
      graph.nodes
        .get(tgtInt)!
        .incoming.push({ targetId: srcInt, type: row.type, confidence: row.confidence });
    }
  }
}
