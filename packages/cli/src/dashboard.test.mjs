// The dashboard model (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 4), built from a real
// ledger, review store and queue in a temporary EVOLO_HOME. Zone fixed so days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { modelIn, sampleModel } from "../dashboard/fixtures.mjs";
import { parseHash, renderRoute, renderShell } from "../dashboard/app.mjs";
import { SECRET } from "./achievements/secret.mjs";
import { day, unit as fixtureUnit } from "./achievements/fixtures.mjs";
import { bundle, dashboardModel, dashboardPath, MODULES, refreshDashboard, renderPage, STYLES, styles, writeDashboard } from "./dashboard.mjs";
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

test("a unit keeps in its result the XP it was scored at, which a revert takes off the unit itself", () => {
  withHome((home) => {
    const scored = unit({ id: "pr-5", kind: "pr", landed: day("2026-10-20"), xp: 45 });
    seed(home, [{ ...scored, status: "reverted", previousStatus: "scored", xp: 0, result: { ...scored.result, xp: 45 } }]);
    const [only] = dashboardModel(home, NOW).units;
    assert.equal(only.xp, 0);
    assert.equal(only.previousStatus, "scored");
    assert.equal(only.result.xp, 45);
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

const DASHBOARD_DIR = fileURLToPath(new URL("../dashboard/", import.meta.url));
const MODEL_TAG = '<script type="application/json" id="model">';

// The sample model with a summary that tries to close the data block, and one with `String.replace` patterns.
function hostileModel() {
  const model = sampleModel();
  const [first, second, ...rest] = model.units;
  return {
    ...model,
    units: [{ ...first, summary: "</script><script>alert(1)</script><!--" }, { ...second, summary: "keep $& and $' and $1 and $$" }, ...rest],
  };
}

test("renderPage embeds the model once, and text in it cannot close the data block", () => {
  const model = hostileModel();
  const page = renderPage(model, DASHBOARD_DIR);
  assert.equal(page.split(MODEL_TAG).length - 1, 1);
  const from = page.indexOf(MODEL_TAG) + MODEL_TAG.length;
  const block = page.slice(from, page.indexOf("</script>", from));
  assert.ok(!block.includes("<"), "every < of the model is escaped");
  // Read back, the model equals what JSON keeps of it: fields that are undefined are left out.
  assert.deepEqual(modelIn(page), JSON.parse(JSON.stringify(model)));
  assert.equal(modelIn(page).units[0].summary, "</script><script>alert(1)</script><!--");
  assert.equal(modelIn(page).units[1].summary, "keep $& and $' and $1 and $$");
});

test("the page is a complete document that loads nothing from the network", () => {
  const page = renderPage(sampleModel(), DASHBOARD_DIR);
  assert.match(page, /^<!doctype html>\n<html lang="en">/);
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">`));
  assert.ok(page.includes("<title>Evolo</title>"));
  assert.ok(page.includes('<div id="app"></div>'));
  assert.ok(page.includes("<noscript>"));
  assert.ok(!page.includes("/*evolo:"), "every placeholder is filled");
  assert.ok(page.includes(`<style>${styles(DASHBOARD_DIR)}</style>`));
  assert.ok(page.includes(`<script type="module">${bundle(DASHBOARD_DIR)}</script>`));
  assert.ok(!/\b(src|href)="(https?:)?\/\//.test(page), "no remote script, style or font");
});

test("the stylesheets all exist, the shared one comes first, and none loads anything", () => {
  assert.deepEqual(STYLES.filter((name) => !existsSync(join(DASHBOARD_DIR, name))), []);
  assert.equal(STYLES[0], "style.css", "a screen's rules come after the shared rules they narrow");
  assert.equal(new Set(STYLES).size, STYLES.length);
  for (const name of STYLES) {
    const css = readFileSync(join(DASHBOARD_DIR, name), "utf8");
    assert.ok(!/@import/i.test(css), `${name} imports nothing`);
    // Every url() is a data: URL, the one kind the page's policy (img-src data:) lets in.
    for (const [, target] of css.matchAll(/url\(\s*["']?([^"')\s]*)/gi)) assert.match(target, /^data:/, `${name} loads ${target}`);
  }
  const joined = styles(DASHBOARD_DIR);
  assert.ok(STYLES.every((name) => joined.includes(readFileSync(join(DASHBOARD_DIR, name), "utf8"))));
  assert.ok(joined.indexOf(":root {") < joined.indexOf(".level-card {"), "the tokens come first");
  assert.ok(!joined.includes("</style"), "no stylesheet can end the style element");
});

test("bundle joins the drawing modules without import or export, and the result loads as one module", async () => {
  const code = bundle(DASHBOARD_DIR);
  assert.deepEqual(code.split("\n").filter((line) => /^\s*(import|export)\b/.test(line)), []);
  // Text the HTML parser would end the script or the comment state on.
  assert.ok(!code.includes("</script") && !code.includes("<!--"));
  assert.deepEqual(MODULES.filter((name) => !existsSync(join(DASHBOARD_DIR, name))), []);
  const dir = mkdtempSync(join(tmpdir(), "evolo-bundle-"));
  try {
    // Loading it catches a name declared by two modules, a syntax error, or a name a module forgot to import.
    const path = join(dir, "bundle.mjs");
    writeFileSync(path, `${code}\nexport { parseHash, renderRoute, renderShell };\n`);
    const joined = await import(pathToFileURL(path).href);
    const model = sampleModel();
    for (const hash of ["#/", "#/nowhere", "#/timeline?repo=hiinguyen%2Fevolo&status=scored", "#/unit/hiinguyen/ai-orgs/pr-1/score",
      "#/unit/hiinguyen/ai-orgs/pr-1/review", "#/unit/hiinguyen/evolo/pr-7/review", "#/unit/hiinguyen/evolo/pr-7/files", "#/unit/hiinguyen/evolo/pr-7/commits",
      "#/unit/me/gone/pr-1", "#/achievements", "#/reviews", "#/reviews?severity=medium"]) {
      const route = joined.parseHash(hash);
      assert.equal(joined.renderShell(model, route, joined.renderRoute(model, route)), renderShell(model, parseHash(hash), renderRoute(model, parseHash(hash))));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeDashboard writes the page of the ledger to <home>/dashboard.html, readable only by the user", () => {
  withHome((home) => {
    seed(home, [unit({ id: "pr-3", kind: "pr", landed: day("2026-10-20"), xp: 90 })]);
    const path = writeDashboard(home, NOW);
    assert.equal(path, join(home, "dashboard.html"));
    assert.equal(dashboardPath(home), path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const model = modelIn(readFileSync(path, "utf8"));
    assert.deepEqual(model, JSON.parse(JSON.stringify(dashboardModel(home, NOW))));
    assert.deepEqual(model.units.map((entry) => entry.key), ["me/a/pr-3"]);
  });
});

test("refreshDashboard rewrites only a page that exists, and logs instead of throwing", () => {
  withHome((home) => {
    seed(home, [unit({ id: "pr-3", kind: "pr", landed: day("2026-10-20") })]);
    refreshDashboard(home, NOW);
    assert.ok(!existsSync(dashboardPath(home)), "no page is made for a user who never asked for one");

    writeDashboard(home, NOW);
    seed(home, [unit({ id: "pr-4", kind: "pr", landed: day("2026-10-21") })]);
    refreshDashboard(home, NOW);
    assert.deepEqual(modelIn(readFileSync(dashboardPath(home), "utf8")).units.map((entry) => entry.id), ["pr-4", "pr-3"]);

    const before = readFileSync(dashboardPath(home), "utf8");
    mkdirSync(join(home, "ledger", "me", "a"), { recursive: true });
    writeFileSync(join(home, "ledger", "me", "a", "pr-5.json"), "{ not json");
    assert.doesNotThrow(() => refreshDashboard(home, NOW));
    assert.equal(readFileSync(dashboardPath(home), "utf8"), before, "a page that cannot be made leaves the old one");
    assert.match(readFileSync(join(home, "evolo.log"), "utf8"), /dashboard not updated: cannot read .*pr-5\.json/);
  });
});
