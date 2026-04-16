import { loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { DbPool } from './db/pool.js';
import { RepoRegistry } from './registry.js';
import { Indexer } from './indexer/indexer.js';
import { Watcher } from './watcher/watcher.js';
import { McpServer } from './mcp/server.js';
import type { AiConfig } from './mcp/ai-adapter.js';

export class App {
  readonly config: Config;
  readonly log: Logger;
  readonly pool: DbPool;
  readonly registry: RepoRegistry;
  readonly indexer: Indexer;
  readonly watcher: Watcher;
  private mcpServer: McpServer | null = null;

  constructor() {
    this.config = loadConfig();
    this.log = createLogger(this.config.logLevel);
    this.pool = new DbPool(this.config.dbPath);
    const db = this.pool.acquire();
    this.registry = new RepoRegistry(db);
    this.indexer = new Indexer(db);
    this.watcher = new Watcher({ debounceMs: 300 });
  }

  async start(): Promise<void> {
    this.log.info({ dbPath: this.config.dbPath }, 'App starting');

    for (const repo of this.registry.list()) {
      this.log.info({ repo: repo.name }, 'Starting initial index');
      await this.indexer.indexRepo(repo.id, repo.rootPath);
      await this.watcher.watch(repo.rootPath);
      this.watcher.on('change', (path: string) => {
        this.log.debug({ path }, 'File changed; re-indexing repo');
        void this.indexer.indexRepo(repo.id, repo.rootPath);
      });
    }

    const aiConfig: AiConfig | null = this.config.aiApiKey
      ? {
          apiKey: this.config.aiApiKey,
          baseUrl: this.config.aiApiBaseUrl,
          model: this.config.aiModel,
        }
      : null;

    this.mcpServer = new McpServer({
      db: this.pool.acquire(),
      registry: this.registry,
      indexer: this.indexer,
      aiConfig,
    });

    await this.mcpServer.connectStdio();
    this.log.info('MCP server listening on stdio');
  }

  async stop(): Promise<void> {
    this.log.info('App stopping');
    await this.watcher.close();
    if (this.mcpServer) {
      await this.mcpServer.close();
      this.mcpServer = null;
    }
    this.pool.close();
  }
}
