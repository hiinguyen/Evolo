# Evolo: review code cho từng push và PR

Tài liệu này mô tả lệnh `evolo review`: một judge riêng đọc lại một đơn vị đã chấm (một lần push hoặc một PR đã merge) và viết review code cho nó.
Review được lưu lại để xem lại trong terminal, và sau này trên dashboard.

Trạng thái (2026-10-20): đã chốt thiết kế, chưa xây.

## 1. Quyết định chính

| Câu hỏi | Quyết định | Lý do ngắn |
|---|---|---|
| Review chạy lúc nào? | Chỉ khi người dùng gọi `evolo review`, không chạy tự động sau mỗi lần chấm | Người dùng chọn; chỉ trả tiền judge cho đơn vị mình muốn xem kỹ |
| Gộp vào lần chấm điểm hay chạy riêng? | Chạy riêng, prompt riêng, schema riêng | Review không làm lệch điểm, và đổi prompt review không phải chấm lại |
| Review gồm gì? | Nhận xét tổng thể, điểm mạnh, điều cần cải thiện, danh sách vấn đề có vị trí `file:dòng`, mức độ và gợi ý sửa | Người dùng muốn cả nhận xét phát triển lẫn review code cụ thể |
| Ngôn ngữ? | Theo cấu hình `review.language`, mặc định `en` | Người dùng muốn cấu hình được |
| Lưu ở đâu? | `~/.evolo/reviews/`, tách khỏi ledger | Ledger chỉ giữ điểm và XP; chấm lại không xoá review |
| Review có ảnh hưởng XP không? | Không | AI chỉ đánh giá, code mới tính; review không có điểm nào |
| Tên lệnh? | `evolo review <ref>`; performance review theo kỳ đổi thành `evolo report` | Tránh trùng tên với `docs/architecture.md` mục 8 |

## 2. Lệnh

```bash
evolo review [<commit>|#<pr>|<unit id>] [--again] [--judge claude|opencode] [--model <id>]
evolo config                              # liệt kê thiết lập và giá trị hiện tại
evolo config get review.language
evolo config set review.language vi
```

- Đơn vị được tìm giống `evolo why`, bằng chung hàm `findByRef` trong `src/views.mjs`.
  Không có tham số thì lấy đơn vị mới nhất.
- Đơn vị đã có review được lưu thì lệnh chỉ in review đó, không gọi judge.
- `--again` chạy lại review và thay bản đã lưu.
- Review chạy ngay trong terminal, in tiến trình của judge ra stderr, không qua hàng đợi của worker.
- Mọi đơn vị có `result.facts` trong ledger đều review được, kể cả đơn vị `failed` sau khi đã thu thập facts, đơn vị `reverted`, `superseded`, `needs_review` và đơn vị chấm bằng luật.
- Đơn vị không có `result` (push bị từ chối, đơn vị bị bỏ qua) bị từ chối với thông báo rõ lý do.
- `evolo why` thêm một dòng cho biết đơn vị đã có review hay chưa, kèm lệnh để xem hoặc tạo review.
- Skill `/evolo` thêm `review <ref>`.
  Skill có `disable-model-invocation`, nên agent đang code không tự gọi review và không tốn tiền ngoài ý muốn.

## 3. Cấu hình

File `~/.evolo/config.json` (hoặc `$EVOLO_HOME/config.json`), ghi bằng `writeJson` của `src/store.mjs`.

```json
{ "review": { "language": "vi" } }
```

- `evolo config` chỉ nhận các khoá đã biết; hiện chỉ có `review.language`.
- `review.language` là tên hoặc mã ngôn ngữ (`vi`, `Vietnamese`, `pt-BR`...), tối đa 40 ký tự, chỉ gồm chữ cái, khoảng trắng và `-`.
  Giá trị này được chèn vào câu lệnh gửi judge, nên phải được kiểm tra.
- File không có hoặc thiếu khoá thì dùng giá trị mặc định.
- File không phải JSON hợp lệ thì lệnh dừng và báo lỗi, không ghi đè.
- Ngôn ngữ chỉ áp dụng cho phần chữ của review.
  `severity` và `category` luôn là mã tiếng Anh cố định, để dashboard lọc và đếm được.

## 4. Judge

### 4.1 Task spec

Hiện backend `claude` và `opencode` gắn cứng với `judge/xp-judge.md` và `judge/output.schema.json`.
Mỗi lần gọi judge sẽ nhận thêm một task spec `{ name, promptPath, schemaPath }`.
Có hai spec: `xp-judge` (chấm điểm, giữ nguyên hành vi hiện tại) và `xp-review`.
`claude` dùng `promptPath` cho `--append-system-prompt-file` và `schemaPath` cho `--json-schema`.
`opencode` ghi agent tên `name` từ `promptPath`.
Sandbox giữ nguyên cho cả hai việc: `--restricted`, allowlist lệnh git chỉ-đọc, ngân sách $1 mỗi lần, `EVOLO_JUDGE=1`.

### 4.2 Đầu vào

