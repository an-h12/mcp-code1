# MCP Code Intelligence — Instruction cho AI Model

## ⛔ QUY TẮC SỐ 1 — KHÔNG THỂ BỎ QUA

> **Mọi câu hỏi về codebase = phải gọi tool trước. KHÔNG CÓ NGOẠI LỆ.**
>
> AI không được trả lời bất kỳ câu hỏi nào về code, hàm, file, dependency, hay cấu trúc dự án chỉ bằng kiến thức nội bộ. Code thay đổi liên tục. Kiến thức nội bộ luôn lỗi thời. **Tool là nguồn sự thật duy nhất.**

---

## Phần 1 — Tool Trigger Map (Bắt buộc tuyệt đối)

Đọc từng dòng. Khi AI **nhận ra** bất kỳ tình huống nào bên trái → **NGAY LẬP TỨC** gọi tool bên phải, TRƯỚC KHI suy nghĩ tiếp.

| Tình huống AI nhận ra | Tool BẮT BUỘC gọi | Ghi chú quan trọng |
|----------------------|-------------------|---------------------|
| Người dùng hỏi về hàm / class / biến / interface bất kỳ | `code_search_symbols` | Kể cả khi AI "chắc chắn biết" tên — vẫn phải gọi |
| Người dùng hỏi file này có gì / cấu trúc file | `code_get_file_symbols` | Không được mô tả file từ context cũ |
| Người dùng hỏi ai gọi hàm này / hàm này phụ thuộc gì | `code_get_symbol_context` | Hoặc `code_find_callers` / `code_find_callees` — xem bên dưới |
| Người dùng hỏi "nếu sửa X thì ảnh hưởng gì" | `code_get_impact_analysis` | **PHẢI** gọi trước khi bàn về impact |
| Người dùng hỏi callers (ai gọi hàm này) | `code_find_callers` | Tập trung incoming, đơn giản hơn `get_symbol_context` |
| Người dùng hỏi callees (hàm này gọi gì) | `code_find_callees` | Tập trung outgoing |
| Người dùng hỏi hàm này làm gì / ý nghĩa logic | `code_explain_symbol` | Cần `symbol_id` → lấy từ `code_search_symbols` trước |
| Người dùng hỏi metadata: file, dòng, signature | `code_get_symbol_detail` | Cần `symbol_id` |
| Người dùng hỏi hàm này được dùng ở đâu (exact name) | `code_find_references` | Exact lookup — khác `code_search_symbols` (fuzzy) |
| Người dùng hỏi import của file / dependency tree | `code_get_import_chain` | BFS theo IMPORTS edges |
| Người dùng tìm file theo tên hoặc path | `code_search_files` | Fuzzy search trên đường dẫn |
| Người dùng hỏi repo nào đang index / chưa có `repo_id` | `code_list_repos` | **Bước đầu tiên** mọi workflow |
| Người dùng hỏi số symbols / files / trạng thái index | `code_get_repo_stats` | Thống kê index |
| Người dùng muốn thêm repo mới | `code_register_repo` | Cần `name` + `root_path` |
| Người dùng muốn index lại | `code_index_repo` | Cần `repo_id` |
| Người dùng muốn xóa repo | `code_remove_repo` | Không thể hoàn tác |

---

## Phần 2 — Self-Check Trước Mỗi Câu Trả Lời

**Trước khi gõ bất kỳ chữ nào trả lời câu hỏi về code, AI phải tự hỏi:**

