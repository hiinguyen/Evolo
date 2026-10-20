# evolo review: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lệnh `evolo review <ref>` chạy một judge riêng viết review code cho một đơn vị đã chấm, lưu vào `~/.evolo/reviews/`, ngôn ngữ theo `evolo config`.

**Architecture:** Judge backend nhận một task spec (`xp-judge` hoặc `xp-review`) thay vì gắn cứng prompt và schema.
Phần dựng worktree, ghi đầu vào và thử lại của `evaluate.mjs` được tách thành hàm dùng chung.
`src/review.mjs` kiểm tra, lưu và in review; `src/config.mjs` giữ cấu hình.

**Tech Stack:** Node.js ESM, `node --test`, `git`, `claude -p`, không thêm phụ thuộc.

**Spec:** `docs/review.md`

## Global Constraints

- Không thêm phụ thuộc npm; không có bước build.
- Không dùng em dash trong code, comment hay docs.
- Markdown dài: mỗi câu một dòng.
- `review.language`: tối đa 40 ký tự, chỉ chữ cái (Unicode), khoảng trắng và `-`; mặc định `en`.
- `severity` ∈ `high, medium, low`; `category` ∈ `bug, security, performance, test, design, readability, other`; `flags` ∈ `suspected_injection, incomplete_investigation`.
- Review lưu ở `<home>/reviews/<owner>/<name>/<unit id>.json`, ghi bằng `writeJson`.
- Thử lại tối đa 3 lần; judge không chạy được thì không lưu gì.
- Mọi test hiện có (`npm test` trong `packages/cli`) phải pass sau mỗi task.

---

### Task 1: Task spec cho judge và prompt chung

**Files:**
- Create: `packages/cli/judge/shared.md` (mục "Inputs" và "Trust rules" chuyển từ `xp-judge.md`, viết trung tính "evaluate" thay vì "score")
- Modify: `packages/cli/judge/xp-judge.md` (thay hai mục đó bằng dòng `{{shared}}`)
- Modify: `packages/cli/src/judges/common.mjs`, `claude.mjs`, `opencode.mjs`, `packages/cli/src/evaluate.mjs`
- Test: `packages/cli/src/judges/judges.test.mjs`

**Interfaces:**
- Produces:
  - `SCORE_TASK = { name: "xp-judge", promptPath, schemaPath }`, `REVIEW_TASK = { name: "xp-review", ... }` trong `common.mjs`.
  - `taskPrompt(spec): string`: nội dung `spec.promptPath` với `{{shared}}` thay bằng `judge/shared.md`.
  - `judge.judge({ checkoutDir, inputs, task, spec = SCORE_TASK, onProgress })` cho mọi backend.
  - `claudeArgs({ model, budgetUsd, inputsDir, task, spec })` dùng `--append-system-prompt <taskPrompt(spec)>` và `--json-schema <spec.schemaPath>`.

- [ ] Viết test: `claudeArgs` với `REVIEW_TASK` chứa schema review và prompt review; `taskPrompt(SCORE_TASK)` chứa "Trust rules" và không còn `{{shared}}`.
- [ ] Chạy test, thấy fail.
- [ ] Tách `shared.md`, thêm spec và `taskPrompt`, đổi hai backend (opencode ghi agent `<spec.name>.md` và chạy `--agent <spec.name>`).
- [ ] `npm test`: mọi test pass, kể cả 15 test E2E chấm điểm.
- [ ] Commit `refactor: let judges run a task spec with a shared prompt`.

### Task 2: Cấu hình `evolo config`

**Files:**
- Create: `packages/cli/src/config.mjs`, `packages/cli/src/config.test.mjs`
- Modify: `packages/cli/bin/evolo.mjs` (lệnh `config`)

**Interfaces:**
- Produces: `CONFIG_KEYS = { "review.language": { default: "en", check(value) } }`; `getConfig(home, key): string`; `setConfig(home, key, value): void` (ném lỗi với khoá lạ hoặc giá trị sai); `listConfig(home): [key, value, isDefault][]`.

