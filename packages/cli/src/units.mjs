// Turns what the user names (a commit, a pushed range, a PR number) into a unit: the change set Evolo scores.
// A unit is { kind: "push" | "pr", id, base, tip, excluded, selected?, pr? }.
// Its contribution is the net diff base..tip, unless some commits in the range are not the user's work:
// then `selected` lists the commits that count, and they are measured one by one (facts.mjs).
// `base` is null when the range starts at the root commit.
import { git } from "./facts.mjs";
import { githubRepo, remoteFor, viewPullRequest } from "./github.mjs";

const short = (sha) => (sha ? sha.slice(0, 7) : "root");

function resolveCommit(repoDir, rev) {
  try {
    return git(repoDir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`]).trim();
  } catch {
    throw new Error(`not a commit in ${repoDir}: ${JSON.stringify(rev)}`);
  }
}

// Thrown when every commit of a change set is someone else's or a merge commit: nothing to judge, and no retry helps.
export class NothingToScoreError extends Error {}

export function hasCommit(repoDir, sha) {
  try {
    resolveCommit(repoDir, sha);
    return true;
  } catch {
    return false;
  }
}

// The merged PR that scores `sha`, or null.
// GitHub links a PR to the commits it brought in, whichever way it was merged (merge commit, squash or rebase),
// but also to commits that were already on its base branch when it was merged: those are not in its diff,
// so they stay with the push or they would be scored nowhere. When the PR's base commit is not in this clone,
// GitHub's link is trusted.
function scoringPr(repoDir, sha, prs) {
  const isBeforePr = ({ base }) => hasCommit(repoDir, base) && isAncestor(repoDir, sha, base);
  return prs.find((pr) => !isBeforePr(pr))?.number ?? null;
}

// Lists the non-merge commits of base..tip, each with the reason it does not count, or null when it does.
// Merge commits are never work of their own.
// authors: lower-case emails that are the user's; omitted means every author counts.
// mergedPrsOf(shas): Map from each sha to the merged PRs GitHub links to it, as [{ number, base }]
// (github.mjs's mergedPrsOfCommits); a commit one of them scores is left to that PR.
function classifyCommits(repoDir, base, tip, { authors, mergedPrsOf } = {}) {
  const range = base ? [`${base}..${tip}`] : [tip];
  const commits = git(repoDir, ["log", "--no-merges", "--reverse", "--format=%H%x1f%ae%x1f%s", ...range])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, email, subject] = line.split("\x1f");
      return { sha, email, subject, isTheirs: Boolean(authors) && !authors.has(email.toLowerCase()) };
    });
  // One lookup for the whole push, and only for the user's own commits.
  const own = commits.filter((commit) => !commit.isTheirs).map((commit) => commit.sha);
  const prsBySha = mergedPrsOf && own.length > 0 ? mergedPrsOf(own) : new Map();
  return commits.map(({ sha, email, subject, isTheirs }) => {
    const pr = isTheirs ? null : scoringPr(repoDir, sha, prsBySha.get(sha) ?? []);
    const reason = isTheirs ? `authored by ${email}` : pr ? `part of merged PR #${pr}` : null;
    return { sha, subject, reason };
  });
}

function changeSet(repoDir, base, tip, filters) {
  const commits = classifyCommits(repoDir, base, tip, filters);
  const excluded = commits.filter((commit) => commit.reason);
  if (excluded.length === commits.length) {
    const why = excluded.map((commit) => `${short(commit.sha)} ${commit.reason}`).join(", ");
    throw new NothingToScoreError(`no commits to score in ${short(base)}..${short(tip)}${why ? `: ${why}` : ""}`);
  }
  const selected = excluded.length > 0 ? { selected: commits.filter((commit) => !commit.reason).map((commit) => commit.sha) } : {};
  return { base, tip, excluded, ...selected };
}

function pushUnit(repoDir, base, tip, filters) {
  return { kind: "push", id: `push-${short(base)}-${short(tip)}`, ...changeSet(repoDir, base, tip, filters) };
}

