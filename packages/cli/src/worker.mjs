// The background half of Evolo: the pre-push hook adds a job, one worker per machine scores the queue,
// and a sync after the queue drains picks up merged PRs and re-checks the ledger (docs/auto-scoring.md sections 2-4).
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { achievementsOf, notifyUnlocks } from "./achievements.mjs";
import { BudgetExceededError, assertWithinBudget, isWithinBudget, nextLocalDay } from "./budget.mjs";
import { refreshDashboard } from "./dashboard.mjs";
import { evaluateUnit } from "./evaluate.mjs";
import { git } from "./facts.mjs";
import { listMergedPrs, mergedPrsOfCommits } from "./github.mjs";
import { createJudge } from "./judges/index.mjs";
import { isJudged, isLive, landedAt, listAllRecords, listRecords, localDay, readRecord, readSummary, refreshLedger, scoredRecord, writeRecord, writeRecords } from "./ledger.mjs";
import { acquireLock, addJob, hasSyncRequest, isAlive, isParked, listJobs, removeJob, takeSyncRequest, updateJob } from "./queue.mjs";
import { findRepo, loadRepos } from "./repos.mjs";
import { markupSupported, sendNotification } from "./platform.mjs";
import { logLine } from "./store.mjs";
import { NothingToScoreError, fetchPullRequest, hasCommit, isAncestor, pushedUnit } from "./units.mjs";
import { terminalSafe } from "./safe-text.mjs";
import { collectSignals, withSignals, withUnreadableSignals } from "./signals.mjs";
import { achievementNotification, budgetNotification, notification } from "./views.mjs";

// While `git push` is still running the remote cannot have the commits yet, so landing is checked this often.
const LAND_POLL_MS = 1000;
// A push whose process cannot be watched is given this long to land.
const LAND_TIMEOUT_MS = 10 * 60 * 1000;
// Waits before retrying a job that hit a passing error (network, gh or claude not signed in, a locked ref).
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
// Longest a worker sleeps before looking at the queue again, so a new push never waits behind a retry's delay.
const MAX_IDLE_MS = 5 * 1000;
// Bound on every call to a remote, which can hang on a dead network.
const REMOTE_TIMEOUT_MS = 2 * 60 * 1000;

const ZERO_SHA = /^0+$/;
const short = (sha) => (sha ? sha.slice(0, 7) : "root");

// Reads `git push`'s pre-push input ("<local ref> <local sha> <remote ref> <remote sha>" per line) and queues
// each update of the registered remote's default branch. Pushes to other remotes or branches are not contributions.
export function enqueuePush(home, repoDir, { remote, pusher, input }) {
  const repo = findRepo(home, repoDir);
  if (!repo || remote !== repo.remote) return [];
  const branchRef = `refs/heads/${repo.defaultBranch}`;
  return input
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, localSha, remoteRef]) => remoteRef === branchRef && localSha && !ZERO_SHA.test(localSha))
    .map(([, localSha, remoteRef, remoteSha]) =>
      addJob(home, {
        type: "push",
        repo: repo.key,
        remote,
        ref: remoteRef,
        from: ZERO_SHA.test(remoteSha) ? null : remoteSha,
        to: localSha,
        pusher: pusher ?? null,
      }),
    );
}

// The commit the remote's branch points at, made present in the clone, or null when the branch does not exist.
export function remoteHead(repoDir, remote, branch) {
  const ref = `refs/heads/${branch}`;
  const sha = git(repoDir, ["ls-remote", remote, ref], { timeout: REMOTE_TIMEOUT_MS }).split("\t")[0].trim();
  if (!sha) return null;
  if (!hasCommit(repoDir, sha)) git(repoDir, ["fetch", "--quiet", "--no-write-fetch-head", remote, ref], { timeout: REMOTE_TIMEOUT_MS });
  if (!hasCommit(repoDir, sha)) throw new Error(`fetched ${remote} ${ref} but ${short(sha)} is still missing`);
  return sha;
}

const unitIdOf = (job) => (job.type === "pr" ? `pr-${job.number}` : `push-${short(job.from)}-${short(job.to)}`);

// Best effort: a machine without a notification tool or without a desktop session still scores, and the log has
// every result. The tool itself is the platform's own (src/platform.mjs).
function notify(home, record, totalBefore) {
  send(home, notification(record, totalBefore, { markup: markupSupported() }));
}