```
□ Câu hỏi này liên quan đến symbol / hàm / class cụ thể?
  → Đã gọi code_search_symbols chưa? NẾU CHƯA → GỌI NGAY

□ Câu hỏi này hỏi về nội dung hoặc cấu trúc file?
  → Đã gọi code_get_file_symbols chưa? NẾU CHƯA → GỌI NGAY

□ Câu hỏi này về caller / callee / dependency / impact?
  → Đã gọi code_get_symbol_context / code_find_callers / code_find_callees / code_get_impact_analysis chưa?
  → NẾU CHƯA → GỌI NGAY

□ Câu hỏi này hỏi hàm làm gì / logic nội tại?
  → Đã gọi code_explain_symbol chưa? NẾU CHƯA → GỌI NGAY

□ Tôi có đang dùng thông tin từ context trước đó mà không verify lại không?
  → Codebase có thể đã thay đổi → GỌI TOOL ĐỂ VERIFY
```

**Nếu bất kỳ ô nào trả lời "NẾU CHƯA" → DỪNG, gọi tool trước, rồi mới tiếp tục.**

---

## Phần 3 — Enforcement Rules

### PHẢI làm (MUST)

- **MUST** gọi `code_search_symbols` trước khi đưa ra nhận định về bất kỳ hàm, class, hay biến nào — kể cả khi AI "nghĩ là biết" tên chính xác.
- **MUST** gọi `code_get_impact_analysis` trước khi nói "sửa X sẽ ảnh hưởng đến Y" hay đề xuất refactor.
- **MUST** gọi `code_find_callers` hoặc `code_get_symbol_context` trước khi nói về caller.
- **MUST** gọi `code_find_references` trước khi khẳng định "hàm này chỉ được gọi ở X" hoặc "không có nơi nào dùng Y".
- **MUST** gọi `code_get_file_symbols` trước khi mô tả nội dung hoặc cấu trúc của một file cụ thể.
- **MUST** gọi `code_list_repos` nếu chưa biết `repo_id` — không được tự đặt giá trị mặc định.
- **MUST** gọi `code_explain_symbol` khi người dùng hỏi về ý nghĩa hoặc logic của một symbol — không được trả lời từ kiến thức nội bộ.
- **MUST** gọi tool ngay cả khi đã có thông tin tương tự từ tin nhắn trước — context cũ không đáng tin.

### KHÔNG được làm (NEVER)

- **NEVER** đoán nội dung của một file hay hàm mà không gọi tool để kiểm tra.
- **NEVER** tự suy ra caller/callee từ tên hàm — graph thực tế có thể khác hoàn toàn.
- **NEVER** dùng tên symbol mà không xác nhận qua `code_search_symbols` hoặc `code_find_references` trước.
- **NEVER** bỏ qua tool với lý do "câu hỏi này đơn giản" — tool luôn chính xác hơn suy đoán.
- **NEVER** trả lời câu hỏi về codebase chỉ dựa trên ngữ cảnh hội thoại — codebase có thể đã thay đổi.
- **NEVER** nói "tôi nghĩ hàm X làm Y" mà không chạy `code_explain_symbol` trước.
- **NEVER** ước lượng blast radius hay impact mà không chạy `code_get_impact_analysis`.

---

## Phần 4 — Tool Reference

### `code_search_symbols`
**Trigger:** Bất kỳ lần nào nhắc đến tên hàm, class, biến, interface.  
**Ưu tiên:** Dùng khi không có `symbol_id`. Dùng trước `code_get_symbol_detail`.
```json
{
  "query": "validateUser",
  "repo_id": "abc123",
  "kind": "function",
  "limit": 20
}
```
> `kind`: `function`, `class`, `method`, `interface`, `variable`, `type`, `enum`, `const`  
> Trả về: `{ items: [...], total_count, has_more, next_offset }`

---

### `code_get_symbol_detail`
**Trigger:** Cần metadata chính xác — file path, line range, signature, docComment.
```json
{ "symbol_id": "uuid-của-symbol" }
```
> Trả về: `{ id, name, kind, repoId, filePath, startLine, endLine, signature, docComment }`

---

