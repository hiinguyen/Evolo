// The ledger: one record per scored unit, in <home>/ledger/<owner>/<name>/<unit id>.json.
// A record is { id, repo, kind, status, xp, summary, at, result?, reason?, signals? }; `xp` is what the unit is worth
// now, `result` is evaluateUnit's full output, `signals` what GitHub learnt about the unit after it landed (signals.mjs).
// Records hold facts, scores and reasons, never code.
//
// Status       Counts  Meaning
// scored       yes     judged (or triaged by rule)
// needs_review no      the judge suspected prompt injection
// failed       no      judging failed after every retry
// push_failed  no      the push never reached the remote
// skipped      no      nothing to score: every commit was someone else's, a merge, or part of a merged PR
// superseded   no      a force push removed the unit's commits from the default branch
// reverted     no      every commit of the unit, or its PR's merge commit, was reverted on the default branch
//
// <home>/summary.json caches the user's XP per local day ({ total, xpByDay: { "YYYY-MM-DD": xp } }), rewritten after
// every write to the ledger, so the status line reads one small file instead of the whole ledger. Two processes writing
// at once (the worker and `evolo sync`) can leave it one write behind until the next write or `evolo status`.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { findReverts, isReverted } from "./facts.mjs";
import { jsonFiles, logLine, readJson, writeJson } from "./store.mjs";
import { isAncestor } from "./units.mjs";

const ledgerDir = (home, key) => join(home, "ledger", ...key.split("/"));
const summaryPath = (home) => join(home, "summary.json");
// Statuses a later push can still change: the unit is (or may become) part of the user's total.
const LIVE = new Set(["scored", "needs_review"]);
// Statuses of a unit that was judged; the others (push_failed, failed, skipped) are replaced when the unit comes again,
// for example when a rejected push is pushed again once fixed.
const JUDGED = new Set([...LIVE, "superseded", "reverted"]);

export const isJudged = (record) => Boolean(record) && JUDGED.has(record.status);
export const isLive = (record) => Boolean(record) && LIVE.has(record.status);

export function readRecord(home, key, id) {
  return readJson(join(ledgerDir(home, key), `${id}.json`), null);
}

export function writeRecords(home, key, records) {
  records.forEach((record) => writeJson(join(ledgerDir(home, key), `${record.id}.json`), { ...record, repo: key }));
  // The records are what matters: a summary that cannot be rebuilt (an unreadable record) must not stop scoring.
  try {
    writeSummary(home);
  } catch (error) {
    logLine(home, `summary not updated: ${error.message}`);
  }
}

export function writeRecord(home, key, record) {
  writeRecords(home, key, [record]);
}

export function listRecords(home, key) {
  return jsonFiles(ledgerDir(home, key)).map((name) => readJson(join(ledgerDir(home, key), name), null)).filter(Boolean);
}

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

// Every repository with records, registered or not: uninstalling a repository keeps the XP earned in it.
export function ledgerKeys(home) {
  const root = join(home, "ledger");
  return subdirs(root).flatMap((owner) => subdirs(join(root, owner)).map((name) => `${owner}/${name}`));
}

export function listAllRecords(home) {
  return ledgerKeys(home).flatMap((key) => listRecords(home, key));
}

// "YYYY-MM-DD" of `date` in the local time zone, which is what "today" means to the user.
export function localDay(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// XP counts on the day the unit was scored; a unit reverted later stops counting on that day.
export function summarize(home) {
  const xpByDay = {};
  for (const record of listAllRecords(home)) {
    if (record.status !== "scored") continue;
    const day = localDay(new Date(record.at));
    xpByDay[day] = (xpByDay[day] ?? 0) + record.xp;
  }
  const total = Object.values(xpByDay).reduce((sum, xp) => sum + xp, 0);
  return { total, xpByDay };
}

// Rebuilds the cached summary from the ledger, and returns it.
export function writeSummary(home) {
  const summary = summarize(home);
  writeJson(summaryPath(home), summary);
  return summary;
}

// The cached summary; built from the ledger when the cache is missing (a ledger written before it existed) or unreadable.
export function readSummary(home) {
  try {
    return readJson(summaryPath(home), null) ?? summarize(home);
  } catch {
    return summarize(home);
  }
}

// The ledger record for evaluateUnit's `result`.
export function scoredRecord(result) {
  const { facts } = result;
  const status =
    result.status === "failed" ? "failed"
    : result.status === "needs_review" ? "needs_review"
    : facts.reverted ? "reverted"
    : "scored";
  return {
    id: facts.id,
    kind: facts.kind,
    status,
    xp: status === "scored" ? result.xp : 0,
    summary: result.evaluation?.summary ?? result.failures?.join(" | ") ?? "",
    at: new Date().toISOString(),
    result,
  };
}

// Re-checks the live units of a repository against `head`, the remote default branch, which the clone has.
// Returns the records whose status changed.
export function refreshLedger(home, key, repoDir, head) {
  const reverts = new Map(
    [...findReverts(repoDir)]
      .map(([sha, by]) => [sha, by.filter((revert) => isAncestor(repoDir, revert, head))])
      .filter(([, by]) => by.length > 0),
  );
  const changed = listRecords(home, key)
    .filter((record) => LIVE.has(record.status))
    .map((record) => {
      const { facts } = record.result;
      const status =
        facts.kind === "push" && !isAncestor(repoDir, facts.tip, head) ? "superseded"
        : isReverted(facts.commits.map((commit) => commit.sha), facts.pr?.mergeCommit, reverts) ? "reverted"
        : record.status;
      return status === record.status ? null : { ...record, status, xp: 0, previousStatus: record.status, changedAt: new Date().toISOString() };
    })
    .filter(Boolean);
  if (changed.length > 0) writeRecords(home, key, changed);
  return changed;
}
