# evolo stats: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lệnh `evolo stats [week|month|quarter] [--previous]` in analytics của một kỳ theo lịch, so với kỳ trước, kèm streak ngày làm việc; mọi số liệu tính tất định từ ledger.

**Architecture:** Bản ghi ledger có thêm `landedAt` (push: `enqueuedAt` của job, PR: `mergedAt`), và `landedAt(record)` trong `ledger.mjs` là nguồn duy nhất cho ngày của một đơn vị, kể cả `summary.json`.
`src/stats.mjs` là hàm thuần: `periodOf`, `computeStats`, `streakOf`.
`views.mjs` thêm `formatStats`; `bin/evolo.mjs` thêm lệnh `stats`.

**Tech Stack:** Node.js ESM, `node --test`, không thêm phụ thuộc.

**Spec:** `docs/superpowers/specs/2026-10-20-evolo-stats-design.md`

## Global Constraints

- Không thêm phụ thuộc npm; không có bước build; chạy được trên Node 20.
- Không dùng em dash trong code, comment hay docs; Markdown dài mỗi câu một dòng.
- Dữ liệu không sửa tại chỗ: hàm trả bản mới.
- Ngày và giờ là giờ địa phương của máy; tuần bắt đầu thứ Hai.
- Chỉ đơn vị `scored` vào số liệu, trừ độ ổn định (`reverted / (scored + reverted)`).
- Trung bình rubric chỉ dùng đơn vị `result.method === "ai"`.
- Chữ lấy từ ledger (repo, đường dẫn) đi qua `terminalSafe` trước khi in.
- Mọi test (`npm test` trong `packages/cli`) pass sau mỗi task.

---

### Task 1: Ngày của một đơn vị (`landedAt`)

**Files:**
- Modify: `packages/cli/src/github.mjs` (`PR_FIELDS` thêm `mergedAt`)
- Modify: `packages/cli/src/units.mjs` (`pullRequestUnit` giữ `mergedAt` trong `pr`)
- Modify: `packages/cli/src/ledger.mjs` (`landedAt`, `scoredRecord(result, { landedAt })`, `summarize`)
- Modify: `packages/cli/src/worker.mjs` (`scoreUnit` truyền `landedAt`; `retryJob` mang `landedAt` của bản ghi cũ)
- Test: `packages/cli/src/ledger.test.mjs`, `packages/cli/src/worker.test.mjs`

**Interfaces:**
- Produces:
  - `landedAt(record): string` (ISO): `record.landedAt ?? record.result?.facts?.pr?.mergedAt ?? <date của commit cuối trong facts.commits> ?? record.at`.
  - `scoredRecord(result, { landedAt } = {})`: bản ghi có thêm `landedAt` (null khi không truyền).
  - Job có thể mang `landedAt`; worker dùng `result.facts.pr?.mergedAt ?? job.landedAt ?? job.enqueuedAt`.

- [ ] Test `ledger.test.mjs`: `landedAt` theo đúng thứ tự dự phòng (bốn trường hợp); `summarize` đặt XP vào ngày của `landedAt`, không phải `at`.
- [ ] Test E2E `worker.test.mjs`: trong test push thành công, `landedAt` của bản ghi nằm giữa thời điểm ngay trước và ngay sau `git push`; trong test PR merge, `landedAt` bằng `mergedAt` của PR giả.
- [ ] Chạy, thấy fail.
- [ ] Viết code; `npm test` pass.
- [ ] Tạm bỏ `landedAt` khỏi `summarize` và khỏi `scoreUnit`, thấy test fail, trả lại.

### Task 2: `src/stats.mjs`

**Files:**
- Create: `packages/cli/src/stats.mjs`, `packages/cli/src/stats.test.mjs`

**Interfaces:**
- Consumes: `landedAt`, `localDay` (`ledger.mjs`); `CRITERIA`, `levelFor` (`score.mjs`); `COUNTED_CLASSES` (`facts.mjs`).
- Produces:
  - `PERIODS = ["week", "month", "quarter"]`.
  - `periodOf(kind, now = new Date(), back = 0) => { kind, start: Date, end: Date, label: string }`; nhãn `week 2026-10-19..2026-10-25`, `2026-10`, `2026 Q4`.
  - `computeStats(records, period) => { period, units, xp, costUsd, level, types: [{ type, units, xp }], rubric: { n, averages: { <criterion>: number } }, tests: { touched, eligible }, reverts: { reverted, total }, repos: [{ repo, units, xp }], dirs: [{ repo, dir, lines }], hours: number[24], weekdays: number[7] }`; danh sách sắp giảm dần (XP, rồi số dòng); `level` là `levelFor(XP scored có landedAt < end).level`.
  - `streakOf(records, now = new Date()) => { current, longest }`.

