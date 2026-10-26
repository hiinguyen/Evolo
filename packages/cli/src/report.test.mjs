// Every date below is local time in a fixed zone without daylight saving, so periods do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { basisOf, formatReport, reportData, storedReport, validateReport } from "./report.mjs";
import { CRITERIA } from "./score.mjs";
import { periodOf } from "./stats.mjs";

const day = (date, time = "12:00:00") => `${date}T${time}+07:00`;
const NOW = new Date(day("2026-10-22"));
const WEEK = periodOf("week", NOW);

// A ledger record as the worker writes it, with the fields a report reads; every criterion scores 2 unless `scores` says
// otherwise, and the judge's reason for each names the criterion and the unit.
function unit({
  id, repo = "me/app", status = "scored", xp = 50, landed = day("2026-10-20"), type = "feature", method = "ai", scores = {},
  title = null, summary = `Summary of ${id}.`,
}) {
  const all = Object.fromEntries(CRITERIA.map((criterion) => [criterion, { score: scores[criterion] ?? 2, reason: `${criterion} of ${id}`, evidence: ["a.js"] }]));
  return {
    id, repo, kind: id.startsWith("pr-") ? "pr" : "push", status, xp, at: landed, landedAt: landed, summary,
    result: {
      method, costUsd: 0.1,
      evaluation: { contribution_type: type, scores: all, summary, flags: [] },
      facts: {
        files: [{ path: "a.js", class: "source", additions: 10, deletions: 0 }],
        commits: [{ sha: "a".repeat(40), subject: `feat: ${id}`, date: landed }],
        totals: { countedLines: 10 }, testsTouched: false, repoHasTests: true,
        ...(title ? { pr: { number: 1, title } } : {}),
      },
    },
  };
}

const review = (id, repo = "me/app", at = day("2026-10-21")) => ({
  unitId: id, repo, at, language: "en", judge: { backend: "claude", model: "m" }, costUsd: 0.2, issues: [],
  review: {
    overview: `Review of ${id}.`, strengths: ["Good tests."], improvements: ["Smaller functions."], flags: [], notes: "",
    findings: [{ severity: "medium", category: "bug", location: "a.js:1", title: "Off by one", detail: "d", suggestion: "s" }],
  },
});

const keys = (units) => units.map((each) => each.key);

test("units are the most impactful first, then the most XP, then the earliest; units scored by rule come last", () => {
  const records = [
    unit({ id: "push-rule-big", method: "rule", type: "docs", xp: 500 }),
    unit({ id: "push-low", scores: { impact: 1 }, xp: 300 }),
    unit({ id: "pr-2", scores: { impact: 3 }, xp: 100, landed: day("2026-10-21") }),
    unit({ id: "pr-1", scores: { impact: 3 }, xp: 100, landed: day("2026-10-20") }),
    unit({ id: "pr-3", scores: { impact: 3 }, xp: 150 }),
    unit({ id: "push-rule-small", method: "rule", type: "docs", xp: 5 }),
  ];
  const { input } = reportData(records, [], WEEK, NOW);
  assert.deepEqual(keys(input.units), [
    "me/app/pr-3", "me/app/pr-1", "me/app/pr-2", "me/app/push-low", "me/app/push-rule-big", "me/app/push-rule-small",
  ]);
  assert.deepEqual(input.highlights, ["me/app/pr-3", "me/app/pr-1", "me/app/pr-2", "me/app/push-low"], "never a unit scored by rule");
  assert.equal(input.omitted, 0);
});

test("a unit carries what the writer needs: its label, title, summary, the judge's reasons and its code review", () => {
  const records = [unit({ id: "pr-7", title: "Add the dashboard", scores: { impact: 4 } }), unit({ id: "push-a-b", method: "rule", type: "docs" })];
  const { input } = reportData(records, [review("pr-7"), review("pr-7", "me/other")], WEEK, NOW);
  const [pr, push] = input.units;
  assert.equal(pr.label, "app PR #7");
  assert.equal(pr.title, "Add the dashboard");
  assert.equal(pr.summary, "Summary of pr-7.");
  assert.deepEqual(pr.scores.impact, { score: 4, reason: "impact of pr-7" }, "no evidence: the writer does not read the code");
  assert.deepEqual(pr.review, {
    overview: "Review of pr-7.", strengths: ["Good tests."], improvements: ["Smaller functions."],
    findings: [{ severity: "medium", category: "bug", title: "Off by one" }],
  });
  assert.equal(push.title, "feat: push-a-b", "a push is named by its first commit");
  assert.equal(push.scores, null, "a rule's fixed scores say nothing about the work");
  assert.equal(push.review, undefined);
  assert.deepEqual([pr.files, pr.countedLines, pr.testsTouched], [1, 10, false]);
});

