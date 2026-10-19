// The repositories Evolo scores on this machine (<home>/repos.json), and `evolo init` / `evolo uninstall`.
// A repository is keyed by its GitHub name, "owner/name"; the clone is identified by its git directory,
// which every worktree of the clone shares.
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { git } from "./facts.mjs";
import { githubLogin, githubRepo, remoteFor } from "./github.mjs";
import { installHook, uninstallHook } from "./hooks.mjs";
import { readJson, writeJson } from "./store.mjs";

const reposPath = (home) => join(home, "repos.json");

export function loadRepos(home) {
  return readJson(reposPath(home), { repos: {} }).repos;
}

function saveRepos(home, repos) {
  writeJson(reposPath(home), { repos });
}

function gitDirOf(repoDir) {
  return resolve(repoDir, git(repoDir, ["rev-parse", "--git-common-dir"]).trim());
}

// The registered repository that `repoDir` is a clone (or a worktree of a clone) of, as { key, ...repo }, or null.
export function findRepo(home, repoDir) {
  const gitDir = gitDirOf(repoDir);
  const match = Object.entries(loadRepos(home)).find(([, repo]) => repo.gitDir === gitDir);
  return match ? { key: match[0], ...match[1] } : null;
}

function checkClaude() {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("the `claude` CLI is not installed or not on PATH; Evolo uses it to judge contributions");
  }
}

// options: { authors: extra author emails, remote: the remote to use instead of the one found from GitHub,
// command: the argv the hook runs Evolo with }.
// Returns the registered repository and the lines `evolo init` prints.
export function initRepo(home, repoDir, { authors = [], remote, command }) {
  checkClaude();
  const path = git(repoDir, ["rev-parse", "--show-toplevel"]).trim();
  const github = githubRepo(path);
  const ownEmail = git(path, ["config", "--default", "", "user.email"]).trim();
  const emails = [...new Set([ownEmail, ...authors].filter(Boolean).map((email) => email.toLowerCase()))];
  if (emails.length === 0) throw new Error("no author email: set `git config user.email` or pass --author");
  const repos = loadRepos(home);
  const previous = repos[github.nameWithOwner];
  const repo = {
    path,
    gitDir: gitDirOf(path),
    remote: remote ?? remoteFor(git(path, ["remote", "-v"]), github.url),
    url: github.url,
    defaultBranch: github.defaultBranchRef.name,
    authors: emails,
    isOwnRepo: github.nameWithOwner.split("/")[0].toLowerCase() === githubLogin(path).toLowerCase(),
    stars: github.stargazerCount ?? 0,
    // Merged PRs are picked up from this moment on; running init again keeps the original moment.
    since: previous?.since ?? new Date().toISOString(),
  };
  const hookNote = installHook(path, command);
  saveRepos(home, { ...repos, [github.nameWithOwner]: repo });
  const notes = [
    hookNote,
    `registered ${github.nameWithOwner}: remote ${repo.remote}, branch ${repo.defaultBranch}, authors ${emails.join(", ")}`,
  ];
  return { key: github.nameWithOwner, repo, notes };
}

// Removes the hook and the registration; the ledger is kept.
export function uninstallRepo(home, repoDir) {
  const notes = [uninstallHook(repoDir)];
  const found = findRepo(home, repoDir);
  if (found) {
    const { [found.key]: removed, ...rest } = loadRepos(home);
    saveRepos(home, rest);
    notes.push(`unregistered ${found.key}; its scores stay in the ledger`);
  }
  return notes;
}