function send(home, message) {
  if (!message) return;
  try {
    sendNotification(terminalSafe(`Evolo ${message.title}`), message.body);
  } catch (error) {
    if (error.code !== "ENOENT") logLine(home, `notification failed: ${error.message}`);
  }
}

function finish(home, job, record) {
  const totalBefore = readSummary(home).total;
  writeRecord(home, job.repo, record);
  removeJob(home, job);
  const xp = record.status === "scored" ? ` +${record.xp} XP` : "";
  logLine(home, `${job.repo} ${record.id}: ${record.status}${xp} ${record.summary ?? record.reason ?? ""}`);
  notify(home, { ...record, repo: job.repo }, totalBefore);
  if (record.status === "scored") announceAchievements(home);
}

// Tells the user about the achievement tiers the ledger reaches that were never announced. Best effort, like every
// notification: the record is written, so an unreadable achievements.json is only logged.
function announceAchievements(home) {
  try {
    const unlocks = notifyUnlocks(home, achievementsOf(listAllRecords(home)));
    if (unlocks.length === 0) return;
    logLine(home, `achievement unlocked: ${unlocks.map(({ label }) => label).join(", ")}`);
    send(home, achievementNotification(unlocks, { markup: markupSupported() }));
  } catch (error) {
    logLine(home, `achievements failed: ${error.message}`);
  }
}

const endRecord = (job, status, reason) => ({ id: unitIdOf(job), kind: job.type, status, xp: 0, reason, at: new Date().toISOString(), job });

// Returns "landed", "pending" or "failed". `git push` has finished once its process is gone, so a push that is not on
// the remote by then never will be. The process is checked before the remote, or a push finishing in between would
// look failed. A job marked `pushed` (`evolo retry`) is for a push that ended long ago.
function landing(repo, job) {
  const pushing = job.pusher !== null && isAlive(job.pusher);
  const head = remoteHead(repo.path, job.remote, repo.defaultBranch);
  if (head && isAncestor(repo.path, job.to, head)) return "landed";
  if (job.pushed) return "failed";
  const expired = Date.now() - Date.parse(job.enqueuedAt) > LAND_TIMEOUT_MS;
  return (job.pusher === null || pushing) && !expired ? "pending" : "failed";
}

// The record with the XP signals GitHub has for it now; when GitHub cannot be asked, see withUnreadableSignals.
function addSignals(home, key, repo, record) {
  try {
    return withSignals(record, collectSignals(repo.path, record.result.facts, record.at), repo);
  } catch (error) {
    logLine(home, `${key} ${record.id}: signals not read: ${error.message}`);
    return withUnreadableSignals(record, error);
  }
}

async function scoreUnit(home, job, repo, unit, judge) {
  if (isJudged(readRecord(home, job.repo, unit.id))) return removeJob(home, job);
  const options = { repo: repo.path, url: repo.url, stars: repo.stars, own: repo.isOwnRepo };
  const result = await evaluateUnit({ options, judge, unit, beforeJudging: () => assertWithinBudget(home) });
  // Nothing is wrong with the unit when the judge could not be reached: keep it queued and try again later.
  if (result.judgeUnavailable) throw new Error(`judge unavailable: ${result.failures.at(-1)}`);
  // A push lands when the hook queues it, just before it reaches the remote; a retried unit keeps its first landing.
  const record = scoredRecord(result, { landedAt: result.facts.pr?.mergedAt ?? job.landedAt ?? job.enqueuedAt });
  return finish(home, job, isLive(record) ? addSignals(home, job.repo, repo, record) : record);
}

// Lets the jobs waiting for tomorrow run now when the day's spending is below the cap again: the cap was raised.
function releaseParked(home) {
  const parked = listJobs(home).filter((job) => isParked(job));
  if (parked.length === 0 || !isWithinBudget(home)) return;
  for (const job of parked) updateJob(home, { ...job, budgetDay: null, notBefore: Date.now() });
  logLine(home, `the daily budget allows judging again: ${parked.length} waiting unit(s) released`);
}

