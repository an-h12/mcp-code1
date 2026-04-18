import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { DbPool } from './db/pool.js';
import type { Db } from './db/index.js';
import { RepoRegistry } from './registry.js';
import { Indexer } from './indexer/indexer.js';
import { Watcher } from './watcher/watcher.js';
import { CodeMcpServer } from './mcp/server.js';
import type { AiConfig } from './mcp/ai-adapter.js';
import { InMemoryGraph } from './graph/in-memory-graph.js';
import { ensureRepo } from './db/repo-registry.js';
import { ContextEnricher } from './mcp/context-enricher.js';

export class App {
  readonly config: Config;
  readonly log: Logger;
  readonly pool: DbPool;
  readonly db: Db;
  readonly registry: RepoRegistry;
  readonly indexer: Indexer;
  readonly watcher: Watcher;
  readonly graph: InMemoryGraph;
  readonly contextEnricher: ContextEnricher;
  readonly repoRoot: string;
  repoId: string = '';
  private mcpServer: CodeMcpServer | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.config = loadConfig();
    this.log = createLogger(this.config.logLevel);

    // Resolve REPO_ROOT (single-repo model)
    this.repoRoot = process.env['REPO_ROOT']
      ? path.resolve(process.env['REPO_ROOT'])
      : process.cwd();

    if (!existsSync(this.repoRoot)) {
      this.log.fatal({ repoRoot: this.repoRoot }, 'REPO_ROOT does not exist — check your Cline MCP config');
      process.exit(1);
    }

    const dbPath = this.config.dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });

    this.pool = new DbPool(dbPath);
    this.db = this.pool.acquire();
    this.registry = new RepoRegistry(this.db);
    this.indexer = new Indexer(this.db);
    this.watcher = new Watcher({ debounceMs: 300 });
    this.graph = new InMemoryGraph(this.db);

    this.repoId = ensureRepo(this.db, this.repoRoot);
    this.contextEnricher = new ContextEnricher(this.repoId, this.db, this.graph);
  }

  async start(): Promise<void> {
    this.log.info({ dbPath: this.config.dbPath, repoId: this.repoId }, 'App starting');

    this.graph.startEviction();

    this.graph.setScanInProgress(this.repoId, true);

    this.indexer
      .indexRepo(this.repoId, this.repoRoot)
      .then(() => {
        this.graph.setScanInProgress(this.repoId, false);
        this.graph.invalidate(this.repoId);
        this.log.info({ repoId: this.repoId }, 'Initial index complete — graph ready');
      })
      .catch((err: unknown) => {
        this.graph.setScanInProgress(this.repoId, false);
        this.log.error({ err, repoId: this.repoId }, 'runFullScan failed — retrying in 60s');
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.graph.setScanInProgress(this.repoId, true);
          this.indexer
            .indexRepo(this.repoId, this.repoRoot)
            .then(() => {
              this.graph.setScanInProgress(this.repoId, false);
              this.graph.invalidate(this.repoId);
            })
            .catch((e: unknown) => {
              this.graph.setScanInProgress(this.repoId, false);
              this.log.error({ e }, 'runFullScan retry also failed — restart server to recover');
            });
        }, 60_000);
      });

    await this.watcher.watch(this.repoRoot);
    // HIGH #4: catch watcher errors — unhandled 'error' events crash the process
    this.watcher.on('error', (err: unknown) => {
      this.log.error({ err }, 'Watcher error');
    });

    const reindexOne = (filePath: string): void => {
      this.indexer
        .indexSingleFile(this.repoId, filePath, this.repoRoot)
        .then(() => {
          this.graph.invalidate(this.repoId);
        })
        .catch((err: unknown) => {
          this.log.error({ err, filePath }, 'Single-file re-index failed');
        });
    };

    // CRITICAL #1: invalidate graph cache after reindex so get_symbol_context sees fresh data
    this.watcher.on('change', (filePath: string) => {
      this.log.debug({ filePath }, 'File changed — re-indexing single file');
      reindexOne(filePath);
    });

    // P0 #2: handle file creation — previously dropped
    this.watcher.on('add', (filePath: string) => {
      this.log.debug({ filePath }, 'File added — indexing');
      reindexOne(filePath);
    });

    // P0 #2: handle file deletion — previously left orphan symbols in DB
    this.watcher.on('unlink', (filePath: string) => {
      this.log.debug({ filePath }, 'File removed — cleaning up index');
      try {
        const relPath = path.sep === '\\'
          ? path.relative(this.repoRoot, filePath).split('\\').join('/')
          : path.relative(this.repoRoot, filePath);
        this.indexer.removeFile(this.repoId, relPath);
        this.graph.invalidate(this.repoId);
      } catch (err: unknown) {
        this.log.error({ err, filePath }, 'removeFile failed');
      }
    });

    const aiConfig: AiConfig | null = this.config.aiApiKey
      ? {
          apiKey: this.config.aiApiKey,
          baseUrl: this.config.aiApiBaseUrl,
          model: this.config.aiModel,
        }
      : null;

    this.mcpServer = new CodeMcpServer({
      db: this.db,
      registry: this.registry,
      indexer: this.indexer,
      aiConfig,
      graph: this.graph,
      repoId: this.repoId,
    });

    const port = this.config.mcpPort;
    await this.mcpServer.connectHttp(port);
    this.log.info({ port }, 'MCP server listening on HTTP — connect Cline to http://127.0.0.1:' + port + '/mcp');
  }

  async stop(): Promise<void> {
    this.log.info('App stopping');
    // HIGH #5: clear pending retry timer so it doesn't fire after DB close
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.graph.stopEviction();
    await this.watcher.close();
    if (this.mcpServer) {
      await this.mcpServer.close();
      this.mcpServer = null;
    }
    this.pool.release();
    this.pool.close();
  }
}
