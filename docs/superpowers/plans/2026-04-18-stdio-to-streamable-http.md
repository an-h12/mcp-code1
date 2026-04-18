# stdio → Streamable HTTP Transport Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển MCP server từ `StdioServerTransport` sang `StreamableHTTPServerTransport` để hoạt động trong môi trường IT block stdio process spawning.

**Architecture:** Thêm method `connectHttp(port)` vào `CodeMcpServer`, cập nhật `App.start()` để gọi HTTP thay vì stdio, dùng `MCP_PORT` đã có sẵn trong config (default 3000). HTTP server Node.js native expose endpoint `/mcp` cho Cline kết nối qua `type: streamableHttp`.

**Tech Stack:** `@modelcontextprotocol/sdk` v1.29+ (đã có `StreamableHTTPServerTransport`), Node.js `http` module, TypeScript.

---

## Chunk 1: Thêm HTTP transport vào `CodeMcpServer`

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Đọc file hiện tại để nắm rõ cấu trúc**

  Đọc `src/mcp/server.ts` — chú ý import, class fields, `connectStdio()`, `close()`.

- [ ] **Step 2: Thêm `_httpServer` field và `connectHttp()` method**

  Trong `src/mcp/server.ts`, thêm vào class `CodeMcpServer`:

  ```typescript
  import type { Server as HttpServer } from 'node:http';

  // Trong class, thêm field:
  private _httpServer: HttpServer | null = null;

  // Thêm method mới:
  async connectHttp(port: number): Promise<void> {
    const http = await import('node:http');
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — phù hợp single-user local
    });

    const httpServer = http.createServer((req, res) => {
      if (req.url === '/mcp') {
        transport.handleRequest(req, res);
      } else {
        res.writeHead(404).end('Not found');
      }
    });

    await this.server.connect(transport);

    await new Promise<void>((resolve, reject) =>
      httpServer.listen(port, '127.0.0.1', () => resolve()).on('error', reject)
    );

    this._httpServer = httpServer;
  }
  ```

- [ ] **Step 3: Cập nhật `close()` để shutdown HTTP server**

  Thay `close()` hiện tại:

  ```typescript
  async close(): Promise<void> {
    if (this._httpServer) {
      await new Promise<void>((resolve, reject) =>
        this._httpServer!.close((err) => (err ? reject(err) : resolve()))
      );
      this._httpServer = null;
    }
    await this.server.close();
  }
  ```

- [ ] **Step 4: Build để kiểm tra TypeScript không lỗi**

  ```bash
  npm run build
  ```

  Expected: Build thành công, không có TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/mcp/server.ts
  git commit -m "feat: add connectHttp() method to CodeMcpServer"
  ```

---

## Chunk 2: Cập nhật `App` dùng HTTP transport

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Thay `connectStdio()` bằng `connectHttp()` trong `App.start()`**

  Trong `src/app.ts`, tìm đoạn:
  ```typescript
  await this.mcpServer.connectStdio();
  this.log.info('MCP server listening on stdio');
  ```

  Thay bằng:
  ```typescript
  const port = this.config.mcpPort;
  await this.mcpServer.connectHttp(port);
  this.log.info({ port }, 'MCP server listening on HTTP — connect Cline to http://127.0.0.1:' + port + '/mcp');
  ```

- [ ] **Step 2: Build lại**

  ```bash
  npm run build
  ```

  Expected: Build thành công.

- [ ] **Step 3: Smoke test chạy server**

  ```bash
  DB_PATH=/tmp/test-mcp.db REPO_ROOT=. node dist/index.js
  ```

  Expected log xuất hiện:
  ```
  MCP server listening on HTTP — connect Cline to http://127.0.0.1:3000/mcp
  ```

  Trong terminal khác:
  ```bash
  curl -X POST http://127.0.0.1:3000/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
  ```

  Expected: JSON response với `"result"` chứa `serverInfo`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app.ts
  git commit -m "feat: switch App to connectHttp transport (MCP_PORT, default 3000)"
  ```

---

## Chunk 3: Cập nhật tài liệu

**Files:**
- Modify: `README.md`
- Modify: `INSTALLATION.md`

- [ ] **Step 1: Cập nhật README.md — phần "Cấu hình cho Cline"**

  Thay config stdio cũ:
  ```json
  {
    "mcpServers": {
      "code-intelligence": {
        "command": "node",
        "args": ["C:/path/to/mcp-code1/dist/index.js"],
        "env": {
          "REPO_ROOT": "C:/path/to/your-project",
          "DB_PATH": "C:/mcp-data/project.db"
        }
      }
    }
  }
  ```

  Bằng config HTTP:
  ```json
  {
    "mcpServers": {
      "code-intelligence": {
        "type": "streamableHttp",
        "url": "http://127.0.0.1:3000/mcp"
      }
    }
  }
  ```

  Thêm hướng dẫn chạy server thủ công trước khi dùng Cline:
  ```bash
  # Windows
  set REPO_ROOT=C:\path\to\your-project
  set DB_PATH=C:\mcp-data\project.db
  node C:\path\to\mcp-code1\dist\index.js

  # Đổi port nếu cần (default: 3000)
  set MCP_PORT=8000
  node C:\path\to\mcp-code1\dist\index.js
  ```

- [ ] **Step 2: Cập nhật INSTALLATION.md tương tự**

  Cập nhật phần cấu hình Cline và phần "Chạy server" theo cùng nội dung trên.

- [ ] **Step 3: Commit**

  ```bash
  git add README.md INSTALLATION.md
  git commit -m "docs: update Cline config for streamableHttp transport"
  ```

---

## Chunk 4: Chạy test suite đảm bảo không regression

- [ ] **Step 1: Chạy toàn bộ tests**

  ```bash
  npm test
  ```

  Expected: Tất cả tests pass (hoặc số test fail không thay đổi so với trước).

- [ ] **Step 2: Test tích hợp với Cline thực tế**

  1. Start server: `DB_PATH=... REPO_ROOT=... node dist/index.js`
  2. Cập nhật Cline MCP settings sang `type: streamableHttp, url: http://127.0.0.1:3000/mcp`
  3. Trong Cline chat: `"tìm hàm login trong codebase"`
  4. Verify: Cline tự gọi `code_search_symbols` tool, nhận kết quả, trả lời đúng.

  Expected: Cline hỏi approve tool call → approve → nhận kết quả từ server.
