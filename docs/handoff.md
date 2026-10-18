# Evolo: bàn giao để tiếp tục ở session mới

Cập nhật: 2026-10-18.
Mở session mới và bảo Claude: "đọc `docs/handoff.md` rồi làm tiếp bước tiếp theo".

## 1. Evolo là gì

Công cụ **cá nhân** theo dõi và chấm điểm đóng góp code trên GitHub: XP, level, achievement, analytics, performance review, dashboard.
Mỗi đóng góp được một AI judge (Claude, chạy headless trong sandbox chỉ-đọc) chấm theo rubric, rồi code tính XP bằng công thức tất định.
Đơn vị chấm là **một lần push lên nhánh mặc định** hoặc **một PR đã merge**, không phải từng commit.
Chỉ dùng cho bản thân, nên **không có chống gian lận, server hay leaderboard**.

## 2. Tài liệu

| File | Nội dung | Trạng thái |
|---|---|---|
| `docs/architecture.md` | Thiết kế tổng thể: phạm vi, đơn vị chấm, level, achievement, analytics, review, dashboard, dữ liệu, lộ trình | Thiết kế, chưa commit |
| `docs/auto-scoring.md` | Tự chấm sau push và PR merge: hook `pre-push`, hàng đợi, worker, sync PR qua `gh`, judge Claude, kết quả so sánh model | Judge đã xây; phần còn lại là thiết kế |
| `docs/xp-evaluation.md` | Rubric, judge, công thức XP, mô hình dữ liệu ban đầu | Đã xây |
| `docs/handoff.md` | File này | |

Thứ tự đọc khi bắt đầu: file này, rồi `architecture.md`, rồi `auto-scoring.md`.

## 3. Đã làm xong

### Chấm một commit (giai đoạn 0)

Code trong `packages/cli/`:

| File | Vai trò |
|---|---|
| `bin/evolo.mjs` | CLI, hiện chỉ có lệnh `evaluate` |
| `src/evaluate.mjs` | Pipeline cho một commit: facts → triage → worktree tạm → judge → validate → XP; thử lại tối đa 3 lần |
| `src/facts.mjs` | Số liệu đo bằng git (file, dòng, loại file, test, revert) và bối cảnh repo (module, README) |
| `src/score.mjs` | Triage bằng luật, validator kiểm bằng chứng và cap điểm, công thức XP 1.1 |
| `src/judges/claude.mjs` | Judge mặc định: `claude -p` sandbox, model `claude-sonnet-5-5` |
| `src/judges/opencode.mjs` | Judge thay thế qua opencode (`--judge opencode`) |
| `src/judges/common.mjs` | Allowlist lệnh git chỉ-đọc, chạy tiến trình JSONL, timeout, dọn tiến trình con |
| `judge/xp-judge.md` | Rubric và prompt, nguồn duy nhất cho mọi backend |
| `judge/output.schema.json` | Schema đầu ra, có test kiểm tra khớp với validator |

Chạy:

```bash
cd packages/cli && npm test                      # 20 test, đều pass
node packages/cli/bin/evolo.mjs evaluate --repo <clone> --out <dir> --own <sha>...
```

### Kết quả đã đo trên 6 commit của `hiinguyen/Friday`

| Commit | Sonnet lần 1 | Sonnet lần 2 | Haiku | Opencode |
|---|---|---|---|---|
| `08ab8ab` feature 2046 dòng | 174 | 204 | 216 | 216 |
| `4b5aa48` feature 822 dòng | 174 | 174 | 134 | 216 |
| `61e69bc` bugfix 70 dòng | 74 | 78 | 68 | 104 |
| `6db9a46` refactor 179 dòng | 62 | 51 | 80 | 62 |
| `1ecc693` chore 1 dòng | 3 | 3 | 2 | 4 |
| `aa09361` docs (luật) | 7 | 7 | 7 | 7 |

Sonnet: 8-17 giây và khoảng $0.06 mỗi commit, xếp hạng ổn định qua hai lần chạy.
Chi tiết và lý do chọn Sonnet ở `docs/auto-scoring.md` mục 5.

### Git

- Nhánh `feat/claude-judge`, commit `25c6d0f`, đã push lên `origin` (`github.com/hiinguyen/Evolo`).
  Chưa merge vào `main`.
- **Chưa commit:** `docs/architecture.md`, `docs/auto-scoring.md` (viết lại theo push và PR), `docs/handoff.md`.

## 4. Việc tiếp theo

Theo `docs/auto-scoring.md` mục 10 và `docs/architecture.md` mục 11:

1. **Chấm change set và PR.**
   Mở rộng `facts.mjs` để gộp nhiều commit (numstat cộng dồn, danh sách commit, `testsTouched`, revert) và nhận thông tin PR (số, tiêu đề, mô tả).
   Mở rộng `evaluate.mjs` để chấm một danh sách SHA hoặc một PR: diff là `from..to` hoặc `merge-base..headSha`, worktree tại commit cuối, câu lệnh cho judge nói rõ là push hay PR.
   Thêm lệnh `evolo evaluate --range <from>..<to>` và `--pr <number>`.
   Kiểm thử trên vài dải push thật của Friday và ít nhất một PR thật.
