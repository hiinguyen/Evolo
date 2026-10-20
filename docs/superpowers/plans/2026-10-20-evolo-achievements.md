# evolo achievements: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achievement nhiều bậc, tính tất định từ ledger, có achievement ẩn; lệnh `evolo achievements`, thông báo desktop khi mở bậc mới, dòng `unlocked` trong `evolo stats`.

**Architecture:** Mỗi luật là một khai báo `{ id, name, description, tiers, value(records), hidden? }` với `value` không giảm khi thêm bản ghi.
`src/achievements.mjs` tính bậc, tiến độ và ngày mở (tìm kiếm nhị phân trên đoạn đầu của ledger xếp theo `landedAt`).
`<home>/achievements.json` chỉ nhớ bậc đã thông báo.

**Tech Stack:** Node.js ESM, `node --test`, không thêm phụ thuộc.

**Spec:** `docs/superpowers/specs/2026-10-20-evolo-achievements-design.md`

## Global Constraints

- Không thêm phụ thuộc npm; không có bước build; chạy được trên Node 20.
- Không dùng em dash trong code, comment hay docs; Markdown dài mỗi câu một dòng.
- Dữ liệu không sửa tại chỗ: hàm trả bản mới.
- Giờ và ngày là giờ địa phương; ngày của một đơn vị là `landedAt(record)`.
- Luật dùng điểm rubric chỉ đọc đơn vị `result.method === "ai"`.
- Tên, điều kiện và test của achievement ẩn chỉ nằm trong `src/achievements/secret.mjs` và `src/achievements/secret.test.mjs`; docs, commit và PR không nêu chúng.
- Mọi test (`npm test` trong `packages/cli`) pass sau mỗi task.

---

### Task 1: Lõi và danh sách hiện

**Files:**
- Create: `packages/cli/src/achievements/catalog.mjs`, `packages/cli/src/achievements.mjs`, `packages/cli/src/achievements.test.mjs`

**Interfaces:**
- Consumes: `landedAt`, `localDay` (`ledger.mjs`), `readJson`, `writeJson` (`store.mjs`), `streakOf` (`stats.mjs`), `COUNTED_CLASSES` (`facts.mjs`).
- Produces:
  - `catalog.mjs`: `VISIBLE` (mảng luật, đúng thứ tự bảng trong spec mục 3) và các hàm dùng chung `scored(records)`, `judged(records)`, `countedChange(record) => { added, deleted }`, `commitDates(record) => Date[]`, `languageOf(path) => string | null`.
  - `achievements.mjs`: `ACHIEVEMENTS`, `achievementsOf(records) => [{ id, name, description, hidden, tiers, value, tier, unlocked: [{ tier, at }] }]`, `unlockedIn(achievements, period) => [{ id, name, description, tier, at }]`, `tierName(tier)` (số La Mã), `notifyUnlocks(home, achievements) => [{ id, name, description, tier }]`.

- [ ] Test (đặt `process.env.TZ = "Asia/Ho_Chi_Minh"` ở đầu file):
  - mỗi luật hiện: ledger giả chạm đúng ngưỡng bậc I thì `tier` là 1, thiếu một thì 0; đơn vị `method: "rule"` không vào luật rubric; `test-believer` không đứt bởi đơn vị chỉ có docs; `core-contributor` lấy repo cao nhất; `polyglot` bỏ đuôi lạ; `night-owl` theo giờ địa phương của commit.
  - ngày mở là `landedAt` của đơn vị chạm ngưỡng, khi bản ghi đưa vào không theo thứ tự.
  - đơn vị chuyển sang `reverted` làm mất bậc.
  - `id` không trùng; `tiers` tăng ngặt; với một ledger giả trộn, `value` của mọi luật (cả ẩn) không giảm qua từng đoạn đầu.
  - `unlockedIn` chỉ lấy bậc có `at` trong kỳ.
  - `notifyUnlocks` lần đầu trả mọi bậc đạt, lần hai trả rỗng, bậc mới sau đó được trả.
- [ ] Chạy, fail; viết `catalog.mjs` và `achievements.mjs` (`secret.mjs` lúc này là mảng rỗng); pass.
- [ ] Tạm thay tìm kiếm nhị phân bằng "ngày của bản ghi cuối", tạm bỏ lọc `method`, tạm bỏ ghi file: thấy test fail, trả lại.

### Task 2: Achievement ẩn

**Files:**
- Create: `packages/cli/src/achievements/secret.mjs`, `packages/cli/src/achievements/secret.test.mjs`

**Interfaces:**
- Consumes: các hàm dùng chung của `catalog.mjs`.
- Produces: `SECRET` (mảng luật `hidden: true`, `tiers: [1]`).

- [ ] Test mỗi luật ẩn: mở khi đủ điều kiện, không mở khi thiếu một chút.
- [ ] Chạy, fail; viết luật; pass; test không giảm của Task 1 cũng phủ chúng.

### Task 3: Hiển thị, thông báo và lệnh

**Files:**
- Modify: `packages/cli/src/views.mjs` (`formatAchievements`, `achievementNotification`, tham số `unlocks` của `formatStats`), `packages/cli/src/views.test.mjs`
- Modify: `packages/cli/src/worker.mjs` (`finish` gọi `notifyUnlocks` sau bản ghi `scored` rồi gửi thông báo)
- Modify: `packages/cli/bin/evolo.mjs` (lệnh `achievements`, dòng `unlocked` trong `stats`, chú thích đầu file, `USAGE`)
- Modify: `packages/cli/claude/skills/evolo/SKILL.md`
- Test: `packages/cli/src/worker.test.mjs` (E2E)

**Interfaces:**
- Produces: `formatAchievements(achievements): string[]`; `achievementNotification(unlocks, { markup }) => { title, body } | null`; `formatStats(current, previous, streak, unlocks = [])`.

- [ ] Test `views.test.mjs`: dòng đầu đếm đã mở, bí mật đã tìm, bí mật còn ẩn; bậc La Mã, `-`, `value/ngưỡng`, `(max)`; ẩn còn khoá không lộ tên; thông báo một bậc và nhiều bậc, có markup thì escape; `formatStats` có dòng `unlocked` khi có bậc, không có thì không.
- [ ] Test E2E: push đầu được chấm thì log thông báo có `achievement unlocked: Contributor I` sau thông báo XP; push thứ hai không báo lại; `evolo achievements` in `Contributor` bậc `I`; `evolo stats` in dòng `unlocked`. Sửa các test E2E hiện có đếm số thông báo.
- [ ] Chạy, fail; viết code; `npm test` pass.

### Task 4: Chạy thật, review và tài liệu

- [ ] Chạy `evolo achievements` và `evolo stats` trên `~/.evolo` thật (chỉ đọc); so với ledger bằng tay.
- [ ] Agent review code; sửa lỗi CRITICAL, HIGH, MEDIUM, mỗi lỗi có test.
- [ ] Cập nhật `docs/architecture.md` (mục 2, 6, 10, 11), `docs/auto-scoring.md` (thông báo, lệnh), `docs/handoff.md` (Đã làm, Chưa làm, bảng file, số test, mục kết quả, Việc tiếp theo).
