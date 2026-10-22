# Evolo: thiết kế tổng thể và lộ trình

Tài liệu này nối các phần đã có thành một sản phẩm hoàn chỉnh và sắp thứ tự xây dựng.
Chi tiết của từng phần nằm ở:

- `docs/xp-evaluation.md`: chấm một đóng góp (rubric, judge, công thức XP). **Đã xây**; có bảng phần nào của thiết kế gốc đã làm, làm khác hoặc chưa làm.
- `docs/auto-scoring.md`: tự chấm sau mỗi lần push và mỗi PR được merge (git hook, hàng đợi, worker, ledger). **Đã xây**, kể cả phần hiển thị (thông báo, `why`, `retry`, skill `/evolo`, status line); còn `backfill` và `preview`.
- `docs/handoff.md`: trạng thái hiện tại và việc tiếp theo, để mở session mới.

## 1. Phạm vi

Evolo hiện là công cụ **cá nhân**: một người dùng, chạy trên máy của chính họ, theo dõi đóng góp của chính họ.
Vì vậy thiết kế cố ý **không có**:

- Chống gian lận: người dùng tự chấm cho mình, không có ai để gian lận với.
- Server, tài khoản, đồng bộ nhiều máy.
- Leaderboard và hồ sơ công khai.

Những phần này để dành cho khi Evolo được dùng chung (mục 11).
Thiết kế hiện tại không chặn đường làm chúng sau này, vì mọi điểm đều lưu kèm dữ liệu gốc và phiên bản công thức.

## 2. Sản phẩm gồm những gì

| Tính năng | Câu hỏi nó trả lời | Dựa trên | Trạng thái |
|---|---|---|---|
| XP | Đóng góp này đáng giá bao nhiêu? | Judge + công thức | Đã xây, tự chấm sau push và PR |
| Level | Tôi đã tích luỹ được bao nhiêu? | Tổng XP trong ledger | Đã có công thức và `evolo status` |
| Achievement | Tôi đã làm được những cột mốc nào? | Luật tất định trên ledger | Đã xây, `evolo achievements` và thông báo khi mở |
| Analytics | Cách tôi làm việc thay đổi thế nào? | Thống kê trên điểm rubric và facts | Đã xây, `evolo stats` |
| Review code | Push hay PR này có vấn đề gì, nên cải thiện gì? | Judge riêng, gọi tay bằng `evolo review` | Đã xây (`docs/review.md`) |
| Performance review | Tuần, tháng hay quý này tôi đã làm được gì? | LLM viết từ ledger, có trích dẫn | Chưa làm |
| Dashboard | Xem tất cả ở một chỗ | Trang HTML sinh từ ledger | **Đã xây** (`evolo dashboard`) |

Nguyên tắc xuyên suốt: **AI chỉ đánh giá, code mới tính toán.**
AI chỉ làm ba việc: chấm rubric cho một đóng góp, review code cho một đóng góp khi được gọi, và viết lời cho bản performance review.
Mọi con số (XP, level, achievement, thống kê) đều được tính tất định từ dữ liệu đã lưu, nên có thể tính lại khi đổi công thức mà không gọi AI.

## 3. Đơn vị chấm: push và PR

XP được chấm theo **đơn vị đóng góp**, không theo từng commit:

| Đơn vị | Khi nào được chấm | Nội dung được chấm |
|---|---|---|
| **Push** | Sau khi push lên nhánh mặc định thành công | Các commit của mình trong lần push đó, gộp thành một change set |
| **PR** | Khi PR của mình được merge | Toàn bộ thay đổi của PR, kèm tiêu đề và mô tả PR |

Lý do không chấm từng commit:

- **Commit là bản nháp.** Nó có thể bị amend, rebase, squash hay bỏ đi; chỉ thứ đã push hoặc đã merge mới là đóng góp thật.
- **Điểm không phụ thuộc cách chia commit.** Đo bằng chính `computeXp` (công thức 1.1): một feature 2.000 dòng trong một commit được 186 XP, nhưng chia thành 20 commit 100 dòng thì tổng được 1.480-1.980 XP.
  Không cần chống gian lận, nhưng điểm vẫn phải phản ánh công việc chứ không phản ánh thói quen commit.
- **Judge thấy được cả bức tranh.** Một feature thường gồm nhiều commit; chấm riêng từng cái thì commit "thêm test" bị tách khỏi commit "thêm code" mà nó kiểm tra.
- **Rẻ hơn.** Một lần gọi judge cho cả lần push thay vì một lần cho mỗi commit.

Đánh đổi: không có điểm ngay sau mỗi commit, phải đợi push hoặc merge.
Xem trước bằng `/evolo preview` (chấm thử các commit chưa push, không ghi vào ledger) chưa làm; tạm thời dùng `evolo evaluate`.

