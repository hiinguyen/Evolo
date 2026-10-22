# evolo dashboard: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lệnh `evolo dashboard` sinh `~/.evolo/dashboard.html`, một trang tĩnh có Overview, Timeline, chi tiết đơn vị dạng tab, Analytics, Achievements và Reviews; worker và `evolo review` ghi lại trang khi nó đã tồn tại.

**Architecture:** `src/dashboard.mjs` dựng model JSON từ các hàm đã có (Node tính mọi con số), rồi ghép nó với `packages/cli/dashboard/` (HTML, CSS, các module vẽ) thành một file.
Các module vẽ là ESM thuần, test được trong Node; khi ghi trang chúng được nối thành một script vì `file://` không cho module import lẫn nhau.
Trình duyệt chỉ vẽ: router hash, tab, bộ lọc, biểu đồ SVG.

**Tech Stack:** Node.js ESM, `node --test`, HTML, CSS, SVG; không thêm phụ thuộc.

**Spec:** `docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md`

## Global Constraints

- Không thêm phụ thuộc npm; không có bước build; chạy được trên Node 20.
- Không dùng em dash trong code, comment hay docs; Markdown dài mỗi câu một dòng.
- Dữ liệu không sửa tại chỗ: hàm trả bản mới.
- Giờ và ngày hiện ra là giờ địa phương; ngày của một đơn vị là `landedAt(record)`.
- Tên, mô tả và điều kiện của achievement ẩn chưa mở không bao giờ vào model, docs, commit hay PR.
- Mọi chữ từ dữ liệu vào HTML đều qua `escape` của `dashboard/html.mjs`; link chỉ nhận `https://`.
- Trang không tải gì từ mạng: không font, không CDN; CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`.
- Module trong `dashboard/` chỉ import từ module anh em, mỗi lệnh `import` một dòng, không trùng tên ở cấp cao nhất.
- Test không mở trình duyệt thật: sandbox có `xdg-open` giả.
- Tool ghi file có thể giải mã `\u003c` thành `<`: sau khi viết code thoát `<` thì `grep` lại để chắc chuỗi đúng.
- Mọi test (`npm test` trong `packages/cli`) pass sau mỗi task; mỗi task một commit.

---

### Task 1: Model

**Files:**
- Modify: `packages/cli/src/store.mjs` (`writeText`; `writeJson` gọi nó)
- Modify: `packages/cli/src/queue.mjs` (nhận `isParked` từ `worker.mjs`), `packages/cli/src/worker.mjs` (import nó)
- Create: `packages/cli/src/dashboard.mjs`, `packages/cli/src/dashboard.test.mjs`

**Interfaces:**
- Consumes: `listAllRecords`, `landedAt`, `localDay`, `summarize` (`ledger.mjs`); `levelFor`, `CRITERIA` (`score.mjs`); `recentXp`, `unitLabel` (`views.mjs`); `streakOf`, `computeStats`, `periodOf`, `PERIODS` (`stats.mjs`); `achievementsOf`, `unlockedIn`, `tierName` (`achievements.mjs`); `dailyBudget` (`budget.mjs`); `listJobs` (`queue.mjs`); `listAllReviews` (`review.mjs`).
- Produces:
  - `store.mjs`: `writeText(path, text, { mode } = {})`: ghi atomic; file đã có giữ quyền, file mới nhận `mode` nếu có.
  - `queue.mjs`: `isParked(job, now = new Date())`.
  - `dashboard.mjs`: `dashboardModel(home, now = new Date())` trả:

```js
{
  version: 1,
  generatedAt: "2026-10-21T06:52:00.000Z",
  level: { level, from, next, total },
  recent: { today, week },
  streak: { current, longest },
  budget: { spent, limit },
  queue: { waiting, parked },          // số job: chưa bị trần chặn, và bị trần chặn
  criteria: CRITERIA,                  // thứ tự năm tiêu chí rubric
  periods: {                           // week, month, quarter
    week: {
      current:  { ...computeStats(records, periodOf("week", now, 0)), days: [{ day: "2026-10-19", xp }] },
      previous: { ...computeStats(records, periodOf("week", now, 1)), days },
    },
  },
  achievements: {
    visible: [{ id, name, description, tiers, value, tier, unlocked: [{ tier, at }] }],
    secretsFound: [{ id, name, description, at }],
    secretsHidden: 25,
    recent: [{ id, name, label, description, hidden, tier, at }],   // unlockedIn tuần này; chỉ bậc đã mở nên không lộ gì
  },
  units: [{
    key: "owner/name/pr-9", repo, id, label: "PR #9", kind, status, previousStatus, xp, summary, reason, at, landedAt,
    result: null | {
      method, judge, costUsd, failures, issues, evaluation, breakdown,
      facts: { diffMode, totals, files: [{ path, class, additions, deletions }],
               commits: [{ sha, subject, date, revertedBy }], excluded: [{ sha, subject, reason }],
               pr: null | { number, title, url, mergedAt } },
    },
    signals,
  }],                                  // mới nhất trước theo landedAt
  reviews: [{ key, repo, unitId, label, at, language, judge, costUsd, review, issues }],   // mới nhất trước
}
```

  `period.start` và `period.end` trong `computeStats` là `Date`; model đổi chúng thành chuỗi ISO; `period.label` có sẵn từ `periodOf` (`2026-10`, `2026 Q4`, `week 2026-10-19..2026-10-25`).
  `days` đi từ `period.start` tới hết kỳ (kỳ hiện tại: tới hôm nay), XP lấy từ `summarize(home).xpByDay`.
  `evaluation.notes`, thân PR, thân commit, `sessionID`, `deniedCommands`, `job` không có trong model.
  Achievement có `hidden` và `tier === 0` chỉ được đếm vào `secretsHidden`.

- [ ] Test `writeText` (trong `dashboard.test.mjs`, hoặc `store.test.mjs` nếu tạo): tạo file mới với `mode: 0o600`; ghi đè file 0644 thì giữ 0644; không để lại file `.tmp-*`.
- [ ] Test `dashboard.test.mjs` (đặt `process.env.TZ = "Asia/Ho_Chi_Minh"` ở đầu file, ghi bản ghi giả vào một `EVOLO_HOME` tạm bằng `writeRecords`, dùng `src/achievements/fixtures.mjs` nếu hợp):
  - `level`, `recent`, `streak` khớp `levelFor`, `recentXp`, `streakOf` trên cùng dữ liệu;
  - `periods.month.current` có `xp`, `units`, `types` bằng `computeStats` và `days` đủ số ngày, đúng XP từng ngày;
  - `units` xếp theo `landedAt` mới nhất trước, có `key` và `label`;
  - một bản ghi có `evaluation.notes`, thân PR, thân commit, `sessionID`: `JSON.stringify(model)` không chứa các chuỗi đó;
  - `JSON.stringify(model)` không chứa `name` hay `description` của bất kỳ phần tử nào trong `SECRET` chưa mở (lặp qua `SECRET` từ `achievements/secret.mjs`), và `secretsHidden` đúng số;
  - bản ghi `push_failed` không có `result`, bản ghi `failed` có `result.failures` mà không có `evaluation`: cả hai vào `units`;
  - review được ghi bằng `writeReview` có trong `reviews` với `label`;
  - job có `budgetDay` hôm nay đếm vào `queue.parked`, job khác vào `queue.waiting`.
- [ ] Chạy, fail; viết code; pass.
- [ ] Tạm bỏ lọc achievement ẩn và tạm giữ `notes`: thấy test fail, trả lại.
- [ ] Commit `feat: build the dashboard model from the ledger, reviews and queue`.

### Task 2: Trang, khung và Overview

**Files:**
- Create: `packages/cli/dashboard/index.html`, `packages/cli/dashboard/style.css`
- Create: `packages/cli/dashboard/html.mjs`, `packages/cli/dashboard/html.test.mjs`
- Create: `packages/cli/dashboard/fixtures.mjs` (`sampleModel()` dùng chung cho test màn hình)
- Create: `packages/cli/dashboard/overview.mjs`, `packages/cli/dashboard/overview.test.mjs`
- Create: `packages/cli/dashboard/app.mjs`, `packages/cli/dashboard/app.test.mjs`
- Modify: `packages/cli/src/dashboard.mjs` (`bundle`, `renderPage`, `writeDashboard`, `refreshDashboard`, `dashboardPath`)
- Modify: `packages/cli/bin/evolo.mjs` (lệnh `dashboard [--no-open]`, chú thích đầu file, `USAGE`)
- Create: `packages/cli/fakes/xdg-open.mjs`; Modify: `packages/cli/src/sandbox.mjs` (cài `xdg-open` giả, `opened()` đọc log của nó)
- Create: `packages/cli/src/dashboard.e2e.test.mjs`

**Interfaces:**
- Consumes: `dashboardModel` (Task 1), `writeText` (Task 1), `logLine` (`store.mjs`).
- Produces:
  - `html.mjs`: `escape(value)` (mọi giá trị thành chuỗi, thoát `& < > " '`), `safeUrl(url)` (trả `url` khi bắt đầu bằng `https://`, ngược lại `null`), `formatXp(xp)` (`1,040`), `localTime(iso)` (`2026-10-21 06:33`), `localDate(iso)` (`2026-10-21`), `plural(count, word)`, `hashOf(...parts)` (ghép phần đường dẫn hash, `encodeURIComponent` từng phần).
  - `overview.mjs`: `renderOverview(model) => string`; `badge(achievement, tier)` dùng lại ở Achievements; `unitRow(unit)` dùng lại ở Timeline.
  - `app.mjs`: `parseHash(hash) => { screen, params, query }`; `renderShell(model, route, content) => string`; `renderRoute(model, route) => string`; trong trình duyệt: đọc `#model`, vẽ, nghe `hashchange` và `change`/`click` của bộ lọc.
  - `dashboard.mjs`: `MODULES` (thứ tự nối), `bundle(dir) => string`, `renderPage(model, dir) => string`, `dashboardPath(home)`, `writeDashboard(home, now) => path`, `refreshDashboard(home, now)`.

