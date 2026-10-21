// The dashboard model (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 4), built from a real
// ledger, review store and queue in a temporary EVOLO_HOME. Zone fixed so days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SECRET } from "./achievements/secret.mjs";
import { day, unit as fixtureUnit } from "./achievements/fixtures.mjs";
import { dashboardModel } from "./dashboard.mjs";
import { listAllRecords, summarize, writeRecords } from "./ledger.mjs";
import { addJob, updateJob } from "./queue.mjs";
import { writeReview } from "./review.mjs";
import { levelFor } from "./score.mjs";
import { computeStats, periodOf, streakOf } from "./stats.mjs";
import { writeText } from "./store.mjs";
import { recentXp } from "./views.mjs";

// The fixture has only what the achievements read; the analytics and the page also read the totals.
const unit = (options) => {
  const record = fixtureUnit(options);
  record.result.facts.totals = { files: 0, additions: 0, deletions: 0, countedLines: 0 };
  return record;
};

const NOW = new Date("2026-10-21T13:00:00+07:00");

function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), "evolo-dashboard-"));
  try {
    return run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const seed = (home, records) => {
  for (const key of new Set(records.map((record) => record.repo))) {
    writeRecords(home, key, records.filter((record) => record.repo === key));
  }
};

test("writeText creates a new file with the given mode, keeps the mode of an existing one, leaves no temporary file", () => {
  withHome((home) => {
    const fresh = join(home, "a", "fresh.html");
    writeText(fresh, "one", { mode: 0o600 });
    assert.equal(statSync(fresh).mode & 0o777, 0o600);
    const old = join(home, "old.html");
    writeFileSync(old, "x");
    chmodSync(old, 0o644);
    writeText(old, "two", { mode: 0o600 });
    assert.equal(statSync(old).mode & 0o777, 0o644);
    assert.deepEqual(readdirSync(home).filter((name) => name.startsWith(".tmp-")), []);
    assert.deepEqual(readdirSync(join(home, "a")), ["fresh.html"]);
  });
});

test("level, recent and streak match the functions the terminal uses", () => {
  withHome((home) => {
    const records = [
      unit({ id: "u1", landed: day("2026-10-19"), xp: 120 }),
      unit({ id: "u2", landed: day("2026-10-20"), xp: 80 }),
      unit({ id: "u3", landed: day("2026-10-21"), xp: 60 }),
    ];
    seed(home, records);
    const summary = summarize(home);
    const model = dashboardModel(home, NOW);
    assert.equal(model.version, 1);
    assert.equal(model.generatedAt, NOW.toISOString());
    assert.deepEqual(model.level, { ...levelFor(summary.total), total: summary.total });
    assert.deepEqual(model.recent, recentXp(summary, NOW));
    assert.deepEqual(model.streak, streakOf(listAllRecords(home), NOW));
  });
});

test("a period carries computeStats, ISO bounds and one XP value per day", () => {
  withHome((home) => {
    const records = [
      unit({ id: "u1", landed: day("2026-10-02"), xp: 40 }),
      unit({ id: "u2", landed: day("2026-10-02", "18:00:00"), xp: 10, type: "bugfix" }),
      unit({ id: "u3", landed: day("2026-10-21"), xp: 70 }),
      unit({ id: "u4", landed: day("2026-09-30"), xp: 5 }),
    ];
    seed(home, records);
    const model = dashboardModel(home, NOW);
    const current = model.periods.month.current;
    const expected = computeStats(listAllRecords(home), periodOf("month", NOW, 0));
    assert.equal(current.xp, expected.xp);
    assert.equal(current.units, expected.units);
    assert.deepEqual(current.types, expected.types);
    assert.equal(current.period.label, "2026-10");
    assert.equal(current.period.start, expected.period.start.toISOString());
    assert.equal(current.period.end, expected.period.end.toISOString());
    // October 1 to the 21st, the day of `now`.
    assert.equal(current.days.length, 21);
    assert.deepEqual(current.days[0], { day: "2026-10-01", xp: 0 });
    assert.deepEqual(current.days[1], { day: "2026-10-02", xp: 50 });
    assert.deepEqual(current.days.at(-1), { day: "2026-10-21", xp: 70 });
    // A finished period runs to its last day.
    assert.equal(model.periods.month.previous.days.length, 30);
    assert.equal(model.periods.month.previous.days.at(-1).xp, 5);
    assert.deepEqual(Object.keys(model.periods), ["week", "month", "quarter"]);
  });
});

test("units are newest landing first, with a key and a label", () => {
  withHome((home) => {
    seed(home, [
      unit({ id: "pr-9", kind: "pr", landed: day("2026-10-18") }),
      unit({ id: "push-aaaaaaa-bbbbbbb", landed: day("2026-10-20") }),
      unit({ id: "pr-3", kind: "pr", landed: day("2026-10-19"), repo: "me/b" }),
    ]);
    const { units } = dashboardModel(home, NOW);
    assert.deepEqual(units.map((entry) => entry.key), ["me/a/push-aaaaaaa-bbbbbbb", "me/b/pr-3", "me/a/pr-9"]);
    assert.deepEqual(units.map((entry) => entry.label), ["push aaaaaaa..bbbbbbb", "PR #3", "PR #9"]);
  });
});

test("long or private text of the ledger never enters the model", () => {
  withHome((home) => {
    const record = unit({ id: "pr-4", kind: "pr", landed: day("2026-10-20") });
    record.sessionID = "SESSION-SECRET-1";
    record.result.sessionID = "SESSION-SECRET-2";
    record.result.deniedCommands = ["DENIED-CMD-1"];
    record.result.job = { token: "JOB-SECRET" };
    record.result.evaluation.notes = "JUDGE-NOTES-1";
    record.result.evaluation.summary = "a short summary";
    record.result.facts.pr = { number: 4, title: "PR title", body: "PR-BODY-1", url: "https://example.com/4", mergedAt: day("2026-10-20") };
    record.result.facts.commits = [{ sha: "abc", subject: "subject", body: "COMMIT-BODY-1", date: day("2026-10-20"), revertedBy: [] }];
    seed(home, [record]);
    const text = JSON.stringify(dashboardModel(home, NOW));
    for (const leaked of ["SESSION-SECRET", "DENIED-CMD", "JOB-SECRET", "JUDGE-NOTES", "PR-BODY", "COMMIT-BODY"]) {
      assert.ok(!text.includes(leaked), `${leaked} leaked`);
    }
    for (const kept of ["a short summary", "PR title", "https://example.com/4", "subject"]) assert.ok(text.includes(kept));
  });
});

test("a locked secret achievement is only a count; an unlocked one is shown", () => {
  withHome((home) => {
    seed(home, [unit({ id: "u1", landed: day("2026-10-19") })]);
    const model = dashboardModel(home, NOW);
    const text = JSON.stringify(model);
    const found = model.achievements.secretsFound;
    const locked = SECRET.filter((rule) => !found.some((entry) => entry.id === rule.id));
    assert.ok(locked.length > 0);
    for (const rule of locked) {
      assert.ok(!text.includes(rule.name), `${rule.id} name leaked`);
      assert.ok(!text.includes(rule.description), `${rule.id} description leaked`);
    }
    assert.equal(model.achievements.secretsHidden, locked.length);
    assert.equal(found.length + model.achievements.secretsHidden, SECRET.length);
    // A reverted unit opens one secret, which then shows with its name and the day it opened.
    seed(home, [unit({ id: "u2", landed: day("2026-10-20"), status: "reverted", xp: 0 })]);
    const opened = dashboardModel(home, NOW).achievements;
    const first = opened.secretsFound.find((entry) => entry.id === SECRET[0].id);
    assert.equal(first.name, SECRET[0].name);
    assert.ok(first.at);
    assert.equal(opened.secretsHidden, SECRET.length - opened.secretsFound.length);
  });
});

test("a unit that never reached judging is still listed", () => {
  withHome((home) => {
    const pushFailed = { id: "push-a-b", repo: "me/a", kind: "push", status: "push_failed", xp: 0, summary: "", reason: "rejected", at: day("2026-10-20"), landedAt: day("2026-10-20") };
    const failed = unit({ id: "push-c-d", status: "failed", xp: 0, landed: day("2026-10-19") });
    delete failed.result.evaluation;
    failed.result.failures = ["attempt 1: boom"];
    seed(home, [pushFailed, failed]);
    const { units } = dashboardModel(home, NOW);
    const byId = Object.fromEntries(units.map((entry) => [entry.id, entry]));
    assert.equal(byId["push-a-b"].result, null);
    assert.equal(byId["push-a-b"].reason, "rejected");
    assert.deepEqual(byId["push-c-d"].result.failures, ["attempt 1: boom"]);
    assert.equal(byId["push-c-d"].result.evaluation, undefined);
  });
});

test("a stored review is listed with its label, newest first", () => {
  withHome((home) => {
    seed(home, [unit({ id: "pr-7", kind: "pr", landed: day("2026-10-20") })]);
    const base = { repo: "me/a", tip: "t", language: "en", judge: { backend: "claude", model: "m" }, costUsd: 0.2, durationMs: 1, review: { summary: "ok", findings: [] }, issues: [] };
    writeReview(home, { ...base, unitId: "pr-7", at: "2026-10-20T05:00:00.000Z" });
    writeReview(home, { ...base, unitId: "pr-8", at: "2026-10-21T05:00:00.000Z" });
    const { reviews } = dashboardModel(home, NOW);
    assert.deepEqual(reviews.map((entry) => [entry.key, entry.label]), [["me/a/pr-8", "PR #8"], ["me/a/pr-7", "PR #7"]]);
    assert.equal(reviews[1].language, "en");
    assert.deepEqual(reviews[1].review, base.review);
  });
});

test("jobs parked on today's budget are counted apart from the waiting ones", () => {
  withHome((home) => {
    const parked = addJob(home, { type: "pr", repo: "me/a" });
    updateJob(home, { ...parked, budgetDay: "2026-10-21" });
    const older = addJob(home, { type: "pr", repo: "me/a" });
    updateJob(home, { ...older, budgetDay: "2026-10-20" });
    addJob(home, { type: "push", repo: "me/a" });
    const { queue, budget } = dashboardModel(home, NOW);
    assert.deepEqual(queue, { waiting: 2, parked: 1 });
    assert.equal(typeof budget.limit, "number");
    assert.equal(budget.spent, 0);
  });
});