- [ ] Test (đặt `process.env.TZ = "Asia/Ho_Chi_Minh"` ở đầu file, trước mọi `Date`):
  - `periodOf`: thứ Tư 2026-10-21 cho tuần 2026-10-19..2026-10-25; Chủ nhật vẫn thuộc tuần bắt đầu thứ Hai trước đó; `back = 1` của tháng 1/2027 là `2026-12`; quý trước của 2027 Q1 là `2026 Q4`; 23:30 giờ địa phương ngày cuối kỳ vẫn thuộc kỳ.
  - `computeStats`: chỉ đơn vị trong kỳ; `failed`, `needs_review`, `superseded` không vào tổng; cơ cấu theo loại; trung bình rubric bỏ đơn vị `method: "rule"`; tỉ lệ test bỏ đơn vị không có dòng code hoặc repo không có test; độ ổn định đếm `reverted` mà không đếm `superseded`; thư mục cha (file gốc repo là `.`, chỉ `source` và `test`); giờ và thứ theo ngày commit giờ địa phương; level ở cuối kỳ; bản ghi không có `landedAt` dùng ngày commit cuối.
  - `streakOf`: chuỗi thứ Năm, thứ Sáu, thứ Hai (cuối tuần trống) là 3; có thêm thứ Bảy là 4; thứ Ba trống làm đứt; hôm nay chưa có đóng góp thì vẫn đếm tới hôm qua; `longest` giữ chuỗi cũ dài hơn; ledger rỗng là `{ current: 0, longest: 0 }`.
- [ ] Chạy, fail; viết `stats.mjs`; pass.
- [ ] Tạm gỡ từng phần (lọc `method`, bỏ qua cuối tuần, lọc `superseded`), thấy test fail, trả lại.

### Task 3: Lệnh `evolo stats`

**Files:**
- Modify: `packages/cli/src/views.mjs` (`formatStats`), `packages/cli/src/views.test.mjs`
- Modify: `packages/cli/bin/evolo.mjs` (lệnh `stats`, chú thích đầu file, `USAGE`)
- Modify: `packages/cli/claude/skills/evolo/SKILL.md` (`allowed-tools` và mục `stats`)
- Test: `packages/cli/src/worker.test.mjs` (E2E)

**Interfaces:**
- Consumes: `PERIODS`, `periodOf`, `computeStats`, `streakOf`.
- Produces: `formatStats(current, previous, streak): string[]`.

- [ ] Test `views.test.mjs`: có kỳ trước thì in `(+N)` sau XP, số đơn vị, từng tiêu chí và tỉ lệ test; kỳ trước không có dữ liệu thì không in chênh lệch; kỳ rỗng in nhãn, streak và `no contributions`; tên repo có ký tự điều khiển bị làm sạch; sparkline 24 ký tự.
- [ ] Test E2E: sau push được chấm trong sandbox, `evolo stats` in nhãn tuần này, XP của đơn vị và `streak 1` (đơn vị tới nơi hôm nay, và ngày cuối tuần có đóng góp cũng được cộng); `evolo stats year` thoát mã 2 với usage.
- [ ] Chạy, fail; viết `formatStats`, lệnh và skill; `npm test` pass.

### Task 4: Chạy thật, review và tài liệu

- [ ] Chạy `evolo stats`, `evolo stats month`, `evolo stats --previous` trên `~/.evolo` thật (chỉ đọc); so con số với ledger bằng tay.
- [ ] Agent review code; sửa lỗi CRITICAL, HIGH, MEDIUM, mỗi lỗi có test.
- [ ] Cập nhật `docs/architecture.md` (mục 2, 7, 10, 11), `docs/auto-scoring.md` (XP theo ngày dùng `landedAt`), `docs/handoff.md` (Đã làm, Chưa làm, bảng file, số test, mục kết quả, Việc tiếp theo), `CLAUDE.md` nếu quy tắc đổi.