Nối module (đặt trong `dashboard.mjs`):

```js
// The page is opened from file://, where Chrome refuses to load one module from another, so the drawing modules are
// joined into one script: imports from a sibling module and `export` keywords are dropped. Each module keeps to one
// import per line, from siblings only, and no two modules declare the same top-level name; the tests load the result.
const SIBLING_IMPORT = /^import \{[^}]*\} from "\.\/[\w-]+\.mjs";\n/gm;
export const MODULES = ["html.mjs", "charts.mjs", "overview.mjs", "timeline.mjs", "unit.mjs", "analytics.mjs", "achievements.mjs", "reviews.mjs", "app.mjs"];

export function bundle(dir) {
  return MODULES.map((name) => readFileSync(join(dir, name), "utf8").replace(SIBLING_IMPORT, "").replace(/^export /gm, "")).join("\n");
}
```

  Ở Task 2 `MODULES` chỉ có `html.mjs`, `overview.mjs`, `app.mjs`; task sau thêm tên của mình vào đúng chỗ.
  `renderPage` thay ba chỗ trong `index.html` (`/*evolo:style*/`, `/*evolo:script*/`, `/*evolo:model*/`) bằng hàm thay thế (`() => text`), để `$` trong dữ liệu không bị `String.replace` hiểu; model nhúng là `JSON.stringify(model).replace(/</g, "\\u003c")`.
  `writeDashboard` ghi bằng `writeText(path, page, { mode: 0o600 })`.
  `refreshDashboard(home, now)`: không làm gì khi `dashboard.html` chưa có; lỗi thì ghi `dashboard not updated: <message>` bằng `logLine` và không ném.

  `index.html`: `<!doctype html>`, `lang="en"`, `<meta charset>`, viewport, CSP như Global Constraints, `<title>Evolo</title>`, `<style>/*evolo:style*/</style>`, `<div id="app"></div>`, `<script type="application/json" id="model">/*evolo:model*/</script>`, `<script type="module">/*evolo:script*/</script>`, và `<noscript>` báo cần JavaScript.

  `style.css`: token trên `:root`, đổi trong `@media (prefers-color-scheme: dark)`.
  Sáng: nền `#f7f7f8`, thẻ `#ffffff`, viền `#e5e5ea`, chữ `#1d1d1f`, chữ phụ `#6e6e73`, nhấn `#0a84ff`, huy hiệu `#ffb020` tới `#ff6a3d`, xanh lá `#1a7f37`, đỏ `#cf222e`.
  Tối: nền `#111113`, thẻ `#1c1c1f`, viền `#2c2c31`, chữ `#ececf1`, chữ phụ `#9a9aa3`, nhấn `#3b9dff`, cùng màu huy hiệu, xanh lá `#3fb950`, đỏ `#f85149`.
  Font `system-ui`, số dùng `font-variant-numeric: tabular-nums`; thanh bên 200 px, dưới 720 px thành thanh ngang trên cùng cuộn ngang; vùng nội dung tối đa 1100 px; mọi thứ có `:focus-visible` rõ.

  Router (hash trong spec mục 6): `#/` và hash rỗng là overview; `#/unit/<owner>/<name>/<id>/<tab>` thiếu tab thì `score`; hash lạ thì overview kèm dòng "Nothing at this address".

  Overview: thẻ level (số level, `formatXp(total)`, "N XP to level L+1", thanh tiến độ `(total - from) / (next - from)`), thẻ Today, Last 7 days, Streak (`current` và "longest N"), thẻ Judge today (`$spent of $limit`), thẻ Queue (`waiting`, và `parked` nếu có, ghi "waiting for tomorrow's budget"), dải "Unlocked this week" bằng `badge` (ẩn khi rỗng), danh sách 5 đơn vị gần nhất bằng `unitRow` (nhãn, repo, loại, XP, ngày), chân trang "Generated <localTime(generatedAt)> · updates after each scored unit".
  Ledger rỗng: một thẻ "No scored units yet: push to the default branch or merge a PR in a repository set up with `evolo init`."

