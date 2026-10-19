# Evolo: bàn giao để tiếp tục ở session mới

Cập nhật: 2026-10-19.
Mở session mới và bảo Claude: "đọc `docs/handoff.md` rồi làm tiếp bước tiếp theo".

## 1. Evolo là gì

Công cụ **cá nhân** theo dõi và chấm điểm đóng góp code trên GitHub: XP, level, achievement, analytics, performance review, dashboard.
Mỗi đóng góp được một AI judge (Claude, chạy headless trong sandbox chỉ-đọc) chấm theo rubric, rồi code tính XP bằng công thức tất định.
Đơn vị chấm là **một lần push lên nhánh mặc định** hoặc **một PR đã merge**, không phải từng commit.
Chỉ dùng cho bản thân, nên **không có chống gian lận, server hay leaderboard**.

## 2. Tài liệu

| File | Nội dung | Trạng thái |
|---|---|---|
| `docs/architecture.md` | Thiết kế tổng thể: phạm vi, đơn vị chấm, level, achievement, analytics, review, dashboard, dữ liệu, lộ trình | Thiết kế |
| `docs/auto-scoring.md` | Tự chấm sau push và PR merge: hook `pre-push`, hàng đợi, worker, sync PR qua `gh`, judge Claude, kết quả so sánh model | Đã xây, trừ phần hiển thị (thông báo, `why`, skill, status line) |
| `docs/xp-evaluation.md` | Rubric, judge, công thức XP, mô hình dữ liệu ban đầu | Đã xây |
| `docs/handoff.md` | File này | |

Thứ tự đọc khi bắt đầu: file này, rồi `architecture.md`, rồi `auto-scoring.md`.

## 3. Đã làm xong

### Chấm một change set: push hoặc PR (giai đoạn 0 và đầu giai đoạn 1)

Code trong `packages/cli/`:

| File | Vai trò |
|---|---|
| `bin/evolo.mjs` | CLI: `init`, `uninstall`, `sync`, `status`, `worker`, `enqueue` (hook gọi), và `evaluate` (chấm tay `--range`, `--pr`, SHA đơn) |
| `src/hooks.mjs` | Cài và gỡ hook `pre-push`, nối tiếp hook cũ (`pre-push.evolo-chained`) |
| `src/repos.mjs` | `~/.evolo/repos.json`, `init`, `uninstall` |
| `src/queue.mjs` | Hàng đợi file, lock của worker (PID và heartbeat), khởi động worker tách rời |
| `src/worker.mjs` | Ghi push vào hàng đợi, xác nhận push tới remote, chấm, thử lại, sync PR đã merge |
| `src/ledger.mjs` | Bản ghi kết quả từng đơn vị và trạng thái (`scored`, `superseded`, `reverted`...) |
| `src/store.mjs` | Thư mục `~/.evolo` (hoặc `$EVOLO_HOME`), ghi JSON atomic, `evolo.log` |
| `fakes/` | `gh` và `claude` giả cho test E2E |
| `src/units.mjs` | Biến dải push, commit đơn hoặc số PR thành unit `{kind, id, base, tip, excluded, selected?, pr?}`, và chọn commit được tính |
| `src/github.mjs` | Mọi lời gọi `gh`: đọc PR, PR đã merge chứa một commit, chọn remote trỏ đúng repo GitHub |
| `src/evaluate.mjs` | Pipeline cho một unit: facts → triage → worktree tạm tại `tip` → judge → validate → XP; thử lại tối đa 3 lần |
| `src/facts.mjs` | Số liệu diff ròng `base..tip` (file, dòng, loại file, test), danh sách commit, revert, thông tin PR, và bối cảnh repo |
| `src/score.mjs` | Triage bằng luật, validator kiểm bằng chứng và cap điểm, công thức XP 1.2 (bội số của 5, tối thiểu 5), `levelFor` (`20 × L²`) |
| `src/judges/claude.mjs` | Judge mặc định: `claude -p` sandbox, model `claude-sonnet-5-5` |
| `src/judges/opencode.mjs` | Judge thay thế qua opencode (`--judge opencode`) |
| `src/judges/common.mjs` | Allowlist lệnh git chỉ-đọc, chạy tiến trình JSONL, timeout, dọn tiến trình con |
| `judge/xp-judge.md` | Rubric và prompt, nguồn duy nhất cho mọi backend |
| `judge/output.schema.json` | Schema đầu ra, có test kiểm tra khớp với validator |

Chạy:

