# mcp-code1

MCP (Model Context Protocol) server nội bộ cung cấp khả năng **index & truy vấn codebase** cho Cline (VS Code extension).

Server chạy qua **stdio transport**, index codebase bằng tree-sitter (JS/TS/Python/Go/Rust) + Roslyn tùy chọn (C#), lưu trong SQLite (FTS5), và expose 13 tool để tra cứu symbol, graph call, import chain, v.v.

---

## 1. Yêu cầu

- **Node.js ≥ 20** (kèm npm)
- **VS Code + Cline extension**
- Windows / macOS / Linux đều chạy được

---

## 2. Cài đặt

```bash
git clone <repo-url> mcp-code1
cd mcp-code1
npm install
npm run build
```

Lệnh `npm run build` biên dịch TypeScript ra thư mục `dist/`. File entrypoint là `dist/index.js`.

---

## 3. Biến môi trường

| Biến | Bắt buộc | Mặc định | Mô tả |
|---|---|---|---|
| `REPO_ROOT` | ✅ | `cwd` | Thư mục gốc của repo cần index. Single-repo-per-process. |
| `DB_PATH` | ✅ | — | Đường dẫn file SQLite (tự tạo nếu chưa có). Ví dụ: `E:\mcp-data\mcp-code1.db` |
| `LOG_LEVEL` | ❌ | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `AI_API_KEY` | ❌ | `''` | Key cho endpoint sinh giải thích của `explain_symbol`. Không set → tool trả về raw metadata. |
| `AI_API_BASE_URL` | ❌ | `''` | Base URL OpenAI-compatible (tùy chọn, chỉ cho `explain_symbol`). |
| `AI_MODEL` | ❌ | — | Tên model dùng cho `explain_symbol` (tùy chọn). |

> Nếu không set 3 biến `AI_*`, các tool khác vẫn chạy bình thường; riêng `explain_symbol` sẽ fallback về metadata thô.

---

## 4. Khởi động MCP server

MCP server chạy **stdio**, không listen port. Có 2 cách khởi động:

### A. Qua Cline (khuyến nghị — production)

Cline sẽ **tự spawn** process `node dist/index.js` mỗi khi VS Code khởi động, và truyền env từ `cline_mcp_settings.json`. Không cần chạy tay — xem Mục 5.

### B. Chạy tay để test / debug

Dùng khi muốn kiểm tra server khởi động OK trước khi gắn vào Cline.

**Windows (PowerShell):**
```powershell
cd E:\Code\MCP-web\mcp-code1
$env:REPO_ROOT = "E:\Code\your-project"
$env:DB_PATH   = "E:\mcp-data\mcp-code1.db"
$env:LOG_LEVEL = "debug"
node dist/index.js
```

**Windows (cmd):**
```cmd
cd /d E:\Code\MCP-web\mcp-code1
set REPO_ROOT=E:\Code\your-project
set DB_PATH=E:\mcp-data\mcp-code1.db
set LOG_LEVEL=debug
node dist\index.js
```

**macOS / Linux (bash):**
```bash
cd /path/to/mcp-code1
REPO_ROOT=/path/to/your-project \
DB_PATH=/var/lib/mcp-code1/db.sqlite \
LOG_LEVEL=debug \
node dist/index.js
```

### Các bước thực hiện đầy đủ (lần đầu)

1. **Cài Node.js ≥ 20** và xác nhận: `node -v`
2. **Clone & build**:
   ```bash
   git clone <repo-url> mcp-code1
   cd mcp-code1
   npm install
   npm run build
   ```
3. **Tạo thư mục chứa DB** (nếu chưa có): ví dụ `mkdir E:\mcp-data`
4. **Set env** `REPO_ROOT` và `DB_PATH` (xem lệnh theo OS ở trên)
5. **Chạy thử**: `node dist/index.js`
   - Nếu thấy log `App starting` rồi `Initial index complete — graph ready` → OK
   - Process sẽ "treo" chờ input stdio — điều này **bình thường** với MCP. Bấm `Ctrl+C` để tắt.
6. **Cấu hình Cline** (Mục 5) để Cline tự spawn và giao tiếp
7. **Restart Cline / VS Code**, kiểm tra tool list trong Cline MCP panel

### Kiểm tra nhanh server đã ready

Khi chạy tay ở bước 5, trong cửa sổ terminal paste JSON sau rồi Enter (đây là một `tools/list` request theo MCP protocol):
```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```
Server phải in ra JSON chứa 13 tool. Nếu có → mọi thứ OK, Ctrl+C để tắt và chuyển qua cấu hình Cline.

### Dev mode (watch, không cần build)

```bash
npm run dev
```
Chạy TypeScript trực tiếp qua `ts-node`, hot-reload khi sửa source. Không dùng cho Cline config — chỉ để phát triển.

---

## 5. Config cho Cline

Cline đọc MCP config từ file `cline_mcp_settings.json`:

- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

Hoặc mở qua Command Palette → `Cline: Open MCP Settings`.

Thêm block sau vào `mcpServers`:

```json
{
  "mcpServers": {
    "mcp-code1": {
      "command": "node",
      "args": ["E:/Code/MCP-web/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "E:/Code/your-project",
        "DB_PATH": "E:/mcp-data/mcp-code1.db",
        "LOG_LEVEL": "info"
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
      ]
    }
  }
}
```

> ⚠️ **Windows path**: dùng `/` (forward slash) hoặc `\\` (double backslash) trong JSON.
>
> 💡 `autoApprove` chỉ liệt kê các tool **read-only** để không cần bấm confirm mỗi lần. Các tool thay đổi state (`register_repo`, `index_repo`, `remove_repo`) nên để Cline hỏi xác nhận.

**Restart Cline** (hoặc toggle MCP server trong Cline). Khi khởi động, server sẽ tự index lần đầu (có thể mất vài chục giây đến vài phút tùy repo), sau đó watch file thay đổi để reindex incrementally.

---

## 6. Các tool MCP server hỗ trợ

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

## 7. Gợi ý Custom Instructions cho Cline

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

## 8. Ngôn ngữ được hỗ trợ

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

## 9. Troubleshooting

| Lỗi | Cách xử lý |
|---|---|
| `REPO_ROOT does not exist` | Kiểm tra path trong Cline config, dùng absolute path. |
| Cline không thấy tool | Restart Cline; kiểm tra log MCP trong output panel. Chạy tay (Mục 4B) để xem log chi tiết. |
| `Cannot find module 'dist/index.js'` | Quên chạy `npm run build`. |
| Chạy tay mà không in log gì | Đúng hành vi stdio — server đang chờ request. Thử gửi JSON `tools/list` như Mục 4. |
| Index chậm | Bình thường cho lần đầu. Sau đó watcher chỉ reindex file thay đổi. |
| DB lock lỗi | Đóng các process khác đang mở `DB_PATH`; SQLite dùng WAL nhưng không multi-writer. |
| `explain_symbol` trả về metadata thô | Chưa set `AI_API_KEY` / `AI_API_BASE_URL`. |

---

## 10. Kiến trúc (tóm tắt)

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
