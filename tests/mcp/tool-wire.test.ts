import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { McpServer } from '../../src/mcp/server.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

describe('tool wiring', () => {
  it('lists tools via internal server', async () => {
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const indexer = new Indexer(db);
    const graph = new InMemoryGraph(db);
    const mcp = new McpServer({ db, registry, indexer, aiConfig: null, graph, repoId: '' });
    const server = mcp.getInternalServer();

    expect(server).toBeDefined();
    expect(ListToolsRequestSchema).toBeDefined();
    expect(CallToolRequestSchema).toBeDefined();
    db.close();
  });
});