- [ ] Test `html.test.mjs`: `escape` của `<img src=x onerror=alert(1)>`, `"`, `'`, `&`, `null`, số; `safeUrl` nhận `https://github.com/a/b/pull/1`, trả `null` cho `javascript:alert(1)`, `http://x`, `data:`; `formatXp(1040)`; `localTime` theo `TZ` đặt ở đầu file.
- [ ] Test `overview.test.mjs`: `sampleModel()` cho ra level, tổng XP, "240 XP to level 8", streak, chi phí, 5 đơn vị đầu; tóm tắt chứa `<script>` bị thoát; ledger rỗng ra câu hướng dẫn; không có huy hiệu tuần thì không có dải.
- [ ] Test `app.test.mjs`: `parseHash` cho từng hash trong bảng của spec, hash có `?repo=a%2Fb&type=feature`, hash lạ; `renderShell` đánh dấu mục đang mở bằng `aria-current="page"`.
- [ ] Test `dashboard.test.mjs` (thêm):
  - `renderPage` có đúng một khối model, trong đó không có `</script>` dù một tóm tắt chứa `</script><script>alert(1)</script>`;
  - `JSON.parse` của khối model (lấy chữ giữa hai thẻ như trình duyệt đọc `textContent`) bằng model;
  - một tóm tắt chứa `$&` và `$'` giữ nguyên;
  - CSP có mặt;
  - `bundle` không còn dòng `import` hay `export`; ghi nó ra một file `.mjs` tạm và `await import()` được (bắt trùng tên và lỗi cú pháp);
  - `writeDashboard` tạo file 0600; `refreshDashboard` không tạo file khi chưa có, ghi lại khi đã có, và chỉ ghi log khi `dashboardModel` ném (giả bằng một bản ghi JSON hỏng trong ledger).
