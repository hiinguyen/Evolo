// Everything Evolo asks GitHub, through the user's own `gh` login.
// `gh` resolves the repository from the clone's remotes, honouring `gh repo set-default`.
import { execFileSync } from "node:child_process";

const PR_FIELDS = "number,title,body,url,state,baseRefName,baseRefOid,headRefOid,mergeCommit";

function gh(repoDir, args) {
  try {
    return execFileSync("gh", args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

// Commits asked about in one GraphQL request; GitHub allows far more, this keeps each response small.
const COMMITS_PER_QUERY = 100;

// The GitHub repository this clone belongs to:
// { nameWithOwner: "owner/name", url: "https://github.com/owner/name", defaultBranchRef: { name: "main" } }.
export function githubRepo(repoDir) {
  return JSON.parse(gh(repoDir, ["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef"]));
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
