import { loadConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { DbPool } from './db/pool.js';
import { RepoRegistry } from './registry.js';

export class App {
  readonly config: Config;
  readonly log: Logger;
  readonly pool: DbPool;
  readonly registry: RepoRegistry;

  constructor() {
    this.config = loadConfig();
    this.log = createLogger(this.config.logLevel);
    this.pool = new DbPool(this.config.dbPath);
    const db = this.pool.acquire();
    this.registry = new RepoRegistry(db);
  }

  async start(): Promise<void> {
    this.log.info({ dbPath: this.config.dbPath }, 'App starting');
    // Plans 2 and 3 will attach subsystems here
  }

  async stop(): Promise<void> {
    this.log.info('App stopping');
    this.pool.close();
  }
}
