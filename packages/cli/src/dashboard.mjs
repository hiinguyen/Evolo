// The model behind `evolo dashboard` (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 4): one plain
// object holding everything the page shows, built from the ledger, the reviews and the queue. The page is a function of
// this object alone, so what is left out here can never reach the HTML.
// Left out on purpose: PR and commit bodies, the judge's `notes`, `sessionID`, `deniedCommands` and `job` are long and
// not shown; a locked secret achievement is only counted, so its name and condition are not in the page source either.
import { achievementsOf, unlockedIn } from "./achievements.mjs";
import { dailyBudget } from "./budget.mjs";
import { landedAt, listAllRecords, localDay, summarize } from "./ledger.mjs";
import { isParked, listJobs } from "./queue.mjs";
import { listAllReviews } from "./review.mjs";
import { CRITERIA, levelFor } from "./score.mjs";
import { computeStats, PERIODS, periodOf, streakOf } from "./stats.mjs";
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

const factsOf = (facts) => ({
  diffMode: facts.diffMode,
  totals: facts.totals,
  files: (facts.files ?? []).map(({ path, class: kind, additions, deletions }) => ({ path, class: kind, additions, deletions })),
  commits: (facts.commits ?? []).map(({ sha, subject, date, revertedBy }) => ({ sha, subject, date, revertedBy })),
  excluded: (facts.excluded ?? []).map(({ sha, subject, reason }) => ({ sha, subject, reason })),
  pr: facts.pr ? { number: facts.pr.number, title: facts.pr.title, url: facts.pr.url, mergedAt: facts.pr.mergedAt } : null,
});

const resultOf = (result) =>
  result && {
    method: result.method,
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