function park(home, job, error) {
  const first = !listJobs(home).some((queued) => isParked(queued));
  updateJob(home, { ...job, budgetDay: localDay(new Date()), notBefore: nextLocalDay() });
  logLine(home, `${job.repo} ${unitIdOf(job)}: waits for tomorrow, ${error.message}`);
  if (first) send(home, budgetNotification(error.message));
}

// After a force push the clone may never have had the commit the push replaced; GitHub still serves it by id.
function ensureReplacedCommit(repo, job) {
  if (!job.from || hasCommit(repo.path, job.from)) return true;
  try {
    git(repo.path, ["fetch", "--quiet", "--no-write-fetch-head", job.remote, job.from], { timeout: REMOTE_TIMEOUT_MS });
  } catch {
    return false;
  }
  return hasCommit(repo.path, job.from);
}

async function processPush(home, job, repo, judge) {
  const state = landing(repo, job);
  if (state === "pending") return updateJob(home, { ...job, notBefore: Date.now() + LAND_POLL_MS });
  if (state === "failed") {
    const where = `${job.remote} ${job.ref}`;
    return finish(home, job, endRecord(job, "push_failed", job.pushed ? `${short(job.to)} is no longer on ${where}` : `${short(job.to)} never reached ${where}`));
  }
  if (!ensureReplacedCommit(repo, job)) {
    return finish(home, job, endRecord(job, "failed", `the push replaced ${short(job.from)}, which neither this clone nor ${job.remote} has`));
  }
  const filters = { authors: new Set(repo.authors), mergedPrsOf: (shas) => mergedPrsOfCommits(repo.path, shas) };
  return scoreUnit(home, job, repo, pushedUnit(repo.path, job.from, job.to, filters), judge);
}

async function processPr(home, job, repo, judge) {
  if (isJudged(readRecord(home, job.repo, unitIdOf(job)))) return removeJob(home, job);
  return scoreUnit(home, job, repo, fetchPullRequest(repo.path, job.number, { remote: repo.remote }), judge);
}

async function processJob(home, job, judge) {
  const repo = loadRepos(home)[job.repo];
  if (!repo || !existsSync(repo.path)) {
    logLine(home, `${job.repo}: dropped ${unitIdOf(job)}, the repository is no longer registered or was moved`);
    return removeJob(home, job);
  }
  try {
    return await (job.type === "pr" ? processPr : processPush)(home, job, repo, judge);
  } catch (error) {
    if (error instanceof NothingToScoreError) return finish(home, job, endRecord(job, "skipped", error.message));
    if (error instanceof BudgetExceededError) return park(home, job, error);
    const attempts = job.attempts + 1;
    if (attempts > RETRY_DELAYS_MS.length) return finish(home, job, endRecord(job, "failed", error.message));
    logLine(home, `${job.repo} ${unitIdOf(job)}: attempt ${attempts} failed, retrying: ${error.message}`);
    return updateJob(home, { ...job, attempts, lastError: error.message, notBefore: Date.now() + RETRY_DELAYS_MS[attempts - 1] });
  }
}

// The job that scores a failed record again, from the job the record came from or else from the unit it judged.
// The push ended long ago, so the job does not wait for it to land.
function retryJob(key, repo, record) {
  const facts = record.result?.facts;
  if (record.kind === "pr") return { type: "pr", repo: key, number: record.job?.number ?? facts.pr.number };
  const [from, to] = record.job ? [record.job.from, record.job.to] : [facts.base, facts.tip];
  // The retried unit keeps the day it was pushed on; a record that never reached scoring has only its job.
  const landed = record.job ? (record.job.landedAt ?? record.job.enqueuedAt) : landedAt(record);
  const ref = `refs/heads/${repo.defaultBranch}`;
  return { type: "push", repo: key, remote: repo.remote, ref, from, to, pusher: null, pushed: true, landedAt: landed };
}

// `evolo retry`: makes the jobs waiting to retry after an error due now, and queues every failed unit of the
// registered repositories again. Returns what it did.
export function retryFailed(home) {
  const notes = [];
  const jobs = listJobs(home);
  for (const job of jobs.filter((queued) => queued.attempts > 0)) {
    if (updateJob(home, { ...job, notBefore: Date.now() })) notes.push(`${job.repo} ${unitIdOf(job)}: retrying now`);
  }
  const queued = new Set(jobs.map((job) => `${job.repo} ${unitIdOf(job)}`));
  for (const [key, repo] of Object.entries(loadRepos(home))) {
    for (const record of listRecords(home, key).filter((candidate) => candidate.status === "failed")) {
      const job = retryJob(key, repo, record);
      if (queued.has(`${key} ${unitIdOf(job)}`)) continue;
      addJob(home, job);
      notes.push(`${key} ${record.id}: queued again`);
    }
  }
  return notes;
}