test("only the period's units are in, the reverted ones are listed apart, and failed ones are counted", () => {
  const records = [
    unit({ id: "pr-1" }),
    unit({ id: "pr-old", landed: day("2026-10-18") }),
    unit({ id: "pr-next", landed: day("2026-10-26") }),
    unit({ id: "pr-gone", status: "reverted", xp: 0 }),
    { id: "pr-9", repo: "me/app", kind: "pr", status: "failed", xp: 0, at: day("2026-10-21"), reason: "judge unavailable" },
  ];
  const data = reportData(records, [], WEEK, NOW);
  assert.deepEqual(keys(data.input.units), ["me/app/pr-1"]);
  assert.deepEqual(data.input.reverted, [{ key: "me/app/pr-gone", label: "app PR #gone", summary: "Summary of pr-gone." }]);
  assert.equal(data.failed, 1);
  assert.equal(data.input.period.inProgress, true);
  assert.equal(data.input.period.label, "week 2026-10-19..2026-10-25");
  assert.equal(data.input.numbers.current.xp, 50);
  assert.equal(data.input.numbers.previous.xp, 50, "the week before holds pr-old");
  assert.equal(reportData(records, [], periodOf("week", NOW, 1), NOW).input.period.inProgress, false);
});

test("a period with many units keeps the most impactful sixty, and says how many it left out", () => {
  const records = Array.from({ length: 65 }, (_, index) => unit({ id: `pr-${index}`, xp: 10 + index }));
  const { input } = reportData(records, [], WEEK, NOW);
  assert.equal(input.units.length, 60);
  assert.equal(input.omitted, 5);
  assert.equal(input.units[0].key, "me/app/pr-64");
  assert.equal(input.highlights.length, 5);
});

test("the basis changes with the previous period's units and the achievements unlocked, which the report also shows", () => {
  const records = [unit({ id: "pr-1" })];
  const basis = basisOf(records, [], WEEK);
  const lastWeek = unit({ id: "pr-0", landed: day("2026-10-14") });
  assert.notEqual(basisOf([...records, lastWeek], [], WEEK), basis, "the comparison with the week before changes");
  assert.notEqual(basisOf([...records, lastWeek], [], WEEK), basisOf([...records, { ...lastWeek, xp: 75 }], [], WEEK));
  assert.equal(basisOf([...records, unit({ id: "pr-next", landed: day("2026-10-27") })], [], WEEK), basis, "a later unit unlocks nothing in it");
});

test("the basis changes with the status, XP or review of a unit of the period, and with nothing else", () => {
  const records = [unit({ id: "pr-1" }), unit({ id: "pr-2" }), unit({ id: "pr-old", landed: day("2026-10-10") })];
  const reviews = [review("pr-1")];
  const basis = basisOf(records, reviews, WEEK);
  assert.match(basis, /^[0-9a-f]{64}$/);
  assert.equal(basisOf([...records].reverse(), reviews, WEEK), basis, "order does not matter");
  const [first, second, old] = records;
  assert.notEqual(basisOf([{ ...first, status: "reverted" }, second, old], reviews, WEEK), basis);
  assert.notEqual(basisOf([{ ...first, xp: 55 }, second, old], reviews, WEEK), basis);
  assert.notEqual(basisOf([...records, unit({ id: "pr-3" })], reviews, WEEK), basis);
  assert.notEqual(basisOf(records, [review("pr-1", "me/app", day("2026-10-22"))], WEEK), basis);
  assert.notEqual(basisOf(records, [], WEEK), basis);
  assert.equal(basisOf([first, second, { ...old, summary: "Edited." }], reviews, WEEK), basis, "a unit long before the period");
  assert.notEqual(basisOf([first, second, { ...old, xp: 999 }], reviews, WEEK), basis, "it moves the XP tiers unlocked this week");
  assert.equal(basisOf(records, [...reviews, review("pr-old")], WEEK), basis, "a review of another period's unit");
});

