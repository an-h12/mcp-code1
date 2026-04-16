import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Db } from '../db/index.js';
import type { RepoRegistry } from '../registry.js';
import type { Indexer } from '../indexer/indexer.js';
import { registerToolHandlers } from './tools/index.js';
import { registerResourceHandlers } from './resources/index.js';
import type { AiConfig } from './ai-adapter.js';

export const TOOL_NAMES = [
  'search_symbols',
  'get_symbol_detail',
  'list_repos',
  'register_repo',
  'index_repo',
  'find_references',
  'search_files',
  'get_file_symbols',
  'explain_symbol',
  'get_repo_stats',
  'remove_repo',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type McpServerOptions = {
  db: Db;
  registry: RepoRegistry;
  indexer: Indexer;
  aiConfig: AiConfig | null;
};

export class McpServer {
  private server: Server;
  private opts: McpServerOptions;

  constructor(opts: McpServerOptions) {
    this.opts = opts;
    this.server = new Server(
      { name: 'mcp-code1', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    registerToolHandlers(this.server, opts);
    registerResourceHandlers(this.server, opts);
  }

  async connectStdio(): Promise<void> {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }

  getInternalServer(): Server {
    return this.server;
  }

  getOptions(): McpServerOptions {
    return this.opts;
  }
}
