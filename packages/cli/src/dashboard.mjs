// `evolo dashboard` (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md): the model, and the page made from it.
// The model (section 4) is one plain object holding everything the page shows, built from the ledger, the reviews and
// the queue. The page is a function of this object alone, so what is left out here can never reach the HTML.
// Left out on purpose: PR and commit bodies, the judge's `notes`, `sessionID`, `deniedCommands` and `job` are long and
// not shown; a locked secret achievement is only counted, so its name and condition are not in the page source either.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { achievementsOf, unlockedIn } from "./achievements.mjs";
import { dailyBudget } from "./budget.mjs";
import { landedAt, listAllRecords, localDay, summarize } from "./ledger.mjs";
import { isParked, listJobs } from "./queue.mjs";
import { listAllReviews } from "./review.mjs";
import { CRITERIA, levelFor } from "./score.mjs";
import { computeStats, PERIODS, periodOf, streakOf } from "./stats.mjs";
import { logLine, writeText } from "./store.mjs";
import { recentXp, unitLabel } from "./views.mjs";

const newestFirst = (time) => (a, b) => Date.parse(time(b)) - Date.parse(time(a));
const keyOf = (repo, id) => `${repo}/${id}`;

// Every local day of `period` up to `now` (a finished period runs to its last day) with the XP that landed on it.
function daysOf(period, xpByDay, now) {
  const last = Math.min(period.end.getTime() - 1, now.getTime());
  const days = [];
  for (let date = period.start; date.getTime() <= last; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    const day = localDay(date);
    days.push({ day, xp: xpByDay[day] ?? 0 });
  }
  return days;
}

function periodStats(records, xpByDay, kind, now, back) {
  const period = periodOf(kind, now, back);
  const stats = computeStats(records, period);
  return {
    ...stats,
    period: { ...period, start: period.start.toISOString(), end: period.end.toISOString() },
    days: daysOf(period, xpByDay, now),
  };
}

// Only the parts of the judge's answer the page shows; `notes` is long and stays in the ledger.
const evaluationOf = (evaluation) =>
  evaluation && { contribution_type: evaluation.contribution_type, summary: evaluation.summary, scores: evaluation.scores, flags: evaluation.flags };

// A record from an older version, or one that ended early, may have no facts: it still goes into the model.
const factsOf = (facts = {}) => ({
  diffMode: facts.diffMode,
  totals: facts.totals ?? null,
  files: (facts.files ?? []).map(({ path, class: kind, additions, deletions }) => ({ path, class: kind, additions, deletions })),
  commits: (facts.commits ?? []).map(({ sha, subject, date, revertedBy }) => ({ sha, subject, date, revertedBy })),
  excluded: (facts.excluded ?? []).map(({ sha, subject, reason }) => ({ sha, subject, reason })),
  pr: facts.pr ? { number: facts.pr.number, title: facts.pr.title, url: facts.pr.url, mergedAt: facts.pr.mergedAt } : null,
});

// `xp` is what the judge's answer was worth when scored: the unit's own `xp` drops to 0 on a revert or a force push,
// and the page still shows the XP it lost and the formula that gave it.
const resultOf = (result) =>
  result && {
    method: result.method,
    xp: result.xp,
    judge: result.judge,
    costUsd: result.costUsd,
    failures: result.failures,
    issues: result.issues,
    evaluation: evaluationOf(result.evaluation),
    breakdown: result.breakdown,
    facts: factsOf(result.facts),
  };

const unitOf = (record) => ({
  key: keyOf(record.repo, record.id),
  repo: record.repo,
  id: record.id,
  label: unitLabel(record.id),
  kind: record.kind,
  status: record.status,
  previousStatus: record.previousStatus,
  xp: record.xp,
  summary: record.summary,
  reason: record.reason,
  at: record.at,
  landedAt: landedAt(record),
  result: record.result ? resultOf(record.result) : null,
  signals: record.signals,
});

const reviewOf = (stored) => ({
  key: keyOf(stored.repo, stored.unitId),
  repo: stored.repo,
  unitId: stored.unitId,
  label: unitLabel(stored.unitId),
  at: stored.at,
  language: stored.language,
  judge: stored.judge,
  costUsd: stored.costUsd,
  review: stored.review,
  issues: stored.issues,
});