- [ ] Test E2E `dashboard.e2e.test.mjs`: sandbox, `init`, một push được chấm; `evolo dashboard --no-open` in đúng đường dẫn, file có quyền 0600 và model chứa đơn vị đó; `evolo dashboard` gọi `xdg-open` giả với đường dẫn đó; không có `xdg-open` trên `PATH` (bỏ khỏi thư mục `bin` của sandbox) thì in đường dẫn và thoát 0.
- [ ] Chạy, fail; viết code; pass.
- [ ] Mở trang thật một lần (Task 7 làm kỹ): `evolo dashboard` trên `~/.evolo`, xem Overview ở chế độ sáng và tối, không có lỗi console (đặc biệt lỗi CSP và lỗi nạp module nội tuyến).
- [ ] Tạm bỏ việc thoát `<` của model và tạm bỏ `escape` trong `unitRow`: thấy test fail, trả lại.
- [ ] Commit `feat: add evolo dashboard with the page frame and overview`.

### Task 3: Timeline và chi tiết đơn vị

**Files:**
- Create: `packages/cli/dashboard/timeline.mjs`, `timeline.test.mjs`, `unit.mjs`, `unit.test.mjs`
- Modify: `packages/cli/dashboard/app.mjs` (route `timeline`, `unit`; bộ lọc), `packages/cli/src/dashboard.mjs` (`MODULES`)