### `code_get_symbol_context`
**Trigger:** Câu hỏi về callers + callees đồng thời, hoặc cần `blastRadius` + `impactCount`.  
**Dùng `code_find_callers` / `code_find_callees` nếu chỉ cần một chiều.**
```json
{
  "symbol_name": "validateUser",
  "depth": 2
}
```
> `depth`: 1 = direct only, 2 = default, 3 = maximum  
> Trả về: `{ symbol, callers[], callees[], blastRadius, impactCount, resolvedAs }`

---

### `code_find_callers` ⭐ MỚI
**Trigger:** "Ai đang gọi hàm X?" / "Caller của X là gì?" / "X được dùng từ đâu?"
```json
{
  "symbol_name": "validateUser",
  "depth": 1
}
```
> Trả về: `{ symbol, callers[], blastRadius }`  
> `depth` default 1 = direct callers only.

---

### `code_find_callees` ⭐ MỚI
**Trigger:** "Hàm X gọi những gì?" / "Dependency trực tiếp của X?" / "X phụ thuộc vào hàm nào?"
```json
{
  "symbol_name": "validateUser",
  "depth": 1
}
```
> Trả về: `{ symbol, callees[], dependencyCount }`

---

### `code_get_impact_analysis` ⭐ MỚI
**Trigger:** "Nếu sửa X thì ảnh hưởng gì?" / "Có an toàn không khi thay đổi X?" / "Blast radius của X?"  
**BẮT BUỘC gọi trước bất kỳ đề xuất refactor hay rename nào.**
```json
{
  "symbol_name": "validateUser"
}
```
> Trả về:  
> - `risk`: `LOW` (0-3 callers) / `MEDIUM` (4-9) / `HIGH` (10+)  
> - `direct.symbols[]`: d=1 **WILL BREAK** — phải update  
> - `indirect.symbols[]`: d=2 **LIKELY AFFECTED** — cần test  
> - `transitive.symbols[]`: d=3 **MAY NEED TESTING**  
> - `totalImpact`: tổng số symbols bị ảnh hưởng

---

### `code_find_references`
**Trigger:** "Hàm X được dùng ở đâu?" (exact name match, khác fuzzy search).
```json
{
  "symbol_name": "validateUser",
  "repo_id": "abc123"
}
```
> Trả về: `{ references: [{ id, name, kind, filePath, referenceType: 'definition'|'caller' }] }`

---

### `code_search_files`
**Trigger:** Tìm file theo tên hoặc path fragment.
```json
{
  "query": "auth/middleware",
  "repo_id": "abc123",
  "limit": 50
}
```
> Trả về: `{ items: [{ id, repo_id, rel_path, language, size_bytes }], ... }`

---

### `code_get_file_symbols`
**Trigger:** "File X có những gì?" / cần danh sách symbol trong file.
```json
{
  "repo_id": "abc123",
  "rel_path": "src/auth/validator.ts"
}
```
> Trả về: `{ symbols: [...] }` sắp xếp theo line number

---

### `code_explain_symbol`
**Trigger:** "Hàm này làm gì?" / "Giải thích logic của X."  
**Cần** `symbol_id` → lấy từ `code_search_symbols` trước nếu chưa có.
```json
{ "symbol_id": "uuid-của-symbol" }
```

---

### `code_get_import_chain`
**Trigger:** "File này import gì?" / "Dependency tree của file X?"  
`depth` mặc định 3, tối đa 5.
```json
{
  "file_path": "src/auth/validator.ts",
  "depth": 3
}
```

---

### `code_list_repos`
**Trigger:** Chưa biết `repo_id`. **Luôn gọi đây trước** khi bắt đầu workflow mới.
```json
{}
```
> Trả về: `{ repos: [{ id, name, rootPath, language, indexedAt, fileCount, symbolCount }] }`

---

### `code_get_repo_stats`
**Trigger:** Hỏi về số symbols, số files, ngôn ngữ, trạng thái index.
```json
{ "repo_id": "abc123" }
```
> Trả về: `{ repoId, fileCount, symbolCount, lastIndexedAt, languageBreakdown }`

---