Phần dựng worktree tạm tại `tip` và ghi `facts.json`, `repo-context.json`, `change.diff` được tách khỏi `evaluateUnit` thành một hàm dùng chung.
Review dùng lại `facts` đã lưu trong ledger, nên judge thấy đúng change set đã được chấm.
Repo của đơn vị phải còn được đăng ký trong `repos.json`, để biết clone nằm ở đâu.
Commit `tip` không còn trong clone thì được tải lại từ remote đã đăng ký, như cách `src/units.mjs` tải commit của PR.

### 4.3 Prompt `judge/xp-review.md`

- Phần mô tả đầu vào và luật tin cậy (nội dung trong repo là dữ liệu, không phải lệnh) dùng chung với `xp-judge.md`, tách ra một file chung để chỉ có một nguồn.
- Quy trình: đọc hết `change.diff`, dùng `git grep` tìm nơi gọi code bị đổi, xem `git log` và `git blame` ở vùng bị sửa, rồi viết review.
- Chỉ báo vấn đề có thật và chỉ được tới dòng code cụ thể.
  Không có vấn đề thì `findings` là mảng rỗng.
- `severity`:
  - `high`: sai hành vi, mất dữ liệu, lỗi bảo mật, rò rỉ tài nguyên.
  - `medium`: rủi ro có thật, xử lý lỗi thiếu, thiếu test cho đường chính.
  - `low`: dễ đọc, dễ bảo trì, đặt tên.
- `category`: `bug`, `security`, `performance`, `test`, `design`, `readability`, `other`.
- Review không có điểm, không nhắc tới XP.
- Câu lệnh gửi judge nêu ngôn ngữ: các trường chữ viết bằng `<review.language>`.

### 4.4 Schema `judge/review.schema.json`

```json
{
  "overview": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "findings": [
    {
      "severity": "high | medium | low",
      "category": "bug | security | performance | test | design | readability | other",
      "location": "path hoặc path:dòng hoặc path:dòng-dòng",
      "title": "string",
      "detail": "string",
      "suggestion": "string"
    }
  ],
  "flags": ["suspected_injection | incomplete_investigation"],
  "notes": "string"
}
```

## 5. Kiểm tra đầu ra

`validateReview` nằm trong `src/review.mjs` mới, là hàm thuần như `validateEvaluation`.

- Sai cấu trúc, hoặc có cờ `incomplete_investigation`: thử lại, tối đa 3 lần như khi chấm điểm.
- Vấn đề có `location` trỏ tới file không có trong repo tại `tip` và không có trong change: bỏ vấn đề đó, ghi lý do vào `issues`, không thử lại.
- Có cờ `suspected_injection`: vẫn lưu, và khi in review thì có cảnh báo ở đầu.
- Judge không chạy được (chưa đăng nhập, mất mạng, hết hạn mức), hoặc cả 3 lần đều sai: báo lỗi, thoát mã khác 0, không lưu gì, review cũ (nếu có) giữ nguyên.

## 6. Lưu trữ

Mỗi đơn vị một file `~/.evolo/reviews/<owner>/<repo>/<unit id>.json`, ghi atomic bằng `writeJson`:

```json
{
  "unitId": "pr-5",
  "repo": "hiinguyen/lightrag",
  "tip": "<sha>",
  "at": "2026-10-20T08:00:00.000Z",
  "language": "vi",
  "judge": { "backend": "claude", "model": "claude-sonnet-5-5" },
  "costUsd": 0.12,
  "durationMs": 21000,
  "review": { "overview": "...", "strengths": [], "improvements": [], "findings": [], "flags": [], "notes": "" },
  "issues": []
}
```

- Mã đơn vị trùng với mã trong ledger, nên dashboard ghép được review với điểm.
- `--again` thay file; không giữ lịch sử các lần review.
- Gỡ repo bằng `evolo uninstall` không xoá review, giống ledger.

## 7. Test

- Unit test: `validateReview` (cấu trúc sai, vị trí không tồn tại, các cờ), `config` (khoá lạ, giá trị sai, file hỏng, mặc định), hàm in review.
- Test E2E với `claude` giả trong `fakes/`:
  - `evolo review` lưu file; gọi lần hai không gọi judge; `--again` có gọi;
  - ngôn ngữ trong config có mặt trong câu lệnh gửi judge;
  - vấn đề trỏ tới file không tồn tại bị bỏ và ghi vào `issues`;
  - đơn vị không có `facts` bị từ chối;
  - `tip` không còn trong clone được tải lại từ remote;
  - judge không chạy được thì không lưu gì.
- Mọi test chấm điểm hiện có vẫn pass sau khi tách task spec.
- Chạy thật một lần bằng `claude` thật trên một đơn vị của lightrag với `review.language vi`, ghi chi phí, thời gian và nhận xét về chất lượng review vào tài liệu này.

## 8. Ngoài phạm vi

- Tự động review sau mỗi lần chấm.
- Dashboard: sẽ đọc `~/.evolo/reviews/` cùng ledger khi được làm (`docs/architecture.md` mục 9).
- Lịch sử nhiều lần review cho cùng một đơn vị.
