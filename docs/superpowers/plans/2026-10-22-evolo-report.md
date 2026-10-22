# `evolo report` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `evolo report [week|month|quarter] [--previous] [--again]` viết, lưu và in một bản tự nhìn lại của một kỳ, với mọi nhận định trích một đơn vị có thật, và dashboard có màn Reports.

**Architecture:** Code tính đầu vào (`reportInput`) và số liệu; một task judge mới (`REPORT_TASK`) chạy không có checkout, chỉ đọc `period.json`; `validateReport` kiểm trích dẫn và cấm chữ số; bản lưu ở `~/.evolo/reports/<kind>/<start>.json` có `basis` để biết khi nào bị cũ.

**Tech Stack:** Node.js ESM, `node:test`, không dependency; `claude -p` hoặc opencode.

**Spec:** `docs/superpowers/specs/2026-10-22-evolo-report-design.md`

## Global Constraints

- Chạy được trên Node 20; không thêm dependency npm.
- Mọi lời gọi `gh` ở `src/github.mjs` (report không gọi `gh`).
- Test cạnh file nguồn, `node:test` và `node:assert/strict`; E2E dùng `src/sandbox.mjs`, chỉ `claude` và các bản giả trong `fakes/`.
- Dữ liệu không sửa tại chỗ; hàm nhỏ; comment giải thích vì sao.
- Tài liệu tiếng Việt, mỗi câu một dòng, không dùng em dash.

---

### Task 1: Lớp judge chạy được task không có checkout

**Files:**
- Modify: `packages/cli/src/judges/common.mjs` (spec có `commands`; thêm `REPORT_TASK`)
- Modify: `packages/cli/src/judges/claude.mjs` (`workDir`, tool theo `spec.commands`)
- Modify: `packages/cli/src/judges/opencode.mjs` (`workDir`, bash theo `spec.commands`)
- Modify: `packages/cli/src/evaluate.mjs` (`judgeWithRetries({ judge, spec, validate, workDir, inputs, task, onProgress })`, `validate(output)`)
- Modify: `packages/cli/src/review.mjs` (tính `knownPathsFor` trong closure)
- Create: `packages/cli/judge/xp-report.md`, `packages/cli/judge/report.schema.json`
- Test: `packages/cli/src/judges/judges.test.mjs`

**Interfaces:**
- Produces: `REPORT_TASK = { name: "xp-report", promptPath, schemaPath, commands: [] }`; `judge.judge({ workDir, inputs, task, spec, onProgress })`; `judgeWithRetries({ judge, spec, validate, workDir, inputs, task, onProgress })` với `validate(output) -> { ok: false, problems } | { ok: true, ... }`.

- [ ] Test: `claudeArgs({ ..., spec: REPORT_TASK })` có `--tools Read` và settings không cho lệnh nào; `SCORE_TASK` vẫn `Read,Grep,Glob,Bash` với allowlist chỉ-đọc.
- [ ] Test: `agentFrontmatter(REPORT_TASK)` có `"*": deny` dưới `bash` và không có dòng `allow` nào cho bash.
- [ ] Test: schema report khớp các trường `validateReport` đòi (Task 2), prompt report có luật tin cậy và luật không viết số.
- [ ] Chạy, thấy đỏ; sửa code; chạy toàn bộ `npm test`, xanh (đổi tên tham số không được làm đỏ test cũ).
- [ ] Commit `refactor: let a judge task declare its commands and run without a checkout`.

### Task 2: `src/report.mjs`: đầu vào, basis, validator, lưu, in

**Files:**
- Create: `packages/cli/src/report.mjs`, `packages/cli/src/report.test.mjs`
- Modify: `packages/cli/src/views.mjs` (`formatStats` nhận `streak` null)
- Modify: `packages/cli/src/config.mjs` (`report.language`)
- Modify: `packages/cli/src/budget.mjs` (cộng `listAllReports`)