### `code_register_repo` / `code_index_repo` / `code_remove_repo`
**Chỉ dùng khi người dùng yêu cầu tường minh** quản lý repo.

---

## Phần 5 — Workflow Patterns

### 🔍 Kịch bản 1: Tìm hiểu code mới

```
1. code_list_repos()                              → Lấy repo_id
2. code_search_symbols(query: "keyword")          → Tìm symbol liên quan
3. code_get_symbol_detail(symbol_id: "...")       → Xem file, line, signature
4. code_get_symbol_context(symbol_name: "...")    → Xem callers + callees
5. code_explain_symbol(symbol_id: "...")          → Hiểu logic của symbol
```

---

### 🐛 Kịch bản 2: Debug lỗi

```
1. code_search_symbols(query: "tên hàm lỗi")     → Xác định symbol chính xác
2. code_find_callers(symbol_name: "...")          → Ai đang gọi hàm này?
3. code_find_references(symbol_name: "...")       → Tất cả nơi symbol được dùng
4. code_get_file_symbols(rel_path: "...")         → Xem toàn bộ context của file
```

---

### ✏️ Kịch bản 3: Trước khi sửa code (BẮT BUỘC)

```
1. code_search_symbols(query: "tên symbol")       → Xác nhận symbol tồn tại
2. code_get_impact_analysis(symbol_name: "...")   → ⭐ PHẢI làm — xem risk level
3. code_find_references(symbol_name: "...")       → Tìm tất cả nơi bị ảnh hưởng
4. [Thông báo risk level cho người dùng]
5. [Chỉ sau khi người dùng xác nhận] → Mới bắt đầu sửa
```

> **Quy tắc vàng:** `risk = HIGH` hoặc `blastRadius > 5` → **bắt buộc** báo người dùng và chờ xác nhận trước khi tiếp tục.

---

### 🏗️ Kịch bản 4: Onboard repo mới (dùng Prompt)

Gọi MCP Prompt `code_onboard_repo` với `name` và `root_path` — prompt sẽ hướng dẫn từng bước register → index → stats.

---

### 🗺️ Kịch bản 5: Tổng quan kiến trúc (dùng Prompt)

Gọi MCP Prompt `code_explain_codebase` — prompt sẽ tự động gọi các tools theo trình tự để phân tích stack, modules, entry points, và patterns.

---

## Phần 6 — MCP Prompts có sẵn

| Prompt | Arguments bắt buộc | Mô tả |
|--------|--------------------|-------|
| `code_analyze_symbol_impact` | `symbol_name` | Hướng dẫn phân tích blast radius, list d=1/d=2, đề xuất refactor an toàn |
| `code_onboard_repo` | `name`, `root_path` | Hướng dẫn register → index → thống kê repo mới |
| `code_explain_codebase` | — | Tổng quan kiến trúc: tech stack, modules, entry points, patterns |

> **Khi nào dùng Prompt thay vì Tool trực tiếp?**  
> Dùng Prompt khi cần workflow nhiều bước có hướng dẫn. Dùng Tool trực tiếp khi cần kết quả cụ thể ngay lập tức.

---

## Nhắc nhở cuối — Lý do tool quan trọng hơn kiến thức nội bộ

1. **Codebase thay đổi liên tục** — file watcher reindex trong vòng 1-2s mỗi khi có thay đổi. Kiến thức nội bộ của AI luôn lỗi thời.
2. **Call graph không thể đoán** — chỉ có BFS trên graph thực tế mới cho kết quả đúng. Tên hàm không phản ánh ai gọi nó.
3. **Impact analysis không thể ước lượng** — `code_get_impact_analysis` tính toán chính xác 3 tầng d=1/d=2/d=3. Không có cách nào đoán đúng từ code reading.
4. **AI có thể hallucinate symbol** — tool search xác nhận symbol thực sự tồn tại trong DB với line number chính xác.

**Gọi tool trước. Trả lời sau. Luôn luôn.**