// For one repository: re-checks the ledger against the remote branch, reads the signals of the live units whose signals
// are not final yet, and queues the user's PRs merged since the repository was registered that are neither scored nor
// queued. Returns what it did.
export function syncRepo(home, key, repo) {
  if (!existsSync(repo.path)) return [`${key}: ${repo.path} no longer exists`];
  const notes = [];
  const head = remoteHead(repo.path, repo.remote, repo.defaultBranch);
  if (head) {
    for (const record of refreshLedger(home, key, repo.path, head)) notes.push(`${key} ${record.id}: ${record.previousStatus} -> ${record.status}`);
  }
  const unsettled = listRecords(home, key).filter((record) => isLive(record) && !record.signals?.final);
  const changed = unsettled.map((record) => [record, addSignals(home, key, repo, record)]).filter(([record, signalled]) => signalled !== record);
  if (changed.length > 0) writeRecords(home, key, changed.map(([, signalled]) => signalled));
  for (const [record, signalled] of changed) {
    if (signalled.xp !== record.xp) notes.push(`${key} ${record.id}: signals, ${record.xp} -> ${signalled.xp} XP`);
  }
  const queued = new Set(listJobs(home).filter((job) => job.repo === key && job.type === "pr").map((job) => job.number));
  const known = new Set(listRecords(home, key).map((record) => record.id));
  for (const number of listMergedPrs(repo.path, { base: repo.defaultBranch, since: repo.since })) {
    if (queued.has(number) || known.has(`pr-${number}`)) continue;
    addJob(home, { type: "pr", repo: key, number });
    notes.push(`${key}: queued merged PR #${number}`);
  }
  return notes;
}

export function syncAll(home) {
  return Object.entries(loadRepos(home)).flatMap(([key, repo]) => {
    try {
      return syncRepo(home, key, repo);
    } catch (error) {
      return [`${key}: sync failed: ${error.message}`];
    }
  });
}

// Scores the queue until it is empty, or only jobs waiting for tomorrow's budget are left, then exits. It syncs whenever it has done some work and nothing is in flight
// (no job is new or waiting for its push to land), so a force push is settled before the units it replaced are
// re-checked; jobs waiting to retry after an error do not hold the sync back.
// Returns false when another worker already holds the lock.
export async function runWorker(home, { judge = createJudge({ backend: "claude" }) } = {}) {
  const release = acquireLock(home);
  if (!release) return false;
  try {
    // A new worker syncs once, which is how `evolo sync --background` works; a pending request is part of that sync.
    takeSyncRequest(home);
    let worked = true;
    for (;;) {
      if (takeSyncRequest(home)) worked = true;
      releaseParked(home);
      const jobs = listJobs(home);
      const ready = jobs.find((job) => job.notBefore <= Date.now());
      const inFlight = jobs.some((job) => job.attempts === 0 && !isParked(job));
      if (ready) {
        await processJob(home, ready, judge);
        // Writing the page costs about a second on a ledger of thousands of units, so a burst of jobs writes it once,
        // after the last of them; the sync that follows writes it again with what the sync found.
        if (!listJobs(home).some((job) => job.notBefore <= Date.now())) refreshDashboard(home);
        worked = true;
      } else if (worked && !inFlight) {
        syncAll(home).forEach((note) => logLine(home, note));
        refreshDashboard(home);
        worked = false;
      } else if (jobs.every((job) => isParked(job))) {
        break;
      } else {
        const next = Math.min(...jobs.map((job) => job.notBefore)) - Date.now();
        await sleep(Math.min(Math.max(0, next), MAX_IDLE_MS));
      }
    }
  } finally {
    release();
  }
  // A job queued or a sync requested while this worker was finishing found the lock taken, and its own worker gave up:
  // look once more.
  if (listJobs(home).some((job) => !isParked(job)) || hasSyncRequest(home)) await runWorker(home, { judge });
  return true;
}
