# Huong dan cai dat MCP Code Intelligence Server

Hướng dẫn chi tiết từng bước để cài đặt và sử dụng MCP server `mcp-code1`.

---

## Muc luc

1. [Yêu cầu hệ thống](#1-yeu-cau-he-thong)
2. [Cài đặt Node.js](#2-cai-dat-nodejs)
3. [Cài đặt MCP server](#3-cai-dat-mcp-server)
4. [Cấu hình cho Cline (VS Code)](#4-cau-hinh-cho-cline-vs-code)
5. [Cấu hình cho Claude Code (CLI)](#5-cau-hinh-cho-claude-code-cli)
6. [Cấu hình AI explain (tùy chọn)](#6-cau-hinh-ai-explain-tuy-chon)
7. [Xác nhận hoạt động](#7-xac-nhan-hoat-dong)
8. [Cấu hình nhiều repo](#8-cau-hinh-nhieu-repo)
9. [Troubleshooting chi tiết](#9-troubleshooting-chi-tiet)

---

## 1. Yeu cau he thong

### Bat buoc

| Thành phần | Phiên bản | Ghi chú |
|------------|-----------|---------|
| **Node.js** | >= 20 | Khuyến nghị >= 22 để dùng prebuilt binary |
| **npm** | >= 9 | Đi kèm Node.js |
| **Git** | Bất kỳ | Để clone repo |

### Tuy chon (cho C# support nang cao)

| Thành phần | Phiên bản | Ghi chú |
|------------|-----------|---------|
| .NET SDK | >= 6.0 | Chỉ cần nếu dùng Roslyn daemon cho C# |

### Tuy chon (cho AI explain)

| Thành phần | Ghi chú |
|------------|---------|
| Ollama | Local LLM server, miễn phí |
| LM Studio | Local LLM server, giao diện đẹp |

---

## 2. Cai dat Node.js

### Windows

1. Tải từ https://nodejs.org/ (chọn LTS >= 20)
2. Chạy installer, giữ tất cả mặc định
3. Mở PowerShell kiểm tra:
   ```powershell
   node -v   # v20.x.x trở lên
   npm -v    # 9.x.x trở lên
   ```

### macOS

```bash
# Dùng Homebrew
brew install node@22

# Hoặc tải .pkg từ https://nodejs.org/
```

### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 3. Cai dat MCP server

### Buoc 3.1: Clone repo

```bash
git clone <repo-url> mcp-code1
cd mcp-code1
```

### Buoc 3.2: Cai dependencies

```bash
npm install
```

**Các thư viện chính được cài tự động:**

| Thư viện | Phiên bản | Mục đích |
|----------|-----------|----------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP protocol SDK - giao tiếp JSON-RPC 2.0 qua stdio |
| `better-sqlite3` | ^12.9.0 | SQLite database (WAL mode + FTS5 full-text search) |
| `tree-sitter` | ^0.21.1 | Parser engine - phân tích AST code đa ngôn ngữ |
| `tree-sitter-javascript` | ^0.21.4 | Grammar JS/JSX |
| `tree-sitter-typescript` | ^0.21.2 | Grammar TS/TSX |
| `tree-sitter-python` | ^0.21.0 | Grammar Python |
| `tree-sitter-go` | ^0.21.2 | Grammar Go |
| `tree-sitter-rust` | ^0.21.0 | Grammar Rust |
| `tree-sitter-c-sharp` | ^0.21.3 | Grammar C# |
| `tree-sitter-c` | ^0.21.4 | Grammar C |
| `tree-sitter-cpp` | ^0.22.3 | Grammar C++ |
| `tree-sitter-java` | ^0.21.0 | Grammar Java |
| `chokidar` | ^5.0.0 | File watcher - tự reindex khi code thay đổi |
| `openai` | ^6.34.0 | OpenAI-compatible SDK cho AI explain feature |
| `pino` | ^9.2.0 | Structured logging (JSON) |
| `pino-pretty` | ^11.2.1 | Log formatter cho dev |
| `p-queue` | ^9.1.2 | Concurrency queue cho indexing |
| `zod` | ^3.23.8 | Schema validation cho tool inputs |
| `dotenv` | ^16.4.5 | Load biến môi trường từ file .env |

> **Lưu ý Windows**: Nếu gặp lỗi `gyp ERR! find VS` khi cài `better-sqlite3`:
> - **Cách 1 (khuyến nghị)**: Dùng Node.js >= 22 (có prebuilt binary)
> - **Cách 2**: Cài [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) với workload "Desktop development with C++"
> - **Cách 3**: `npm install better-sqlite3@^12.9.0` (force prebuilt)

### Buoc 3.3: Build TypeScript

```bash
npm run build
```

Kết quả: tạo thư mục `dist/` với file entrypoint `dist/index.js`.

> Nếu lỗi `'tsc' is not recognized`:
> ```bash
> npm install --ignore-scripts
> npm run build
> ```

### Buoc 3.4: Tao file .env (chi can khi chay thu bang tay)

```bash
cp .env.example .env
```

Chỉnh nội dung:

```env
DB_PATH=./data/mcp-code1.db
LOG_LEVEL=info
```

> Khi dùng qua Cline/Claude Code, biến env được truyền qua config, **không cần file .env**.

---

## 4. Cau hinh cho Cline (VS Code)

### Buoc 4.1: Cai Cline extension

1. Mở VS Code
2. Extensions (Ctrl+Shift+X) > tìm **"Cline"** > Install

### Buoc 4.2: Mo file cau hinh MCP

Command Palette (Ctrl+Shift+P) > gõ `Cline: Open MCP Settings`

Hoặc mở thủ công:

| OS | Đường dẫn |
|----|-----------|
| Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| macOS | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Linux | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

### Buoc 4.3: Them cau hinh MCP server

```json
{
  "mcpServers": {
    "mcp-code1": {
      "command": "node",
      "args": ["C:/Users/YOU/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Users/YOU/your-project",
        "DB_PATH": "C:/Users/YOU/mcp-data/project.db",
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
      ],
      "timeout": 60
    }
  }
}
```

**Thay thế:**
- `C:/Users/YOU/mcp-code1/dist/index.js` -> đường dẫn thật đến file build
- `C:/Users/YOU/your-project` -> thư mục project bạn muốn index
- `C:/Users/YOU/mcp-data/project.db` -> nơi lưu database

> **Windows**: dùng `/` (forward slash) trong JSON, KHÔNG dùng `\` đơn.

### Buoc 4.4: Kiem tra

1. Lưu file config
2. Cline tự spawn MCP server
3. Mở Cline panel > tab **MCP Servers** > verify **mcp-code1** hiển thị 🟢 Connected, 13 tools

---

## 5. Cau hinh cho Claude Code (CLI)

Thêm vào file `.claude/settings.json` hoặc `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "mcp-code1": {
      "command": "node",
      "args": ["C:/Users/YOU/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Users/YOU/your-project",
        "DB_PATH": "C:/Users/YOU/mcp-data/project.db",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## 6. Cau hinh AI explain (tuy chon)

Tool `explain_symbol` cần LLM endpoint để sinh giải thích ngôn ngữ tự nhiên. Nếu không cấu hình, tool fallback về metadata thô (vẫn dùng được).

### Ollama (mien phi, chay local)

1. Tải từ https://ollama.ai/
2. Cài model:
   ```bash
   ollama pull qwen2.5-coder
   ```
3. Thêm env:
   ```json
   "env": {
     "AI_API_KEY": "local",
     "AI_API_BASE_URL": "http://localhost:11434/v1",
     "AI_MODEL": "qwen2.5-coder"
   }
   ```

### LM Studio

1. Tải từ https://lmstudio.ai/
2. Load model bất kỳ, start server
3. Thêm env:
   ```json
   "env": {
     "AI_API_KEY": "local",
     "AI_API_BASE_URL": "http://localhost:1234/v1",
     "AI_MODEL": "your-model-name"
   }
   ```

### OpenAI / API khac

```json
"env": {
  "AI_API_KEY": "sk-your-key",
  "AI_API_BASE_URL": "https://api.openai.com/v1",
  "AI_MODEL": "gpt-4o-mini"
}
```

---

## 7. Xac nhan hoat dong

### Cach 1: Qua Cline

Mở Cline chat, gõ:
```
List all tools from mcp-code1
```
Cline sẽ liệt kê 13 tools.

### Cach 2: Chay thu bang tay

**PowerShell:**
```powershell
cd C:\path\to\mcp-code1
$env:REPO_ROOT = "C:\path\to\your-project"
$env:DB_PATH = "C:\mcp-data\test.db"
$env:LOG_LEVEL = "debug"
node dist/index.js
```

**macOS / Linux:**
```bash
REPO_ROOT=/path/to/project DB_PATH=/tmp/test.db LOG_LEVEL=debug node dist/index.js
```

Paste vào stdin:
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
```

Server trả JSON với 13 tools -> hoạt động OK. `Ctrl+C` để tắt.

### Cach 3: Chay test suite

```bash
npm test
```

Kết quả: 40 test files, 200+ tests passed.

---

## 8. Cau hinh nhieu repo

Mỗi instance MCP phục vụ 1 repo. Để index nhiều repo, khai báo nhiều entry:

```json
{
  "mcpServers": {
    "code-backend": {
      "command": "node",
      "args": ["C:/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Code/backend",
        "DB_PATH": "C:/mcp-data/backend.db"
      }
    },
    "code-frontend": {
      "command": "node",
      "args": ["C:/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Code/frontend",
        "DB_PATH": "C:/mcp-data/frontend.db"
      }
    }
  }
}
```

> Mỗi entry cần `DB_PATH` riêng biệt (SQLite không hỗ trợ multi-writer).

---

## 9. Troubleshooting chi tiet

### Loi cai dat

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `gyp ERR! find VS` | `better-sqlite3` cần build native addon | Dùng Node >= 22 (prebuilt), hoặc cài VS Build Tools |
| `Could not locate the bindings file` | Node.js ABI mismatch | `npm install better-sqlite3@^12.9.0` |
| `'tsc' is not recognized` | TypeScript chưa cài | `npm install --ignore-scripts && npm run build` |
| `Cannot find module 'dist/index.js'` | Chưa build | `npm run build` |

### Loi runtime

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `Config FAIL: DB_PATH Required` | Thiếu biến env `DB_PATH` | Kiểm tra `env` block trong config |
| `REPO_ROOT does not exist` | Path sai | Dùng absolute path, kiểm tra thư mục tồn tại |
| Cline 🔴 Disconnected | Path dist/index.js sai, hoặc chưa build | Xem Output panel > "Cline" |
| `explain_symbol` trả metadata thô | Không có LLM endpoint | Set `AI_API_KEY` + `AI_API_BASE_URL` (Mục 6) |
| DB lock error | Nhiều process mở cùng DB | Dùng DB_PATH riêng cho mỗi MCP instance |
| Index chậm lần đầu | Bình thường với repo lớn | Đợi hoàn thành, sau đó watcher chỉ reindex incremental |
| Stale data sau edit | Graph cache chưa invalidate | Restart MCP server hoặc gọi `index_repo` |
| Windows path dùng `\` trong response | DB cũ chưa normalize | Gọi `index_repo` để reindex |

### Kiem tra logs

Cline: Output panel (dropdown top-right) > chọn "Cline"

Chạy tay: set `LOG_LEVEL=debug` để xem log chi tiết.

---

## Tom tat lenh

```bash
# Cai dat
git clone <repo-url> mcp-code1
cd mcp-code1
npm install
npm run build

# Test
npm test

# Chay dev mode (hot-reload)
npm run dev

# Chay thu bang tay
REPO_ROOT=/path/to/project DB_PATH=/tmp/test.db node dist/index.js
```
