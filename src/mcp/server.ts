import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '../db/index.js';
import type { RepoRegistry } from '../registry.js';
import type { Indexer } from '../indexer/indexer.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import type { AiConfig } from './ai-adapter.js';
import type { InMemoryGraph } from '../graph/in-memory-graph.js';


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
  'get_symbol_context',
  'get_import_chain',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type McpServerOptions = {
  db: Db;
  registry: RepoRegistry;
  indexer: Indexer;
  aiConfig: AiConfig | null;
  graph: InMemoryGraph;
  repoId: string;
};

export class CodeMcpServer {
  private server: McpServer;
  private opts: McpServerOptions;

  constructor(opts: McpServerOptions) {
    this.opts = opts;
    this.server = new McpServer(
      { name: 'mcp-code1', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    registerTools(this.server, opts);
    registerResources(this.server, opts);
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

  getInternalServer(): McpServer {
    return this.server;
  }

  getOptions(): McpServerOptions {
    return this.opts;
  }
}