- [ ] Test: mặc định khi không có file; `set` rồi `get`; khoá lạ, giá trị dài 41 ký tự, giá trị có `\n` hoặc `` ` `` bị từ chối; file JSON hỏng làm `get` và `set` ném lỗi và file không bị ghi đè; `vi`, `Tiếng Việt`, `pt-BR` hợp lệ.
- [ ] Chạy, fail; viết `config.mjs` và lệnh CLI (`evolo config`, `config get <key>`, `config set <key> <value>`); chạy, pass.
- [ ] Commit `feat: add evolo config with review.language`.

### Task 3: Prompt, schema và lõi review

**Files:**
- Create: `packages/cli/judge/xp-review.md`, `packages/cli/judge/review.schema.json`, `packages/cli/src/review.mjs`, `packages/cli/src/review.test.mjs`
- Modify: `packages/cli/src/evaluate.mjs` (xuất `withJudgeInputs` và `judgeWithRetries` tổng quát)

**Interfaces:**
- Consumes: `REVIEW_TASK`, `getConfig`.
- Produces:
  - `evaluate.mjs`: `withJudgeInputs(options, facts, work(checkoutDir, inputs))`; `judgeWithRetries({ judge, spec, checkoutDir, inputs, task, validate(output) => {ok, problems?}, onProgress })` trả `{ ok, ...validation, ...run, attempts, failures, costUsd, unavailable }`; `knownPathsFor(checkoutDir, facts)`.
  - `review.mjs`: `validateReview(raw, knownPaths) => { ok: true, review, issues } | { ok: false, problems }`; `readReview(home, key, id)`; `writeReview(home, key, stored)`; `reviewUnit({ options, judge, facts, language, onProgress }) => { ok, review?, issues?, costUsd, durationMs, judge, failures? }`; `formatReview(stored): string`.

- [ ] Test `validateReview`: thiếu `overview` thì fail; `severity` lạ thì fail; `incomplete_investigation` thì fail; finding trỏ file lạ bị bỏ và ghi vào `issues`; cờ lạ bị lọc; review hợp lệ giữ nguyên.
- [ ] Test `formatReview`: có cảnh báo khi `suspected_injection`; findings sắp `high` trước; dòng "no findings" khi rỗng.
- [ ] Test schema: enum của schema khớp hằng số trong `review.mjs`.
- [ ] Chạy fail; viết prompt, schema, `review.mjs`, tách `withJudgeInputs` và `judgeWithRetries`; `npm test` pass.
- [ ] Commit `feat: add the review judge prompt, schema and validator`.

### Task 4: Lệnh `evolo review`, E2E

**Files:**
- Create: `packages/cli/src/sandbox.mjs` (chuyển `makeSandbox` từ `worker.test.mjs`), `packages/cli/src/review.e2e.test.mjs`
- Modify: `packages/cli/src/worker.test.mjs` (import sandbox), `packages/cli/fakes/claude.mjs` (trả lời review khi schema có `findings`; `$FAKE_CLAUDE_LOG.badpath` làm finding trỏ file lạ), `packages/cli/bin/evolo.mjs`, `packages/cli/src/views.mjs` (dòng review trong `why`), `packages/cli/claude/skills/evolo/SKILL.md`, `packages/cli/src/units.mjs` (`ensureCommit`)

**Interfaces:**
- Produces: `ensureCommit(repoDir, remote, facts)`: tải `tip` (PR: `refs/pull/<n>/head`; push: sha) khi clone thiếu; `explain(record, { reviewed })` thêm dòng review.

- [ ] Test E2E: review lưu file và in ra, lần hai không gọi judge, `--again` gọi lại; ngôn ngữ `vi` có trong câu lệnh; finding file lạ bị bỏ; đơn vị `push_failed` bị từ chối; `tip` bị xoá khỏi clone được tải lại; judge down thì thoát mã 1 và không có file; `why` báo đã có review.
- [ ] Chạy fail; viết lệnh, `ensureCommit`, dòng `why`, skill; `npm test` pass.
- [ ] Commit `feat: add evolo review`.

### Task 5: Chạy thật và tài liệu

- [ ] Clone lightrag vào scratchpad, `EVOLO_HOME` riêng, chấm PR #5, `evolo config set review.language vi`, `evolo review #5`; ghi chi phí, thời gian, nhận xét chất lượng vào `docs/review.md` mục 9.
- [ ] Cập nhật trạng thái trong `docs/review.md`, `docs/architecture.md`, `docs/handoff.md`, chú thích đầu `bin/evolo.mjs`.
- [ ] Agent review code; sửa lỗi CRITICAL, HIGH, MEDIUM.
- [ ] Commit `docs: record the first real review run`.
