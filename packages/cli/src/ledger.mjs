// The ledger: one record per scored unit, in <home>/ledger/<owner>/<name>/<unit id>.json.
// A record is { id, repo, kind, status, xp, summary, at, result?, reason? }; `xp` is what the unit is worth now,
// `result` is evaluateUnit's full output. Records hold facts, scores and reasons, never code.
//
// Status       Counts  Meaning
// scored       yes     judged (or triaged by rule)
// needs_review no      the judge suspected prompt injection
// failed       no      judging failed after every retry
// push_failed  no      the push never reached the remote
// skipped      no      nothing to score: every commit was someone else's, a merge, or part of a merged PR
// superseded   no      a force push removed the unit's commits from the default branch
// reverted     no      every commit of the unit, or its PR's merge commit, was reverted on the default branch
import { join } from "node:path";
import { findReverts, isReverted } from "./facts.mjs";
import { jsonFiles, readJson, writeJson } from "./store.mjs";
import { isAncestor } from "./units.mjs";

const ledgerDir = (home, key) => join(home, "ledger", ...key.split("/"));
// Statuses a later push can still change: the unit is (or may become) part of the user's total.
const LIVE = new Set(["scored", "needs_review"]);
// Statuses of a unit that was judged; the others (push_failed, failed, skipped) are replaced when the unit comes again,
// for example when a rejected push is pushed again once fixed.
const JUDGED = new Set([...LIVE, "superseded", "reverted"]);

export const isJudged = (record) => Boolean(record) && JUDGED.has(record.status);

export function readRecord(home, key, id) {
  return readJson(join(ledgerDir(home, key), `${id}.json`), null);
}

export function writeRecord(home, key, record) {
  writeJson(join(ledgerDir(home, key), `${record.id}.json`), { ...record, repo: key });
}

export function listRecords(home, key) {
  return jsonFiles(ledgerDir(home, key)).map((name) => readJson(join(ledgerDir(home, key), name), null)).filter(Boolean);
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
  changed.forEach((record) => writeRecord(home, key, record));
  return changed;
}