**Interfaces:**
- Consumes: `escape`, `safeUrl`, `formatXp`, `localTime`, `hashOf` (`html.mjs`); `unitRow` (`overview.mjs`).
- Produces: `renderTimeline(model, query) => string`; `filterUnits(units, query) => units`; `renderUnit(model, key, tab) => string`.

  Timeline: ba ô chọn (repo, type, status) với giá trị lấy từ chính `units`; đổi ô chọn thì đổi hash `#/timeline?repo=...&type=...&status=...`; danh sách bằng `unitRow`, mỗi dòng là link `#/unit/<key>`; đơn vị không `scored` có nhãn trạng thái và XP gạch ngang (`<s>`) nếu `previousStatus === "scored"`; bộ lọc không còn gì thì "No units match these filters".
  `filterUnits` chỉ so bằng (`===`), không tính toán.

  Chi tiết: đầu trang có repo, `label`, XP hoặc trạng thái, loại, `landedAt`, link PR qua `safeUrl`, `summary`.
  Tab là các link `#/unit/<key>/<tab>` với `role="tab"` và `aria-selected`; nhãn tab Review là "Review · N" với N là số vấn đề, "Review" khi chưa có review.
  - Score: với mỗi tiêu chí trong `model.criteria`: tên, thanh 0-4 (`score / 4`), điểm, `reason`, `evidence` dạng mã; dòng công thức `base × value × size × repo × signals = raw -> XP` lấy từ `breakdown` và `facts.totals.countedLines`; tín hiệu (giống `signalsLine` của `views.mjs`: CI lần đầu +5%, merge sạch +5%, đóng bug issue +10%, "read again at the next sync" khi chưa `final`); `issues` của validator và `flags`.
    `result.method === "rule"`: "Triaged by rule" và XP, không có thanh rubric.
    Không có `result` hoặc không có `evaluation`: hiện `reason` hoặc `failures`.
  - Review: tìm review có cùng `repo` và `unitId`; hiện `overview`, strengths, improvements, vấn đề xếp high, medium, low, mỗi vấn đề có mức độ, loại, `location`, tiêu đề, chi tiết, gợi ý sửa; cảnh báo khi `flags` có `suspected_injection`; chưa có review thì "No review yet" và khối mã `evolo review <id>` có nút Copy (`navigator.clipboard.writeText`, nút ẩn khi không có clipboard).
  - Files: nhóm theo `class`, mỗi file `path` với `+additions −deletions`, tổng ở đầu.
  - Commits: commit được tính (sha 7 ký tự, `subject`, ngày, "reverted by <sha>" nếu có), rồi "Left out" với `reason`.
  Key không có trong model: "This unit is no longer in the ledger" và link về Timeline.

