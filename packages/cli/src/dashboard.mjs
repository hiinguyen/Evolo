// `evolo dashboard` (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md): the model, and the page made from it.
// The model (section 4) is one plain object holding everything the page shows, built from the ledger, the reviews, the
// reports and the queue. The page is a function of this object alone, so what is left out here can never reach the HTML.
// Left out on purpose: PR and commit bodies, the judge's `notes`, `sessionID`, `deniedCommands` and `job` are long and
// not shown; a locked secret achievement is only counted, so its name, condition and drawing are not in the page source
// either.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { achievementsOf, unlockedIn } from "./achievements.mjs";
import { secretIcon } from "./achievements/secret-icons.mjs";
import { dailyBudget } from "./budget.mjs";
import { getConfig } from "./config.mjs";
import { landedAt, listAllRecords, localDay, summarize } from "./ledger.mjs";
import { isParked, listJobs } from "./queue.mjs";
import { nextRankFor, rankFor } from "./rank.mjs";
import { basisOf, listAllReports } from "./report.mjs";
import { listAllReviews } from "./review.mjs";
import { CRITERIA, levelFor, xpForLevel } from "./score.mjs";
import { computeStats, PERIODS, periodOf, streakOf } from "./stats.mjs";
import { logLine, writeText } from "./store.mjs";
import { recentXp, unitLabel } from "./views.mjs";
import { bootScript } from "../dashboard/theme.mjs";
import { BRAND_MARK } from "../dashboard/brand.mjs";

const newestFirst = (time) => (a, b) => Date.parse(time(b)) - Date.parse(time(a));
const keyOf = (repo, id) => `${repo}/${id}`;
// The version of the package the page was written from, shown in the sidebar's brand.
const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
// The tab icon carries the same drawing as the sidebar brand, so there is no second image to keep in step.
const FAVICON = `data:image/svg+xml,${encodeURIComponent(BRAND_MARK)}`;

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
const factsOf = (given) => {
  const facts = given ?? {};
  return {
    diffMode: facts.diffMode,
    totals: facts.totals ?? null,
    files: (facts.files ?? []).map(({ path, class: kind, additions, deletions }) => ({ path, class: kind, additions, deletions })),
    commits: (facts.commits ?? []).map(({ sha, subject, date, revertedBy }) => ({ sha, subject, date, revertedBy })),
    excluded: (facts.excluded ?? []).map(({ sha, subject, reason }) => ({ sha, subject, reason })),
    pr: facts.pr ? { number: facts.pr.number, title: facts.pr.title, url: facts.pr.url, mergedAt: facts.pr.mergedAt } : null,
  };
};

// `xp` is what the judge's answer was worth when scored: the unit's own `xp` drops to 0 on a revert or a force push,
// and the page still shows the XP it lost and the formula that gave it.
const resultOf = (result) =>
  result && {
    method: result.method,
    xp: result.xp,
    judge: result.judge,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
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
  durationMs: stored.durationMs,
  review: stored.review,
  issues: stored.issues,
});

// Only what the Reports screen shows of a period's numbers; the rest stays in the saved report.
const reportNumbers = ({ period, xp, units, level }) => ({ label: period.label, xp, units, level });

// The command that writes the report of the period starting at `start` again, or null for a period `evolo report` no
// longer reaches: it writes only this period and the one before it.
function againCommand(kind, start, now) {
  const back = [0, 1].find((step) => periodOf(kind, now, step).start.getTime() === Date.parse(start));
  if (back === undefined) return null;
  return `evolo report ${kind}${back === 1 ? " --previous" : ""} --again`;
}

// A saved report as the page shows it, with whether the ledger changed since it was written. The full statistics stay
// in the file: the Analytics screen has them for the current and the previous periods.
function reportOf(stored, { records, reviews, achievements, now }) {
  const period = { kind: stored.kind, start: new Date(stored.start), end: new Date(stored.end) };
  const { overview, highlights, strengths, improvements, flags, notes } = stored.report;
  return {
    id: stored.id, kind: stored.kind, label: stored.label, start: stored.start, end: stored.end, inProgress: stored.inProgress,
    at: stored.at, language: stored.language, judge: stored.judge, costUsd: stored.costUsd, durationMs: stored.durationMs,
    failed: stored.failed, omitted: stored.omitted, unlocked: stored.unlocked,
    numbers: { current: reportNumbers(stored.numbers.current), previous: reportNumbers(stored.numbers.previous) },
    units: stored.units,
    report: { overview, highlights, strengths, improvements, flags, notes },
    issues: stored.issues,
    stale: stored.basis !== basisOf(records, reviews, period, achievements),
    again: againCommand(stored.kind, stored.start, now),
  };
}

// Every saved report the page can show. A file in another shape (edited by hand, or from another version) is left out
// and logged, so it cannot keep the rest of the page from being written.
function reportsModel(home, context) {
  return listAllReports(home).flatMap((stored) => {
    try {
      return [reportOf(stored, context)];
    } catch (error) {
      logLine(home, `dashboard: left out the report ${stored.id ?? "without an id"}: ${error.message}`);
      return [];
    }
  });
}

// The latest period first; of two starting on one day, the report written last.
const byPeriod = (a, b) => Date.parse(b.start) - Date.parse(a.start) || Date.parse(b.at) - Date.parse(a.at);