**Interfaces:**
- `reportInput(records, reviews, period, now) -> { period, numbers, unlocked, highlights, units, reverted, omitted }`
- `basisOf(records, reviews, period) -> string` (hex SHA-256)
- `validateReport(raw, input) -> { ok: false, problems } | { ok: true, report, issues }`
- `readReport(home, period)`, `saveReport(home, stored)`, `listAllReports(home)`
- `writeReport({ judge, input, language, onProgress }) -> { ok: true, report, issues, judge, costUsd, durationMs } | { ok: false, failures, unavailable, costUsd }`
- `storedReport({ input, records, reviews, written, language, at }) -> stored` (mục 6 của spec)
- `formatReport(stored, { stale }) -> string`

- [ ] Test `reportInput`: thứ tự (impact, XP, landedAt; rule sau), cắt 60 và `omitted`, `highlights` tối đa 5 và không có rule, review gắn đúng đơn vị, `reverted`, `inProgress`.
- [ ] Test `basisOf`: đổi khi status, XP hoặc review của đơn vị trong kỳ đổi; không đổi với bản ghi ngoài kỳ; không phụ thuộc thứ tự.
- [ ] Test `validateReport`: thiếu trường; highlights sai tập hoặc sai thứ tự; trích dẫn lạ bị bỏ với issue; mục không trích bị bỏ; trích lặp được gộp; chữ số ngoài backtick (ASCII và chữ số Ả Rập) không hợp lệ; trong backtick hợp lệ; cờ lạ bị bỏ.
- [ ] Test `formatReport`: số liệu từ snapshot, không dòng streak, nhãn trích dẫn, dòng stale, dòng in progress, dòng failed, cảnh báo injection, `none` khi rỗng.
- [ ] Test config `report.language` và `spentOn` cộng report.
- [ ] Chạy đỏ; viết code; chạy xanh; tạm gỡ kiểm trích dẫn, luật chữ số và `basis` để thấy test đỏ.
- [ ] Commit `feat: compute, check and format a period's performance review`.

### Task 3: Lệnh `evolo report` và E2E

**Files:**
- Modify: `packages/cli/bin/evolo.mjs`, `packages/cli/fakes/claude.mjs`, `packages/cli/src/sandbox.mjs`
- Create: `packages/cli/src/report.e2e.test.mjs`

- [ ] Fake claude: với schema có `"highlights"`, đọc `period.json` từ task, trả highlights đúng, một strength trích đơn vị đầu; công tắc `.badcite` (thêm mục trích `nobody/none/pr-0`) và `.digits` (overview có số).
- [ ] E2E: viết rồi in lại không gọi judge; `--again`; `report.language vi` vào task; kỳ trống không gọi judge, thoát 0; push mới làm bản cũ hiện dòng stale; `.badcite` bị bỏ và hiện trong `validator:`; `.digits` thất bại 3 lần, thoát 1, không có file; `status` cộng chi phí report; dashboard có report sau khi viết.
- [ ] Commit `feat: add evolo report`.

### Task 4: Màn Reports trên dashboard

**Files:**
- Modify: `packages/cli/src/dashboard.mjs` (model `reports`, `MODULES`, `STYLES`)
- Create: `packages/cli/dashboard/reports.mjs`, `packages/cli/dashboard/reports.css`, `packages/cli/dashboard/reports.test.mjs`
- Modify: `packages/cli/dashboard/app.mjs` (route, nav, title), `packages/cli/dashboard/fixtures.mjs`

- [ ] Test: danh sách mới nhất trước, nhãn stale và in progress, màn trống, chi tiết có ô số và thay đổi, highlight và trích dẫn là link `#/unit/...`, đơn vị không còn là chữ thường, escape, `parseHash("#/reports/week/2026-10-19")`, id lạ là màn không tìm thấy.
- [ ] Chạy đỏ, viết, xanh; xem trong Chrome sáng, tối, 360 px, 900 px.
- [ ] Commit `feat: show saved reports on the dashboard`.

### Task 5: Review, chạy thật, tài liệu

- [ ] Agent review cả nhánh; sửa CRITICAL, HIGH, MEDIUM.
- [ ] Chạy thật với `claude` thật trên bản sao `~/.evolo` (`EVOLO_HOME` riêng).
- [ ] Cập nhật `docs/handoff.md`, `docs/architecture.md` mục 8, 10, 11, `docs/auto-scoring.md` nếu chạm; commit `docs: ...`.
- [ ] Push, mở PR, chờ CI.