- [ ] Test `timeline.test.mjs`: lọc theo từng ô và kết hợp; ô chọn có đúng giá trị; nhãn trạng thái; XP gạch ngang khi mất; rỗng sau lọc.
- [ ] Test `unit.test.mjs`: mỗi tab với đơn vị AI đủ trường, đơn vị `rule`, đơn vị `failed`, đơn vị `push_failed`; công thức đúng số; tab Review khi có và chưa có review; link PR `javascript:` không thành `href`; `evidence` và `location` chứa `<` bị thoát; key lạ.
- [ ] Chạy, fail; viết; pass; `bundle` vẫn nạp được.
- [ ] Commit `feat: add the dashboard timeline and unit details`.

### Task 4: Analytics

**Files:**
- Create: `packages/cli/dashboard/charts.mjs`, `charts.test.mjs`, `analytics.mjs`, `analytics.test.mjs`
- Modify: `packages/cli/dashboard/app.mjs` (route `analytics`), `packages/cli/src/dashboard.mjs` (`MODULES`)

**Interfaces:**
- Consumes: `model.periods`, `model.criteria`; `escape`, `formatXp` (`html.mjs`).
- Produces: `barChart(points, { label }) => string` (SVG, `points: [{ label, value }]`), `hBars(rows) => string` (thanh ngang HTML, `rows: [{ label, value, max, note }]`), `strip(values, labels) => string` (dải ô đậm nhạt cho 24 giờ hoặc 7 thứ); `renderAnalytics(model, kind, which) => string`.

  Biểu đồ dùng `viewBox` và co theo chiều rộng; mỗi cột có `<title>` (tooltip gốc của trình duyệt) ghi ngày và XP; có `role="img"` và `aria-label` tóm tắt; màu lấy từ biến CSS, nên đổi theo dark mode.
  Analytics: thanh chọn kỳ (Week, Month, Quarter) và (This, Previous) là link hash; đầu trang có `period.label`, XP, số đơn vị, level cuối kỳ, chi phí; chênh lệch so với kỳ trước (XP, đơn vị) là `current` trừ `previous` đã có trong model (một phép trừ để hiển thị, giống `formatStats`); XP theo ngày (`barChart` của `days`); loại việc (`hBars`); rubric trung bình hai kỳ cạnh nhau; tests "N of M units with code touched tests"; reverted; repos; dirs; giờ và thứ (`strip`).
  Kỳ không có đơn vị: "Nothing landed in <period.label>".

- [ ] Test `charts.test.mjs`: số cột bằng số điểm; cột cao nhất chạm đỉnh, cột 0 có chiều cao 0; `<title>` có nhãn đã thoát; mọi giá trị 0 không chia cho 0.
- [ ] Test `analytics.test.mjs`: đúng kỳ theo `kind` và `which`; số khớp `formatStats` của `views.mjs` trên cùng `computeStats` (XP, units, types, rubric, tests); kỳ rỗng.
- [ ] Chạy, fail; viết; pass.
- [ ] Commit `feat: add dashboard analytics with charts`.

### Task 5: Achievements và Reviews

**Files:**
- Create: `packages/cli/dashboard/achievements.mjs`, `achievements.test.mjs`, `reviews.mjs`, `reviews.test.mjs`
- Modify: `packages/cli/dashboard/app.mjs` (route `achievements`, `reviews`; bộ lọc mức độ), `packages/cli/src/dashboard.mjs` (`MODULES`)

**Interfaces:**
- Consumes: `badge` (`overview.mjs`), `model.achievements`, `model.reviews`, `model.units`.
- Produces: `renderAchievements(model) => string`, `renderReviews(model, query) => string`.

  Huy hiệu (kiểu đã chốt): emblem tròn gradient cam với số La Mã của bậc đang có (`★` cho achievement ẩn đã mở, `–` khi chưa mở), tên, vạch bậc (mỗi bậc một vạch, vạch đã đạt tô cam), mô tả, tiến độ `value / tiers[tier]` với thanh, hoặc "max" khi đủ bậc, "unlocked <localDate>" của bậc cao nhất; huy hiệu chưa mở mờ đi.
  Đầu trang: "13 / 33 · ★ 3 secrets · ? 25 hidden"; lưới achievement hiện theo thứ tự catalog; rồi achievement ẩn đã mở; rồi `secretsHidden` ô "?".
  Reviews: thẻ mỗi review (nhãn đơn vị, repo, ngày, ngôn ngữ, số vấn đề theo mức độ, `overview` cắt ở 2 dòng bằng CSS), link tới `#/unit/<key>/review`; lọc `?severity=high|medium|low` giữ review có ít nhất một vấn đề mức đó; chưa có review: "No reviews yet: `evolo review` writes one for the latest unit".

