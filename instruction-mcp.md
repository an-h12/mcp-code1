# MCP Code Intelligence — Instruction cho Cline AI

## ⚠️ Quy tắc cốt lõi

**Nếu trong quá trình suy nghĩ (thinking) có bất kỳ ý định nào liên quan đến tools bên dưới, AI PHẢI gọi tool đó TRƯỚC KHI trả lời. Không được đoán mò, không được dùng kiến thức nội bộ thay cho tool.**

---

## Phần 1 — Tool Trigger Map

Đây là bảng bắt buộc. Khi AI **nghĩ** đến bất kỳ vấn đề nào bên trái → PHẢI gọi tool bên phải trước.

| Nếu AI đang nghĩ về... | Tool PHẢI gọi | Ghi chú |
|------------------------|---------------|---------|
| Tìm hàm / class / biến theo tên hoặc keyword | `search_symbols` | Dùng khi không biết tên chính xác |
| Ai đang gọi hàm này? / Hàm này gọi gì? / Blast radius | `get_symbol_context` | Trả về callers + callees + blastRadius |
| Hàm này làm gì? / Giải thích logic | `explain_symbol` | Cần `symbol_id` từ `search_symbols` trước |
| Chi tiết của symbol: file path, dòng, signature | `get_symbol_detail` | Không cần AI — metadata thuần |
| Tìm file theo tên hoặc path | `search_files` | Fuzzy search trên path |
| Tất cả symbols trong một file | `get_file_symbols` | Cần `repo_id` + `rel_path` |
| Hàm/biến này được dùng ở đâu? (exact name) | `find_references` | Exact lookup, khác với `search_symbols` |
| Import chain của file này là gì? | `get_import_chain` | BFS theo IMPORTS edges |
| Repo nào đang được index? | `list_repos` | Bước đầu tiên khi chưa biết `repo_id` |
| Thống kê index của repo | `get_repo_stats` | Số symbols, files, trạng thái |
| Đăng ký repo mới | `register_repo` | Cần `name` + `root_path` |
| Trigger index lại repo | `index_repo` | Cần `repo_id` |
| Xóa repo khỏi registry | `remove_repo` | Cần `repo_id` |

---

## Phần 2 — Enforcement Rules

### PHẢI làm (MUST)

- **MUST** gọi `search_symbols` trước khi đưa ra nhận định về bất kỳ hàm, class, hay biến nào — kể cả khi AI "nghĩ là biết" tên chính xác.
- **MUST** gọi `get_symbol_context` trước khi nói về caller/callee, dependency, hay impact của một symbol.
- **MUST** gọi `find_references` trước khi khẳng định "hàm này chỉ được gọi ở X" hoặc "không có nơi nào dùng Y".
- **MUST** gọi `get_file_symbols` trước khi mô tả nội dung hoặc cấu trúc của một file cụ thể.
- **MUST** gọi `list_repos` nếu chưa biết `repo_id` — không được tự đặt giá trị mặc định.
- **MUST** gọi `explain_symbol` khi người dùng hỏi về ý nghĩa hoặc logic của một symbol — không được trả lời từ kiến thức nội bộ.

### KHÔNG được làm (NEVER)

- **NEVER** đoán nội dung của một file hay hàm mà không gọi tool để kiểm tra.
- **NEVER** tự suy ra caller/callee từ tên hàm — graph thực tế có thể khác hoàn toàn.
- **NEVER** dùng tên symbol mà không xác nhận qua `search_symbols` hoặc `find_references` trước.
- **NEVER** bỏ qua tool với lý do "câu hỏi này đơn giản" — tool luôn chính xác hơn suy đoán.
- **NEVER** trả lời câu hỏi về codebase chỉ dựa trên ngữ cảnh hội thoại trước đó — codebase có thể đã thay đổi.

---

## Phần 3 — Tool Reference

### `search_symbols`
**Dùng khi:** Tìm symbol theo keyword hoặc tên một phần.  
**Không dùng khi:** Đã có `symbol_id` chính xác (dùng `get_symbol_detail`).
```json
{
  "query": "validateUser",
  "repo_id": "abc123",
  "kind": "function",
  "limit": 20
}
```
> `kind` có thể là: `function`, `class`, `method`, `interface`, `variable`

