// Every date below is local time in a fixed zone without daylight saving, so periods and weekdays do not depend on the
// machine. Node applies a TZ set at run time to every Date created afterwards.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA } from "./score.mjs";
import { computeStats, periodOf, streakOf } from "./stats.mjs";

const at = (local) => new Date(`${local}+07:00`);
const day = (date) => `${date}T12:00:00+07:00`;

// A ledger record as the worker writes it, with only the fields the analytics read.
function unit({
  id = "push-a-b", landed, status = "scored", xp = 50, type = "feature", method = "ai", scores = [3, 3, 3, 3, 3],
  repo = "me/a", files = [], commits = [{ date: landed }], testsTouched = false, repoHasTests = true, costUsd = 0.1,
}) {
  const countedLines = files
    .filter((file) => file.class === "source" || file.class === "test")
    .reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const scored = Object.fromEntries(CRITERIA.map((criterion, index) => [criterion, { score: scores[index] }]));
  return {
    id, repo, kind: "push", status, xp, at: landed, landedAt: landed,
    result: {
      method, costUsd,
      evaluation: { contribution_type: type, scores: scored },
      facts: { files, commits, testsTouched, repoHasTests, totals: { countedLines } },
    },
  };
}

const file = (path, cls, lines) => ({ path, class: cls, additions: lines, deletions: 0 });

test("a week runs from Monday to Sunday, a month and a quarter follow the calendar, back steps to earlier ones", () => {
  const wednesday = at("2026-10-21T10:00:00");
  const week = periodOf("week", wednesday);
  assert.equal(week.label, "week 2026-10-19..2026-10-25");
  assert.deepEqual([week.start, week.end], [at("2026-10-19T00:00:00"), at("2026-10-26T00:00:00")]);
  assert.equal(periodOf("week", at("2026-10-25T23:30:00")).label, "week 2026-10-19..2026-10-25", "Sunday ends the week");
  assert.equal(periodOf("week", wednesday, 1).label, "week 2026-10-12..2026-10-18");
  assert.equal(periodOf("month", wednesday).label, "2026-10");
  assert.equal(periodOf("month", at("2027-01-31T23:30:00"), 1).label, "2026-12");
  assert.equal(periodOf("quarter", wednesday).label, "2026 Q4");
  const previousQuarter = periodOf("quarter", at("2027-02-10T08:00:00"), 1);
  assert.equal(previousQuarter.label, "2026 Q4");
  assert.deepEqual([previousQuarter.start, previousQuarter.end], [at("2026-10-01T00:00:00"), at("2027-01-01T00:00:00")]);
  assert.throws(() => periodOf("year", wednesday), /unknown period "year"/);
});

test("periods and streaks follow the calendar across a daylight saving change", () => {
  const zone = process.env.TZ;
  process.env.TZ = "Europe/Berlin"; // clocks went back one hour on Sunday 2026-10-25
  try {
    const week = periodOf("week", new Date(2026, 9, 28, 12));
    assert.deepEqual([week.start, week.end], [new Date(2026, 9, 26), new Date(2026, 10, 2)]);
    assert.equal(periodOf("week", new Date(2026, 9, 28, 12), 1).label, "week 2026-10-19..2026-10-25");
    const worked = ["2026-10-23", "2026-10-26"].map((date) => unit({ landed: new Date(`${date}T12:00:00`).toISOString() }));
    assert.deepEqual(streakOf(worked, new Date(2026, 9, 26, 18)), { current: 2, longest: 2 });
  } finally {
    process.env.TZ = zone;
  }
});

test("a period counts the scored units that landed in it, by type, repository and judge cost", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const records = [
    unit({ id: "u1", landed: day("2026-10-19"), xp: 100, type: "feature", repo: "me/a" }),
    unit({ id: "u2", landed: day("2026-10-20"), xp: 60, type: "bugfix", repo: "me/b" }),
    unit({ id: "u3", landed: day("2026-10-21"), xp: 40, type: "feature", repo: "me/a" }),
    unit({ id: "late-night", landed: "2026-10-25T23:30:00+07:00", xp: 5, type: "docs", repo: "me/b", costUsd: 0 }),
    unit({ id: "last-week", landed: day("2026-10-18"), xp: 500 }),
    unit({ id: "next-week", landed: "2026-10-26T00:00:00+07:00", xp: 500 }),
    unit({ id: "failed", landed: day("2026-10-20"), status: "failed", xp: 0 }),
    unit({ id: "suspicious", landed: day("2026-10-20"), status: "needs_review", xp: 0 }),
    unit({ id: "replaced", landed: day("2026-10-20"), status: "superseded", xp: 0 }),
  ];
  const stats = computeStats(records, week);
  assert.equal(stats.units, 4);
  assert.equal(stats.xp, 205);
  assert.equal(stats.costUsd, 0.3);
  assert.deepEqual(stats.types, [
    { type: "feature", units: 2, xp: 140 },
    { type: "bugfix", units: 1, xp: 60 },
    { type: "docs", units: 1, xp: 5 },
  ]);
  assert.deepEqual(stats.repos, [{ repo: "me/a", units: 2, xp: 140 }, { repo: "me/b", units: 2, xp: 65 }]);
  // Level at the end of the week: every scored unit landed before it, 705 XP, and level L needs 20 × L × (L + 9) XP.
  assert.equal(stats.level, 2);
});