// An input with two units, the first a highlight, and one reverted unit.
const INPUT = {
  highlights: ["me/app/pr-1"],
  units: [{ key: "me/app/pr-1" }, { key: "me/app/pr-2" }],
  reverted: [{ key: "me/app/pr-gone" }],
};
const answer = (overrides = {}) => ({
  overview: "A steady week of feature work with `SHA-256` hashing.",
  highlights: [{ unit: "me/app/pr-1", text: "It shipped the core." }],
  strengths: [{ text: "Clear tests.", units: ["me/app/pr-1"] }],
  improvements: [{ text: "Fewer reverts.", units: ["me/app/pr-gone", "me/app/pr-2"] }],
  flags: [],
  notes: "",
  ...overrides,
});

test("a well-formed report is accepted as written", () => {
  const checked = validateReport(answer(), INPUT);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.report, answer());
  assert.deepEqual(checked.issues, []);
});

test("a report in the wrong shape is rejected", () => {
  for (const broken of [
    null,
    answer({ overview: " " }),
    answer({ highlights: "x" }),
    answer({ highlights: [{ unit: "me/app/pr-1" }] }),
    answer({ strengths: [{ text: "x" }] }),
    answer({ improvements: [{ text: "", units: ["me/app/pr-1"] }] }),
    answer({ strengths: [{ text: "x", units: [1] }] }),
    answer({ flags: "none" }),
    answer({ notes: 3 }),
  ]) {
    assert.equal(validateReport(broken, INPUT).ok, false, JSON.stringify(broken));
  }
});

test("the highlights must be the units code picked, each once, in its order", () => {
  const two = { ...INPUT, highlights: ["me/app/pr-1", "me/app/pr-2"] };
  const highlight = (unit) => ({ unit, text: "Why." });
  assert.equal(validateReport(answer({ highlights: [highlight("me/app/pr-1"), highlight("me/app/pr-2")] }), two).ok, true);
  for (const highlights of [
    [highlight("me/app/pr-2"), highlight("me/app/pr-1")],
    [highlight("me/app/pr-1")],
    [highlight("me/app/pr-1"), highlight("me/app/pr-1")],
    [highlight("me/app/pr-1"), highlight("me/app/pr-9")],
  ]) {
    const checked = validateReport(answer({ highlights }), two);
    assert.equal(checked.ok, false);
    assert.match(checked.problems.join(), /highlights/);
  }
});

test("a point citing a unit not in the input, or citing none, is dropped and recorded; repeated citations merge", () => {
  const checked = validateReport(answer({
    strengths: [
      { text: "Real.", units: ["me/app/pr-1", "me/app/pr-1"] },
      { text: "Invented.", units: ["me/app/pr-1", "me/app/pr-404"] },
    ],
    improvements: [{ text: "Uncited.", units: [] }],
  }), INPUT);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.report.strengths, [{ text: "Real.", units: ["me/app/pr-1"] }]);
  assert.deepEqual(checked.report.improvements, []);
  assert.deepEqual(checked.issues, [
    'dropped a strength citing a unit not in the period (me/app/pr-404): "Invented."',
    'dropped an improvement without a citation: "Uncited."',
  ]);
});

test("a digit anywhere in the prose outside inline code rejects the report", () => {
  for (const overrides of [
    { overview: "You earned 535 XP." },
    { overview: "Mười ٣ việc." },
    { highlights: [{ unit: "me/app/pr-1", text: "PR #12 shipped." }] },
    { strengths: [{ text: "Tests in 4 of 4 units.", units: ["me/app/pr-1"] }] },
    { improvements: [{ text: "Use `Node 20` and Node 22.", units: ["me/app/pr-1"] }] },
  ]) {
    const checked = validateReport(answer(overrides), INPUT);
    assert.equal(checked.ok, false, JSON.stringify(overrides));
    assert.match(checked.problems.join(), /digit/);
  }
  assert.equal(validateReport(answer({ overview: "Moved to `Node 20` and `SHA-256`, with `i18n` and `utf-8`." }), INPUT).ok, true);
  // A digit-led name is a word the writer writes bare or in inline code; a count hides nowhere.
  assert.equal(validateReport(answer({ overview: "Built a 3D world guarded by 2FA logins and 4K textures, on `Node 20`." }), INPUT).ok, true);
  for (const overview of [
    "You earned `100 XP`.", "It touched `12 files`.", "About `3` reverts.", "Only `about 40 lines`.",
    "A `24/7` bridge.", "The `2026` merge.", "a `128MB` cache.", "the `1st` merge.", "a 10x speedup.", "the 80s.", "Done in 3d.",
  ]) {
    assert.equal(validateReport(answer({ overview }), INPUT).ok, false, overview);
  }
});

