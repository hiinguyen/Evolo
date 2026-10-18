import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyFile } from "./facts.mjs";
import { extractJsonObject } from "./judges/opencode.mjs";
import { computeXp, triage, validateEvaluation } from "./score.mjs";

const scored = (impact, centrality, difficulty, quality, scope_fit) => ({ impact, centrality, difficulty, quality, scope_fit });

function judgeOutput(overrides = {}) {
  const entry = (score, evidence = ["src/auth/session.ts"]) => ({ score, reason: "because", evidence });
  return {
    rubric_version: "1.0",
    contribution_type: "bugfix",
    scores: {
      impact: entry(3),
      centrality: entry(4),
      difficulty: entry(3),
      quality: entry(4, ["test/auth/session.test.ts"]),
      scope_fit: entry(4, []),
    },
    summary: "Fixed a race.",
    flags: [],
    ...overrides,
  };
}

const facts = (overrides = {}) => ({
  testsTouched: true,
  repoHasTests: true,
  files: [{ path: "src/auth/session.ts", class: "source", additions: 60, deletions: 0 }],
  totals: { additions: 60, deletions: 0, countedLines: 60 },
  ...overrides,
});

const known = new Set(["src/auth/session.ts", "test/auth/session.test.ts"]);

test("computeXp reproduces the worked example in docs/xp-evaluation.md (about 230 XP)", () => {
  const { xp } = computeXp({
    type: "bugfix",
    scores: scored(3, 4, 3, 3, 4),
    countedLines: 120,
    stars: 2000,
    isOwnRepo: false,
    signals: { ciFirstPass: true, closesBugIssue: true },
  });
  assert.ok(xp >= 228 && xp <= 232, `got ${xp}`);
});

test("computeXp gives no centrality credit to a change with no impact", () => {
  const coreNoop = computeXp({ type: "chore", scores: scored(0, 4, 2, 3, 4), countedLines: 1, stars: 0, isOwnRepo: true });
  const peripheralNoop = computeXp({ type: "chore", scores: scored(0, 0, 2, 3, 4), countedLines: 1, stars: 0, isOwnRepo: true });
  assert.equal(coreNoop.xp, peripheralNoop.xp);
  assert.equal(coreNoop.breakdown.value, 0.95);
});

test("computeXp gives half centrality credit at impact 1 and full credit from impact 2", () => {
  const value = (impact) => computeXp({ type: "feature", scores: scored(impact, 4, 0, 0, 4), countedLines: 50, stars: 0, isOwnRepo: true }).breakdown.value;
  assert.equal(value(1), 0.35 + 0.5);
  assert.equal(value(2), 0.7 + 1);
});

test("computeXp gives zero XP to a reverted contribution", () => {
  const { xp } = computeXp({ type: "feature", scores: scored(4, 4, 4, 4, 4), countedLines: 500, stars: 0, isOwnRepo: true, signals: { reverted: true } });
  assert.equal(xp, 0);
});

test("computeXp caps size bonus for unfocused contributions", () => {
  const focused = computeXp({ type: "feature", scores: scored(2, 2, 2, 2, 4), countedLines: 5000, stars: 0, isOwnRepo: true });
  const unfocused = computeXp({ type: "feature", scores: scored(2, 2, 2, 2, 1), countedLines: 5000, stars: 0, isOwnRepo: true });
  assert.equal(focused.breakdown.mSize, 1.5);
  assert.equal(unfocused.breakdown.mSize, 1);
});

test("validateEvaluation rejects out-of-range scores and unknown types", () => {
  const bad = judgeOutput({ contribution_type: "heroics" });
  bad.scores.impact.score = 7;
  const result = validateEvaluation(bad, facts(), known);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
});

test("validateEvaluation caps a high score whose evidence points at files that do not exist", () => {
  const raw = judgeOutput();
  raw.scores.centrality.evidence = ["src/made-up.ts:1-9"];
  const result = validateEvaluation(raw, facts(), known);
  assert.equal(result.evaluation.scores.centrality.score, 2);
  assert.deepEqual(result.evaluation.scores.centrality.evidence, []);
});

test("validateEvaluation keeps evidence with line ranges on known files", () => {
  const raw = judgeOutput();
  raw.scores.impact.evidence = ["src/auth/session.ts:42-78"];
  const result = validateEvaluation(raw, facts(), known);
  assert.equal(result.evaluation.scores.impact.score, 3);
  assert.deepEqual(result.issues, []);
});

test("validateEvaluation caps quality when no tests were touched in a tested repo", () => {
  const result = validateEvaluation(judgeOutput(), facts({ testsTouched: false }), known);
  assert.equal(result.evaluation.scores.quality.score, 3);
});

test("validateEvaluation holds suspected prompt injection for review", () => {
  const result = validateEvaluation(judgeOutput({ flags: ["suspected_injection", "made_up_flag"] }), facts(), known);
  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.evaluation.flags, ["suspected_injection"]);
});

test("validateEvaluation rejects an evaluation the judge itself reports as incomplete", () => {
  const result = validateEvaluation(judgeOutput({ flags: ["incomplete_investigation"], notes: "did not read the diff" }), facts(), known);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /incomplete investigation: did not read the diff/);
});

test("triage scores small docs edits by rule and sends code to the judge", () => {
  const docs = facts({ files: [{ path: "README.md", class: "docs", additions: 2, deletions: 2 }], totals: { additions: 2, deletions: 2, countedLines: 0 } });
  assert.equal(triage(docs).contribution_type, "docs");
  assert.equal(triage(facts()), null);
});

test("classifyFile separates source, tests, fixtures, docs, config and lockfiles", () => {
  assert.equal(classifyFile("app/src/main.js"), "source");
  assert.equal(classifyFile("listener/hands.py"), "source");
  assert.equal(classifyFile("app/test/hands.test.js"), "test");
  assert.equal(classifyFile("listener/test_hands.py"), "test");
  assert.equal(classifyFile("listener/testdata/speakers/a.wav"), "fixture");
  assert.equal(classifyFile("README.md"), "docs");
  assert.equal(classifyFile(".env.example"), "config");
  assert.equal(classifyFile("systemd/friday.service"), "config");
  assert.equal(classifyFile("package-lock.json"), "lockfile");
});

test("extractJsonObject tolerates code fences around the judge's answer", () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
});