export function isAncestor(repoDir, ancestor, descendant) {
  try {
    git(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

// "<from>..<to>": what a push moved the default branch from and to.
// Ref names cannot contain "..", so the first one separates the two ends.
// filters: { authors, mergedPrsOf } as in classifyCommits.
export function rangeUnit(repoDir, range, filters = {}) {
  const at = range.indexOf("..");
  const [from, to] = [range.slice(0, at), range.slice(at + 2)];
  if (at <= 0 || to === "" || to.startsWith(".")) throw new Error(`expected <from>..<to>, got ${JSON.stringify(range)}`);
  const [base, tip] = [resolveCommit(repoDir, from), resolveCommit(repoDir, to)];
  // After a force push the old tip is not an ancestor, and base..tip would also undo the discarded history.
  if (!isAncestor(repoDir, base, tip)) throw new Error(`${from} is not an ancestor of ${to}, so ${range} is not one push`);
  return pushUnit(repoDir, base, tip, filters);
}

// What a push to the default branch added: `from` is the commit the remote branch was at (null for a new branch)
// and `to` the commit it was pushed to. After a force push only the commits since the two diverged count;
// the units that scored the discarded commits become superseded (ledger.mjs).
// filters: { authors, mergedPrsOf } as in classifyCommits.
export function pushedUnit(repoDir, from, to, filters = {}) {
  const tip = resolveCommit(repoDir, to);
  if (!from) return pushUnit(repoDir, null, tip, filters);
  const old = resolveCommit(repoDir, from);
  if (isAncestor(repoDir, old, tip)) return pushUnit(repoDir, old, tip, filters);
  let base = null;
  try {
    base = git(repoDir, ["merge-base", old, tip]).trim();
  } catch {
    // Unrelated histories: the push replaced the whole branch.
  }
  return pushUnit(repoDir, base, tip, filters);
}

// One commit, scored as a push that contained only it.
export function commitUnit(repoDir, rev) {
  const tip = resolveCommit(repoDir, rev);
  const parent = git(repoDir, ["rev-list", "--parents", "-n", "1", tip]).trim().split(" ")[1] ?? null;
  return pushUnit(repoDir, parent, tip);
}

// `pr` is the output of github.mjs's viewPullRequest.
// The diff runs from the merge base to the PR head, which is the change GitHub shows on the PR,
// whether it was merged with a merge commit, squashed, rebased or fast-forwarded.
// Only PRs into the default branch are scored: a PR stacked on a feature branch is also part of the PR that later
// brings that branch in, so scoring both would count its work twice.
export function pullRequestUnit(repoDir, pr, { defaultBranch } = {}) {
  if (pr.state !== "MERGED") throw new Error(`PR #${pr.number} is ${pr.state}; only merged PRs are scored`);
  if (defaultBranch && pr.baseRefName !== defaultBranch) {
    throw new Error(`PR #${pr.number} was merged into ${pr.baseRefName}, not ${defaultBranch}; it is scored with the PR that merges ${pr.baseRefName}`);
  }
  const tip = resolveCommit(repoDir, pr.headRefOid);
  const base = git(repoDir, ["merge-base", resolveCommit(repoDir, pr.baseRefOid), tip]).trim();
  return {
    kind: "pr",
    id: `pr-${pr.number}`,
    ...changeSet(repoDir, base, tip),
    pr: { number: pr.number, title: pr.title, body: pr.body, url: pr.url, mergeCommit: pr.mergeCommit?.oid ?? null },
  };
}

// Reads the PR from GitHub with `gh`. When this clone lacks the PR's commits (for example because the PR branch
// was deleted after the merge), fetches them from `remote`, by default the remote that points at the PR's repository,
// which in a clone of a fork is not `origin`.
export function fetchPullRequest(repoDir, number, { remote } = {}) {
  if (!/^[1-9][0-9]*$/.test(String(number))) throw new Error(`PR number must be a positive integer, got ${JSON.stringify(number)}`);
  const pr = viewPullRequest(repoDir, number);
  const repo = githubRepo(repoDir);
  const missing = [pr.headRefOid, pr.baseRefOid].filter((oid) => !hasCommit(repoDir, oid));
  if (missing.length > 0) {
    const from = remote ?? remoteFor(git(repoDir, ["remote", "-v"]), repo.url);
    // refs/pull/<n>/head stays on GitHub after the branch is deleted and carries every commit of the PR.
    git(repoDir, ["fetch", "--quiet", from, `refs/pull/${number}/head`, ...(hasCommit(repoDir, pr.baseRefOid) ? [] : [pr.baseRefOid])]);
  }
  return pullRequestUnit(repoDir, pr, { defaultBranch: repo.defaultBranchRef.name });
}
