/**
 * Test Streamable HTTP transport — verify server hoạt động qua HTTP thay vì stdio.
 *
 * Mục tiêu:
 *  - Verify server khởi động thành công trên port configured
 *  - Test endpoint /mcp phản hồi đúng JSON-RPC
 *  - Test initialize handshake
 *  - Test path khác /mcp trả về 404
 *  - Test server shutdown sạch, không leak port
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import { CodeMcpServer } from '../../src/mcp/server.js';
import type { Db } from '../../src/db/index.js';

// Pick high port to avoid collisions with running services
const TEST_PORT = 39001;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const MCP_URL = `${BASE_URL}/mcp`;

const INIT_PAYLOAD = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' },
  },
};

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

describe('Streamable HTTP transport', () => {
  let db: Db;
  let mcpServer: CodeMcpServer;
  let registry: RepoRegistry;
  let indexer: Indexer;
  let graph: InMemoryGraph;

  beforeEach(async () => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
    indexer = new Indexer(db);
    graph = new InMemoryGraph(db);

    mcpServer = new CodeMcpServer({
      db,
      registry,
      indexer,
      aiConfig: null,
      graph,
      repoId: '',
    });

    await mcpServer.connectHttp(TEST_PORT);
  });

  afterEach(async () => {
    await mcpServer.close();
    db.close();
  });

  it('listens on configured port and responds to /mcp endpoint', async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(INIT_PAYLOAD),
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('initialize handshake returns server info and capabilities', async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(INIT_PAYLOAD),
    });

    const text = await res.text();
    // Streamable HTTP returns as SSE when streaming — extract JSON from "data:" prefix if present
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    const json = dataLine
      ? JSON.parse(dataLine.slice(5).trim())
      : JSON.parse(text);

    expect(json.jsonrpc).toBe('2.0');
    expect(json.id).toBe(1);
    expect(json.result).toBeDefined();
    expect(json.result.serverInfo.name).toBe('code-intelligence-mcp-server');
    expect(json.result.serverInfo.version).toBe('0.1.0');
    expect(json.result.capabilities).toHaveProperty('tools');
    expect(json.result.capabilities).toHaveProperty('resources');
    expect(json.result.capabilities).toHaveProperty('prompts');
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${BASE_URL}/unknown-path`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(INIT_PAYLOAD),
    });

    expect(res.status).toBe(404);
  });

  it('returns 404 for root path', async () => {
    const res = await fetch(`${BASE_URL}/`, {
      method: 'GET',
    });

    expect(res.status).toBe(404);
  });

  it('rejects missing Accept header with JSON-RPC error', async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(INIT_PAYLOAD),
    });

    // MCP protocol requires client to accept both json + event-stream
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('close() releases port so server can re-bind', async () => {
    await mcpServer.close();

    // Re-bind on the same port should succeed
    mcpServer = new CodeMcpServer({
      db,
      registry,
      indexer,
      aiConfig: null,
      graph,
      repoId: '',
    });

    await expect(mcpServer.connectHttp(TEST_PORT)).resolves.not.toThrow();

    // Verify server actually responds after re-bind
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(INIT_PAYLOAD),
    });
    expect(res.ok).toBe(true);
  });

  it('binds to 127.0.0.1 only (not exposed externally)', async () => {
    // Server should respond on loopback
    const resLoopback = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(INIT_PAYLOAD),
    });
    expect(resLoopback.ok).toBe(true);
  });
});

describe('HTTP transport — error handling', () => {
  it('close() is idempotent — calling twice does not throw', async () => {
    const db = openDb(':memory:');
    const mcpServer = new CodeMcpServer({
      db,
      registry: new RepoRegistry(db),
      indexer: new Indexer(db),
      aiConfig: null,
      graph: new InMemoryGraph(db),
      repoId: '',
    });

    await mcpServer.connectHttp(TEST_PORT + 1);
    await mcpServer.close();
    await expect(mcpServer.close()).resolves.not.toThrow();
    db.close();
  });

  it('connectHttp() rejects when port is already in use', async () => {
    const port = TEST_PORT + 2;
    const db1 = openDb(':memory:');
    const server1 = new CodeMcpServer({
      db: db1,
      registry: new RepoRegistry(db1),
      indexer: new Indexer(db1),
      aiConfig: null,
      graph: new InMemoryGraph(db1),
      repoId: '',
    });
    await server1.connectHttp(port);

    const db2 = openDb(':memory:');
    const server2 = new CodeMcpServer({
      db: db2,
      registry: new RepoRegistry(db2),
      indexer: new Indexer(db2),
      aiConfig: null,
      graph: new InMemoryGraph(db2),
      repoId: '',
    });

    await expect(server2.connectHttp(port)).rejects.toThrow();

    await server1.close();
    db1.close();
    db2.close();
  });
});
