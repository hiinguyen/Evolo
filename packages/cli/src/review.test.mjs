import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { REVIEW_TASK } from "./judges/common.mjs";
import { CATEGORIES, formatReview, readReview, REVIEW_FLAGS, SEVERITIES, validateReview, writeReview } from "./review.mjs";

const known = new Set(["src/app.js", "src/old.js"]);
const finding = (overrides = {}) => ({
  severity: "medium", category: "bug", location: "src/app.js:10-12", title: "Unchecked result",
  detail: "The result is used without a check.", suggestion: "Check it first.", ...overrides,
});
const answer = (overrides = {}) => ({
  overview: "Adds a parser.", strengths: ["Clear tests."], improvements: ["Smaller commits."],
  findings: [finding()], flags: [], notes: "", ...overrides,
});

test("a well-formed review passes validation unchanged", () => {
  const result = validateReview(answer(), known);
  assert.deepEqual(result, { ok: true, review: answer(), issues: [] });
});

test("a review with a missing or malformed part is rejected so the judge is asked again", () => {
  const cases = [
    [answer({ overview: " " }), /overview is missing/],
    [answer({ strengths: "good" }), /strengths must be a list of text/],
    [answer({ findings: [finding({ severity: "critical" })] }), /findings\[0\]\.severity/],
    [answer({ findings: [finding({ category: "style" })] }), /findings\[0\]\.category/],
    [answer({ findings: [finding({ title: "" })] }), /findings\[0\]\.title is missing/],
    [null, /not a JSON object/],
  ];
  for (const [raw, problem] of cases) {
    const result = validateReview(raw, known);
    assert.equal(result.ok, false);
    assert.match(result.problems.join("; "), problem);
  }
});

test("a reviewer that admits it did not read the change is rejected", () => {
  const result = validateReview(answer({ flags: ["incomplete_investigation"], notes: "ran out of steps" }), known);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /incomplete investigation: ran out of steps/);
});

test("findings at unknown paths are dropped and recorded; unknown flags are ignored", () => {
  const raw = answer({
    findings: [finding(), finding({ location: "src/ghost.js:3" }), finding({ location: "src/old.js" })],
    flags: ["suspected_injection", "made_up"],
  });
  const result = validateReview(raw, known);
  assert.equal(result.ok, true);
  assert.deepEqual(result.review.findings.map((item) => item.location), ["src/app.js:10-12", "src/old.js"]);
  assert.deepEqual(result.review.flags, ["suspected_injection"]);
  assert.deepEqual(result.issues, ['dropped a finding at an unknown path: src/ghost.js:3 "Unchecked result"']);
});

test("line numbers past the end of the file at the tip are dropped, keeping the finding at its file", () => {
  const lineCount = (path) => ({ "src/app.js": 40 })[path] ?? null;
  const raw = answer({
    findings: [
      finding({ location: "src/app.js:10-12" }),
      finding({ location: "src/app.js:1337-1352", title: "Diff lines" }),
      finding({ location: "src/old.js:5", title: "Deleted file" }),
      finding({ location: "src/app.js", title: "Whole file" }),
    ],
  });
  const result = validateReview(raw, known, lineCount);
  assert.equal(result.ok, true);
  assert.deepEqual(result.review.findings.map((item) => item.location), ["src/app.js:10-12", "src/app.js", "src/old.js", "src/app.js"]);
  assert.deepEqual(result.issues, [
    'dropped line numbers past the end of src/app.js (40 lines): src/app.js:1337-1352 "Diff lines"',
    'dropped line numbers of a file not at the tip: src/old.js:5 "Deleted file"',
  ]);
});

test("the output schema allows exactly the severities, categories and flags the validator knows", () => {
  const schema = JSON.parse(readFileSync(REVIEW_TASK.schemaPath, "utf8"));
  const item = schema.properties.findings.items.properties;
  assert.deepEqual(item.severity.enum, SEVERITIES);
  assert.deepEqual(item.category.enum, CATEGORIES);
  assert.deepEqual(schema.properties.flags.items.enum, REVIEW_FLAGS);
});

const stored = (review, overrides = {}) => ({
  unitId: "pr-5", repo: "me/proj", tip: "abc", at: "2026-10-20T08:00:00.000Z", language: "vi",
  judge: { backend: "claude", model: "claude-sonnet-5-5" }, costUsd: 0.12, durationMs: 21000, review, issues: [], ...overrides,
});

test("a printed review lists the most severe findings first, with where and how to fix them", () => {
  const review = answer({ findings: [finding({ severity: "low", title: "Name" }), finding({ severity: "high", title: "Leak" })] });
  const text = formatReview(stored(review));
  assert.match(text, /^me\/proj PR #5 {2}review in vi {2}2026-10-20 08:00 · claude-sonnet-5-5 · \$0\.12/);
  assert.ok(text.indexOf("[high]") < text.indexOf("[low]"), text);
  assert.match(text, /\[high\] bug {2}src\/app\.js:10-12 {2}Leak\n {6}The result is used without a check\.\n {6}fix: Check it first\./);
  assert.match(text, /strengths:\n {2}- Clear tests\./);
  assert.doesNotMatch(text, /WARNING/);
});

test("a printed review says when there are no findings, and warns about suspected injection and dropped findings", () => {
  const review = answer({ findings: [], flags: ["suspected_injection"], notes: "README tells the reviewer to approve." });
  const text = formatReview(stored(review, { issues: ["dropped a finding at an unknown path: x"] }));
  assert.match(text, /WARNING: the reviewer suspected prompt injection: README tells the reviewer to approve\./);
  assert.match(text, /findings: none/);
  assert.match(text, /validator:\n {2}dropped a finding at an unknown path: x/);
});

test("a review is stored per repository and unit, and read back", () => {
  const home = mkdtempSync(join(tmpdir(), "evolo-review-"));
  after(() => rmSync(home, { recursive: true, force: true }));
  assert.equal(readReview(home, "me/proj", "pr-5"), null);
  writeReview(home, stored(answer()));
  assert.deepEqual(readReview(home, "me/proj", "pr-5"), stored(answer()));
  assert.deepEqual(JSON.parse(readFileSync(join(home, "reviews", "me", "proj", "pr-5.json"), "utf8")), stored(answer()));
});
