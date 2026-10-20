// Everything Evolo asks GitHub, through the user's own `gh` login.
// `gh` resolves the repository from the clone's remotes, honouring `gh repo set-default`.
import { execFileSync } from "node:child_process";

const PR_FIELDS = "number,title,body,url,state,baseRefName,baseRefOid,headRefOid,mergeCommit";

// Every call talks to GitHub, so none may hang forever: the worker would stop scoring.
const GH_TIMEOUT_MS = 2 * 60 * 1000;

function gh(repoDir, args) {
  try {
    return execFileSync("gh", args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GH_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

// Commits asked about in one GraphQL request; GitHub allows far more, this keeps each response small.
const COMMITS_PER_QUERY = 100;

// The GitHub repository this clone belongs to:
// { nameWithOwner: "owner/name", url: "https://github.com/owner/name", defaultBranchRef: { name: "main" }, stargazerCount }.
export function githubRepo(repoDir) {
  return JSON.parse(gh(repoDir, ["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef,stargazerCount"]));
}

// The login `gh` is signed in as.
export function githubLogin(repoDir) {
  return gh(repoDir, ["api", "user", "--jq", ".login"]).trim();
}

// Most PRs listed per sync; a sync runs after every push, so far fewer are ever new.
const PRS_PER_SYNC = 100;

// Numbers of the signed-in user's PRs merged into `base` since the ISO time `since`, oldest first.
export function listMergedPrs(repoDir, { base, since }) {
  const args = ["pr", "list", "--author", "@me", "--state", "merged", "--base", base, "--search", `merged:>=${since.slice(0, 10)}`];
  const prs = JSON.parse(gh(repoDir, [...args, "--json", "number,mergedAt", "--limit", String(PRS_PER_SYNC)]));
  return prs
    .filter((pr) => Date.parse(pr.mergedAt) >= Date.parse(since))
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))
    .map((pr) => pr.number);
}

// "host/owner/name" for any URL form git accepts (https, ssh://, scp-like user@host:path), or null for local paths.
function repoKey(url) {
  const cleaned = url.trim().replace(/\/$/, "").replace(/\.git$/, "");
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(cleaned);
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
  try {
    const parsed = new URL(cleaned);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

// Picks, from `git remote -v` output, the remote that points at the repository at `repoUrl`.
// In a clone of a fork, `origin` is the fork, so the name alone cannot be trusted.
export function remoteFor(remoteList, repoUrl) {
  const wanted = repoKey(repoUrl);
  const match = remoteList
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, target = ""]) => repoKey(target.replace(/ \((fetch|push)\)$/, "")) === wanted);
  if (!match) throw new Error(`no git remote points at ${repoUrl}`);
  return match[0];
}

