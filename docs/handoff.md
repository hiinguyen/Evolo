# Evolo: bàn giao để tiếp tục ở session mới

Cập nhật: 2026-10-21.
Mở session mới và bảo Claude: "đọc `docs/handoff.md` rồi làm tiếp bước tiếp theo".
Quy tắc làm việc trong repo (git, test, tài liệu) nằm ở `CLAUDE.md`, Claude Code tự nạp ở mỗi phiên.

## 1. Evolo là gì

Công cụ **cá nhân** theo dõi và chấm điểm đóng góp code trên GitHub: XP, level, achievement, analytics, performance review, dashboard.
Mỗi đóng góp được một AI judge (Claude, chạy headless trong sandbox chỉ-đọc) chấm theo rubric, rồi code tính XP bằng công thức tất định.
Đơn vị chấm là **một lần push lên nhánh mặc định** hoặc **một PR đã merge**, không phải từng commit.
Chỉ dùng cho bản thân, nên **không có chống gian lận, server hay leaderboard**.

## 2. Tài liệu

| File | Nội dung | Trạng thái |
|---|---|---|
| `docs/architecture.md` | Thiết kế tổng thể: phạm vi, đơn vị chấm, level, achievement, analytics, review, dashboard, dữ liệu, lộ trình | Có cột trạng thái cho từng tính năng và giai đoạn |
| `docs/auto-scoring.md` | Tự chấm sau push và PR merge: hook `pre-push`, hàng đợi, worker, sync PR qua `gh`, judge Claude, kết quả so sánh model | Đã xây, trừ phần hiển thị (mục 6) |
| `docs/xp-evaluation.md` | Thiết kế gốc của rubric, judge, công thức XP | Có bảng phần nào đã xây, xây khác hoặc chưa làm |
| `docs/review.md` | Review code cho từng push và PR: `evolo review`, cấu hình ngôn ngữ, lưu trữ, kết quả chạy thật | Đã xây (PR #6) |
| `docs/superpowers/plans/2026-10-20-evolo-review.md` | Kế hoạch triển khai `evolo review` | Đã làm xong |
| `docs/superpowers/specs/2026-10-20-evolo-stats-design.md` | Thiết kế analytics (`evolo stats`), phần A của Game hoá: `landedAt`, kỳ, định nghĩa từng chỉ số, streak | Đã xây |
| `docs/superpowers/plans/2026-10-20-evolo-stats.md` | Kế hoạch triển khai `evolo stats` | Đã làm xong |
| `docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md` | Thiết kế dashboard (`evolo dashboard`), phần C của Game hoá: model, khi nào sinh lại, sáu màn hình, bảo mật, module, test | Đã xây |
| `docs/superpowers/plans/2026-10-21-evolo-dashboard.md` | Kế hoạch triển khai dashboard | Đã làm xong |
| `docs/handoff.md` | File này | |
| `CLAUDE.md` | Quy tắc cho agent: quy trình nhánh và PR, ruleset của `main`, cách viết code, test và tài liệu | Cập nhật khi quy tắc đổi |

Thứ tự đọc khi bắt đầu: file này, rồi `architecture.md`, rồi `auto-scoring.md`.

## 3. Trạng thái

### Đã làm

| Phần | Nội dung | PR |
|---|---|---|
| Judge | Rubric 0-4 có bằng chứng, `claude -p --restricted` với Sonnet, validator, backend opencode thay thế | #1 |
| Change set | Chấm một lần push hoặc một PR đã merge như một thay đổi; `evolo evaluate` để chấm tay | #2 |
| Chọn commit | Bỏ commit của người khác và commit thuộc PR đã merge; chọn đúng remote cho PR; chỉ chấm PR vào nhánh mặc định | #3 |
| Tự chấm | `evolo init` / `uninstall`, hook `pre-push`, hàng đợi, worker nền, xác nhận push, sync PR đã merge, ledger, `superseded` và `reverted`, thử lại khi mất mạng hoặc judge không chạy được | #4 |
| XP và level | Công thức 1.2: XP là bội số của 5, tối thiểu 5; level L cần `20 × L²` XP; `evolo status` hiện level, tổng XP, hàng đợi, các lần chấm gần nhất | #4 |
| Hiển thị | Thông báo desktop khi chấm xong (có báo lên level); `evolo why` giải thích điểm rubric, bằng chứng và công thức; `evolo retry`; `evolo statusline` đọc `summary.json`; `status` thêm XP hôm nay và 7 ngày; `evolo claude install` cài skill `/evolo`, hook `SessionStart` chạy `sync --background`, và status line khi chưa có | #5 |
| Review code | `evolo review [<ref>] [--again]`: judge riêng (prompt `judge/xp-review.md`) viết nhận xét, điểm mạnh, điều cần cải thiện, vấn đề có `file:dòng`; lưu ở `~/.evolo/reviews/`; `evolo config set review.language vi`; judge dùng task spec và prompt chung `judge/shared.md` | #6 |
| Tín hiệu XP | CI pass ngay +5%, merge sạch sau review +5%, đóng issue `bug`/`security` +10%; đọc khi chấm và ở mỗi lần sync tới khi chốt (CI xong hoặc sau 24 giờ), XP tính lại từ điểm đã lưu | #7 |
| Chi phí | Trần theo ngày `budget.daily-usd` (mặc định $5), tính từ `costUsd` trong ledger và review; hết thì đơn vị cần judge chờ sang ngày sau, có một thông báo mỗi ngày; `status` in chi phí hôm nay | #7 |
| CI và bảo vệ `main` | `.github/workflows/test.yml` chạy test trên Node 20, 22 và 24; ruleset `main` bắt buộc PR và ba check xanh, cấm force push và xoá | #8; ruleset tạo trên web |
| Analytics | `evolo stats [week\|month\|quarter] [--previous]`: XP, cơ cấu, trung bình rubric, kỷ luật test, revert, repo, thư mục, nhịp làm việc theo kỳ lịch, so với kỳ trước, và streak ngày làm việc; bản ghi có `landedAt` (lúc push hoặc merge), `summary.json` tính XP theo ngày đó | #9 |
| Achievement | `evolo achievements`: 33 achievement hiện nhiều bậc (cột mốc, XP, loại việc, chất lượng, đều đặn, phạm vi, thói quen, commit) kèm tiến độ, và một nhóm achievement ẩn; thông báo desktop khi mở bậc mới; `evolo stats` có dòng `unlocked` | #10 |
| Giờ địa phương | `status`, `why` và `review` hiện giờ theo múi giờ máy thay vì UTC | #11 |
| Dashboard | `evolo dashboard [--no-open]`: trang HTML tĩnh `~/.evolo/dashboard.html` (0600) với Overview, Timeline, chi tiết đơn vị (Score, Review, Files, Commits), Analytics, Achievements, Reviews; worker và `evolo review` ghi lại trang khi nó đã có | #12 |
| Cài đặt | Lệnh `evolo` là symlink `~/.local/bin/evolo` tới `packages/cli/bin/evolo.mjs` | không commit |

### Chưa làm

| Phần | Nội dung | Ở đâu trong docs |
|---|---|---|
| Thao tác | `preview` (chấm thử commit chưa push), duyệt `needs_review` | `auto-scoring.md` mục 6 |
| Thông báo khi mất XP | Đơn vị thành `reverted` hoặc `superseded` khi sync chưa có thông báo | `auto-scoring.md` mục 6 |
| Game hoá | Còn D performance review (`evolo report`), một spec và một PR | `architecture.md` mục 8, 9 |
| Hiệu chỉnh | Golden set có repo lớn, chấm nhiều lần, chỉnh hằng số level | `architecture.md` mục 11 |
| Tần suất sync | Hook `SessionStart` chạy ở mọi phiên Claude Code, ở bất kỳ thư mục nào, và mỗi lần gọi `gh` cho từng repo đã đăng ký; chưa có giới hạn kiểu "bỏ qua nếu vừa sync vài phút trước" | `auto-scoring.md` mục 6 |
| Rủi ro đã biết | Diff cho judge bị cắt ở 80 KB, dễ chạm hơn ở chế độ `per-commit` vì patch nối nhau | `auto-scoring.md` mục 4 |
| Giới hạn đã biết | Lần push đầu chấm cả lịch sử; đổi bản Node phải `evolo init` lại; `core.hooksPath` dùng chung | `auto-scoring.md` mục 7 |

### Code

Code trong `packages/cli/`:

| File | Vai trò |
|---|---|
| `bin/evolo.mjs` | CLI: `init`, `uninstall`, `sync`, `status`, `worker`, `enqueue` (hook gọi), và `evaluate` (chấm tay `--range`, `--pr`, SHA đơn) |
| `src/hooks.mjs` | Cài và gỡ hook `pre-push`, nối tiếp hook cũ (`pre-push.evolo-chained`) |
| `src/repos.mjs` | `~/.evolo/repos.json`, `init`, `uninstall` |
| `src/queue.mjs` | Hàng đợi file, lock của worker (PID và heartbeat), khởi động worker tách rời |
| `src/worker.mjs` | Ghi push vào hàng đợi, xác nhận push tới remote, chấm, thử lại, sync PR đã merge, gửi thông báo, `retry` |
| `src/ledger.mjs` | Bản ghi kết quả từng đơn vị và trạng thái (`scored`, `superseded`, `reverted`...), `landedAt(record)` (ngày của một đơn vị), `summary.json` (XP theo ngày) |
| `src/stats.mjs` | Analytics: `periodOf` (tuần, tháng, quý theo lịch), `computeStats`, `streakOf`; hàm thuần trên bản ghi, cho `evolo stats` và các phần Game hoá sau |
| `src/achievements.mjs` | Achievement: `achievementsOf` (bậc, tiến độ, ngày mở bằng tìm kiếm nhị phân trên ledger xếp theo `landedAt`), `unlockedIn`, `notifyUnlocks` (`achievements.json`) |
| `src/achievements/` | `catalog.mjs` (achievement hiện và hàm đọc bản ghi dùng chung), `secret.mjs` và `secret.test.mjs` (achievement ẩn: đừng nêu tên hay điều kiện với người dùng), `fixtures.mjs` (bản ghi giả cho test) |
| `src/dashboard.mjs` | Dashboard: `dashboardModel` (một object chứa mọi thứ trang hiện), `writeDashboard`, `refreshDashboard` (chỉ ghi khi file đã có, lỗi chỉ vào log); `MODULES` và `STYLES` là thứ tự nối module và CSS |
| `dashboard/` | Template, CSS và module vẽ của trang, không có bước build (`src/dashboard.mjs` nối chúng thành một script):<br>`index.html` khung trang và CSP; `html.mjs` `escape`, `safeUrl`, định dạng; `charts.mjs` biểu đồ SVG;<br>`overview.mjs`, `timeline.mjs`, `unit.mjs`, `analytics.mjs`, `achievements.mjs`, `reviews.mjs` mỗi file một màn hình; `app.mjs` router hash, khung trang, bộ lọc, khởi động;<br>`style.css` và một file CSS cho mỗi màn hình; `fixtures.mjs` model mẫu cho test |
| `src/store.mjs` | Thư mục `~/.evolo` (hoặc `$EVOLO_HOME`), ghi JSON atomic (giữ quyền của file cũ), `evolo.log` |
| `src/views.mjs` | Nội dung thông báo, status line, `why`, `stats` và `achievements`; tìm đơn vị theo mã, `#PR` hoặc commit |
| `src/review.mjs` | `evolo review`: kiểm tra đầu ra (đường dẫn và số dòng), lưu và in review |
| `src/config.mjs` | `~/.evolo/config.json` và `evolo config`; chỉ nhận khoá đã biết (`review.language`, `budget.daily-usd`) |
| `src/signals.mjs` | Tín hiệu XP từ CI, review và issue; tính lại XP của bản ghi từ điểm rubric đã lưu |
| `src/budget.mjs` | Chi phí judge theo ngày (ledger và review) và trần `budget.daily-usd` |
| `src/sandbox.mjs` | Sandbox E2E dùng chung (repo tạm, remote bare, `gh` và `claude` giả) |
| `src/claude.mjs` | `evolo claude install` / `uninstall`: skill, hook `SessionStart`, status line trong `$CLAUDE_CONFIG_DIR/settings.json` |
| `claude/skills/evolo/SKILL.md` | Skill `/evolo`: chỉ người dùng gọi được, chỉ chạy `evolo status`, `why`, `retry` |
| `fakes/` | `gh`, `claude`, `notify-send`, `gdbus` và `xdg-open` giả cho test E2E |
| `src/units.mjs` | Biến dải push, commit đơn hoặc số PR thành unit `{kind, id, base, tip, excluded, selected?, pr?}`, và chọn commit được tính |
| `src/github.mjs` | Mọi lời gọi `gh`: đọc PR, PR đã merge chứa một commit, chọn remote trỏ đúng repo GitHub, CI và review của đơn vị, issue được đóng |
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
cd packages/cli && npm test                      # 304 test, đều pass (35 test E2E, khoảng 40 giây); CI chạy cùng lệnh
ln -s "$PWD/packages/cli/bin/evolo.mjs" ~/.local/bin/evolo   # cài một lần (đã làm trên máy này)
evolo init                                       # trong clone cần chấm; sau đó cứ push hoặc merge PR
evolo status                                     # hàng đợi và các lần chấm gần nhất
evolo evaluate --repo <clone> --out <dir> --own \
  [--range <from>..<to>]... [--pr <number>]... [<sha>...]
```

Các bảng kết quả dưới đo bằng công thức 1.1, trước khi XP được làm tròn tới bội số của 5.

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
- `evolo evaluate --range` đòi `from` là tổ tiên của `to`; sau force-push thì dải bị từ chối, vì diff ròng sẽ gồm cả việc gỡ lịch sử bị bỏ.
  Worker xử lý force-push khác: đơn vị bắt đầu từ `merge-base`, đơn vị cũ thành `superseded`.
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

### Hiển thị (2026-10-19, PR #5)

- Worker gửi `notify-send` cho `scored` (kèm `level N!` khi lên level), `needs_review` và `failed`; máy không có `notify-send` thì bỏ qua.
  Có `body-markup` thì in đậm tên đơn vị và thoát chữ của judge; không có thì gửi chữ thường (2026-10-20).
- `evolo why [<commit>|#<pr>|<unit id>]` in từng điểm rubric kèm lý do và bằng chứng, cảnh báo của validator, commit bị bỏ, và dòng công thức `XP = base × value × size × repo × signals = raw -> XP`.
  Commit thuộc nhiều đơn vị thì chọn đơn vị đã tính nó; merge commit trỏ về PR của nó.
- `evolo retry` xếp lại các đơn vị `failed` (cùng mã, nên kết quả mới thay bản ghi cũ) và cho job đang chờ chạy ngay; push đã bị force-push mất thì thành `push_failed` ngay.
- `summary.json` lưu XP theo ngày, ghi lại mỗi lần ledger đổi; `statusline` chỉ đọc nó (khoảng 50 ms, gần hết là khởi động Node); `status` tính lại từ ledger và ghi đè nó.
- Tổng XP giờ tính trên cả ledger, kể cả repo đã `uninstall` (trước đây chỉ repo đang đăng ký).
- `sync --background` không in gì (stdout của hook `SessionStart` vào context của agent), để lại yêu cầu sync rồi khởi động worker; worker đang ngủ chờ thử lại cũng thấy yêu cầu đó.
- `evolo claude install` chạy lại được, giữ status line có sẵn, sửa đúng file khi `settings.json` là symlink, giữ quyền 0600, và dừng nếu file không phải JSON hợp lệ.
  Thử trên bản sao `~/.claude/settings.json` thật: các thiết lập khác y nguyên, `uninstall` trả về đúng bản gốc.
- Agent review không thấy lỗi CRITICAL hay HIGH; đã sửa 5 lỗi MEDIUM (quyền của `settings.json`, xoá symlink skill của người khác, summary có thể chặn worker, `retry` hồi sinh job vừa xong, `sync --background` không tới được worker đang ngủ) và 2 lỗi LOW, mỗi lỗi có test.
  Các test mới đã được kiểm tra là bắt được lỗi khi đưa bản sửa ra.
- Chạy thật trên clone tạm của lightrag với `gh` và `claude` thật: `sync --background` chấm PR #5 được 160 XP ($0.12, 24 giây); `why #5`, `why 86e74d3` (merge commit), `status` và `statusline` đều đúng; một thông báo thật đã hiện trên desktop.
- Sửa thêm: `git worktree add --quiet`, để `evolo.log` không còn dòng "Preparing worktree".
- 2026-10-20: đã chạy `evolo claude install` trên máy thật (người dùng yêu cầu).
  `~/.claude/settings.json` chỉ thêm một nhóm `SessionStart` chạy `'/usr/bin/node' '.../packages/cli/bin/evolo.mjs' sync --background`; status line của Orca được giữ; skill là symlink `~/.claude/skills/evolo`.
  Chạy tay đúng lệnh của hook: thoát 0, không in gì.
  Gỡ bằng `evolo claude uninstall`.

### Tín hiệu XP và trần chi phí (2026-10-20, PR #7)

- Định nghĩa tín hiệu: `docs/xp-evaluation.md` mục 7.5; cách đọc và khi nào chốt: `docs/auto-scoring.md` mục 4 "Tín hiệu XP"; trần theo ngày: `docs/auto-scoring.md` mục 7.
- Hook `evaluateUnit({ beforeJudging })` chạy sau triage và trước khi gọi judge; worker dùng nó để kiểm tra trần, nên đơn vị triage bằng luật không bị chặn.
- Lỗi của judge sau khi đã chạy giờ mang `costUsd`, và `judgeWithRetries` cộng nó vào chi phí.
- Test: unit test cho `signals.mjs`, `budget.mjs`, khoá config mới; 3 test E2E (push nhận tín hiệu issue khi chấm và CI khi sync; PR có đủ ba tín hiệu; hết ngân sách thì chờ sang ngày, docs vẫn được chấm, một thông báo).
  Đã kiểm tra test bắt được lỗi khi gỡ từng phần chính (kiểm tra trần, điều kiện thoát của worker, ghi tín hiệu khi sync).
- Kiểm chứng với `gh` thật: truy vấn chạy đúng trên `hiinguyen/Evolo`, `cli/cli` và `golang/go` (chi tiết ở `docs/auto-scoring.md` mục 4); lúc đó Evolo chưa có CI nên chưa có điểm cộng CI; CI được thêm ngay sau (mục dưới).
- Bản ghi cũ (chấm trước thay đổi này) được đọc tín hiệu ở lần sync đầu; stars và `isOwnRepo` để tính lại XP lấy từ `repos.json`, giống lúc chấm.
- Agent review: không có CRITICAL; đã sửa 1 HIGH (nâng trần không giải phóng đơn vị đang chờ), 2 MEDIUM (tín hiệu không đọc được bị hỏi lại mãi; sync ghi từng bản ghi một) và 2 LOW (config sửa tay sai làm hỏng đơn vị; review `DISMISSED` được tính), mỗi lỗi có test.
- Rủi ro còn lại: chi phí của lần chạy mà judge không trả lời được (`judgeUnavailable`) không được ghi, nên trần có thể bị vượt thêm chút ít; thường là $0 vì API không trả lời.
  Hai tiến trình cùng ghi một bản ghi (sync và worker) vẫn có thể đè nhau, như `refreshLedger` trước đây.

### CI và bảo vệ `main` (2026-10-20, PR #8)

- `.github/workflows/test.yml` chạy `npm test` trong `packages/cli` trên Node 20, 22 và 24, khi push lên `main` và ở mọi PR.
  Dùng `actions/checkout@v7` và `actions/setup-node@v7`; bản v4 chạy trên runtime Node 20 mà GitHub đã ngừng hỗ trợ.
- Test không cần git identity toàn cục hay dependency nào; đã chạy thử với `HOME` trống và `env -i`, 124 test pass, và cả ba job trên GitHub đều chạy đủ 124 test.
- Ruleset `main` (id 25459177, người dùng tạo trên web, đang Active, bypass list trống, áp vào nhánh mặc định):
  cấm xoá, cấm force push, bắt buộc PR với 0 approve, bắt buộc check `test (20)`, `test (22)` và `test (24)` xanh, không bắt nhánh phải cập nhật với `main`.
  Chưa bật Copilot tự review.
- Hệ quả: không push thẳng lên `main` được nữa; mọi thay đổi đi qua nhánh và PR (quy trình ở `CLAUDE.md`).
  Evolo chấm repo này qua PR khi merge, không còn đơn vị push trên `main`.
- Có CI thì PR của repo này nhận được tín hiệu "CI pass ngay" (+5%).
  Đổi tên job hoặc danh sách Node trong workflow thì phải sửa danh sách check của ruleset theo.

### Analytics (2026-10-20, PR #9)

- Phần A trong bốn phần Game hoá; người dùng chọn thứ tự A analytics, B achievement, C dashboard, D performance review.
  Thiết kế: `docs/superpowers/specs/2026-10-20-evolo-stats-design.md`; người dùng đã chốt: có lệnh `evolo stats`, kỳ theo lịch, streak tính ngày làm việc, ngày của đơn vị là lúc tới nơi.
- `landedAt`: push là `enqueuedAt` của job (lúc hook chạy), PR là `mergedAt` (thêm vào trường `gh pr view` và `facts.pr`), `evolo retry` giữ mốc cũ.
  `landedAt(record)` bỏ qua giá trị không đọc được rồi lùi về `mergedAt`, ngày commit cuối, `at`; bản ghi cũ không cần migration.
  `summary.json` (XP hôm nay, status line) giờ tính theo ngày này; chi phí theo ngày (`budget.mjs`) vẫn theo `at`, vì đó là ngày tiền được tiêu.
- Thư mục gom theo thư mục cha của file, không theo 2 cấp đầu: trên Evolo 2 cấp đầu luôn là `packages/cli`.
- Mọi lệnh giờ in usage và thoát mã 2 khi gặp cờ lạ, thay vì in stack trace của `parseArgs`.
- Chạy thật trên `~/.evolo` (chỉ đọc): tuần này 535 XP, 5 đơn vị, rubric I2.4 C2.2 D2.4 Q3.6 S3.0, 4/4 đơn vị có code chạm test, 16 commit đều vào thứ Ba, đỉnh lúc 8 giờ; khớp khi đối chiếu tay với ledger; `status` vẫn 535 XP hôm nay.
- Test: 9 test `stats.test.mjs` (gồm DST ở Europe/Berlin), 3 test `formatStats`, 3 test `landedAt` và `summarize`, khẳng định `landedAt` trong E2E push, PR và retry, một E2E `evolo stats`.
  Đã kiểm tra test bắt được lỗi khi gỡ từng phần (lọc `method`, cuối tuần, `superseded`, `landedAt` trong worker, retry và `summarize`).
- Agent review: không có CRITICAL hay HIGH; đã sửa `landedAt` không đọc được và stack trace khi gõ sai cờ; giữ nguyên hai điểm (bản ghi `scored` thiếu `result` không xảy ra vì `scoredRecord` luôn ghi nó, lọc âm thầm sẽ làm `stats` lệch `status`; nhịp làm việc đếm commit của đơn vị trong kỳ là đúng thiết kế).

### Achievement (2026-10-20, PR #10)

- Phần B Game hoá; thiết kế: `docs/superpowers/specs/2026-10-20-evolo-achievements-design.md`, plan cùng ngày trong `docs/superpowers/plans/`.
  Người dùng đã chốt: achievement tính lại từ ledger và có thể mất khi đơn vị bị revert; nhiều bậc kèm tiến độ; hiện ở `evolo achievements`, thông báo desktop và `evolo stats`.
- Người dùng muốn có achievement ẩn và không muốn biết trước chúng là gì: đừng nêu tên, điều kiện hay gợi ý về chúng trong chat, docs, commit hay PR; chúng chỉ nằm trong `src/achievements/secret.mjs` và test của nó.
- Mỗi luật là `{ id, name, description, tiers, value(records) }` với `value` không giảm khi thêm bản ghi vào cuối danh sách xếp theo `landedAt`; nhờ đó ngày mở của mỗi bậc tìm được bằng tìm kiếm nhị phân, và test kiểm tra tính chất này cho mọi luật.
- Worker kiểm tra achievement sau mỗi bản ghi `scored`, gửi một thông báo gộp sau thông báo XP; `achievements.json` chỉ nhớ bậc đã báo, lỗi đọc file chỉ ghi log.
- Test E2E không giả định achievement ẩn nào mở, vì vài cái phụ thuộc giờ chạy test; chỉ Contributor I là chắc chắn.
- Chạy thật trên `~/.evolo` (chỉ đọc, 6 đơn vị): 9 trong 33 achievement hiện đã mở (Contributor I, Merge Master I, Builder I, Test Believer I, Hat Trick I, Explorer I, Polyglot II, Overdrive II, By the Book I), và hai achievement ẩn.
- Không có achievement cho `signals.cleanMerge`: tín hiệu này cần người khác approve PR, repo chỉ có một người.
- Test: 19 test `achievements.test.mjs`, 13 test `secret.test.mjs`, 3 test view, một E2E; đã kiểm tra test bắt được lỗi khi gỡ tìm kiếm nhị phân, lọc `method`, ghi `achievements.json`, giờ địa phương và lời gọi thông báo trong worker.
- Agent review: không có CRITICAL hay HIGH; đã sửa bản ghi thiếu `facts.files`, `achievements.json` sai dạng và một khẳng định E2E có thể đỏ khi test chạy qua mốc giờ.
  Giữ nguyên việc worker đọc lại ledger sau mỗi đơn vị `scored`: `writeRecords` vốn đã làm vậy để dựng `summary.json`, 5.000 bản ghi mất khoảng 90 ms, nhỏ so với một lần gọi judge.

### Dashboard (2026-10-21, PR #12)

- Phần C Game hoá; thiết kế: `docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md`, plan cùng ngày trong `docs/superpowers/plans/`.
- `evolo dashboard` luôn sinh lại `~/.evolo/dashboard.html` (0600), luôn in đường dẫn, rồi chạy `xdg-open` tách rời trừ khi có `--no-open`.
  Worker ghi lại trang sau job cuối của một loạt job (không ghi giữa hai job liền nhau) và mỗi lần sync, `evolo review` sau khi lưu; chỉ khi file đã có, lỗi chỉ vào `evolo.log`.
- Trang là một hàm của model: mọi chữ từ dữ liệu qua `escape`, link chỉ nhận `https://`, CSP băm SHA-256 đúng đoạn script (không `'unsafe-inline'` cho script, có `base-uri 'none'` và `form-action 'none'`), không có `connect-src`, achievement ẩn chưa mở không có tên hay mô tả trong model.
  Các module `dashboard/*.mjs` được nối thành một script vì Chrome không cho nạp module từ `file://`.
- Chạy thật trong Chrome DevTools trên bản sao dữ liệu thật: mọi màn hình ở chế độ sáng, tối, 360 px và 900 px; một review chứa `</script>` và `$&` vẫn vẽ đúng; console không có lỗi, không có request mạng; số khớp `evolo stats`, `status` và `achievements`.
  Từ đó sửa: thanh trên cùng cao tới 255 px ở 360 px, mục nav đang mở bị cắt, năm thẻ Overview xếp 3 + 2 có ô trống, dải "Unlocked this week" dài 16 huy hiệu (giờ tối đa 10 rồi "+N more"), đơn vị triage bằng luật đã bị revert vẫn hiện "+N XP" không gạch, và `facts: null` trong bản ghi.
- Đo trên 5.000 bản ghi giả (5 repo, một năm, 5-40 file mỗi bản ghi): `dashboardModel` khoảng 1,1-1,3 giây, `renderPage` 0,13-0,19 giây, trang 12,2 MiB; vì quá 1 giây nên worker chỉ ghi lại trang sau job cuối của một loạt job thay vì sau mỗi job.
- Khoảng hở đã biết: màn Analytics "previous" không có số thay đổi so với kỳ trước, vì model chỉ giữ hai kỳ cho mỗi loại (`evolo stats --previous` so với kỳ ngay trước đó).
- Test: `src/dashboard.test.mjs`, một test cho mỗi module trong `dashboard/`, `src/dashboard.e2e.test.mjs` (6 test); tổng 304 test của `npm test`, đều pass.
- Agent review từng task và review cuối cả nhánh: không có CRITICAL; đã sửa CSP còn `'unsafe-inline'` cho script (giờ dùng hash SHA-256), file tạm bị bỏ lại khi ghi lỗi, chi phí ghi lại trang sau mỗi job, `role="tab"` trên link không có phím mũi tên, và bản ghi thiếu `facts` làm hỏng cả trang.
  Để sau: bộ lọc Type trộn `push`/`pr` với loại việc, số trong công thức có dấu phân cách hàng nghìn khác `evolo why`, Timeline chưa phân trang.

### Git

- Repo: `github.com/hiinguyen/Evolo`.
- `main` có judge, chấm change set và PR (PR #1 và PR #2), lọc commit của push, chọn đúng remote cho PR, chỉ chấm PR vào nhánh mặc định (PR #3).
- Hook, hàng đợi, worker, sync, ledger, `status`, XP bội số của 5 và level `20 × L²` (PR #4).
- Thông báo, `why`, `retry`, status line và tích hợp Claude Code (PR #5, merge 2026-10-20).
- `evolo review` (PR #6), tín hiệu XP và trần chi phí theo ngày (PR #7, merge 2026-10-20), CI chạy test trên mỗi PR và ruleset bảo vệ `main` (PR #8, merge 2026-10-20).
- `evolo stats`, `landedAt` và lộ trình Game hoá; `CLAUDE.md` với quy tắc cho agent (PR #9, merge 2026-10-20).
- `evolo achievements` và achievement ẩn (PR #10).
- `status`, `why` và `review` hiện giờ địa phương thay vì UTC (PR #11).
- `evolo dashboard` (PR #12).

## 4. Việc tiếp theo

Theo `docs/auto-scoring.md` mục 10 và `docs/architecture.md` mục 11:

1. **Dùng thật vài ngày:** Evolo đã được `evolo init` (2026-10-20, mốc `since` 00:30 UTC, tác giả `devnnhai@gmail.com`); theo dõi `~/.evolo/evolo.log` và `evolo status`.
   PR #5 merge trước mốc `since` nên không được chấm.
   Đã chạy thật (2026-10-20): hook chấm hai lần push lên `main` (75 và 95 XP), sync chấm PR #6 (175), #7 (170) và #8 (20, có tín hiệu "CI pass ngay" +5%; file YAML là config nên không tính dòng); level 5, 535 XP, chi phí judge $0.62.
   `main` của Evolo giờ cấm push thẳng, nên đơn vị push chỉ còn đến từ các repo khác.
   Các repo cá nhân khác (friday, map-tour, Tunnel_Security) chưa được đăng ký.
2. **Hiển thị:** xong, PR #5 đã merge (2026-10-20); `evolo claude install` đã chạy trên máy thật.
   Người dùng đã quyết định không làm `backfill` (2026-10-20); còn `preview`.
3. **Review code:** `evolo review` xong, PR #6 đã merge (2026-10-20).
   Việc có thể làm tiếp: số dòng của vấn đề đôi khi vẫn là vị trí trong diff (validator đưa về mức file); judge chưa lần theo nơi gọi bằng `git grep` (`docs/review.md` mục 9).
4. **Game hoá:** A analytics xong (`evolo stats`, PR #9); B achievement xong (`evolo achievements`, PR #10); C dashboard xong (`evolo dashboard`, PR #12); tiếp theo D performance review (`evolo report`).
   Mỗi phần: brainstorm, spec trong `docs/superpowers/specs/`, plan, PR riêng.
5. Sau đó: hiệu chỉnh bằng golden set (giai đoạn 3).

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
- Clone thử nghiệm của Friday và lightrag, và các file kết quả JSON, nằm trong scratchpad của session cũ, có thể đã mất.
  Clone lại bằng `git clone https://github.com/hiinguyen/Friday` hoặc `https://github.com/hiinguyen/lightrag`.
- Lệnh `evolo` là symlink `~/.local/bin/evolo`; thư mục global của npm là `/usr` (cần sudo), nên không dùng `npm link`.
- `~/.evolo` có một repo đăng ký là `hiinguyen/Evolo` (2026-10-20); hook `pre-push` nằm ở `.git/hooks/pre-push`.
- `evolo claude install` đã chạy (2026-10-20); bản sao lưu `settings.json` trước khi cài nằm trong scratchpad của session cũ, có thể đã mất, nhưng `uninstall` trả về đúng như cũ.

## 8. Cách làm việc với người dùng

- Trả lời bằng tiếng Việt.
- Không dùng dấu gạch dài (em dash), dùng `-`.
- Trong file Markdown dài, mỗi câu một dòng.
- Chỉ commit, push, mở PR hoặc merge khi được yêu cầu; mọi thay đổi đi qua nhánh và PR vì `main` được bảo vệ.
- Ưu tiên chất lượng, đơn giản, bền vững hơn chi phí phát triển; sửa lỗi thì tái hiện lỗi end-to-end trước.

## 9. Câu hỏi còn mở

- Có chấm repo của công ty không? Nếu có cần tuỳ chọn tắt gửi code theo từng remote.
- Có cần `/evolo preview` (chấm thử commit chưa push) ngay ở giai đoạn 1 không?
- Thông báo desktop có làm phiền không? Hiện chưa có cách tắt.
- `backfill` (đã quyết định không làm, 2026-10-20; giữ lại để biết lý do): Evolo chỉ chấm push đi qua hook và PR merge sau mốc `evolo init` (`repo.since`), nên lịch sử trước đó không có XP.
  GitHub không giữ lịch sử push (Events API chỉ 90 ngày và 300 sự kiện, với lightrag đã trống).
  PR cũ thì dễ (`gh pr list` từ mốc N ngày).
  Push cũ có ba cách: (A) reflog của `refs/remotes/<remote>/<branch>`, đúng từng lần push từ clone này, các lần push từ máy khác gộp theo mỗi lần fetch, chỉ trong thời hạn của reflog; (B) gộp commit của mình trên nhánh mặc định theo ngày; (C) A khi có reflog, B khi không.
  Đề xuất A, vì đơn vị khớp với cách hook chấm; cần chốt trước khi làm, vì chấm bù tốn tiền judge cho mỗi đơn vị.
  Nên có bước xem trước: in danh sách đơn vị và ước tính chi phí rồi mới chấm.
- Có cần giới hạn tần suất sync của hook `SessionStart` (ví dụ bỏ qua nếu lần sync gần nhất cách đây dưới vài phút) không?
- Lần push đầu của nhánh mặc định đang chấm cả lịch sử thành một đơn vị: có muốn bỏ qua lần đó không?
