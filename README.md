# mcp-code1

MCP (Model Context Protocol) server cung cấp khả năng **index & truy vấn codebase** cho các AI coding assistant (Cline, Claude Code, Cursor...).

Server chạy qua **stdio transport**, index codebase bằng tree-sitter (JS/TS/Python/Go/Rust/C/C++/Java/C#), lưu trong SQLite (FTS5), và expose **13 tool** để tra cứu symbol, call graph, import chain, giải thích code bằng AI.

---

## Tính nang chinh

- **Multi-language**: JS/TS, Python, Go, Rust, C#, C/C++, Java
- **13 MCP tools**: search, graph, import chain, AI explain, repo management
- **Fuzzy + FTS5 search**: tìm symbol nhanh ngay cả khi không nhớ chính xác tên
- **Call graph**: xem ai gọi hàm này (callers) và hàm này gọi gì (callees)
- **Auto-reindex**: watcher tự reindex khi file thay đổi (debounce 300ms)
- **AI explain**: giải thích symbol bằng ngôn ngữ tự nhiên (cần LLM endpoint)

---

## Yeu cau he thong

| Yêu cầu | Phiên bản |
|----------|-----------|
| **Node.js** | >= 20 (khuyến nghị >= 22) |
| **npm** | >= 9 |
| **OS** | Windows / macOS / Linux |

---

## Cai dat nhanh

```bash
git clone <repo-url> mcp-code1
cd mcp-code1
npm install
npm run build
```

> Chi tiết cài đặt đầy đủ xem file [INSTALLATION.md](./INSTALLATION.md)

---

## Cau hinh cho Cline (VS Code)

Mở `cline_mcp_settings.json` (Command Palette > `Cline: Open MCP Settings`):

```json
{
  "mcpServers": {
    "mcp-code1": {
      "command": "node",
      "args": ["C:/path/to/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/path/to/your-project",
        "DB_PATH": "C:/mcp-data/project.db",
        "LOG_LEVEL": "info"
      },
      "disabled": false,
      "autoApprove": [
        "search_symbols", "find_references", "get_symbol_detail",
        "get_symbol_context", "get_import_chain", "search_files",
        "get_file_symbols", "get_repo_stats", "list_repos"
      ],
      "timeout": 60
    }
  }
}
```

### Bien moi truong

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `REPO_ROOT` | Co | Thư mục gốc repo cần index |
| `DB_PATH` | Co | Đường dẫn file SQLite |
| `LOG_LEVEL` | Khong | `trace`/`debug`/`info`/`warn`/`error`/`fatal` (default: `info`) |
| `AI_API_KEY` | Khong | API key cho LLM (dùng cho `explain_symbol`) |
| `AI_API_BASE_URL` | Khong | Base URL LLM endpoint |
| `AI_MODEL` | Khong | Tên model LLM |

---

## 13 Tools

### Tim kiem

| Tool | Mô tả |
|------|-------|
| `search_symbols` | Fuzzy/FTS5 search symbol theo keyword |
| `find_references` | Exact-name lookup: mọi nơi symbol xuất hiện |
| `search_files` | Tìm file theo path fragment |
| `get_file_symbols` | List toàn bộ symbol trong 1 file |

### Chi tiet & Graph

| Tool | Mô tả |
|------|-------|
| `get_symbol_detail` | Metadata: file, line, signature, kind |
| `get_symbol_context` | Call graph: callers + callees, blast radius |
| `get_import_chain` | BFS import dependency chain |
| `explain_symbol` | AI giải thích symbol (fallback metadata nếu không có LLM) |

### Quan tri repo

| Tool | Mô tả |
|------|-------|
| `list_repos` | List tất cả repo đã đăng ký |
| `register_repo` | Đăng ký repo mới |
| `index_repo` | Trigger full re-index |
| `get_repo_stats` | Thống kê files/symbols/edges |
| `remove_repo` | Xóa repo khỏi registry |

---

## Ngon ngu ho tro

| Ngôn ngữ | Parser | Symbols | Relations |
|-----------|--------|---------|-----------|
| JavaScript / JSX | tree-sitter | Yes | Yes |
| TypeScript / TSX | tree-sitter | Yes | Yes |
| Python | tree-sitter | Yes | Yes |
| Go | tree-sitter | Yes | Yes |
| Rust | tree-sitter | Yes | Yes |
| C# | tree-sitter / Roslyn | Yes | Yes (Roslyn) |
| C / C++ / Java | tree-sitter | Yes | Khong |

---

## Chay test

```bash
npm test
```

40 test files, 200+ tests covering: MCP protocol, tool handlers, indexer, graph, parser, reliability.

### Test voi LLM that

```bash
AI_API_KEY=local AI_API_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen2.5-coder npm test -- tests/live-llm.test.ts
```

---

## Kien truc

```
AI Client (Cline / Claude Code / Cursor)
  |  stdio (JSON-RPC 2.0)
  v
mcp-code1 (Node.js)
  +-- Indexer (tree-sitter: symbols + relations)
  +-- Watcher (chokidar, debounce 300ms)
  +-- SQLite DB (WAL + FTS5)
  +-- InMemoryGraph (BFS, TTL 30min)
  +-- Roslyn Bridge (optional, C#)
```

---

## Troubleshooting

| Lỗi | Cách xử lý |
|-----|------------|
| `Config FAIL: DB_PATH Required` | Thiếu `DB_PATH` trong env |
| `gyp ERR! find VS` | Cần Visual Studio Build Tools hoặc dùng `better-sqlite3@^12.9.0` |
| `'tsc' is not recognized` | `npm install --ignore-scripts && npm run build` |
| Cline 🔴 Disconnected | Kiểm tra path `dist/index.js`, `REPO_ROOT`, đã build chưa |
| `explain_symbol` trả metadata thô | Chưa set `AI_API_KEY` / `AI_API_BASE_URL` |

> Chi tiết troubleshooting đầy đủ xem [INSTALLATION.md](./INSTALLATION.md)

---

## License

Private / Internal use.