test("rubric averages leave out units triaged by rule, whose scores are fixed", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const stats = computeStats([
    unit({ id: "u1", landed: day("2026-10-19"), scores: [4, 3, 2, 4, 3] }),
    unit({ id: "u2", landed: day("2026-10-20"), scores: [2, 2, 3, 3, 4] }),
    unit({ id: "typo", landed: day("2026-10-20"), method: "rule", scores: [0, 0, 0, 0, 0] }),
  ], week);
  assert.equal(stats.rubric.n, 2);
  assert.deepEqual(stats.rubric.averages, { impact: 3, centrality: 2.5, difficulty: 2.5, quality: 3.5, scope_fit: 3.5 });
  assert.deepEqual(computeStats([], week).rubric, { n: 0, averages: {} });
});

test("test discipline counts only units with code in repositories that have tests", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const code = [file("src/app.js", "source", 10)];
  const stats = computeStats([
    unit({ id: "tested", landed: day("2026-10-19"), files: [...code, file("src/app.test.js", "test", 5)], testsTouched: true }),
    unit({ id: "untested", landed: day("2026-10-19"), files: code }),
    unit({ id: "docs-only", landed: day("2026-10-19"), files: [file("README.md", "docs", 30)] }),
    unit({ id: "no-tests-repo", landed: day("2026-10-19"), files: code, repoHasTests: false }),
  ], week);
  assert.deepEqual(stats.tests, { touched: 1, eligible: 2 });
});

test("stability counts reverted units against scored ones, and leaves out units replaced by a force push", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const stats = computeStats([
    unit({ id: "kept", landed: day("2026-10-19") }),
    unit({ id: "kept-too", landed: day("2026-10-19") }),
    unit({ id: "undone", landed: day("2026-10-20"), status: "reverted", xp: 0 }),
    unit({ id: "replaced", landed: day("2026-10-20"), status: "superseded", xp: 0 }),
    unit({ id: "undone-before", landed: day("2026-10-12"), status: "reverted", xp: 0 }),
  ], week);
  assert.deepEqual(stats.reverts, { reverted: 1, total: 3 });
});

test("lines are grouped by the directory that holds each source or test file, per repository", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const stats = computeStats([
    unit({
      id: "u1", landed: day("2026-10-19"), repo: "me/a",
      files: [
        file("packages/cli/src/a.mjs", "source", 30), file("packages/cli/src/a.test.mjs", "test", 20),
        file("packages/cli/bin/evolo.mjs", "source", 10), file("main.js", "source", 5), file("docs/x.md", "docs", 99),
      ],
    }),
    unit({ id: "u2", landed: day("2026-10-20"), repo: "me/b", files: [file("packages/cli/src/b.mjs", "source", 40)] }),
  ], week);
  assert.deepEqual(stats.dirs, [
    { repo: "me/a", dir: "packages/cli/src", lines: 50 },
    { repo: "me/b", dir: "packages/cli/src", lines: 40 },
    { repo: "me/a", dir: "packages/cli/bin", lines: 10 },
    { repo: "me/a", dir: ".", lines: 5 },
  ]);
});

test("the rhythm counts commits by local hour and weekday, Monday first", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const commits = [
    { date: "2026-10-19T09:15:00+07:00" },
    { date: "2026-10-19T02:15:00Z" }, // 09:15 local
    { date: "2026-10-25T22:00:00+07:00" },
  ];
  const stats = computeStats([unit({ landed: day("2026-10-20"), commits })], week);
  assert.equal(stats.hours.length, 24);
  assert.equal(stats.hours[9], 2);
  assert.equal(stats.hours[22], 1);
  assert.deepEqual(stats.weekdays, [2, 0, 0, 0, 0, 0, 1]);
});

test("a record scored before landedAt existed is placed by its last commit", () => {
  const week = periodOf("week", at("2026-10-21T10:00:00"));
  const scoredLastWeek = unit({ landed: day("2026-10-12"), commits: [{ date: day("2026-10-19") }] });
  const legacy = { ...scoredLastWeek, landedAt: undefined };
  assert.equal(computeStats([legacy], week).units, 1);
});

test("a streak counts workdays in a row; weekends never break it and count when worked", () => {
  const worked = (...days) => days.map((date, index) => unit({ id: `u${index}`, landed: day(date) }));
  const monday = at("2026-10-19T15:00:00");
  assert.deepEqual(streakOf(worked("2026-10-15", "2026-10-16", "2026-10-19"), monday), { current: 3, longest: 3 });
  assert.deepEqual(streakOf(worked("2026-10-15", "2026-10-16", "2026-10-17", "2026-10-19"), monday), { current: 4, longest: 4 });
  // Tuesday the 20th had nothing, so on Wednesday the streak is over.
  assert.deepEqual(streakOf(worked("2026-10-15", "2026-10-16", "2026-10-19"), at("2026-10-21T15:00:00")), { current: 0, longest: 3 });
  // Nothing yet today does not break it: the day is not over.
  assert.deepEqual(streakOf(worked("2026-10-19"), at("2026-10-20T08:00:00")), { current: 1, longest: 1 });
  // Thursday the 1st to Tuesday the 6th, then a gap on Wednesday the 7th.
  const older = worked("2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-19");
  assert.deepEqual(streakOf(older, monday), { current: 1, longest: 4 });
  assert.deepEqual(streakOf([], monday), { current: 0, longest: 0 });
  const reverted = [unit({ landed: day("2026-10-19"), status: "reverted", xp: 0 })];
  assert.deepEqual(streakOf(reverted, monday), { current: 0, longest: 0 });
});
