# mcp-code1

MCP (Model Context Protocol) server nội bộ cung cấp khả năng **index & truy vấn codebase** cho Cline (VS Code extension).

Server chạy qua **stdio transport**, index codebase bằng tree-sitter (JS/TS/Python/Go/Rust) + Roslyn tùy chọn (C#), lưu trong SQLite (FTS5), và expose 13 tool để tra cứu symbol, graph call, import chain, v.v.

---

## 1. Yêu cầu

- **Node.js ≥ 20** (kèm npm) — khuyến nghị **Node.js ≥ 22** để dùng prebuilt binary của `better-sqlite3`
- **VS Code + Cline extension**
- Windows / macOS / Linux đều chạy được

> ⚠️ **Node.js v24+ trên Windows**: `better-sqlite3` cần prebuilt binary tương thích. Nếu `npm install` báo lỗi `gyp ERR! find VS`, hãy xem mục [Troubleshooting](#9-troubleshooting).

---

## 2. Cài đặt

```bash
git clone <repo-url> mcp-code1
cd mcp-code1
npm install
npm run build
```

Lệnh `npm run build` biên dịch TypeScript ra thư mục `dist/`. File entrypoint là `dist/index.js`.

> 💡 **Nếu `npm install` thành công nhưng `npm run build` báo lỗi `'tsc' is not recognized`**, thì `typescript` chưa được cài vào `node_modules`. Thử lại:
> ```bash
> npm install --ignore-scripts
> npm run build
> ```

---

## 3. Cấu hình môi trường

### Tạo file .env (chạy tay / dev)

Copy file mẫu và chỉnh sửa:

```bash
cp .env.example .env
```

Nội dung tối thiểu:

```env
DB_PATH=./data/mcp-code1.db
LOG_LEVEL=info
```

> ⚠️ **File `.env` là bắt buộc khi chạy tay** — nếu thiếu, server crash ngay với lỗi `Config FAIL: DB_PATH Required`.

Khi cấu hình Cline, các biến được truyền qua `env` trong `cline_mcp_settings.json` (xem Mục 5) thay vì file `.env`.

### Tất cả biến môi trường

| Biến | Bắt buộc | Mặc định | Mô tả |
|---|---|---|---|
| `REPO_ROOT` | ✅ | `cwd` | Thư mục gốc của repo cần index. Single-repo-per-process. |
| `DB_PATH` | ✅ | — | Đường dẫn file SQLite (tự tạo nếu chưa có). Ví dụ: `E:\mcp-data\mcp-code1.db` |
| `LOG_LEVEL` | ❌ | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `AI_API_KEY` | ❌ | `''` | Key cho endpoint sinh giải thích của `explain_symbol`. Không set → tool trả về raw metadata. |
| `AI_API_BASE_URL` | ❌ | `''` | Base URL của local LLM (tùy chọn, chỉ cho `explain_symbol`). |
| `AI_MODEL` | ❌ | — | Tên model dùng cho `explain_symbol` (tùy chọn). |

> Nếu không set 3 biến `AI_*`, các tool khác vẫn chạy bình thường; riêng `explain_symbol` sẽ fallback về metadata thô.

---

## 4. Quy trình setup lần đầu (checklist)

1. **Cài Node.js ≥ 20** (khuyến nghị 22+): `node -v` để kiểm tra
2. **Clone & cài dependencies**:
   ```bash
   git clone <repo-url> mcp-code1
   cd mcp-code1
   npm install
   ```
3. **Build TypeScript**:
   ```bash
   npm run build
   ```
   → Tạo ra `dist/index.js` (đây là entry point Cline sẽ gọi)
4. **Cấu hình Cline** (Mục 5) — paste config vào `cline_mcp_settings.json`
5. **Restart / toggle Cline** → server tự spawn, tự index lần đầu
6. **Verify** trong Cline MCP Servers panel: 🟢 Connected, 13 tools visible

### Dev mode (watch, không cần build lại)

```bash
npm run dev
```
Chạy TypeScript trực tiếp qua `ts-node`, hot-reload khi sửa source. **Không** dùng cho Cline config (Cline cần `dist/index.js`) — chỉ để phát triển server.

---

## 5. Config cho Cline — hướng dẫn từng bước

### 5.1 Mở file `cline_mcp_settings.json`

**Cách 1 (khuyến nghị):** VS Code Command Palette → gõ `Cline: Open MCP Settings`

**Cách 2:** Mở thủ công theo OS:

| OS | Đường dẫn |
|---|---|
| **Windows** | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| **macOS** | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Linux** | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

Nếu file chưa tồn tại, tạo mới với nội dung:
```json
{
  "mcpServers": {}
}
```

### 5.2 Thêm block cấu hình MCP server

Thêm entry `mcp-code1` vào `mcpServers`. Đây là **template đầy đủ** — thay các path theo máy bạn:

```json
{
  "mcpServers": {
    "mcp-code1": {
      "command": "node",
      "args": ["C:/Users/YOU/path-to/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Users/YOU/path-to/your-project",
        "DB_PATH": "C:/Users/YOU/mcp-data/mcp-code1.db",
        "LOG_LEVEL": "info",
        "AI_API_KEY": "",
        "AI_API_BASE_URL": "",
        "AI_MODEL": ""
      },
      "disabled": false,
      "autoApprove": [
        "search_symbols",
        "find_references",
        "get_symbol_detail",
        "get_symbol_context",
        "get_import_chain",
        "search_files",
        "get_file_symbols",
        "get_repo_stats",
        "list_repos"
      ],
      "timeout": 60
    }
  }
}
```

### 5.3 Giải thích từng field

| Field | Ý nghĩa | Giá trị gợi ý |
|---|---|---|
| `command` | Runtime chạy MCP server | `"node"` (đã cài Node.js ≥ 20) |
| `args` | Đường dẫn tuyệt đối đến `dist/index.js` sau khi `npm run build` | Path entrypoint |
| `env.REPO_ROOT` | **Bắt buộc** — thư mục codebase bạn muốn Cline truy vấn | Absolute path đến project của bạn |
| `env.DB_PATH` | **Bắt buộc** — nơi lưu SQLite DB. Thư mục cha sẽ tự tạo nếu chưa có | Bất kỳ đường dẫn nào có quyền ghi |
| `env.LOG_LEVEL` | `trace`/`debug`/`info`/`warn`/`error`/`fatal` | `info` (default); dùng `debug` khi troubleshoot |
| `env.AI_API_KEY` | Token cho local LLM (dùng cho tool `explain_symbol`). Để trống → fallback về metadata thô | `sk-xxx` hoặc để `""` |
| `env.AI_API_BASE_URL` | Endpoint của local LLM server | `http://localhost:11434/v1` (Ollama), `http://localhost:1234/v1` (LM Studio) |
| `env.AI_MODEL` | Tên model dùng cho explain_symbol | `qwen2.5-coder`, `llama3`, `deepseek-coder`... |
| `disabled` | Tạm tắt MCP server mà không xóa config | `false` |
| `autoApprove` | Cline không hỏi xác nhận khi gọi các tool **read-only** trong list này | Giữ như template — chỉ các tool read-only |
| `timeout` | Giới hạn giây cho mỗi tool call | `60` (đủ cho repo lớn) |

> ⚠️ **Windows path**: JSON không hiểu `\` — dùng `/` (forward slash) hoặc `\\` (double backslash).
> ```json
> "args": ["C:/Users/YOU/mcp-code1/dist/index.js"]   // ✅
> "args": ["C:\\Users\\YOU\\mcp-code1\\dist\\index.js"]  // ✅
> "args": ["C:\Users\YOU\mcp-code1\dist\index.js"]   // ❌ JSON invalid
> ```

### 5.4 Trường hợp chỉ có API token (không biết baseUrl)

Nếu nơi cấp token cho bạn không cho baseUrl rõ ràng:
1. **Bỏ `AI_API_KEY`** (để trống `""`) — tool `explain_symbol` sẽ fallback về metadata thô, 12 tool còn lại vẫn chạy bình thường
2. Hoặc hỏi provider token baseUrl (thường là `https://...api/v1` hoặc `http://localhost:PORT/v1`)
3. Chạy test: `AI_API_KEY=sk-xxx AI_API_BASE_URL=http://... npm test -- tests/live-llm.test.ts`

### 5.5 Ví dụ cấu hình thực tế (3 setup phổ biến)

**Setup A — Chỉ dùng tool code intelligence, không AI explain:**
```json
"env": {
  "REPO_ROOT": "C:/Code/my-app",
  "DB_PATH": "C:/mcp-data/my-app.db",
  "LOG_LEVEL": "info"
}
```

**Setup B — Dùng Ollama local:**
```json
"env": {
  "REPO_ROOT": "C:/Code/my-app",
  "DB_PATH": "C:/mcp-data/my-app.db",
  "LOG_LEVEL": "info",
  "AI_API_KEY": "local",
  "AI_API_BASE_URL": "http://localhost:11434/v1",
  "AI_MODEL": "qwen2.5-coder"
}
```

**Setup C — Nhiều repo (nhiều MCP server instances):**
```json
{
  "mcpServers": {
    "mcp-code1-backend": {
      "command": "node",
      "args": ["C:/mcp-code1/dist/index.js"],
      "env": { "REPO_ROOT": "C:/Code/backend", "DB_PATH": "C:/mcp-data/backend.db" }
    },
    "mcp-code1-frontend": {
      "command": "node",
      "args": ["C:/mcp-code1/dist/index.js"],
      "env": { "REPO_ROOT": "C:/Code/frontend", "DB_PATH": "C:/mcp-data/frontend.db" }
    }
  }
}
```

---

## 6. Khởi động server để Cline gọi tools

### 6.1 Luồng hoạt động (Cline ↔ MCP)

```
┌─────────────┐          stdio (JSON-RPC 2.0)          ┌────────────────┐
│   Cline     │ ────────────────────────────────────▶  │  mcp-code1     │
│ (VS Code)   │ ◀──── tools/list, tools/call ──────── │  (Node process)│
└─────────────┘                                         └────────────────┘
                                                                │
                                                                ▼
                                                        ┌────────────────┐
                                                        │   SQLite DB    │
                                                        │  (tree-sitter  │
                                                        │   symbol index)│
                                                        └────────────────┘
```

Cline **tự spawn** process `node dist/index.js` mỗi khi VS Code khởi động hoặc bạn toggle MCP server. **Bạn không cần chạy server bằng tay.**

### 6.2 Cách khởi động (cho user)

**Quy trình chuẩn:**

1. Mở VS Code với Cline đã cài
2. Command Palette → `Cline: Open MCP Settings` → paste config (mục 5.2)
3. Lưu file → Cline **tự động spawn** MCP server
4. Mở Cline panel → tab **"MCP Servers"** → verify `mcp-code1` có status **🟢 Connected** và list 13 tools
5. Nếu status 🔴 Disconnected → xem log trong **Cline Output panel** (dropdown top-right → `Cline`)

**Trigger lại server:**
- Toggle switch "Enabled" trong Cline MCP Servers panel
- Hoặc restart VS Code
- Hoặc edit `cline_mcp_settings.json` (Cline auto-reload)

### 6.3 Kiểm tra MCP server hoạt động

Khi Cline đã connect:
```
Bạn → Cline: "Dùng mcp-code1 để tìm function `validateUser` trong project này"
```

Cline sẽ gọi `search_symbols` (autoApprove) → trả kết quả → đưa vào context trả lời bạn.

Để debug nếu Cline không gọi tool:
```
Bạn → Cline: "List all tools available from mcp-code1"
```

### 6.4 Chạy tay để test / debug (không qua Cline)

Khi muốn check server khởi động OK trước khi gắn Cline:

**Windows (PowerShell):**
```powershell
cd C:\path\to\mcp-code1
$env:REPO_ROOT = "C:\Code\your-project"
$env:DB_PATH   = "C:\mcp-data\test.db"
$env:LOG_LEVEL = "debug"
node dist/index.js
```

**Windows (cmd):**
```cmd
cd /d C:\path\to\mcp-code1
set REPO_ROOT=C:\Code\your-project
set DB_PATH=C:\mcp-data\test.db
set LOG_LEVEL=debug
node dist\index.js
```

**macOS / Linux:**
```bash
cd /path/to/mcp-code1
REPO_ROOT=/path/to/project DB_PATH=/tmp/test.db LOG_LEVEL=debug node dist/index.js
```

Server sẽ:
1. Log `App starting` với repoId
2. Log `Initial index complete — graph ready` khi xong Pass 1 + Pass 2
3. Log `MCP server listening on stdio`
4. Chờ input JSON từ stdin (đây là hành vi **đúng** của stdio transport)

**Gửi test request:** paste đoạn JSON sau vào terminal rồi Enter:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Server trả về JSON chứa 13 tools → MCP server hoạt động hoàn hảo. Bấm `Ctrl+C` để tắt.

### 6.5 Watcher & auto-reindex

Server tự watch `REPO_ROOT` bằng `chokidar` (debounce 300ms):
- Bạn edit file → watcher emit `change` → `indexer.indexRepo()` chạy lại
- Graph cache invalidate tự động → `get_symbol_context` nhận data mới ngay
- Với repo trung bình (< 500 files), reindex mất ~1-3s

---

## 7. Các tool MCP server hỗ trợ

Tổng cộng **13 tool**, chia 3 nhóm:

### 🔍 Nhóm tìm kiếm (search / lookup)

| Tool | Input | Khi dùng |
|---|---|---|
| `search_symbols` | `query`, `repo_id?`, `kind?`, `limit?` | **Fuzzy / FTS5 search** khi không biết chính xác tên symbol. Trả về nhiều kết quả xếp hạng. |
| `find_references` | `symbol_name`, `repo_id?` | **Exact-name lookup**: mọi nơi xuất hiện symbol này (cả định nghĩa lẫn sử dụng). |
| `search_files` | `query`, `repo_id?`, `limit?` | Tìm file theo fragment đường dẫn. |
| `get_file_symbols` | `repo_id`, `rel_path` | List toàn bộ symbol trong một file cụ thể. |

### 📊 Nhóm chi tiết & graph

| Tool | Input | Khi dùng |
|---|---|---|
| `get_symbol_detail` | `symbol_id` (UUID) | Metadata thuần (file, dòng, signature, kind). **Không graph, không sinh text.** |
| `get_symbol_context` | `symbol_name`, `depth?` (1-3, default 2) | Graph: ai **gọi** (callers) + nó **gọi gì** (callees) qua BFS. Trả về `blastRadius` (callers.length — ai vỡ nếu sửa) và `impactCount` (tổng). |
| `get_import_chain` | `file_path`, `depth?` (1-5, default 3) | BFS chain import bắt đầu từ file, dùng để hiểu dependency chain. |
| `explain_symbol` | `symbol_id` | Giải thích symbol bằng natural language. Fallback về metadata nếu không có endpoint sinh text. |

### 🗂️ Nhóm quản trị repo

| Tool | Input | Khi dùng |
|---|---|---|
| `list_repos` | — | List tất cả repo đã đăng ký trong DB. |
| `register_repo` | `name`, `root_path`, `language?` | Đăng ký repo mới (thường không cần gọi thủ công — `REPO_ROOT` tự đăng ký khi khởi động). |
| `index_repo` | `repo_id` | Trigger full re-index một repo. |
| `get_repo_stats` | `repo_id` | Thống kê số file / symbol / edge đã index. |
| `remove_repo` | `repo_id` | Xóa repo khỏi registry (và data liên quan). |

---

## 8. Gợi ý Custom Instructions cho Cline

Có thể thêm vào **Custom Instructions** của Cline để chọn tool đúng:

```
Khi làm việc với codebase, hãy dùng MCP server mcp-code1:
- Không biết tên chính xác → search_symbols
- Biết tên chính xác, muốn thấy mọi nơi xuất hiện → find_references
- Muốn biết đổi hàm này ảnh hưởng ai → get_symbol_context (xem blastRadius)
- Muốn hiểu file phụ thuộc gì → get_import_chain
- Cần giải thích bằng tiếng tự nhiên → explain_symbol
- Tra metadata nhanh → get_symbol_detail
```

---

## 9. Ngôn ngữ được hỗ trợ

| Ngôn ngữ | Parser | Symbol extraction | Relations (CALLS/IMPORTS/EXTENDS/IMPLEMENTS) |
|---|---|---|---|
| JavaScript / JSX | tree-sitter | ✅ | ✅ |
| TypeScript / TSX | tree-sitter | ✅ | ✅ |
| Python | tree-sitter | ✅ | ✅ |
| Go | tree-sitter | ✅ | ✅ |
| Rust | tree-sitter | ✅ | ✅ |
| C# | Roslyn (daemon tùy chọn) | ✅ nếu có daemon | ✅ nếu có daemon |
| C / C++ / Java | tree-sitter | Symbol-only | ❌ |

File bị bỏ qua tự động: `node_modules/`, `dist/`, `build/`, `.git/`, `*.min.js`, `*.Designer.cs`, `*.g.cs`, `*.generated.cs`, `AssemblyInfo.cs`, `GlobalUsings.g.cs`.

---

## 10. Chạy test

```bash
npm test
```

Vitest chạy **40 test files / 200 tests + 4 skipped** (live LLM tests tự skip khi không có `AI_API_KEY`):

| Nhóm | Mô tả |
|---|---|
| `tests/e2e/cline-scenario.test.ts` | Mô phỏng Cline gọi 13 tool qua MCP protocol, index fixture TypeScript thực |
| `tests/e2e/mcp-protocol.test.ts` | JSON-RPC 2.0 compliance: handshake, Zod validation, concurrent requests |
| `tests/cline-config.test.ts` | Validate env combinations từ `cline_mcp_settings.json` |
| `tests/reliability/recovery.test.ts` | Concurrent reindex guard, watcher debounce, CASCADE delete (real FS) |
| `tests/live-llm.test.ts` | **Opt-in**: gọi LLM thật qua `AI_API_KEY` + `AI_API_BASE_URL` env |
| `tests/mcp/tools/` | Unit test từng tool handler: search, context graph, import chain, explain với AI mock |
| `tests/indexer/` | Pass 1 (symbols) + Pass 2 (relations) cho TS / JS / Python; git renames |
| `tests/graph/` | BFS, IdMapper, InMemoryGraph load/cache/invalidate/evict/reloadFile |
| `tests/db/` | Migrations, pool, ensureRepo |
| `tests/parser/` | tree-sitter extractor, grammars, tokenizer |

### Chạy test live LLM

```bash
# Ollama
AI_API_KEY=local AI_API_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen2.5-coder \
  npm test -- tests/live-llm.test.ts

# LM Studio
AI_API_KEY=local AI_API_BASE_URL=http://localhost:1234/v1 AI_MODEL=your-model \
  npm test -- tests/live-llm.test.ts
```

---

## 11. Troubleshooting

| Lỗi | Cách xử lý |
|---|---|
| `Config FAIL: DB_PATH Required` | Thiếu `DB_PATH` trong env. Kiểm tra `env` block trong `cline_mcp_settings.json` (Mục 5.2). |
| `gyp ERR! find VS` khi `npm install` | `better-sqlite3` cần build native. Cách 1: cài **Visual Studio Build Tools** với workload "Desktop development with C++". Cách 2 (nhanh hơn): `npm install better-sqlite3@^12.9.0` để dùng prebuilt. |
| `Could not locate the bindings file` | Node.js v24 dùng ABI v137, cần `better-sqlite3 ≥ 12.9.0`. Chạy: `npm install better-sqlite3@^12.9.0` |
| `'tsc' is not recognized` | TypeScript chưa được cài. Chạy: `npm install --ignore-scripts && npm run build` |
| `REPO_ROOT does not exist` | Kiểm tra `REPO_ROOT` trong Cline config phải là **absolute path** và thư mục tồn tại. |
| Cline MCP panel hiển thị 🔴 Disconnected | Xem log Output panel (dropdown top-right → "Cline"). Thường do: path `dist/index.js` sai, REPO_ROOT sai, hoặc chưa `npm run build`. |
| Cline không thấy tool / không gọi tool | Restart VS Code; thử trực tiếp "List tools from mcp-code1" để force enumerate. |
| `Cannot find module 'dist/index.js'` | Quên chạy `npm run build`. |
| Server không phản hồi request nào | Đúng hành vi stdio khi chưa nhận input — server chờ JSON từ stdin. Trong Cline, verify status 🟢 Connected. |
| Index chậm lần đầu | Bình thường cho repo lớn (1000+ files). Sau đó watcher chỉ reindex file thay đổi (< 1s). |
| DB lock lỗi | Đóng các process khác đang mở `DB_PATH`; SQLite WAL không support multi-writer. Hoặc đổi `DB_PATH` cho mỗi MCP server instance. |
| `explain_symbol` trả về metadata thô | Chưa set `AI_API_KEY` / `AI_API_BASE_URL` trong Cline config. Xem Mục 5.4. |
| Tool `get_symbol_context` trả stale data sau edit | Fixed từ v0.1 — graph cache tự invalidate sau reindex. Nếu vẫn gặp, restart MCP server. |
| Windows: đường dẫn file trong response dùng `\` thay vì `/` | Fixed từ v0.1 — tất cả `rel_path` được normalize về forward slash khi lưu DB. Nếu thấy `\`, reindex: `index_repo(repo_id)`. |

---

## 12. Kiến trúc (tóm tắt)

```
Cline (VS Code)
  │  stdio (JSON-RPC 2.0 over stdin/stdout)
  ▼
mcp-code1 (Node.js process)
  ├── Indexer (tree-sitter Pass 1: symbols, Pass 2: relations)
  ├── Watcher (chokidar, debounce 300ms)
  ├── SQLite DB (WAL + FTS5)
  ├── InMemoryGraph (IdMapper UUID↔int, BFS, TTL 30 min)
  └── Roslyn Bridge (optional NDJSON daemon cho C#)
```

Single-repo-per-process: mỗi instance MCP chỉ phục vụ một `REPO_ROOT`. Muốn index nhiều repo → khai báo nhiều entry trong `mcpServers` của Cline (mỗi cái `REPO_ROOT` khác nhau, `DB_PATH` khác nhau).
