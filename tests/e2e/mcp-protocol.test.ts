/**
 * Test MCP protocol compliance — mô phỏng cách Cline gửi JSON-RPC requests.
 *
 * Mục tiêu:
 *  - Verify server tuân thủ JSON-RPC 2.0 spec
 *  - Test malformed requests, concurrent calls, schema validation
 *  - Đảm bảo Cline không bao giờ làm crash server bằng input lạ
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import { McpServer } from '../../src/mcp/server.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

type Db = ReturnType<typeof openDb>;

type HandlerExtra = {
  signal: AbortSignal;
  sendNotification: () => Promise<void>;
  sendRequest: () => Promise<unknown>;
  requestId: string;
  authInfo: undefined;
};

const noopExtra: HandlerExtra = {
  signal: new AbortController().signal,
  sendNotification: async () => {},
  sendRequest: async () => ({}),
  requestId: 'test',
  authInfo: undefined,
};

function getHandler(server: Server, method: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = (server as any)._requestHandlers as Map<string, any>;
  const h = handlers.get(method);
  if (!h) throw new Error(`No handler for method: ${method}`);
  return h;
}

async function rpc(
  server: Server,
  method: string,
  params: Record<string, unknown> = {},
) {
  const handler = getHandler(server, method);
  return handler({ method, params }, noopExtra);
}

describe('MCP Protocol Compliance', () => {
  let db: Db;
  let mcpServer: McpServer;
  let sdkServer: Server;
  let graph: InMemoryGraph;

  beforeAll(() => {
    db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const indexer = new Indexer(db);
    graph = new InMemoryGraph(db);
    const repo = registry.register({ name: 'proto-test', rootPath: '/tmp/proto-test' });

    mcpServer = new McpServer({
      db,
      registry,
      indexer,
      aiConfig: null,
      graph,
      repoId: repo.id,
    });
    sdkServer = mcpServer.getInternalServer();
  });

  afterAll(() => {
    graph.stopEviction();
    db.close();
  });

  // ─── Handler registration ─────────────────────────────────────
  describe('Handler registration', () => {
    it('đã đăng ký handler cho tools/list', () => {
      expect(() => getHandler(sdkServer, 'tools/list')).not.toThrow();
    });

    it('đã đăng ký handler cho tools/call', () => {
      expect(() => getHandler(sdkServer, 'tools/call')).not.toThrow();
    });

    it('đã đăng ký handler cho resources/list', () => {
      expect(() => getHandler(sdkServer, 'resources/list')).not.toThrow();
    });

    it('đã đăng ký handler cho resources/read', () => {
      expect(() => getHandler(sdkServer, 'resources/read')).not.toThrow();
    });
  });

  // ─── tools/list response shape ────────────────────────────────
  describe('tools/list response shape', () => {
    it('trả về object có property "tools" là array', async () => {
      const result = await rpc(sdkServer, 'tools/list');
      expect(result).toHaveProperty('tools');
      expect(Array.isArray(result.tools)).toBe(true);
    });

    it('mỗi tool có đúng schema fields: name, description, inputSchema', async () => {
      const result = await rpc(sdkServer, 'tools/list');
      for (const tool of result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toHaveProperty('type');
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('mỗi tool có tên unique', async () => {
      const result = await rpc(sdkServer, 'tools/list');
      const names = result.tools.map((t: any) => t.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it('tools có required fields trong inputSchema đúng format', async () => {
      const result = await rpc(sdkServer, 'tools/list');
      for (const tool of result.tools) {
        if (tool.inputSchema.required) {
          expect(Array.isArray(tool.inputSchema.required)).toBe(true);
          // Mỗi required field phải có trong properties
          for (const field of tool.inputSchema.required) {
            expect(tool.inputSchema.properties).toHaveProperty(field);
          }
        }
      }
    });
  });

  // ─── tools/call response shape ────────────────────────────────
  describe('tools/call response shape', () => {
    it('success response có content[] dạng {type, text}', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_list_repos',
        arguments: {},
      });
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
      expect(result.content[0].type).toBe('text');
    });

    it('error response có isError: true và content giải thích lỗi', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'tool_không_tồn_tại',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBeTruthy();
    });

    it('error response KHÔNG throw — Cline luôn nhận được JSON hợp lệ', async () => {
      // Server không được throw exception cho client; phải trả isError
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_search_symbols',
        // thiếu 'query' required field
        arguments: {},
      });
      expect(result.isError).toBe(true);
    });
  });

  // ─── Zod input validation ─────────────────────────────────────
  describe('Zod input validation', () => {
    it('thiếu required field → isError', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_search_symbols',
        arguments: {}, // thiếu 'query'
      });
      expect(result.isError).toBe(true);
    });

    it('sai kiểu dữ liệu → isError', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_search_symbols',
        arguments: { query: 123 }, // phải là string
      });
      expect(result.isError).toBe(true);
    });

    it('depth ngoài range (>3) → isError', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_get_symbol_context',
        arguments: { symbol_name: 'foo', depth: 10 }, // max 3
      });
      expect(result.isError).toBe(true);
    });

    it('limit ngoài range → isError', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_search_symbols',
        arguments: { query: 'x', limit: 99999 }, // max 100
      });
      expect(result.isError).toBe(true);
    });

    it('arguments = null → SDK schema validation throw (Cline nhận JSON-RPC error)', async () => {
      // SDK schema require arguments là object/record — null sẽ bị reject trước khi vào tool handler.
      // Đây là behavior đúng: SDK sẽ format thành JSON-RPC error cho Cline.
      await expect(
        rpc(sdkServer, 'tools/call', {
          name: 'code_search_symbols',
          arguments: null as any,
        }),
      ).rejects.toThrow();
    });
  });

  // ─── Concurrent requests ──────────────────────────────────────
  describe('Concurrent requests', () => {
    it('xử lý 10 concurrent list_repos mà không crash', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => rpc(sdkServer, 'tools/call', { name: 'code_list_repos', arguments: {} })),
      );
      expect(results).toHaveLength(10);
      for (const r of results) {
        expect(r.isError).toBeFalsy();
      }
    });

    it('xử lý mixed concurrent tool calls', async () => {
      const calls = [
        rpc(sdkServer, 'tools/call', { name: 'code_list_repos', arguments: {} }),
        rpc(sdkServer, 'tools/call', { name: 'code_search_symbols', arguments: { query: 'x' } }),
        rpc(sdkServer, 'tools/call', { name: 'code_search_files', arguments: { query: 'y' } }),
        rpc(sdkServer, 'tools/list'),
        rpc(sdkServer, 'tools/call', { name: 'unknown', arguments: {} }),
      ];
      const results = await Promise.all(calls);
      expect(results).toHaveLength(5);
      // Kết quả không bị lẫn lộn giữa các request
      expect(results[0]).toHaveProperty('content');
      expect(results[3]).toHaveProperty('tools');
    });
  });

  // ─── JSON serialization ───────────────────────────────────────
  describe('JSON serialization', () => {
    it('text content JSON-parseable khi tool trả object', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_list_repos',
        arguments: {},
      });
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    it('full response có thể JSON.stringify (Cline wire format)', async () => {
      const result = await rpc(sdkServer, 'tools/call', {
        name: 'code_list_repos',
        arguments: {},
      });
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  // ─── resources/list ───────────────────────────────────────────
  describe('resources/list', () => {
    it('trả về list of resources với uri và name', async () => {
      const result = await rpc(sdkServer, 'resources/list');
      expect(result).toHaveProperty('resources');
      expect(Array.isArray(result.resources)).toBe(true);
      for (const res of result.resources) {
        expect(res).toHaveProperty('uri');
        expect(res).toHaveProperty('name');
      }
    });
  });

  describe('Prompts', () => {
    it('prompts/list returns 3 prompts', async () => {
      const result = await rpc(sdkServer, 'prompts/list');
      expect(result).toHaveProperty('prompts');
      const prompts = (result as { prompts: Array<{ name: string }> }).prompts;
      expect(prompts).toHaveLength(3);
      const names = prompts.map((p) => p.name);
      expect(names).toContain('code_analyze_symbol_impact');
      expect(names).toContain('code_onboard_repo');
      expect(names).toContain('code_explain_codebase');
    });

    it('code_analyze_symbol_impact has required argument', async () => {
      const result = await rpc(sdkServer, 'prompts/list');
      const prompts = (result as { prompts: Array<{ name: string; arguments?: Array<{ name: string; required?: boolean }> }> }).prompts;
      const analyzePrompt = prompts.find((p) => p.name === 'code_analyze_symbol_impact');
      expect(analyzePrompt).toBeDefined();
      const args = analyzePrompt!.arguments ?? [];
      const symbolArg = args.find((a) => a.name === 'symbol_name');
      expect(symbolArg).toBeDefined();
      expect(symbolArg!.required).toBe(true);
    });
  });
});