Quy tắc ghép đơn vị (đã xây):

- Push lên nhánh khác nhánh mặc định không được chấm, vì công việc đó sẽ được chấm khi PR merge.
- Commit đã thuộc một PR đã merge không được tính lại trong một lần push, ví dụ khi merge PR ở local rồi push nhánh mặc định.
- Merge commit không được tính như một thay đổi riêng.
- Chỉ tính commit có author email khớp với email đã đăng ký.

Chi tiết cơ chế (hook `pre-push`, xác nhận push thành công, phát hiện PR merge bằng `gh`) nằm trong `docs/auto-scoring.md`.

## 4. Kiến trúc

```
                                    MÁY NGƯỜI DÙNG
┌──────────────────────────────────────────────────────────────────────────────────┐
│  git push ─► hook pre-push ─► queue ─┐                                           │
│                                      ├─► worker ─► @evolo/core ─► ~/.evolo/ledger│
│  PR merge (phát hiện qua gh) ────────┘          facts · triage · judge · score   │
│                                                                                  │
│  đọc ledger: /evolo skill · status line · thông báo · dashboard HTML · review    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Lõi `@evolo/core` gồm `units.mjs`, `facts.mjs`, `score.mjs`, `judges/` và `evaluate.mjs`; phần tự chấm gồm `hooks.mjs`, `repos.mjs`, `queue.mjs`, `worker.mjs`, `ledger.mjs` và `store.mjs`, đều nằm trong `packages/cli/src/`.
Chưa tách thành package riêng vì hiện chỉ có một nơi dùng nó.
Phần đọc ledger đã có `evolo status`, `stats` (analytics, mục 7), `why`, `review` (review code từng đơn vị, `docs/review.md`), skill `/evolo`, status line và thông báo; `evolo dashboard` (một trang HTML tĩnh, mục 9) cũng chỉ đọc ledger và review; performance review chưa làm.

## 5. Level

Level tính từ tổng XP của các đơn vị đang `scored` trong ledger.
XP không bị trừ theo thời gian, nhưng tổng có thể giảm khi một đơn vị bị revert hoặc bị force-push thay thế, vì đơn vị đó về 0 XP.

Tổng XP cần để đạt level `L` là `20 × L²` (hạ từ `50 × L²` ngày 2026-10-19 vì lên level quá chậm).

| Level | Tổng XP |
|---|---|
| 1 | 20 |
| 5 | 500 |
| 10 | 2.000 |
| 20 | 8.000 |
| 40 | 32.000 |

Đường cong bậc hai cho cảm giác tiến bộ nhanh lúc đầu và chậm dần, nhưng không chạm trần.
Với khoảng 100-300 XP mỗi ngày làm việc (đo trên Friday và lightrag), level 10 đến sau khoảng 1-2 tuần làm đều.
Hằng số 20 sẽ được chỉnh lại ở giai đoạn 3, khi có vài tuần XP thật.
Hàm `levelFor(xp)` nằm trong `score.mjs`, cùng chỗ với công thức XP, và có `LEVEL_FORMULA_VERSION` riêng; `evolo status` hiện level, tổng XP và số XP còn thiếu để lên level kế tiếp.
Tổng XP chỉ cộng các đơn vị đang `scored`.

## 6. Achievement (đã xây)

Achievement là luật tất định trên ledger, viết dạng khai báo, không dùng AI.
Mỗi luật là một hàm thuần trên ledger, trả một giá trị không bao giờ giảm khi thêm bản ghi, kèm các ngưỡng cho từng bậc và id cố định.
Vì là hàm thuần, toàn bộ achievement được tính lại từ đầu mỗi lần; bậc chỉ dựa vào một đơn vị đã bị revert thì mất.
`~/.evolo/achievements.json` chỉ nhớ những bậc đã thông báo.
Có 33 achievement hiện nhiều bậc và một nhóm achievement ẩn, không hiện tên hay điều kiện cho tới khi mở.
Thiết kế và danh sách đầy đủ của achievement hiện: `docs/superpowers/specs/2026-10-20-evolo-achievements-design.md`.

Nhóm đề xuất ban đầu, đã có trong bản đầu (Streak tính theo ngày làm việc, như `evolo stats`):

| Nhóm | Ví dụ | Điều kiện |
|---|---|---|
| Cột mốc | First Blood, Centurion | Đóng góp đầu tiên; 100 đóng góp |
| Chất lượng | Test Believer | 10 đóng góp liên tiếp có `quality ≥ 3` và chạm vào test |
| Loại việc | Bug Hunter, Architect | 10 bugfix có `impact ≥ 3`; 5 refactor có `centrality ≥ 3` |
| Tác động | Core Contributor | 5 đóng góp có `impact = 4` và `centrality = 4` trong một repo |
| Đều đặn | Streak 7 / 30 | Có đóng góp trong 7 hoặc 30 ngày liên tiếp (theo múi giờ người dùng) |
| Phạm vi | Polyglot, Explorer | Đóng góp vào code ở 3 ngôn ngữ; vào 5 repo khác nhau |

Achievement dựa trên điểm rubric chứ không dựa trên số commit hay số dòng, để chúng thưởng cho chất lượng công việc.

## 7. Analytics (đã xây)

Mọi chỉ số đều tính từ facts và điểm rubric đã lưu, theo cửa sổ thời gian (tuần, tháng, quý):

- **Cơ cấu công việc:** tỉ lệ feature, bugfix, refactor, test, docs.
- **Xu hướng chất lượng:** trung bình từng tiêu chí rubric theo thời gian, đặc biệt là `quality` và `scope_fit`.
- **Kỷ luật test:** tỉ lệ đóng góp chạm vào test, trên các repo có bộ test.
- **Độ ổn định:** tỉ lệ đóng góp bị revert.
- **Tập trung:** số repo, số module và phân bố XP giữa chúng.
- **Nhịp làm việc:** đóng góp theo giờ trong ngày và ngày trong tuần.

Không có chỉ số "số dòng code mỗi ngày".
Đó là chỉ số dễ đo nhất nhưng ít ý nghĩa nhất, và Evolo được xây chính để thay thế nó.

Đã xây trong `src/stats.mjs` và lệnh `evolo stats [week|month|quarter] [--previous]`, theo `docs/superpowers/specs/2026-10-20-evolo-stats-design.md`.
Kỳ theo lịch (tuần từ thứ Hai), giờ địa phương; một đơn vị thuộc ngày nó tới nơi (`landedAt`), không phải ngày được chấm.
Trung bình rubric bỏ đơn vị triage bằng luật; tập trung tính theo thư mục cha của file; streak đếm ngày làm việc, cuối tuần không làm đứt chuỗi.
Achievement, dashboard và performance review dùng lại các hàm này.

## 8. Performance review (chưa làm)

Bản review được sinh theo yêu cầu qua `/evolo report [tuần|tháng|quý]`.
`evolo review` là lệnh khác: review code cho một push hoặc PR (`docs/review.md`).

Quy trình gồm hai bước, giữ đúng nguyên tắc ở mục 2:

1. **Code tính:** các con số của kỳ (XP, level, cơ cấu, xu hướng, achievement mới) và danh sách đóng góp nổi bật, chọn theo `impact` rồi đến XP.
2. **AI viết:** nhận đúng dữ liệu bước 1 cùng `summary` và `reason` của từng đóng góp, rồi viết các phần: điểm mạnh, việc nổi bật, điều nên cải thiện.

Ràng buộc cho bước 2:

- Mọi nhận định phải trích một đơn vị (SHA của lần push hoặc số PR) có trong dữ liệu đầu vào.
  Validator kiểm tra mọi trích dẫn, và chặn những câu trích tới thứ không tồn tại.
- AI không được tự đưa ra con số.
  Con số trong bản review lấy từ bước 1 và được chèn vào bằng template.

## 9. Dashboard (đã xây)

`evolo dashboard` sinh `~/.evolo/dashboard.html`, một trang HTML tĩnh từ ledger, rồi mở trong trình duyệt.
Trang chi tiết một đóng góp hiện cả review code đã lưu trong `~/.evolo/reviews/` (cùng mã đơn vị với ledger), nếu có.
Không cần server, không cần đăng nhập, dữ liệu không rời khỏi máy; CSP của trang không cho gọi mạng.

Sáu màn hình: Overview (level, XP, streak, achievement mới trong tuần, đơn vị gần nhất), Timeline (có bộ lọc), chi tiết một đơn vị (điểm rubric, lý do, bằng chứng, công thức, review, file, commit), Analytics, Achievements, Reviews.
Worker ghi lại trang sau mỗi job và mỗi lần sync, và `evolo review` sau khi lưu, nhưng chỉ khi file đã có.
Thiết kế và các quyết định: `docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md`.

## 10. Mô hình dữ liệu

Local lưu mỗi bản ghi một file JSON trong `~/.evolo/`, ghi theo kiểu atomic.

Đã xây:

```
repos.json                          repo đã đăng ký: path, gitDir, remote, url, defaultBranch, authors[], isOwnRepo, stars, since
queue/<job-id>.json                 job đang chờ: push {remote, ref, from, to, pusher} hoặc pr {number}, attempts, lastError, notBefore
ledger/<owner>/<name>/<unit-id>.json   một đơn vị: id, kind, status, xp, summary, at (lúc chấm), landedAt (lúc push hoặc merge), result (facts, evaluation, judge, breakdown), signals
achievements.json                   bậc achievement đã thông báo {notified: ["bug-hunter:2"]}; không phải dữ liệu gốc
dashboard.html                      trang của `evolo dashboard` (0600), sinh lại từ ledger; không phải dữ liệu gốc
worker.lock, evolo.log              lock của worker và log của hook, worker
```

Một bản ghi ledger gộp `contribution`, `evaluation` và `xp_entry` của thiết kế dưới.
`result.evaluation` và `result.facts` đủ để tính lại XP bằng công thức mới mà không gọi AI, nhưng chưa có lệnh làm việc đó.

Thiết kế ban đầu, để tách ra khi cần tính lại hoặc lưu nhiều phiên bản công thức:

```
contribution   id, repo, kind (push | pr), shas[], pr_number?, author, landed_at, status
evaluation     contribution_id, judge {backend, model}, rubric_version, scores, type, summary, flags, cost_usd
xp_entry       contribution_id, formula_version, xp, breakdown
achievement    achievement_id, unlocked_at, contribution_ids[]   (bản đã xây tính lại từ ledger, không lưu)
review         period, stats (code tính), narrative (AI viết), citations[]
```

`evaluation` và `xp_entry` tách riêng: đổi công thức chỉ cần sinh thêm `xp_entry` mới với `formula_version` mới, giữ nguyên `evaluation`.
Level, achievement và analytics luôn được tính lại từ `xp_entry` mới nhất của mỗi đóng góp.

## 11. Lộ trình

Mỗi giai đoạn chỉ xong khi đạt điều kiện nghiệm thu, đo bằng test chứ không bằng cảm giác.

| Giai đoạn | Nội dung | Điều kiện nghiệm thu |
|---|---|---|
| **0. Chấm điểm** | Rubric, judge Claude, công thức XP | **Xong** (PR #1) |
| **1. Tự chấm** | Chấm theo change set nhiều commit và theo PR (**xong**, PR #2, #3); `evolo init`, hook `pre-push`, hàng đợi, worker, phát hiện PR merge, ledger, `status` (**xong**, PR #4); thông báo, `why`, `retry`, skill `/evolo`, status line, hook `SessionStart` (**xong**, PR #5); còn lại: `backfill`, `preview` (chi tiết trong `docs/auto-scoring.md` mục 6) | Test E2E trên repo tạm có remote giả: push thành công, push bị từ chối, force-push, merge PR, revert, mất mạng, push dồn dập; ledger đúng trạng thái; không để lại worktree hay tiến trình mồ côi (**đạt** cho phần đã xây) |
| **2. Game hoá** | Level (**công thức xong**, `20 × L²`), analytics (**xong**, `evolo stats`), achievement (**xong**, `evolo achievements`), dashboard HTML (**xong**, `evolo dashboard`), `/evolo report` (tiếp theo); làm theo thứ tự này, mỗi phần một spec và một PR | Tính lại toàn bộ từ ledger cho kết quả giống hệt; review không có trích dẫn nào sai |
| **3. Hiệu chỉnh** | Golden set khoảng 30 đóng góp, gồm repo lớn; chạy mỗi đóng góp 3 lần; chỉnh trần điểm, hằng số level | Độ lệch giữa các lần chạy dưới ngưỡng đặt ra; xếp hạng khớp golden set |
| **Sau này** | Khi dùng chung với người khác: server, GitHub App, judge trên server, chống gian lận, leaderboard | Chỉ thiết kế khi có nhu cầu thật |

Giai đoạn 3 đứng sau giai đoạn 1 và 2 vì nó cần dữ liệu thật từ vài tuần dùng hằng ngày.

## 12. Quyết định kỹ thuật

- **Ngôn ngữ:** JavaScript ESM, không có bước build.
  Chỉ chuyển sang TypeScript nếu sau này có nhiều package dùng chung schema.
- **Không phụ thuộc thêm:** chỉ dùng Node.js chuẩn, `git`, `claude` và `gh` (để đọc PR).
- **Chi phí:** khoảng $0.03-0.31 mỗi lần chấm với Sonnet (đo trên Friday và lightrag), tuỳ kích thước đơn vị; trần $1 mỗi lần.
  Chấm theo push và PR nên số lần gọi judge ít hơn số commit.
  Chi phí đi vào gói Claude của chính người dùng.

## 13. Câu hỏi mở

- Có chấm repo của công ty không?
  Nếu có, cần tuỳ chọn tắt gửi code lên Claude theo từng remote.
- Có cần `/evolo preview` (chấm thử commit chưa push) ngay ở giai đoạn 1 không, hay để sau?
