# Achievement (`evolo achievements`): thiết kế

Phần B trong bốn phần Game hoá (`docs/architecture.md` mục 6), sau A analytics (`evolo stats`, PR #9).
Achievement dùng lại `landedAt` của `ledger.mjs` và `streakOf` của `stats.mjs`.

## 1. Mục tiêu

- Thưởng cho cột mốc, chất lượng, loại việc, sự đều đặn và vài thói quen đáng cười, bằng luật tất định trên ledger, không gọi AI.
- Mỗi achievement có nhiều bậc và tiến độ tới bậc kế tiếp, để luôn có mục tiêu gần.
- Có achievement ẩn: không hiện tên, điều kiện hay tiến độ cho tới khi mở.
- Báo lần mở đầu tiên bằng thông báo desktop; `evolo stats` liệt kê các bậc mở trong kỳ.

Không làm: điểm thưởng XP cho achievement, achievement do người dùng tự viết, đồng bộ lên server.

## 2. Tính lại, có thể mất

Achievement là hàm thuần trên ledger hiện tại, giống level và stats.
Một đơn vị bị revert hoặc bị force-push thay thế thì các bậc dựa vào nó có thể mất, và mở lại khi đủ điều kiện.

`<home>/achievements.json` chỉ nhớ những bậc đã thông báo: `{ "notified": ["bug-hunter:2", ...] }`.
Nó không phải dữ liệu gốc: xoá file này thì lần chấm sau báo lại mọi bậc đang đạt, ngoài ra không đổi gì.

## 3. Luật

Mỗi luật là một khai báo:

```js
{ id, name, description, tiers: [3, 10, 30], value(records), hidden? }
```

- `records` là mọi bản ghi ledger (mọi trạng thái), xếp theo `landedAt`; phần lớn luật chỉ đọc bản ghi `scored`.
- `value` trả một số không âm, và không bao giờ giảm khi thêm bản ghi vào cuối danh sách.
  Mọi luật là số đếm, tổng, giá trị lớn nhất, chuỗi dài nhất hoặc số thứ khác nhau, nên điều này luôn đúng.
- Bậc `k` (đánh số từ 1) đạt khi `value >= tiers[k - 1]`; tên bậc là số La Mã (`Bug Hunter II`).
- Luật dùng điểm rubric chỉ đọc đơn vị `method: "ai"`, vì triage bằng luật gán điểm cố định.
- `id` không bao giờ đổi, vì `achievements.json` lưu theo nó.

### Ngày mở

Ngày mở của bậc `k` là `landedAt` của bản ghi đầu tiên mà, khi tính `value` trên các bản ghi tới nó, chạm `tiers[k - 1]`.
Vì `value` không giảm, ngày này tìm bằng tìm kiếm nhị phân trên độ dài đoạn đầu của danh sách.

### Danh sách hiện

| id | Tên | Đo gì | Bậc |
|---|---|---|---|
| `contributor` | Contributor | đơn vị `scored` | 1 / 10 / 50 / 100 / 500 |
| `merge-master` | Merge Master | PR `scored` | 1 / 10 / 50 |
| `hoarder` | Hoarder | tổng XP của đơn vị `scored` | 1.000 / 5.000 / 20.000 / 50.000 |
| `jackpot` | Jackpot | đơn vị đáng từ 200 XP | 1 / 5 / 20 |
| `overdrive` | Overdrive | XP của ngày nhiều XP nhất (ngày tới nơi, giờ địa phương) | 300 / 600 / 1.000 / 2.000 |
| `builder` | Builder | `feature` có `impact ≥ 3` | 3 / 10 / 30 |
| `bug-hunter` | Bug Hunter | `bugfix` có `impact ≥ 3` | 3 / 10 / 30 |
| `architect` | Architect | `refactor` có `centrality ≥ 3` | 3 / 10 / 30 |
| `guardian` | Guardian | `security` có `impact ≥ 3` | 1 / 5 / 15 |
| `speed-demon` | Speed Demon | `performance` có `impact ≥ 3` | 1 / 5 / 15 |
| `scribe` | Scribe | `docs` có `impact ≥ 2` | 3 / 10 / 30 |
| `test-pilot` | Test Pilot | `test` có `quality ≥ 3` | 3 / 10 / 30 |
| `plumber` | Plumber | `infra` có `impact ≥ 2` | 3 / 10 / 30 |
| `exterminator` | Exterminator | đơn vị đóng một issue bug (`signals.closesBugIssue`) | 1 / 5 / 20 |
| `craftsman` | Craftsman | đơn vị có `quality = 4` | 5 / 20 / 50 |
| `perfectionist` | Perfectionist | đơn vị có cả năm tiêu chí bằng 4 | 1 / 3 / 10 |
| `hard-mode` | Hard Mode | đơn vị có `difficulty = 4` | 1 / 5 / 20 |
| `on-target` | On Target | đơn vị có `scope_fit = 4` | 5 / 20 / 50 |
| `tiny-but-mighty` | Tiny but Mighty | đơn vị có 1-10 dòng được tính và `impact ≥ 3` | 1 / 5 / 15 |
| `janitor` | Janitor | đơn vị xoá nhiều hơn thêm ít nhất 20 dòng được tính | 3 / 10 / 30 |
| `test-believer` | Test Believer | chuỗi dài nhất các đơn vị có code trong repo có test mà chạm test và có `quality ≥ 3`; đơn vị không có code hoặc ở repo không có test không làm đứt chuỗi | 3 / 10 / 25 |
| `green-light` | Green Light | PR có CI xanh ngay lần đầu (`signals.ciFirstPass`) | 3 / 10 / 30 |
| `core-contributor` | Core Contributor | số đơn vị có `impact = 4` và `centrality = 4` trong một repo, lấy repo cao nhất | 1 / 5 / 15 |
| `streak` | Streak | `longest` của `streakOf` (ngày làm việc) | 5 / 10 / 30 / 60 |
| `hat-trick` | Hat Trick | ngày (giờ địa phương) có từ 3 đơn vị `scored` trở lên | 1 / 5 / 20 |
| `full-week` | Full Week | tuần lịch có đơn vị vào cả năm ngày thứ Hai tới thứ Sáu | 1 / 4 / 12 |
| `night-owl` | Night Owl | đơn vị có commit từ 00:00 tới 04:59 giờ địa phương | 3 / 10 / 30 |
| `early-bird` | Early Bird | đơn vị có commit từ 05:00 tới 06:59 giờ địa phương | 3 / 10 / 30 |
| `weekend-warrior` | Weekend Warrior | đơn vị tới nơi vào thứ Bảy hoặc Chủ nhật | 3 / 10 / 30 |
| `explorer` | Explorer | repo khác nhau có đơn vị `scored` | 2 / 5 / 10 |
| `polyglot` | Polyglot | ngôn ngữ khác nhau của file `source`, theo bảng đuôi file; đuôi lạ không tính | 2 / 3 / 5 |
| `by-the-book` | By the Book | commit có tiêu đề theo Conventional Commits (`feat(cli)!: ...`) | 10 / 50 / 200 |
| `co-pilot` | Co-pilot | đơn vị có commit mang trailer `Co-authored-by:` | 1 / 10 / 50 |

Không có achievement cho `signals.cleanMerge`: tín hiệu này cần người khác approve PR, mà Evolo chỉ có một người dùng.

"Dòng được tính" là thêm cộng xoá của file `source` và `test` (`COUNTED_CLASSES`), như `countedLines` của facts.

### Achievement ẩn

Achievement ẩn có `hidden: true` và một bậc duy nhất (`tiers: [1]`).
Chúng nằm riêng trong `src/achievements/secret.mjs` và test của chúng trong `src/achievements/secret.test.mjs`, để đọc spec, plan hay danh sách hiện không lộ chúng.
Tài liệu, commit và PR không nêu tên hay điều kiện của chúng.
Luật ẩn được đọc mọi trạng thái bản ghi, kể cả `reverted` và `superseded`.

## 4. Module

- `src/achievements/catalog.mjs`: danh sách hiện và các hàm nhỏ dùng chung cho luật (đơn vị `scored`, đơn vị judge chấm, dòng được tính, giờ của commit, ngôn ngữ của file).
- `src/achievements/secret.mjs`: danh sách ẩn, dùng hàm của `catalog.mjs`.
- `src/achievements.mjs`:
  - `ACHIEVEMENTS`: hai danh sách nối lại; test kiểm tra `id` không trùng và mọi luật có bậc tăng dần.
  - `achievementsOf(records)`: mỗi luật một `{ id, name, description, hidden, tiers, value, tier, unlocked: [{ tier, at }] }`, `tier` là số bậc đã đạt (0 là chưa đạt).
  - `unlockedIn(achievements, period)`: các bậc có `at` trong kỳ, theo thứ tự ngày.
  - `notifyUnlocks(home, achievements)`: trả các bậc đang đạt chưa thông báo và ghi chúng vào `achievements.json`.

## 5. Thông báo

Sau khi worker ghi một bản ghi `scored` (`finish` trong `worker.mjs`), nó tính `achievementsOf` trên toàn ledger và gọi `notifyUnlocks`.
Có bậc mới thì gửi một thông báo riêng, sau thông báo XP:

- một bậc: tiêu đề `achievement unlocked: Bug Hunter II`, thân là mô tả;
- nhiều bậc: tiêu đề `3 achievements unlocked`, thân là mỗi bậc một dòng.

Tên và mô tả là chữ trong code, nhưng vẫn đi qua `terminalSafe` và `escapeMarkup` như mọi thông báo.
Lần chạy đầu sau khi cập nhật báo gộp mọi bậc ledger đã đạt.
Gửi thông báo thất bại thì vẫn ghi `achievements.json`, vì thông báo chỉ là best effort.
Achievement chỉ được kiểm tra sau một bản ghi `scored`; bậc của một luật ẩn mở nhờ bản ghi khác sẽ được báo ở lần chấm kế tiếp.

## 6. Hiển thị

`evolo achievements` in mọi achievement hiện theo thứ tự danh sách, rồi các achievement ẩn đã mở, rồi số achievement ẩn còn khoá:

```
9 of 33 unlocked · 3 secrets found, 25 still hidden
Contributor       II   12/50     scored units
Bug Hunter        -    1/3       bugfixes with impact ≥ 3
Explorer          II   2/5       repositories
Polyglot          III  5 (max)   languages
...
Secret Name       ★              what it was for
??? × 25
```

- Cột bậc là số La Mã, `-` khi chưa đạt; tiến độ là `value/ngưỡng kế`, hoặc `value (max)` ở bậc cuối.
- Achievement ẩn còn khoá không lộ tên, mô tả hay tiến độ.
- `evolo stats` thêm dòng `unlocked  Bug Hunter II · Explorer I` khi kỳ đó có bậc mở; không có thì không in dòng.
- Skill `/evolo` thêm `achievements`.

## 7. Test

- `achievements.test.mjs`: mỗi luật hiện trên ledger giả (đơn vị triage bị bỏ khỏi luật rubric, giờ địa phương với `TZ` cố định); bậc và tiến độ; ngày mở bằng `landedAt` của đơn vị chạm ngưỡng, kể cả khi bản ghi không theo thứ tự; bậc mất khi đơn vị bị revert; `id` không trùng và bậc tăng dần; mọi luật không giảm khi thêm bản ghi (kiểm tra trên một ledger giả trộn); `unlockedIn`; `notifyUnlocks` chỉ trả bậc mới và nhớ chúng.
- `achievements/secret.test.mjs`: mỗi luật ẩn mở đúng lúc và không mở khi chưa đủ.
- `views.test.mjs`: `formatAchievements`, `achievementNotification` một và nhiều bậc, dòng `unlocked` trong `formatStats`.
- E2E (`worker.test.mjs`): push đầu tiên được chấm gửi thông báo `achievement unlocked: Contributor I`, push thứ hai không gửi lại; `evolo achievements` chạy thật trên sandbox.
- Tạm gỡ phần code chính (tìm kiếm nhị phân, lọc `method`, ghi `achievements.json`) để chắc test bắt được lỗi.
