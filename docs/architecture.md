# Evolo: thiết kế tổng thể và lộ trình

Tài liệu này nối các phần đã có thành một sản phẩm hoàn chỉnh và sắp thứ tự xây dựng.
Chi tiết của từng phần nằm ở:

- `docs/xp-evaluation.md`: chấm một đóng góp (rubric, judge, công thức XP). **Đã xong.**
- `docs/auto-scoring.md`: tự chấm sau mỗi lần push và mỗi PR được merge (git hook, hàng đợi, ledger, skill `/evolo`). **Đã thiết kế, chưa xây.**
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

| Tính năng | Câu hỏi nó trả lời | Dựa trên |
|---|---|---|
| XP | Đóng góp này đáng giá bao nhiêu? | Judge + công thức (đã xong) |
| Level | Tôi đã tích luỹ được bao nhiêu? | Tổng XP trong ledger |
| Achievement | Tôi đã làm được những cột mốc nào? | Luật tất định trên ledger |
| Analytics | Cách tôi làm việc thay đổi thế nào? | Thống kê trên điểm rubric và facts |
| Performance review | Tuần, tháng hay quý này tôi đã làm được gì? | LLM viết từ ledger, có trích dẫn |
| Dashboard | Xem tất cả ở một chỗ | Trang HTML sinh từ ledger |

Nguyên tắc xuyên suốt: **AI chỉ đánh giá, code mới tính toán.**
AI chỉ làm hai việc: chấm rubric cho một đóng góp và viết lời cho bản review.
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
Nếu cần xem trước, `/evolo preview` chấm thử các commit chưa push mà không ghi vào ledger.

Quy tắc ghép đơn vị:

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

Lõi `@evolo/core` chính là phần đã xong: `facts.mjs`, `score.mjs`, `judges/` và `evaluate.mjs`, hiện nằm trong `packages/cli/src/`.
Chưa tách thành package riêng vì hiện chỉ có một nơi dùng nó.

## 5. Level

Level tính từ tổng XP trong ledger, không bao giờ giảm, và XP không bị trừ theo thời gian.

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

## 6. Achievement

Achievement là luật tất định trên ledger, viết dạng khai báo, không dùng AI.
Mỗi luật là một hàm thuần `(ledger) → danh sách mở khoá`, có id cố định để không bao giờ mở khoá hai lần.
Vì là hàm thuần, toàn bộ achievement có thể tính lại từ đầu bất cứ lúc nào.

Nhóm đề xuất cho bản đầu:

| Nhóm | Ví dụ | Điều kiện |
|---|---|---|
| Cột mốc | First Blood, Centurion | Đóng góp đầu tiên; 100 đóng góp |
| Chất lượng | Test Believer | 10 đóng góp liên tiếp có `quality ≥ 3` và chạm vào test |
| Loại việc | Bug Hunter, Architect | 10 bugfix có `impact ≥ 3`; 5 refactor có `centrality ≥ 3` |
| Tác động | Core Contributor | 5 đóng góp có `impact = 4` và `centrality = 4` trong một repo |
| Đều đặn | Streak 7 / 30 | Có đóng góp trong 7 hoặc 30 ngày liên tiếp (theo múi giờ người dùng) |
| Phạm vi | Polyglot, Explorer | Đóng góp vào code ở 3 ngôn ngữ; vào 5 repo khác nhau |

Achievement dựa trên điểm rubric chứ không dựa trên số commit hay số dòng, để chúng thưởng cho chất lượng công việc.

## 7. Analytics

Mọi chỉ số đều tính từ facts và điểm rubric đã lưu, theo cửa sổ thời gian (tuần, tháng, quý):

- **Cơ cấu công việc:** tỉ lệ feature, bugfix, refactor, test, docs.
- **Xu hướng chất lượng:** trung bình từng tiêu chí rubric theo thời gian, đặc biệt là `quality` và `scope_fit`.
- **Kỷ luật test:** tỉ lệ đóng góp chạm vào test, trên các repo có bộ test.
- **Độ ổn định:** tỉ lệ đóng góp bị revert.
- **Tập trung:** số repo, số module và phân bố XP giữa chúng.
- **Nhịp làm việc:** đóng góp theo giờ trong ngày và ngày trong tuần.

Không có chỉ số "số dòng code mỗi ngày".
Đó là chỉ số dễ đo nhất nhưng ít ý nghĩa nhất, và Evolo được xây chính để thay thế nó.

## 8. Performance review

Bản review được sinh theo yêu cầu qua `/evolo review [tuần|tháng|quý]`.

Quy trình gồm hai bước, giữ đúng nguyên tắc ở mục 2:

