# Hướng dẫn cài đặt — code-intelligence-mcp-server

Hướng dẫn chi tiết từng bước để cài đặt, cấu hình và sử dụng MCP server `code-intelligence-mcp-server`.

---

## Mục lục

1. [Yêu cầu hệ thống](#1-yêu-cầu-hệ-thống)
2. [Cài đặt Node.js](#2-cài-đặt-nodejs)
3. [Cài đặt MCP server](#3-cài-đặt-mcp-server)
4. [Cấu hình cho Cline (VS Code)](#4-cấu-hình-cho-cline-vs-code)
5. [Nạp instruction cho AI (bắt buộc)](#5-nạp-instruction-cho-ai-bắt-buộc)
6. [Cấu hình cho Claude Code (CLI)](#6-cấu-hình-cho-claude-code-cli)
7. [Cấu hình AI explain (tùy chọn)](#7-cấu-hình-ai-explain-tùy-chọn)
8. [Xác nhận hoạt động](#8-xác-nhận-hoạt-động)
9. [Cấu hình nhiều repo](#9-cấu-hình-nhiều-repo)
10. [Troubleshooting chi tiết](#10-troubleshooting-chi-tiết)

---

## 1. Yêu cầu hệ thống

### Bắt buộc

| Thành phần | Phiên bản | Ghi chú |
|------------|-----------|---------|
| **Node.js** | >= 20 | Khuyến nghị >= 22 để dùng prebuilt binary |
| **npm** | >= 9 | Đi kèm Node.js |
| **Git** | Bất kỳ | Để clone repo |

### Tùy chọn (cho AI explain)

| Thành phần | Ghi chú |
|------------|---------|
| Ollama | Local LLM server, miễn phí, chạy offline |
| LM Studio | Local LLM server, giao diện đẹp |

---

## 2. Cài đặt Node.js

### Windows

1. Tải từ https://nodejs.org/ — chọn phiên bản **LTS >= 20**
2. Chạy installer, giữ tất cả mặc định
3. Mở PowerShell kiểm tra:
   ```powershell
   node -v   # v20.x.x trở lên
   npm -v    # 9.x.x trở lên
   ```

### macOS

```bash
brew install node@22
# hoặc tải .pkg từ https://nodejs.org/
```

### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 3. Cài đặt MCP server

### Bước 3.1 — Clone repo

```bash
git clone <repo-url> mcp-code1
cd mcp-code1
```

### Bước 3.2 — Cài dependencies

```bash
npm install
```

> **Windows**: Nếu gặp lỗi `gyp ERR! find VS` khi cài `better-sqlite3`:
> - **Cách 1 (khuyến nghị)**: Dùng Node.js >= 22 — có prebuilt binary, không cần build
> - **Cách 2**: Cài [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) với workload **"Desktop development with C++"**

### Bước 3.3 — Build TypeScript

```bash
npm run build
```

Kết quả: thư mục `dist/` với entrypoint `dist/index.js`.

> Nếu lỗi `'tsc' is not recognized`:
> ```bash
> npm install --ignore-scripts && npm run build
> ```

---

## 4. Cấu hình cho Cline (VS Code)

### Bước 4.1 — Cài Cline extension

1. Mở VS Code
2. Extensions (`Ctrl+Shift+X`) → tìm **"Cline"** → Install

### Bước 4.2 — Mở file cấu hình MCP

Dùng Command Palette (`Ctrl+Shift+P`) → gõ **`Cline: Open MCP Settings`**

Hoặc mở thủ công tại:

| OS | Đường dẫn |
|----|-----------|
| **Windows** | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| **macOS** | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Linux** | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

### Bước 4.3 — Thêm cấu hình MCP server

Paste nội dung sau vào file, **thay thế các path theo máy của bạn**:

```json
{
  "mcpServers": {
    "code-intelligence": {
      "command": "node",
      "args": ["C:/path/to/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/path/to/your-project",
        "DB_PATH": "C:/path/to/mcp-data/project.db",
        "LOG_LEVEL": "info"
      },
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

**Giải thích từng trường:**

| Trường | Giá trị cần thay | Ví dụ |
|--------|-----------------|-------|
| `args[0]` | Đường dẫn tuyệt đối đến `dist/index.js` | `C:/Users/YourName/mcp-code1/dist/index.js` |
| `REPO_ROOT` | Thư mục gốc project cần index | `C:/Users/YourName/projects/my-app` |
| `DB_PATH` | Đường dẫn lưu file SQLite | `C:/Users/YourName/mcp-data/my-app.db` |

> **Lưu ý Windows**: Dùng `/` (forward slash) trong JSON, **không** dùng `\` đơn.

> **`DB_PATH`**: Có thể đặt bất kỳ đâu. Thư mục chứa file sẽ được tạo tự động. Mỗi project nên dùng một file `.db` riêng.

### Bước 4.4 — Lưu và kiểm tra

1. Lưu file config (`Ctrl+S`)
2. Cline tự động khởi động MCP server
3. Mở Cline panel → tab **MCP Servers** → kiểm tra **code-intelligence** hiển thị 🟢 **Connected** với **16 tools**

---

## 5. Nạp instruction cho AI (bắt buộc)

File `instruction-mcp.md` trong repo chứa các quy tắc bắt buộc để AI **luôn gọi tool** thay vì đoán mò. **Không nạp file này, AI sẽ bỏ qua tools ngay cả khi cần thiết.**

### Cách A — Cline: Custom Instructions (khuyến nghị)

1. Mở Cline panel
2. Click icon ⚙️ **Settings** (góc trên bên phải panel)
3. Tìm mục **"Custom Instructions"**
4. Copy toàn bộ nội dung file `instruction-mcp.md` và paste vào đây
5. Click **Save**

> Custom Instructions được gửi vào mỗi conversation — AI luôn nhận được quy tắc này.

### Cách B — Cline: Rules file trong project

Tạo file `.clinerules` tại thư mục gốc của project (nơi bạn mở VS Code):

```bash
# Windows PowerShell
Copy-Item "C:\path\to\mcp-code1\instruction-mcp.md" ".clinerules"

# macOS / Linux
cp /path/to/mcp-code1/instruction-mcp.md .clinerules
```

> `.clinerules` được Cline tự động nạp cho project đó. Phù hợp khi muốn rule khác nhau cho từng project.

### Cách C — Claude Code: Memory file

```bash
# Thêm vào CLAUDE.md của project
cat /path/to/mcp-code1/instruction-mcp.md >> CLAUDE.md
```

Hoặc tạo file riêng trong `.claude/`:

```bash
cp /path/to/mcp-code1/instruction-mcp.md .claude/mcp-instructions.md
```

Sau đó thêm vào `CLAUDE.md`:
```markdown
## MCP Tools
@.claude/mcp-instructions.md
```

### Kiểm tra instruction đã có hiệu lực

Hỏi AI: *"Hàm `validateUser` làm gì?"*

- ✅ **Đúng**: AI gọi `code_search_symbols` trước, rồi `code_explain_symbol`
- ❌ **Sai**: AI trả lời ngay từ kiến thức nội bộ mà không gọi tool

---

## 6. Cấu hình cho Claude Code (CLI)

Thêm vào file `.claude/settings.json` trong project hoặc `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "code-intelligence": {
      "command": "node",
      "args": ["/path/to/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "/path/to/your-project",
        "DB_PATH": "/path/to/mcp-data/project.db",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Kiểm tra:

```bash
claude mcp list
# Phải thấy: code-intelligence — node /path/to/dist/index.js
```

---

## 7. Cấu hình AI explain (tùy chọn)

Tool `code_explain_symbol` cần LLM endpoint để sinh giải thích ngôn ngữ tự nhiên. Nếu không cấu hình, tool trả về metadata thô (vẫn hoạt động bình thường).

Thêm 3 biến sau vào block `"env"` trong config MCP:

### Ollama (miễn phí, chạy local)

```bash
# Cài Ollama từ https://ollama.ai/ rồi pull model:
ollama pull qwen2.5-coder
```

```json
"env": {
  "REPO_ROOT": "...",
  "DB_PATH": "...",
  "AI_API_KEY": "local",
  "AI_API_BASE_URL": "http://localhost:11434/v1",
  "AI_MODEL": "qwen2.5-coder"
}
```

### LM Studio

```json
"env": {
  "AI_API_KEY": "local",
  "AI_API_BASE_URL": "http://localhost:1234/v1",
  "AI_MODEL": "tên-model-trong-lm-studio"
}
```

### OpenAI / API tương thích

```json
"env": {
  "AI_API_KEY": "sk-your-api-key",
  "AI_API_BASE_URL": "https://api.openai.com/v1",
  "AI_MODEL": "gpt-4o-mini"
}
```

---

## 8. Xác nhận hoạt động

### Cách 1 — Qua Cline

Mở Cline chat, hỏi:
```
List all tools from code-intelligence MCP server
```
→ Cline liệt kê **16 tools** (tất cả có prefix `code_`).

```
List all prompts from code-intelligence MCP server
```
→ Cline liệt kê **3 prompts**: `code_analyze_symbol_impact`, `code_onboard_repo`, `code_explain_codebase`.

### Cách 2 — Smoke test thủ công

**Windows PowerShell:**
```powershell
$env:REPO_ROOT = "C:\path\to\your-project"
$env:DB_PATH   = "C:\mcp-data\test.db"
$env:LOG_LEVEL = "info"

$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
$init | node C:\path\to\mcp-code1\dist\index.js
```

**macOS / Linux:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | REPO_ROOT=/path/to/project DB_PATH=/tmp/test.db node /path/to/mcp-code1/dist/index.js
```

**Kết quả mong đợi:**
```json
{
  "result": {
    "serverInfo": { "name": "code-intelligence-mcp-server", "version": "0.1.0" },
    "capabilities": { "tools": {}, "resources": {}, "prompts": {} }
  }
}
```

→ Thấy `"name": "code-intelligence-mcp-server"` và `"prompts": {}` = hoạt động đúng.

### Cách 3 — Chạy test suite

```bash
npm test
```

→ 43 test files, 208+ tests passed (5 failures là pre-existing, không ảnh hưởng runtime).

---

## 9. Cấu hình nhiều repo

Mỗi MCP server instance phục vụ 1 repo. Để index nhiều repo, khai báo nhiều entry với key khác nhau:

```json
{
  "mcpServers": {
    "code-backend": {
      "command": "node",
      "args": ["C:/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Code/my-backend",
        "DB_PATH":   "C:/mcp-data/backend.db",
        "LOG_LEVEL": "info"
      },
      "disabled": false,
      "autoApprove": [
        "code_search_symbols", "code_get_symbol_detail", "code_list_repos",
        "code_find_references", "code_search_files", "code_get_file_symbols",
        "code_get_symbol_context", "code_find_callers", "code_find_callees",
        "code_get_impact_analysis", "code_get_import_chain", "code_get_repo_stats"
      ]
    },
    "code-frontend": {
      "command": "node",
      "args": ["C:/mcp-code1/dist/index.js"],
      "env": {
        "REPO_ROOT": "C:/Code/my-frontend",
        "DB_PATH":   "C:/mcp-data/frontend.db",
        "LOG_LEVEL": "info"
      },
      "disabled": false,
      "autoApprove": [
        "code_search_symbols", "code_get_symbol_detail", "code_list_repos",
        "code_find_references", "code_search_files", "code_get_file_symbols",
        "code_get_symbol_context", "code_find_callers", "code_find_callees",
        "code_get_impact_analysis", "code_get_import_chain", "code_get_repo_stats"
      ]
    }
  }
}
```

> **Quan trọng**: Mỗi entry **phải có `DB_PATH` riêng** — SQLite không hỗ trợ nhiều writer trên cùng file.

---

## 10. Troubleshooting chi tiết

### Lỗi cài đặt

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `gyp ERR! find VS` | `better-sqlite3` cần build native | Dùng Node >= 22 (prebuilt), hoặc cài VS Build Tools |
| `Could not locate the bindings file` | Node ABI mismatch | `npm install better-sqlite3@^12.9.0` |
| `'tsc' is not recognized` | TypeScript chưa cài | `npm install --ignore-scripts && npm run build` |
| `Cannot find module 'dist/index.js'` | Chưa build | Chạy `npm run build` |

### Lỗi kết nối Cline

| Triệu chứng | Nguyên nhân | Giải pháp |
|------------|-------------|-----------|
| 🔴 Disconnected | Path `dist/index.js` sai | Kiểm tra đường dẫn trong `args[0]` — dùng path tuyệt đối |
| 🔴 Disconnected | Chưa build | Chạy `npm run build` |
| 🔴 Disconnected | `REPO_ROOT` không tồn tại | Kiểm tra thư mục tồn tại, dùng path tuyệt đối |
| Hiển thị 0 tools | Server key cũ (`mcp-code1`) | Đổi key thành `code-intelligence` và cập nhật `autoApprove` |
| Tools không auto-approve | Tên tool thiếu prefix | Tất cả tên trong `autoApprove` phải có prefix `code_` |

### Lỗi runtime

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `Config FAIL: DB_PATH Required` | Thiếu `DB_PATH` trong env | Thêm `DB_PATH` vào block `"env"` |
| `REPO_ROOT does not exist` | Path sai | Dùng absolute path, kiểm tra thư mục tồn tại |
| `code_explain_symbol` trả metadata thô | Không có LLM endpoint | Set `AI_API_KEY` + `AI_API_BASE_URL` (xem Mục 7) |
| DB lock error | Nhiều process cùng mở một DB | Dùng `DB_PATH` riêng cho mỗi MCP instance |
| Index chậm lần đầu | Bình thường với repo lớn | Đợi hoàn thành — sau đó watcher chỉ reindex incremental |
| File sửa nhưng không cập nhật | `dist/`, `node_modules/`, `.git/` bị bỏ qua | Kiểm tra file không nằm trong thư mục bị ignore |

### AI không dùng tools

| Triệu chứng | Nguyên nhân | Giải pháp |
|------------|-------------|-----------|
| AI trả lời không gọi tool | Chưa nạp `instruction-mcp.md` | Làm theo **Mục 5** |
| AI gọi tool sai tên | Dùng tên cũ (không có `code_`) | Nạp lại instruction — đảm bảo dùng bản mới nhất |
| AI gọi tool nhưng bị chặn | `autoApprove` thiếu tên tool | Thêm tên tool vào `autoApprove` list |

### Kiểm tra logs

**Cline:** Output panel (dropdown góc trên phải) → chọn **"Cline"**

**Thủ công:** Thêm `"LOG_LEVEL": "debug"` vào env để xem log chi tiết.

---

## Tóm tắt lệnh

```bash
# Cài đặt
git clone <repo-url> mcp-code1
cd mcp-code1
npm install
npm run build

# Chạy test
npm test

# Smoke test thủ công (macOS/Linux)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | REPO_ROOT=/path/to/project DB_PATH=/tmp/test.db node dist/index.js

# Smoke test thủ công (Windows PowerShell)
$env:REPO_ROOT="C:\path\to\project"; $env:DB_PATH="C:\tmp\test.db"
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist\index.js
```