// For each commit, the merged PRs GitHub links to it, as [{ number, base }] where `base` is the PR's base commit.
// One GraphQL request answers up to COMMITS_PER_QUERY commits, so a long push costs a few calls, not one per commit.
// Commits GitHub does not know yet have no PRs.
export function mergedPrsOfCommits(repoDir, shas) {
  const bad = shas.find((sha) => !/^[0-9a-f]{40,64}$/.test(sha));
  if (bad) throw new Error(`not a full commit id: ${JSON.stringify(bad)}`);
  const [owner, name] = githubRepo(repoDir).nameWithOwner.split("/");
  const result = new Map();
  for (let start = 0; start < shas.length; start += COMMITS_PER_QUERY) {
    const batch = shas.slice(start, start + COMMITS_PER_QUERY);
    const fields = batch
      .map((sha, index) => `c${index}: object(oid: "${sha}") { ... on Commit { associatedPullRequests(first: 10) { nodes { number merged baseRefOid } } } }`)
      .join("\n");
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const output = gh(repoDir, ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`]);
    const repository = JSON.parse(output).data.repository;
    batch.forEach((sha, index) => {
      const pulls = repository[`c${index}`]?.associatedPullRequests.nodes ?? [];
      result.set(sha, pulls.filter((pull) => pull.merged).map((pull) => ({ number: pull.number, base: pull.baseRefOid })));
    });
  }
  return result;
}

export function viewPullRequest(repoDir, number) {
  return JSON.parse(gh(repoDir, ["pr", "view", String(number), "--json", PR_FIELDS]));
}

// Whether a failed `gh` call means GitHub has no such thing (never had it, or deleted it), rather than that GitHub
// could not be asked.
const isNotFound = (error) => /HTTP (404|410)/.test(error.message);

// What GitHub knows about a unit after it landed, for the XP signals (signals.mjs):
// { checks: Map(sha -> CI state of the commit, or null without CI), pr: { author, reviews, commitDates, closingIssues } | null }.
// A CI state is GitHub's combined status of every check and status on the commit: SUCCESS, FAILURE, ERROR, PENDING
// or EXPECTED. `reviews` are [{ author, state, submittedAt }], `closingIssues` [{ number, labels }].
export function unitActivity(repoDir, { shas, pr }) {
  const bad = shas.find((sha) => !/^[0-9a-f]{40,64}$/.test(sha));
  if (bad) throw new Error(`not a full commit id: ${JSON.stringify(bad)}`);
  if (pr !== null && !Number.isInteger(pr)) throw new Error(`not a PR number: ${JSON.stringify(pr)}`);
  const [owner, name] = githubRepo(repoDir).nameWithOwner.split("/");
  const checks = new Map();
  let pull = null;
  for (let start = 0; start === 0 || start < shas.length; start += COMMITS_PER_QUERY) {
    const batch = shas.slice(start, start + COMMITS_PER_QUERY);
    const fields = batch.map((sha, index) => `c${index}: object(oid: "${sha}") { ... on Commit { statusCheckRollup { state } } }`);
    if (start === 0 && pr !== null) {
      fields.push(
        `pr: pullRequest(number: ${pr}) { author { login } ` +
          "reviews(first: 100) { nodes { state submittedAt author { login } } } " +
          "commits(last: 100) { nodes { commit { committedDate } } } " +
          "closingIssuesReferences(first: 25) { nodes { number labels(first: 25) { nodes { name } } } } }",
      );
    }
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join("\n")} } }`;
    const output = gh(repoDir, ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`]);
    const repository = JSON.parse(output).data.repository;
    batch.forEach((sha, index) => checks.set(sha, repository[`c${index}`]?.statusCheckRollup?.state ?? null));
    if (repository.pr) {
      pull = {
        author: repository.pr.author?.login ?? null,
        reviews: repository.pr.reviews.nodes.map((review) => ({ author: review.author?.login ?? null, state: review.state, submittedAt: review.submittedAt })),
        commitDates: repository.pr.commits.nodes.map((node) => node.commit.committedDate),
        closingIssues: repository.pr.closingIssuesReferences.nodes.map((issue) => ({
          number: issue.number,
          labels: issue.labels.nodes.map((label) => label.name),
        })),
      };
    }
  }
  return { checks, pr: pull };
}

// The issue `number` as { number, labels, closedBy }, where `closedBy` is the commit whose message closed it (null when it
// is open or was closed otherwise), or null when the repository has no such issue (a missing number, or a PR).
export function closedIssue(repoDir, number) {
  if (!Number.isInteger(number)) throw new Error(`not an issue number: ${JSON.stringify(number)}`);
  let issue;
  try {
    issue = JSON.parse(gh(repoDir, ["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", "{state, labels: [.labels[].name], pr: (.pull_request != null)}"]));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (issue.pr) return null;
  if (issue.state !== "closed") return { number, labels: issue.labels, closedBy: null };
  // One line per time the issue was closed, oldest first: the commit that closed it, or "" when someone closed it by hand.
  const closers = gh(repoDir, ["api", "--paginate", `repos/{owner}/{repo}/issues/${number}/events?per_page=100`, "--jq", '.[] | select(.event == "closed") | .commit_id // ""']);
  return { number, labels: issue.labels, closedBy: closers.trimEnd().split("\n").at(-1).trim() || null };
}