---

### `get_symbol_detail`
**Dùng khi:** Cần metadata — file path, line range, signature. Nhanh, không gọi AI.  
**Không dùng khi:** Cần callers/callees (dùng `get_symbol_context`).
```json
{ "symbol_id": "uuid-của-symbol" }
```

---

### `get_symbol_context`
**Dùng khi:** Cần biết ai gọi symbol này (`callers`), symbol này gọi gì (`callees`), và blast radius.  
**`depth`:** 1 = direct only, 2 = default, 3 = maximum.
```json
{
  "symbol_name": "validateUser",
  "depth": 2
}
```
> Response bao gồm `blastRadius` (số callers) và `impactCount` (callers + callees).

---

### `find_references`
**Dùng khi:** Tìm **mọi nơi** một tên symbol cụ thể xuất hiện (exact match).  
**Khác với `search_symbols`:** `find_references` exact, `search_symbols` fuzzy.
```json
{
  "symbol_name": "validateUser",
  "repo_id": "abc123"
}
```

---

### `search_files`
**Dùng khi:** Tìm file theo tên hoặc path fragment.
```json
{
  "query": "auth/middleware",
  "repo_id": "abc123",
  "limit": 50
}
```

---

### `get_file_symbols`
**Dùng khi:** Cần danh sách tất cả symbols trong một file cụ thể.
```json
{
  "repo_id": "abc123",
  "rel_path": "src/auth/validator.ts"
}
```

---

### `explain_symbol`
**Dùng khi:** Người dùng hỏi "hàm này làm gì?" hoặc cần giải thích ngôn ngữ tự nhiên.  
**Cần** `symbol_id` — lấy từ `search_symbols` trước nếu chưa có.
```json
{ "symbol_id": "uuid-của-symbol" }
```

---

### `get_import_chain`
**Dùng khi:** Cần hiểu dependency tree của một file (ai import ai).  
**`depth`:** 1–5, default 3.
```json
{
  "file_path": "src/auth/validator.ts",
  "depth": 3
}
```

---

### `list_repos`
**Dùng khi:** Cần `repo_id` nhưng chưa biết. Luôn gọi đây trước.
```json
{}
```

---

### `get_repo_stats`
**Dùng khi:** Kiểm tra trạng thái index, số symbols, số files của repo.
```json
{ "repo_id": "abc123" }
```

---

### `register_repo` / `index_repo` / `remove_repo`
**Chỉ dùng khi người dùng yêu cầu tường minh** việc quản lý repo.

---

## Phần 4 — Workflow Patterns

### 🔍 Kịch bản 1: Tìm hiểu code mới

```
1. list_repos()                          → Lấy repo_id
2. search_symbols(query: "keyword")      → Tìm symbol liên quan
3. get_symbol_detail(symbol_id: "...")   → Xem file, line, signature
4. get_symbol_context(symbol_name: "...") → Xem callers/callees
5. explain_symbol(symbol_id: "...")      → Hiểu logic của symbol
```

---

### 🐛 Kịch bản 2: Debug lỗi

```
1. search_symbols(query: "tên hàm lỗi") → Xác định symbol chính xác
2. get_symbol_context(symbol_name: "...") → Ai gọi hàm này? (trace ngược)
3. find_references(symbol_name: "...")   → Tất cả nơi symbol được dùng
4. get_file_symbols(rel_path: "...")     → Xem toàn bộ context của file
```

---

### ✏️ Kịch bản 3: Trước khi sửa code

```
1. search_symbols(query: "tên symbol")  → Xác nhận symbol tồn tại
2. get_symbol_context(symbol_name: "...") → Kiểm tra blastRadius
3. find_references(symbol_name: "...")   → Tìm tất cả chỗ sẽ bị ảnh hưởng
4. [Chỉ sau khi hiểu đủ] → Mới bắt đầu sửa
```

> **Quy tắc vàng:** `blastRadius > 5` → thông báo cho người dùng trước khi tiếp tục.

---

## Nhắc nhở cuối

AI không được tự tin vào kiến thức nội bộ khi làm việc với codebase này. Code thay đổi liên tục. Tools luôn có dữ liệu mới nhất. **Gọi tool trước, trả lời sau.**