function achievementsModel(records, now) {
  const all = achievementsOf(records);
  const secrets = all.filter((achievement) => achievement.hidden);
  return {
    visible: all.filter((achievement) => !achievement.hidden).map(({ id, name, description, tiers, value, tier, unlocked }) => ({ id, name, description, tiers, value, tier, unlocked })),
    // A secret carries its drawing only once it is found: a locked one stays a number, not art that would hint at it.
    secretsFound: secrets.filter((achievement) => achievement.tier > 0).map(({ id, name, description, unlocked }) => ({ id, name, description, icon: secretIcon(id), at: unlocked[0].at })),
    secretsHidden: secrets.filter((achievement) => achievement.tier === 0).length,
    recent: unlockedIn(all, periodOf("week", now, 0)).map(({ id, name, label, description, hidden, tier, at }) => ({ id, name, label, description, hidden, tier, at, ...(hidden ? { icon: secretIcon(id) } : {}) })),
  };
}

export function dashboardModel(home, now = new Date()) {
  const records = listAllRecords(home);
  const summary = summarize(home);
  const jobs = listJobs(home);
  const reviews = listAllReviews(home);
  const level = levelFor(summary.total);
  const nextRank = nextRankFor(level.level);
  // A review is of one unit: the card can show the XP and status that unit is worth now, without a second lookup in the
  // page. A unit that left the ledger keeps the review with null facts, as the Review tab does.
  const unitsByKey = new Map(records.map((record) => [keyOf(record.repo, record.id), record]));
  return {
    version: 1,
    appVersion: APP_VERSION,
    generatedAt: now.toISOString(),
    theme: getConfig(home, "dashboard.theme"),
    name: getConfig(home, "dashboard.name"),
    level: { ...level, total: summary.total },
    rank: rankFor(level.level),
    nextRank: nextRank
      ? { name: nextRank.name, effect: nextRank.effect, deep: nextRank.deep ?? false, level: nextRank.min, xp: xpForLevel(nextRank.min) }
      : null,
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
    reviews: reviews.map((stored) => {
      const review = reviewOf(stored);
      const unit = unitsByKey.get(review.key);
      return { ...review, kind: unit?.kind ?? null, xp: unit?.xp ?? null, status: unit?.status ?? null };
    }).sort(newestFirst((review) => review.at)),
    reports: reportsModel(home, { records, reviews, achievements: achievementsOf(records), now }).sort(byPeriod),
  };
}

// packages/cli/dashboard: the page's template, its style and the drawing modules, read each time a page is written.
const DASHBOARD_DIR = fileURLToPath(new URL("../dashboard/", import.meta.url));

// The page is opened from file://, where Chrome refuses to load one module from another, so the drawing modules are
// joined into one script: imports from a sibling module and `export` keywords are dropped. Each module keeps to one
// import per line, from siblings only, and no two modules declare the same top-level name; the tests load the result.
const SIBLING_IMPORT = /^import \{[^}]*\} from "\.\/[\w-]+\.mjs";\n/gm;
export const MODULES = ["html.mjs", "charts.mjs", "icons.mjs", "brand.mjs", "theme.mjs", "overview.mjs", "timeline.mjs", "unit.mjs", "analytics.mjs", "achievements.mjs", "reviews.mjs", "reports.mjs", "app.mjs"];

export function bundle(dir) {
  return MODULES.map((name) => readFileSync(join(dir, name), "utf8").replace(SIBLING_IMPORT, "").replace(/^export /gm, "")).join("\n");
}

// The stylesheets, joined into the page's one <style> in this order: the tokens, the frame and the shared components
// first, then each screen's own rules, so a screen's rule wins over a shared one it narrows.
export const STYLES = ["style.css", "overview.css", "timeline.css", "unit.css", "analytics.css", "achievements.css", "reviews.css", "reports.css"];

export function styles(dir) {
  return STYLES.map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
}

// Only the scripts the page carries may run: the boot script in <head> and the module that draws it, each named by the
// SHA-256 of its exact text, so markup that gets into the page through a future escaping mistake cannot run. Styles stay
// inline because the screens set `style="width:..."`. The JSON model block is `type="application/json"`, which is data
// and never executed, so it needs no hash.
export function contentSecurityPolicy(scripts) {
  const hash = (script) => `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;
  return `default-src 'none'; script-src ${scripts.map(hash).join(" ")}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
}

// The page for `model`: the template of `dir` with its theme boot script, styles, model and script put in. Each is put in
// by a function, so a `$&` or `$'` in the data is kept as written instead of being read as a replacement pattern. The
// model goes in last, so nothing in the data can be taken for a placeholder. Every `<` in it is written `\u003c`, which
// JSON reads back as `<`, so a `</script>` in a commit subject cannot end the data block.
export function renderPage(model, dir) {
  const template = readFileSync(join(dir, "index.html"), "utf8");
  const boot = bootScript(model.theme);
  const style = styles(dir);
  const script = bundle(dir);
  const data = JSON.stringify(model).replace(/</g, "\\u003c");
  return template
    .replace("/*evolo:csp*/", () => contentSecurityPolicy([boot, script]))
    .replace("/*evolo:icon*/", () => FAVICON)
    .replace("/*evolo:boot*/", () => boot)
    .replace("/*evolo:style*/", () => style)
    .replace("/*evolo:script*/", () => script)
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
