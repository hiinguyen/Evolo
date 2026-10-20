// The XP signals (docs/xp-evaluation.md section 7.5): facts GitHub learns about a unit after it lands, which raise
// its XP through `M_signals`. Nothing here uses AI. CI usually finishes after the unit was scored, so a record's signals
// are read again at every sync until they are final, and its XP is recomputed from the stored scores each time.
import { scoreValues } from "./evaluate.mjs";
import { closedIssue, unitActivity } from "./github.mjs";
import { computeXp } from "./score.mjs";

// CI that has not finished this long after the unit was scored is taken as never passing (or never set up).
export const SIGNALS_SETTLE_MS = 24 * 60 * 60 * 1000;
// Issues a push's commit messages may close that are looked up; each one costs two calls to GitHub.
const MAX_REFERENCED_ISSUES = 10;
const FAILED_CI = new Set(["FAILURE", "ERROR"]);
const FINISHED_CI = new Set(["SUCCESS", ...FAILED_CI]);
const BUG_LABEL = /\b(bug|security)\b/i;
// Reviews that say nothing about the PR as merged: not submitted yet, or set aside by a maintainer.
const IGNORED_REVIEWS = new Set(["PENDING", "DISMISSED"]);
// The keywords GitHub closes an issue with when a commit or PR that mentions it reaches the default branch.
const CLOSING_REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

// Numbers of the issues in this repository that `commits` say they close ("Fixes #12"), in order of first mention.
export function referencedIssues(commits) {
  const numbers = commits.flatMap((commit) =>
    [...`${commit.subject}\n${commit.body}`.matchAll(CLOSING_REFERENCE)].map((match) => Number(match[1])),
  );
  return [...new Set(numbers)].slice(0, MAX_REFERENCED_ISSUES);
}

// A PR merged without rework after review: someone other than the author reviewed it, nobody asked for changes,
// and no commit was made after the first review.
function isCleanMerge(pr) {
  const reviews = pr.reviews.filter((review) => review.author !== pr.author && !IGNORED_REVIEWS.has(review.state) && review.submittedAt);
  if (reviews.length === 0 || reviews.some((review) => review.state === "CHANGES_REQUESTED")) return false;
  const firstReview = Math.min(...reviews.map((review) => Date.parse(review.submittedAt)));
  return pr.commitDates.every((date) => Date.parse(date) <= firstReview);
}

// The signals of a unit from what GitHub knows (`activity` from unitActivity, `issues` from closedIssue for a push):
// { ciFirstPass, cleanMerge, closesBugIssue, ci, bugIssues, final }. `ci` is the CI state of the unit's tip.
// CI passed the first time when the tip passed and no commit of the unit failed on the way. GitHub keeps only the
// latest run of each check, so a failed check that passed when run again counts as passed.
// The signals are final once the tip's CI has finished, or SIGNALS_SETTLE_MS after `scoredAt`.
export function readSignals({ facts, activity, issues = [], scoredAt, now = Date.now() }) {
  const ci = activity.checks.get(facts.tip) ?? null;
  const failedOnTheWay = facts.commits.some((commit) => FAILED_CI.has(activity.checks.get(commit.sha)));
  const unitShas = new Set(facts.commits.map((commit) => commit.sha));
  const bugIssues = (
    facts.kind === "pr" ? (activity.pr?.closingIssues ?? []) : issues.filter((issue) => issue && unitShas.has(issue.closedBy))
  )
    .filter((issue) => issue.labels.some((label) => BUG_LABEL.test(label)))
    .map((issue) => issue.number);
  return {
    ciFirstPass: ci === "SUCCESS" && !failedOnTheWay,
    cleanMerge: facts.kind === "pr" && activity.pr !== null && isCleanMerge(activity.pr),
    closesBugIssue: bugIssues.length > 0,
    ci,
    bugIssues,
    final: FINISHED_CI.has(ci) || now - Date.parse(scoredAt) >= SIGNALS_SETTLE_MS,
  };
}

// Asks GitHub for the signals of the unit `facts` describes, scored at the ISO time `scoredAt`.
export function collectSignals(repoDir, facts, scoredAt) {
  const activity = unitActivity(repoDir, { shas: facts.commits.map((commit) => commit.sha), pr: facts.pr?.number ?? null });
  const issues = facts.kind === "pr" ? [] : referencedIssues(facts.commits).map((number) => closedIssue(repoDir, number));
  return { ...readSignals({ facts, activity, issues, scoredAt }), checkedAt: new Date().toISOString() };
}

// The record after GitHub could not be asked for its signals (`error`): as it was, so the next sync tries again, until
// SIGNALS_SETTLE_MS after scoring; then its signals so far become final, so a unit GitHub cannot answer for is not
// asked about at every sync forever.
export function withUnreadableSignals(record, error, now = Date.now()) {
  if (now - Date.parse(record.at) < SIGNALS_SETTLE_MS) return record;
  const none = { ciFirstPass: false, cleanMerge: false, closesBugIssue: false, ci: null, bugIssues: [] };
  return { ...record, signals: { ...none, ...record.signals, final: true, unreadable: error.message, checkedAt: new Date(now).toISOString() } };
}

// The record with `signals` and its XP recomputed from the stored scores; only a scored unit is worth XP.
// `repo` ({ stars, isOwnRepo }) is the registration the unit was scored with.
export function withSignals(record, signals, repo) {
  const { facts, evaluation } = record.result;
  const { xp, breakdown } = computeXp({
    type: evaluation.contribution_type,
    scores: scoreValues(evaluation),
    countedLines: facts.totals.countedLines,
    stars: repo.stars,
    isOwnRepo: repo.isOwnRepo,
    signals: { ...signals, reverted: facts.reverted },
  });
  const worth = record.status === "scored" ? xp : 0;
  return { ...record, xp: worth, signals, result: { ...record.result, xp: worth, breakdown } };
}