1. **Code tính:** các con số của kỳ (XP, level, cơ cấu, xu hướng, achievement mới) và danh sách đóng góp nổi bật, chọn theo `impact` rồi đến XP.
2. **AI viết:** nhận đúng dữ liệu bước 1 cùng `summary` và `reason` của từng đóng góp, rồi viết các phần: điểm mạnh, việc nổi bật, điều nên cải thiện.

Ràng buộc cho bước 2:

- Mọi nhận định phải trích một đơn vị (SHA của lần push hoặc số PR) có trong dữ liệu đầu vào.
  Validator kiểm tra mọi trích dẫn, và chặn những câu trích tới thứ không tồn tại.
- AI không được tự đưa ra con số.
  Con số trong bản review lấy từ bước 1 và được chèn vào bằng template.

## 9. Dashboard

`evolo dashboard` sinh một trang HTML tĩnh từ ledger rồi mở trong trình duyệt.
Không cần server, không cần đăng nhập, dữ liệu không rời khỏi máy.

Các màn hình: tổng quan (level, XP, streak, achievement mới), dòng thời gian đóng góp, chi tiết một đóng góp (điểm rubric, lý do, bằng chứng, breakdown công thức), analytics, review.

## 10. Mô hình dữ liệu

Local lưu mỗi bản ghi một file JSON trong `~/.evolo/`, ghi theo kiểu atomic.

```
contribution   id, repo, kind (push | pr), shas[], pr_number?, author, landed_at, status
evaluation     contribution_id, judge {backend, model}, rubric_version, scores, type, summary, flags, cost_usd
xp_entry       contribution_id, formula_version, xp, breakdown
achievement    achievement_id, unlocked_at, contribution_ids[]
review         period, stats (code tính), narrative (AI viết), citations[]
```

`evaluation` và `xp_entry` tách riêng: đổi công thức chỉ cần sinh thêm `xp_entry` mới với `formula_version` mới, giữ nguyên `evaluation`.
Level, achievement và analytics luôn được tính lại từ `xp_entry` mới nhất của mỗi đóng góp.

## 11. Lộ trình

Mỗi giai đoạn chỉ xong khi đạt điều kiện nghiệm thu, đo bằng test chứ không bằng cảm giác.

| Giai đoạn | Nội dung | Điều kiện nghiệm thu |
|---|---|---|
| **0. Chấm điểm** | Rubric, judge Claude, công thức XP | **Xong** (nhánh `feat/claude-judge`) |
| **1. Tự chấm** | Chấm theo change set nhiều commit và theo PR (**xong**); `evolo init`, hook `pre-push`, hàng đợi, worker, phát hiện PR merge, ledger, `status` (**xong**, 2026-10-19); thông báo, `why`, skill `/evolo` (chi tiết trong `docs/auto-scoring.md`) | Test E2E trên repo tạm có remote giả: push thành công, push bị từ chối, force-push, merge PR, revert, mất mạng, push dồn dập; ledger đúng trạng thái; không để lại worktree hay tiến trình mồ côi |
| **2. Game hoá** | Level, achievement, analytics, `/evolo review`, dashboard HTML | Tính lại toàn bộ từ ledger cho kết quả giống hệt; review không có trích dẫn nào sai |
| **3. Hiệu chỉnh** | Golden set khoảng 30 đóng góp, gồm repo lớn; chạy mỗi đóng góp 3 lần; chỉnh trần điểm, hằng số level | Độ lệch giữa các lần chạy dưới ngưỡng đặt ra; xếp hạng khớp golden set |
| **Sau này** | Khi dùng chung với người khác: server, GitHub App, judge trên server, chống gian lận, leaderboard | Chỉ thiết kế khi có nhu cầu thật |

Giai đoạn 3 đứng sau giai đoạn 1 và 2 vì nó cần dữ liệu thật từ vài tuần dùng hằng ngày.

## 12. Quyết định kỹ thuật

- **Ngôn ngữ:** JavaScript ESM, không có bước build.
  Chỉ chuyển sang TypeScript nếu sau này có nhiều package dùng chung schema.
- **Không phụ thuộc thêm:** chỉ dùng Node.js chuẩn, `git`, `claude` và `gh` (để đọc PR).
- **Chi phí:** trung bình khoảng $0.06 mỗi lần chấm với Sonnet, đo trên Friday.
  Chấm theo push và PR nên số lần gọi judge ít hơn số commit.
  Chi phí đi vào gói Claude của chính người dùng.

## 13. Câu hỏi mở

- Có chấm repo của công ty không?
  Nếu có, cần tuỳ chọn tắt gửi code lên Claude theo từng remote.
- Có cần `/evolo preview` (chấm thử commit chưa push) ngay ở giai đoạn 1 không, hay để sau?