```bash
cd packages/cli && npm test                      # 54 test, đều pass (10 test E2E, khoảng 12 giây)
ln -s "$PWD/packages/cli/bin/evolo.mjs" ~/.local/bin/evolo   # cài một lần (đã làm trên máy này)
evolo init                                       # trong clone cần chấm; sau đó cứ push hoặc merge PR
evolo status                                     # hàng đợi và các lần chấm gần nhất
evolo evaluate --repo <clone> --out <dir> --own \
  [--range <from>..<to>]... [--pr <number>]... [<sha>...]
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

### Quy tắc của change set

- Một commit đơn là push `sha^..sha`; dải push là `from..to`; PR là `merge-base(baseRefOid, headRefOid)..headRefOid`.
- Số liệu và diff cho judge là **diff ròng** `base..tip`, nên file thêm rồi xoá trong cùng đơn vị không được tính.
- `--range` bỏ commit đã được một PR đã merge chấm, và bỏ commit của tác giả khác khi có `--author` (lặp được, vì bạn commit bằng nhiều email).
  Commit bị bỏ vì PR khi GitHub liên kết nó với một PR đã merge (đúng cho merge commit, squash và rebase), trừ khi nó đã nằm trên nhánh đích từ trước PR đó.
  Cả lần push chỉ tốn một truy vấn GraphQL cho mỗi 100 commit.
- Có commit bị bỏ thì đơn vị chuyển sang `diffMode: "per-commit"`: chấm các commit còn lại ghép nối, ghi các commit bị bỏ trong `excluded` (phương án C của vấn đề 1).
- Tải PR thiếu commit từ remote trỏ đúng repo GitHub, không mặc định `origin` (phương án C của vấn đề 2); `evolo init` lưu remote này vào `repos.json`.
- `commits` liệt kê mọi commit không phải merge trong dải, cũ trước, kèm `revertedBy`.
- `reverted` chỉ đúng khi mọi commit bị revert, hoặc merge commit của PR bị revert; revert một phần chỉ được ghi lại.
- Chỉ PR có trạng thái `MERGED` và merge vào nhánh mặc định được chấm.
  PR merge vào nhánh feature (PR lồng nhau, như lightrag #4) được tính trong PR đưa nhánh đó vào nhánh mặc định (#5), để không chấm trùng.
- Dải push phải có `from` là tổ tiên của `to`; sau force-push thì dải bị từ chối, vì diff ròng sẽ gồm cả việc gỡ lịch sử bị bỏ.
- Đơn vị không có commit nào ngoài merge commit bị từ chối trước khi gọi judge.
- File đổi tên được ghi theo đường dẫn mới (`git diff --numstat -z`), để phân loại đúng và dùng được làm bằng chứng.
- Prompt của judge nói rõ đơn vị là push hay PR, và bảo chấm cả change set chứ không chấm từng commit.

### Kết quả chấm change set thật (Sonnet, 2026-10-18)

| Đơn vị | Nội dung | Loại | Điểm rubric | Dòng tính | XP | Chi phí | Thời gian |
|---|---|---|---|---|---|---|---|
| Friday `eb82eec..89fd4e3` | 7 commit tính năng gesture + docs | feature | I3 C2 D3 Q4 S3 | 1430 | 162 | $0.20 | 13s |
| Friday `89fd4e3..8c68e65` | 3 bản sửa, gồm `61e69bc` | bugfix | I2 C2 D3 Q3 S3 | 81 | 77 | $0.04 | 10s |
| Friday `8c68e65..db9ce91` | 3 bản sửa nhỏ, gồm `1ecc693` | bugfix | I2 C1 D2 Q2 S3 | 7 | 38 | $0.03 | 9s |
| lightrag PR #5 | 17 commit, merge commit, mô tả 4,6 KB | feature | I3 C2 D3 Q4 S3 | 934 | 162 | $0.31 | 31s |

- Số file và số dòng của PR #5 khớp đúng GitHub (21 file, +2075 -16).
- Dải `89fd4e3..8c68e65` được 77 XP, gần bằng `61e69bc` chấm riêng (74-78), nên gộp không làm lệch điểm của bản sửa chính.
- Không còn worktree hay thư mục tạm nào sau khi chạy.
- Friday không có PR nào, nên PR được thử trên `hiinguyen/lightrag`.

### Kết quả lọc commit và chọn remote (2026-10-19)

- lightrag `21ba23b..db8fb94` (đoạn có PR #2, PR #3 và commit đẩy thẳng): 2 commit được tính, 5 bị bỏ vì thuộc PR #2 và #3; chế độ `per-commit`; feature I3 C3 D2 Q2 S3, 443 dòng, 130 XP, $0.12, 13 giây.
  Lời tóm tắt của judge chỉ nói về 2 commit được tính.
- Tra GitHub bằng một truy vấn GraphQL: 1,8 giây cho đoạn trên; 2,8 giây cho toàn bộ lịch sử lightrag (`1bd88fc..main`, 27 commit được tính, 33 commit được giao cho PR #1-#5).
- Friday `89fd4e3..8c68e65` vẫn ở chế độ `net` và vẫn 77 XP.
- Clone giả làm fork (`origin` trỏ repo khác, repo thật là `upstream`, đã xoá commit của PR #1): `--pr 1` tự tìm `upstream`, tải PR về, số liệu khớp GitHub.

### Tự chấm sau push và PR (giai đoạn 1, 2026-10-19)

- `evolo init` cài hook `pre-push` (nối tiếp hook cũ) và đăng ký repo vào `~/.evolo/repos.json`; `--remote` chọn remote khi không tự tìm được.
- Hook chỉ ghi một job cho lần cập nhật nhánh mặc định trên remote đã đăng ký, rồi khởi động worker tách rời; nó không bao giờ làm push thất bại.
- Worker xác nhận push tới nơi bằng `ls-remote`, dùng PID của `git push` (`$PPID` của hook) để biết push bị từ chối ngay khi `git push` kết thúc.
- Sau khi chấm xong, worker sync: xếp hàng PR của mình merge vào nhánh mặc định từ lúc đăng ký, và đánh dấu `superseded` (force-push) hoặc `reverted`.
- Judge không chạy được (chưa đăng nhập, mất mạng, hết hạn mức) thì job ở lại hàng đợi, thử lại sau 1, 5, 30 phút; không ghi `failed` ngay.
- Chi tiết, trạng thái ledger và giới hạn đã biết: `docs/auto-scoring.md` mục 3, 4, 7.
- Test E2E (`src/worker.test.mjs`) chạy hook và worker thật trên repo tạm có bare repo làm remote, với `gh` và `claude` giả trong `fakes/`:
  push thành công, nhánh khác, push dưới `EVOLO_JUDGE`, push bị từ chối, push lại sau khi bị từ chối, force-push qua remote chậm, force-push đè commit chưa fetch, PR merge, revert, push dồn dập, mất GitHub, judge không chạy được, worker bị `SIGKILL`.
- Agent review tìm 3 lỗi HIGH (push bị từ chối không bao giờ được chấm lại; judge chưa đăng nhập thành `failed` ngay; sync chạy trước khi force-push tới nơi), đã sửa, mỗi lỗi có test và đã kiểm tra test bắt được lỗi khi đưa nó trở lại.
- Chạy thật (2026-10-19) trên clone tạm của `hiinguyen/lightrag` với `gh` và `claude` thật, `EVOLO_HOME` riêng, mốc `since` lùi về 2026-09-15 08:30:
  sync tìm đúng PR #5 (bỏ PR #4 vì merge vào nhánh feature), worker chấm 162 XP (I3 C2 D3 Q4 S3), $0.16, 17 giây, khớp lần chấm tay; sync lần hai báo "nothing new".
  Chưa thử push thật lên GitHub, vì đó là thao tác ra bên ngoài.

### Git

- Repo: `github.com/hiinguyen/Evolo`.
- `main` có judge, chấm change set và PR (PR #1 và PR #2), lọc commit của push, chọn đúng remote cho PR, chỉ chấm PR vào nhánh mặc định (PR #3).
- Hook, hàng đợi, worker, sync, ledger, `status`, XP bội số của 5 và level `20 × L²` (PR #4).
- Mọi PR trên đã merge; chưa có nhánh nào đang mở.

## 4. Việc tiếp theo

Theo `docs/auto-scoring.md` mục 10 và `docs/architecture.md` mục 11:

1. **Dùng thật vài ngày:** `evolo init` trong các repo cá nhân, theo dõi `~/.evolo/evolo.log` và `evolo status`.
2. **Hiển thị:** thông báo desktop khi chấm xong, `why`, `retry`, `backfill`, skill `/evolo`, status line, hook `SessionStart` chạy `evolo sync`.
3. Sau đó: level, achievement, analytics, review, dashboard (giai đoạn 2), rồi hiệu chỉnh bằng golden set (giai đoạn 3).

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