- [ ] Test `achievements.test.mjs`: dòng đầu đúng số; bậc La Mã; vạch bậc; tiến độ và "max"; số ô "?" bằng `secretsHidden`; tên achievement có `<` bị thoát.
- [ ] Test `reviews.test.mjs`: thứ tự; lọc mức độ; link đúng `key`; rỗng.
- [ ] Chạy, fail; viết; pass.
- [ ] Commit `feat: add dashboard achievements and reviews`.

### Task 6: Tự ghi lại trang

**Files:**
- Modify: `packages/cli/src/worker.mjs` (`runWorker`: sau `processJob` và sau `syncAll` gọi `refreshDashboard(home)`)
- Modify: `packages/cli/bin/evolo.mjs` (`review`: sau `writeReview` gọi `refreshDashboard(home)`)
- Modify: `packages/cli/src/dashboard.e2e.test.mjs`

**Interfaces:**
- Consumes: `refreshDashboard(home, now)` (Task 2).

- [ ] Test E2E:
  - push được chấm khi chưa từng chạy `evolo dashboard`: không có `dashboard.html`;
  - chạy `evolo dashboard --no-open`, push thêm một lần, chờ `settled`: model trong trang có đơn vị mới;
  - `evolo review <id>`: model trong trang có review đó;
  - PR merge được sync (fake `gh` như các test PR trong `worker.test.mjs`): trang có PR đó;
  - một bản ghi ledger hỏng làm `dashboardModel` ném: worker vẫn chấm xong, log có `dashboard not updated`.
- [ ] Chạy, fail; viết; pass.
- [ ] Tạm bỏ lời gọi trong worker, rồi trong `review`: thấy test fail, trả lại.
- [ ] Commit `feat: rewrite the dashboard after scoring, sync and review`.

### Task 7: Chạy thật, soát giao diện, review và tài liệu

- [ ] `evolo dashboard` trên `~/.evolo` thật; mở bằng Chrome DevTools (MCP `chrome-devtools`): mọi màn hình, mọi tab của một đơn vị AI, một đơn vị PR có link, các bộ lọc, Back và Forward.
- [ ] Chụp màn hình từng màn hình ở 1280 px sáng, 1280 px tối (`emulate` `prefers-color-scheme: dark`) và 360 px; soát lệch hàng, tràn chữ, cuộn ngang, độ tương phản, focus; sửa tới khi sạch.
- [ ] Console không có lỗi; tab Network không có request nào ngoài trang.
- [ ] So vài con số với `evolo status`, `evolo stats month` và `evolo achievements` (chỉ đọc).
- [ ] Sinh trang từ một `EVOLO_HOME` tạm có tóm tắt chứa `</script>` và `$&` để chắc trình duyệt thật vẫn vẽ đúng (đã có test, đây là kiểm tra trên trình duyệt).
- [ ] Agent review code (`ecc:code-reviewer` và `ecc:security-reviewer`); sửa CRITICAL, HIGH, MEDIUM, mỗi lỗi có test.
- [ ] Cập nhật `CLAUDE.md` (fake `xdg-open`), `docs/architecture.md` (mục 2, 4, 9, 10, 11), `docs/auto-scoring.md` (worker ghi lại dashboard), `docs/handoff.md` (Đã làm kèm PR #11 sửa giờ địa phương và PR dashboard, Chưa làm, bảng file, số test, mục kết quả, Việc tiếp theo là D `evolo report`).
- [ ] Commit `docs: plan the dashboard and record it in the handoff`.