2. **Hook, hàng đợi, worker, sync** (`docs/auto-scoring.md` mục 2-4), với test E2E trên repo tạm có bare repo làm remote.
3. **Hiển thị:** thông báo, `status`, `why`, skill `/evolo`, status line.
4. Sau đó: level, achievement, analytics, review, dashboard (giai đoạn 2), rồi hiệu chỉnh bằng golden set (giai đoạn 3).

## 5. Quyết định đã chốt và lý do

- **AI chỉ đánh giá, code mới tính toán:** judge trả điểm rubric 0-4 kèm bằng chứng; XP do `computeXp` tính, nên đổi công thức không phải gọi lại AI.
- **Chấm theo push và PR:** commit là bản nháp; chấm từng commit thì chia nhỏ commit được gấp 8-10 lần XP cho cùng công việc.
- **Trigger là git hook `pre-push`, không phải hook của Claude Code:** bắt cả push gõ tay và từ IDE. Git không có `post-push`, nên worker tự xác nhận push thành công.
- **Judge là tiến trình riêng, không phải phiên đang code:** tránh thiên vị, tránh agent tối ưu theo điểm, tránh làm đầy context.
- **Điểm chỉ báo cho người** (thông báo, status line, `/evolo`), không đưa vào context của agent đang code.
- **Sonnet làm judge mặc định:** nhanh và rẻ nhất, ổn định; Haiku điều tra kỹ hơn nhưng chấm lệch hơn.
- **Không phụ thuộc thêm:** Node.js chuẩn, `git`, `claude`, `gh`. JavaScript ESM, không có bước build.

## 6. Bài học kỹ thuật (đừng lặp lại)

- `claude -p --restricted` chặn settings, hooks, plugin và **cả `CLAUDE.md`** của người dùng lẫn của repo được chấm, mà vẫn dùng được đăng nhập OAuth.
  `--bare` thì đòi API key.
  Đã kiểm chứng bằng một `CLAUDE.md` chứa từ bí mật.
- `--restricted` chỉ cho đọc file trong thư mục làm việc, nên thư mục chứa input của judge phải truyền bằng `--add-dir`.
- Trong `-p`, lệnh không nằm trong allowlist bị từ chối, nhưng Claude Code tự cho phép các lệnh chỉ-đọc như `grep`, `head`, `tail`.
  Lệnh bị từ chối được ghi vào `deniedCommands` của kết quả.
- Prompt kiểu "be efficient, at most 10 steps" làm Sonnet đọc diff bằng `head` rồi chấm.
  Prompt hiện bắt buộc đọc hết diff, và validator loại kết quả có cờ `incomplete_investigation`.
- Sonnet chỉ gọi 2-3 tool mỗi lần chấm (đọc facts và diff); lý do vẫn hợp lý trên Friday nhưng chưa kiểm chứng trên repo lớn.
- opencode: `opencode run` không tự thoát sau sự kiện lỗi; nó lấy project từ biến `PWD`; cần `OPENCODE_DISABLE_PROJECT_CONFIG=1` để repo được chấm không thay được agent.
- zsh **không** tách biến chứa nhiều SHA thành nhiều tham số (`$SHAS`); hãy ghi từng SHA ra.
  CLI giờ kiểm tra SHA trước khi chấm.
- Đừng dùng `pkill -f` hay `pgrep -f` với một pattern: nó có thể khớp với chính shell đang chạy lệnh. Hãy kill theo PID cụ thể.
- Máy có hook GateGuard: lần đầu sửa một file hoặc chạy lệnh xoá, nó đòi nêu sự thật (ai gọi file, dữ liệu, câu lệnh gốc của người dùng, cách khôi phục) rồi mới cho chạy lại.

## 7. Môi trường

- Claude Code 2.1.289, git 2.56.0, Node.js có `node --test`, Linux, zsh.
- opencode 2.0.26 (model mặc định `opencode-go/deepseek-v4.1-flash`, rất chậm).
- Clone thử nghiệm của Friday và các file kết quả JSON nằm trong scratchpad của session cũ, có thể đã mất.
  Clone lại bằng `git clone https://github.com/hiinguyen/Friday`.

## 8. Cách làm việc với người dùng

- Trả lời bằng tiếng Việt.
- Không dùng dấu gạch dài (em dash), dùng `-`.
- Trong file Markdown dài, mỗi câu một dòng.
- Chỉ commit hoặc push khi được yêu cầu; đang ở `main` thì tạo nhánh trước.
- Ưu tiên chất lượng, đơn giản, bền vững hơn chi phí phát triển; sửa lỗi thì tái hiện lỗi end-to-end trước.

## 9. Câu hỏi còn mở

- Có chấm repo của công ty không? Nếu có cần tuỳ chọn tắt gửi code theo từng remote.
- Có cần `/evolo preview` (chấm thử commit chưa push) ngay ở giai đoạn 1 không?
- Thông báo desktop có làm phiền không, hay chỉ hiện trong status line?