function achievementsModel(records, now) {
  const all = achievementsOf(records);
  const secrets = all.filter((achievement) => achievement.hidden);
  return {
    visible: all.filter((achievement) => !achievement.hidden).map(({ id, name, description, tiers, value, tier, unlocked }) => ({ id, name, description, tiers, value, tier, unlocked })),
    secretsFound: secrets.filter((achievement) => achievement.tier > 0).map(({ id, name, description, unlocked }) => ({ id, name, description, at: unlocked[0].at })),
    secretsHidden: secrets.filter((achievement) => achievement.tier === 0).length,
    recent: unlockedIn(all, periodOf("week", now, 0)).map(({ id, name, label, description, hidden, tier, at }) => ({ id, name, label, description, hidden, tier, at })),
  };
}

export function dashboardModel(home, now = new Date()) {
  const records = listAllRecords(home);
  const summary = summarize(home);
  const jobs = listJobs(home);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    level: { ...levelFor(summary.total), total: summary.total },
    recent: recentXp(summary, now),
    streak: streakOf(records, now),
    budget: dailyBudget(home, now),
    queue: { waiting: jobs.filter((job) => !isParked(job, now)).length, parked: jobs.filter((job) => isParked(job, now)).length },
    criteria: CRITERIA,
    periods: Object.fromEntries(PERIODS.map((kind) => [kind, {
      current: periodStats(records, summary.xpByDay, kind, now, 0),
      previous: periodStats(records, summary.xpByDay, kind, now, 1),
    }])),
    achievements: achievementsModel(records, now),
    units: records.map(unitOf).sort(newestFirst((unit) => unit.landedAt)),
    reviews: listAllReviews(home).map(reviewOf).sort(newestFirst((review) => review.at)),
  };
}

// packages/cli/dashboard: the page's template, its style and the drawing modules, read each time a page is written.
const DASHBOARD_DIR = fileURLToPath(new URL("../dashboard/", import.meta.url));

// The page is opened from file://, where Chrome refuses to load one module from another, so the drawing modules are
// joined into one script: imports from a sibling module and `export` keywords are dropped. Each module keeps to one
// import per line, from siblings only, and no two modules declare the same top-level name; the tests load the result.
const SIBLING_IMPORT = /^import \{[^}]*\} from "\.\/[\w-]+\.mjs";\n/gm;
export const MODULES = ["html.mjs", "charts.mjs", "overview.mjs", "timeline.mjs", "unit.mjs", "analytics.mjs", "achievements.mjs", "reviews.mjs", "app.mjs"];

export function bundle(dir) {
  return MODULES.map((name) => readFileSync(join(dir, name), "utf8").replace(SIBLING_IMPORT, "").replace(/^export /gm, "")).join("\n");
}

// The stylesheets, joined into the page's one <style> in this order: the tokens, the frame and the shared components
// first, then each screen's own rules, so a screen's rule wins over a shared one it narrows.
export const STYLES = ["style.css", "overview.css", "timeline.css", "unit.css", "analytics.css", "achievements.css", "reviews.css"];

export function styles(dir) {
  return STYLES.map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
}

// The page for `model`: the template of `dir` with its styles, the model and the script put in. Each is put in by a
// function, so a `$&` or `$'` in the data is kept as written instead of being read as a replacement pattern. The model
// goes in last, so nothing in the data can be taken for a placeholder. Every `<` in it is written `\u003c`, which JSON
// reads back as `<`, so a `</script>` in a commit subject cannot end the data block.
export function renderPage(model, dir) {
  const template = readFileSync(join(dir, "index.html"), "utf8");
  const style = styles(dir);
  const data = JSON.stringify(model).replace(/</g, "\\u003c");
  return template
    .replace("/*evolo:style*/", () => style)
    .replace("/*evolo:script*/", () => bundle(dir))
    .replace("/*evolo:model*/", () => data);
}

export const dashboardPath = (home) => join(home, "dashboard.html");

// Writes the page of the current ledger, and returns its path. It holds summaries, review text and file paths, so a
// new page is readable by the user alone; one that exists keeps the permissions it has.
export function writeDashboard(home, now = new Date()) {
  const path = dashboardPath(home);
  writeText(path, renderPage(dashboardModel(home, now), DASHBOARD_DIR), { mode: 0o600 });
  return path;
}

// Writes the page again after the data changed, but only for a user who has opened it once: Evolo does not make a file
// nobody asked for. Scoring and reviews never stop for the dashboard, so a failure is only logged.
export function refreshDashboard(home, now = new Date()) {
  if (!existsSync(dashboardPath(home))) return;
  try {
    writeDashboard(home, now);
  } catch (error) {
    logLine(home, `dashboard not updated: ${error.message}`);
  }
}
