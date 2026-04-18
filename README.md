# code-intelligence-mcp-server

MCP (Model Context Protocol) server cung cấp khả năng **index & truy vấn codebase** cho AI coding assistant (Cline, AI IDE...).

Server chạy qua **Streamable HTTP transport** (localhost), index codebase bằng tree-sitter (JS/TS/Python/Go/Rust/C/C++/Java/C#), lưu trong SQLite (FTS5), và expose **16 tools + 3 prompts** để tra cứu symbol, call graph, blast radius analysis, import chain, và giải thích code bằng AI.

---

## Tính năng chính

- **Multi-language**: JS/TS, Python, Go, Rust, C#, C/C++, Java — parse bằng tree-sitter
- **16 MCP tools** với prefix `code_`: search, graph, impact analysis, import chain, AI explain, repo management
- **3 MCP Prompts**: workflow có hướng dẫn từng bước cho AI client
- **structuredContent**: mọi tool trả về cả JSON typed object lẫn text (backward compat)
- **Fuzzy + FTS5 search**: tìm symbol nhanh ngay cả khi không nhớ chính xác tên
- **Call graph BFS**: callers (ai gọi hàm này) + callees (hàm này gọi gì) tới depth 1-3
- **Blast radius**: phân tích tầng d=1 WILL BREAK / d=2 LIKELY AFFECTED / d=3 MAY NEED TESTING với risk level LOW/MEDIUM/HIGH
- **Auto-reindex**: chokidar watcher tự reindex khi file thay đổi (debounce 300ms, ~1-2s end-to-end)
- **AI explain**: giải thích symbol bằng ngôn ngữ tự nhiên (cần LLM endpoint)

---

## Yêu cầu hệ thống

| Yêu cầu | Phiên bản |
|----------|-----------|
| **Node.js** | >= 20 (khuyến nghị >= 22) |
| **npm** | >= 9 |
| **OS** | Windows / macOS / Linux |

---

## Cài đặt nhanh

```bash
git clone <repo-url> mcp-code1
cd mcp-code1
npm install
npm run build
```

> Chi tiết cài đặt đầy đủ xem file [INSTALLATION.md](./INSTALLATION.md)

---

## Chạy server

Server chạy như một HTTP service trên localhost. Khởi động trước khi dùng Cline:

```bash
# Windows
set REPO_ROOT=C:\path\to\your-project
set DB_PATH=C:\mcp-data\project.db
node C:\path\to\mcp-code1\dist\index.js

# Đổi port nếu cần (default: 3000)
set MCP_PORT=8000
node C:\path\to\mcp-code1\dist\index.js
```

## Cấu hình cho Cline (VS Code)

Mở `cline_mcp_settings.json` bằng Command Palette → **Cline: Open MCP Settings**:

```json
{
  "mcpServers": {
    "code-intelligence": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:3000/mcp",
      "disabled": false,
      "autoApprove": [
        "code_search_symbols",
        "code_get_symbol_detail",
        "code_list_repos",
        "code_register_repo",
        "code_index_repo",
        "code_find_references",
        "code_search_files",
        "code_get_file_symbols",
        "code_explain_symbol",
        "code_get_repo_stats",
        "code_remove_repo",
        "code_get_symbol_context",
        "code_get_import_chain",
        "code_find_callers",
        "code_find_callees",
        "code_get_impact_analysis"
      ],
      "timeout": 60
    }
  }
}
```

> **Lưu ý breaking change:** Server đã chuyển từ stdio sang **Streamable HTTP transport**. Cần chạy server thủ công trước khi dùng Cline, và cấu hình Cline dùng `type: streamableHttp` thay vì `command`/`args`.

### Biến môi trường

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `REPO_ROOT` | **Có** | Thư mục gốc repo cần index (path tuyệt đối) |
| `DB_PATH` | **Có** | Đường dẫn file SQLite lưu index |
| `MCP_PORT` | Không | Port HTTP server (default: `3000`) |
| `LOG_LEVEL` | Không | `trace`/`debug`/`info`/`warn`/`error`/`fatal` (default: `info`) |
| `AI_API_KEY` | Không | API key cho LLM (dùng cho `code_explain_symbol`) |
| `AI_API_BASE_URL` | Không | Base URL LLM endpoint (ví dụ: `http://localhost:11434/v1`) |
| `AI_MODEL` | Không | Tên model LLM (ví dụ: `your-model-name`) |

---

## 16 Tools

Tất cả tool có prefix `code_` và trả về `structuredContent` (typed JSON object) cùng với `content[].text` (backward compat).

### Tìm kiếm

| Tool | Input bắt buộc | Mô tả |
|------|---------------|-------|
| `code_search_symbols` | `query` | Fuzzy/FTS5 search symbol theo keyword. Dùng khi không biết tên chính xác. |
| `code_find_references` | `symbol_name` | Exact-name lookup: mọi định nghĩa + callers (depth=1). Dùng khi biết tên chính xác. |
| `code_search_files` | `query` | Tìm file theo path fragment |
| `code_get_file_symbols` | `repo_id`, `rel_path` | List toàn bộ symbol trong 1 file, sắp xếp theo line |

### Chi tiết & Call Graph

| Tool | Input bắt buộc | Mô tả |
|------|---------------|-------|
| `code_get_symbol_detail` | `symbol_id` | Metadata: file, line range, signature, kind, docComment |
| `code_get_symbol_context` | `symbol_name` | Full graph view: callers + callees (depth 1-3), blastRadius, impactCount |
| `code_find_callers` | `symbol_name` | Chỉ callers (incoming BFS). Đơn giản hơn `get_symbol_context` khi chỉ cần callers. |
| `code_find_callees` | `symbol_name` | Chỉ callees (outgoing BFS). Đơn giản hơn `get_symbol_context` khi chỉ cần callees. |
| `code_get_import_chain` | `file_path` | BFS import dependency chain từ 1 file |
| `code_explain_symbol` | `symbol_id` | AI giải thích symbol (fallback metadata nếu không có LLM) |

### Blast Radius Analysis

| Tool | Input bắt buộc | Mô tả |
|------|---------------|-------|
| `code_get_impact_analysis` | `symbol_name` | Phân tích blast radius 3 tầng: `d=1` WILL BREAK / `d=2` LIKELY AFFECTED / `d=3` MAY NEED TESTING. Risk level: `LOW`/`MEDIUM`/`HIGH`. |

### Quản trị repo

| Tool | Input bắt buộc | Mô tả |
|------|---------------|-------|
| `code_list_repos` | — | List tất cả repo đã đăng ký (trả về `{ repos: [...] }`) |
| `code_register_repo` | `name`, `root_path` | Đăng ký repo mới, trả về repo ID |
| `code_index_repo` | `repo_id` | Trigger full re-index (skips unchanged files tự động) |
| `code_get_repo_stats` | `repo_id` | Thống kê: fileCount, symbolCount, languageBreakdown |
| `code_remove_repo` | `repo_id` | Xóa repo + toàn bộ index (không thể hoàn tác) |

---

## 3 Prompts

MCP Prompts là workflow có hướng dẫn từng bước — AI client gọi prompt, nhận hướng dẫn chi tiết cách dùng các tools theo trình tự.

| Prompt | Arguments | Mô tả |
|--------|-----------|-------|
| `code_analyze_symbol_impact` | `symbol_name` (bắt buộc) | Phân tích blast radius, list d=1 phải update, d=2 cần test, đề xuất bước refactor an toàn |
| `code_onboard_repo` | `name`, `root_path`, `language` | Hướng dẫn register → index → stats một repo mới |
| `code_explain_codebase` | — | Tổng quan kiến trúc: tech stack, modules, entry points, patterns |

---

## Ngôn ngữ hỗ trợ

| Ngôn ngữ | Extensions | Symbols | Call Relations |
|-----------|-----------|---------|----------------|
| TypeScript / TSX | `.ts`, `.tsx` | ✅ | ✅ |
| JavaScript / JSX | `.js`, `.jsx`, `.mjs`, `.cjs` | ✅ | ✅ |
| Python | `.py` | ✅ | ✅ |
| Go | `.go` | ✅ | ✅ |
| Rust | `.rs` | ✅ | ✅ |
| C# | `.cs` | ✅ | ✅ |
| Java | `.java` | ✅ | Không |
| C / C++ | `.c`, `.h`, `.cpp`, `.cc`, `.hpp` | ✅ | Không |

---

## Auto-reindex (File Watcher)

Server tự động cập nhật index khi code thay đổi — không cần restart hay gọi `code_index_repo` thủ công:

| Event | Hành động | Thời gian |
|-------|-----------|-----------|
| Tạo file mới | `indexSingleFile()` + invalidate graph | ~1-2s |
| Sửa file | `indexSingleFile()` + invalidate graph | ~1-2s |
| Xoá file | `removeFile()` + invalidate graph + cascade delete symbols | ~1s |

**Cơ chế:** chokidar watcher → debounce 300ms → re-index → graph cache invalidation.

> Các thư mục bị bỏ qua: `node_modules`, `dist`, `build`, thư mục ẩn (`.git`, `.next`...).

---

## Chạy test

```bash
npm test
```

43 test files, 210+ tests covering: MCP protocol, tool handlers, indexer, graph, parser, reliability.

## Kiến trúc

```
AI Client (Cline)
  │  HTTP/SSE (JSON-RPC 2.0 / MCP protocol)
  ▼
code-intelligence-mcp-server (Node.js)
  ├── 16 Tools  (code_search_symbols, code_get_impact_analysis, ...)
  ├── 3 Prompts (code_analyze_symbol_impact, code_onboard_repo, ...)
  ├── Resources (repo context, cluster view, process traces)
  ├── Indexer   (tree-sitter: symbols + call relations)
  ├── Watcher   (chokidar, debounce 300ms — auto-reindex on save)
  ├── SQLite DB (WAL mode + FTS5 full-text search)
  └── InMemoryGraph (BFS call graph, TTL 30min cache)
```

---

## Troubleshooting

| Lỗi | Cách xử lý |
|-----|------------|
| Cline 🔴 Disconnected | Kiểm tra path `dist/index.js` đúng chưa, đã `npm run build` chưa |
| `Config FAIL: DB_PATH Required` | Thiếu `DB_PATH` trong `env` |
| Tools không hiển thị trong Cline | Restart Cline sau khi sửa `cline_mcp_settings.json` |
| `autoApprove` không nhận tool | Tên tool phải có prefix `code_` (phiên bản cũ không có prefix) |
| `gyp ERR! find VS` | Cài Visual Studio Build Tools hoặc dùng `better-sqlite3 >= 12.9.0` |
| `code_explain_symbol` trả metadata thô | Chưa set `AI_API_KEY` + `AI_API_BASE_URL` |
| File thay đổi nhưng không reindex | Kiểm tra `REPO_ROOT` trỏ đúng thư mục. Thư mục `dist/`, `node_modules/` bị bỏ qua theo thiết kế. |

> Chi tiết troubleshooting xem [INSTALLATION.md](./INSTALLATION.md)

---

## License

Private / Internal use.
