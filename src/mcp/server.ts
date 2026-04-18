import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '../db/index.js';
import type { RepoRegistry } from '../registry.js';
import type { Indexer } from '../indexer/indexer.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import type { AiConfig } from './ai-adapter.js';
import type { InMemoryGraph } from '../graph/in-memory-graph.js';


export const TOOL_NAMES = [
  'code_search_symbols',
  'code_get_symbol_detail',
  'code_list_repos',
  'code_register_repo',
  'code_index_repo',
  'code_find_references',
  'code_search_files',
  'code_get_file_symbols',
  'code_explain_symbol',
  'code_get_repo_stats',
  'code_remove_repo',
  'code_get_symbol_context',
  'code_get_import_chain',
  'code_find_callers',
  'code_find_callees',
  'code_get_impact_analysis',
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
      { name: 'code-intelligence-mcp-server', version: '0.1.0' },
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
