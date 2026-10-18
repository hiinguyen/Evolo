// Turns what the user names (a commit, a pushed range, a PR number) into a unit: the change set Evolo scores.
// A unit is { kind: "push" | "pr", id, base, tip, pr? }; its contribution is the net diff base..tip.
// `base` is null when the range starts at the root commit.
import { execFileSync } from "node:child_process";
import { git } from "./facts.mjs";

const PR_FIELDS = "number,title,body,url,state,baseRefOid,headRefOid,mergeCommit";

const short = (sha) => (sha ? sha.slice(0, 7) : "root");

function resolveCommit(repoDir, rev) {
  try {
    return git(repoDir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`]).trim();
  } catch {
    throw new Error(`not a commit in ${repoDir}: ${JSON.stringify(rev)}`);
  }
}

function hasCommit(repoDir, sha) {
  try {
    resolveCommit(repoDir, sha);
    return true;
  } catch {
    return false;
  }
}

// Merge commits are not work of their own, so a change set without any other commit has nothing to score.
function requireCommits(repoDir, base, tip) {
  const range = base ? [`${base}..${tip}`] : [tip];
  const count = Number(git(repoDir, ["rev-list", "--count", "--no-merges", ...range]).trim());
  if (count === 0) throw new Error(`no commits to score in ${short(base)}..${short(tip)}`);
}

function pushUnit(repoDir, base, tip) {
  requireCommits(repoDir, base, tip);
  return { kind: "push", id: `push-${short(base)}-${short(tip)}`, base, tip };
}

function isAncestor(repoDir, ancestor, descendant) {
  try {
    git(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

// "<from>..<to>": what a push moved the default branch from and to.
// Ref names cannot contain "..", so the first one separates the two ends.
export function rangeUnit(repoDir, range) {
  const at = range.indexOf("..");
  const [from, to] = [range.slice(0, at), range.slice(at + 2)];
  if (at <= 0 || to === "" || to.startsWith(".")) throw new Error(`expected <from>..<to>, got ${JSON.stringify(range)}`);
  const [base, tip] = [resolveCommit(repoDir, from), resolveCommit(repoDir, to)];
  // After a force push the old tip is not an ancestor, and base..tip would also undo the discarded history.
  if (!isAncestor(repoDir, base, tip)) throw new Error(`${from} is not an ancestor of ${to}, so ${range} is not one push`);
  return pushUnit(repoDir, base, tip);
}

// One commit, scored as a push that contained only it.
export function commitUnit(repoDir, rev) {
  const tip = resolveCommit(repoDir, rev);
  const parent = git(repoDir, ["rev-list", "--parents", "-n", "1", tip]).trim().split(" ")[1] ?? null;
  return pushUnit(repoDir, parent, tip);
}

// `pr` is the output of `gh pr view --json ${PR_FIELDS}`.
// The diff runs from the merge base to the PR head, which is the change GitHub shows on the PR,
// whether it was merged with a merge commit, squashed, rebased or fast-forwarded.
export function pullRequestUnit(repoDir, pr) {
  if (pr.state !== "MERGED") throw new Error(`PR #${pr.number} is ${pr.state}; only merged PRs are scored`);
  const tip = resolveCommit(repoDir, pr.headRefOid);
  const base = git(repoDir, ["merge-base", resolveCommit(repoDir, pr.baseRefOid), tip]).trim();
  requireCommits(repoDir, base, tip);
  return {
    kind: "pr",
    id: `pr-${pr.number}`,
    base,
    tip,
    pr: { number: pr.number, title: pr.title, body: pr.body, url: pr.url, mergeCommit: pr.mergeCommit?.oid ?? null },
  };
}

// Reads the PR from GitHub with `gh`, and fetches its head and base from origin when this clone lacks them
// (for example when the PR branch was deleted after the merge).
export function fetchPullRequest(repoDir, number) {
  if (!/^[1-9][0-9]*$/.test(String(number))) throw new Error(`PR number must be a positive integer, got ${JSON.stringify(number)}`);
  let pr;
  try {
    const output = execFileSync("gh", ["pr", "view", String(number), "--json", PR_FIELDS], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    pr = JSON.parse(output);
  } catch (error) {
    throw new Error(`gh pr view ${number} failed: ${String(error.stderr || error.message).trim()}`);
  }
  for (const sha of [pr.headRefOid, pr.baseRefOid].filter((oid) => !hasCommit(repoDir, oid))) {
    git(repoDir, ["fetch", "--quiet", "origin", sha]);
  }
  return pullRequestUnit(repoDir, pr);
}