test("only known flags are kept, and missing notes become empty", () => {
  const checked = validateReport(answer({ flags: ["suspected_injection", "made_up"], notes: undefined }), INPUT);
  assert.deepEqual(checked.report.flags, ["suspected_injection"]);
  assert.equal(checked.report.notes, "");
});

// A report as `evolo report` saves it, of the week of NOW, written by the judge with `answer()`.
function saved(overrides = {}) {
  const records = [unit({ id: "pr-1", xp: 175, scores: { impact: 3 } }), unit({ id: "pr-2", xp: 95 }), unit({ id: "pr-gone", status: "reverted", xp: 0 })];
  const data = reportData(records, [], WEEK, NOW);
  const written = { report: answer(), issues: [], judge: { backend: "claude", model: "claude-sonnet-5-5" }, costUsd: 0.04, durationMs: 9000 };
  return { ...storedReport({ data, written, language: "vi", at: day("2026-10-22", "09:10:00") }), ...overrides };
}

test("a saved report keeps its period, the numbers and units it was written from, and the writer's answer", () => {
  const stored = saved();
  assert.equal(stored.id, "week/2026-10-19");
  assert.equal(stored.kind, "week");
  assert.equal(stored.label, "week 2026-10-19..2026-10-25");
  assert.equal(stored.inProgress, true);
  assert.equal(stored.numbers.current.xp, 270);
  assert.equal(stored.numbers.current.period.start, new Date(day("2026-10-19", "00:00:00")).toISOString());
  assert.deepEqual(stored.units.map((each) => [each.key, each.label, each.xp]), [
    ["me/app/pr-1", "app PR #1", 175], ["me/app/pr-2", "app PR #2", 95], ["me/app/pr-gone", "app PR #gone", 0],
  ]);
  assert.deepEqual(stored.report, answer());
  assert.equal(JSON.parse(JSON.stringify(stored)).basis, stored.basis);
});

test("the printed report has the numbers, the writer's words with their citations, and the validator's notes", () => {
  const text = formatReport(saved({ issues: ['dropped a strength citing a unit not in the period (x/y/z): "Invented."'] }));
  const lines = text.split("\n");
  assert.equal(lines[0], "week 2026-10-19..2026-10-25  (vs week 2026-10-12..2026-10-18)");
  assert.equal(lines[1], "report in vi  2026-10-22 09:10 · claude-sonnet-5-5 · $0.04");
  assert.equal(lines[2], "the week was not over when this report was written");
  assert.match(lines[3], /^270 XP {2}2 units {2}level \d+/);
  assert.ok(!text.includes("streak"));
  assert.match(text, /\n\noverview:\n {2}A steady week of feature work with `SHA-256` hashing\.\n/);
  assert.match(text, /\n\nhighlights:\n {2}app PR #1 {2}175 XP {2}feature\n {4}It shipped the core\.\n/);
  assert.match(text, /\n\nstrengths:\n {2}- Clear tests\. {2}\[app PR #1\]\n/);
  assert.match(text, /\n\nimprovements:\n {2}- Fewer reverts\. {2}\[app PR #gone · app PR #2\]\n/);
  assert.match(text, /\n\nvalidator:\n {2}dropped a strength citing a unit not in the period \(x\/y\/z\): "Invented\."$/);
});

test("the printed report says when it is stale, what failed to score, what was left out, and what the writer suspected", () => {
  const text = formatReport(
    saved({ inProgress: false, failed: 2, omitted: 3, report: { ...answer(), strengths: [], flags: ["suspected_injection"], notes: "A commit asked for praise." } }),
    { stale: true, again: "evolo report week --previous --again" },
  );
  assert.doesNotMatch(text, /not over/);
  assert.match(text, /^the ledger changed since this report was written: `evolo report week --previous --again` writes it again$/m);
  assert.match(text, /^2 units of this period failed to score and are not in this report: `evolo retry` scores them again$/m);
  assert.match(text, /^3 more units of this period were left out of what the writer read: the least impactful$/m);
  assert.match(text, /^WARNING: the writer suspected prompt injection: A commit asked for praise\.$/m);
  assert.match(text, /\n\nstrengths:\n {2}none\n/);
});

test("a citation of a unit the report does not know is shown by its key", () => {
  const stored = saved();
  const text = formatReport({ ...stored, report: { ...stored.report, strengths: [{ text: "Odd.", units: ["me/zzz/pr-5"] }] } });
  assert.match(text, /- Odd\. {2}\[me\/zzz\/pr-5\]/);
});
