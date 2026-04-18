import type { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '../db/index.js';
import type { RepoRegistry } from '../registry.js';
import type { Indexer } from '../indexer/indexer.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
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
  private _httpServer: HttpServer | null = null;

  constructor(opts: McpServerOptions) {
    this.opts = opts;
    this.server = new McpServer(
      { name: 'code-intelligence-mcp-server', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );
    registerTools(this.server, opts);
    registerResources(this.server, opts);
    registerPrompts(this.server, opts);
  }

  async connectHttp(port: number): Promise<void> {
    const http = await import('node:http');
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );

    const transport = new StreamableHTTPServerTransport({});

    const httpServer = http.createServer((req, res) => {
      if (req.url === '/mcp') {
        transport.handleRequest(req, res);
      } else {
        res.writeHead(404).end('Not found');
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.server.connect(transport as any);

    await new Promise<void>((resolve, reject) =>
      httpServer.listen(port, '127.0.0.1', () => resolve()).on('error', reject),
    );

    this._httpServer = httpServer;
  }

  async close(): Promise<void> {
    if (this._httpServer) {
      await new Promise<void>((resolve, reject) =>
        this._httpServer!.close((err) => (err ? reject(err) : resolve())),
      );
      this._httpServer = null;
    }
    await this.server.close();
  }

  getInternalServer(): McpServer {
    return this.server;
  }

  getOptions(): McpServerOptions {
    return this.opts;
  }
}
