// The end-to-end sandbox: a real clone with a bare repository as its remote, the real pre-push hook and a real
// background worker. Only `gh`, `claude` and `notify-send` are stand-ins (fakes/), put first on PATH.
// Imported by the end-to-end tests; the sandboxes are removed after the test file that made them.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after } from "node:test";
import { readRecord } from "./ledger.mjs";
import { listJobs, updateJob } from "./queue.mjs";

export const BIN = fileURLToPath(new URL("../bin/evolo.mjs", import.meta.url));
const FAKES = fileURLToPath(new URL("../fakes/", import.meta.url));
export const REPO = "me/proj";
const WAIT_MS = 30 * 1000;

const sandboxes = [];
after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

export const lines = (count, tag) => Array.from({ length: count }, (_, index) => `${tag} ${index}`).join("\n") + "\n";

export function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "evolo-e2e-"));
  sandboxes.push(dir);
  const [home, bin, remote, work] = ["home", "bin", "remote.git", "work"].map((name) => join(dir, name));
  mkdirSync(bin);
  for (const [name, script] of [["gh", "gh.mjs"], ["claude", "claude.mjs"], ["notify-send", "notify-send.mjs"]]) {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${join(FAKES, script)}' "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const ghState = join(dir, "gh.json");
  const github = {
    repo: { nameWithOwner: REPO, url: "https://github.com/me/proj", defaultBranchRef: { name: "main" }, stargazerCount: 3 },
    login: "me",
    prs: [],
    commitPrs: {},
  };
  writeFileSync(ghState, JSON.stringify(github));
  const claudeLog = join(dir, "claude.log");
  const notifyLog = join(dir, "notify.log");
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, EVOLO_HOME: home, FAKE_GH: ghState, FAKE_CLAUDE_LOG: claudeLog, FAKE_NOTIFY_LOG: notifyLog,
  };
  delete env.EVOLO_JUDGE;

  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  const git = (...args) => execFileSync("git", args, { cwd: work, env, encoding: "utf8" }).trim();
  git("config", "user.name", "Dev");
  git("config", "user.email", "dev@example.com");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", remote);

  const commit = (message, files) => {
    for (const [path, content] of Object.entries(files)) writeFileSync(join(work, path), content);
    git("add", ...Object.keys(files));
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const push = (args, extraEnv = {}) => spawnSync("git", ["push", "-q", ...args], { cwd: work, env: { ...env, ...extraEnv }, encoding: "utf8" });
  const evolo = (...args) => execFileSync(process.execPath, [BIN, ...args], { cwd: work, env, encoding: "utf8" });
  // Like `evolo`, for a command expected to fail: returns { status, stdout, stderr } instead of throwing.
  const evoloRun = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: work, env, encoding: "utf8" });
  const setGithub = (change) => writeFileSync(ghState, JSON.stringify({ ...github, ...change }));
  const judgeCalls = () => (existsSync(claudeLog) ? readFileSync(claudeLog, "utf8").split("\n").filter(Boolean).length : 0);

  const setClaudeDown = (down) => (down ? writeFileSync(`${claudeLog}.down`, "") : rmSync(`${claudeLog}.down`, { force: true }));
  const setClaudeInvalid = (invalid) => (invalid ? writeFileSync(`${claudeLog}.invalid`, "") : rmSync(`${claudeLog}.invalid`, { force: true }));
  const setClaudeBadPath = (bad) => (bad ? writeFileSync(`${claudeLog}.badpath`, "") : rmSync(`${claudeLog}.badpath`, { force: true }));
  // The first line of every task the fake judge was given, in order.
  const judgeTasks = () => (existsSync(claudeLog) ? readFileSync(claudeLog, "utf8").split("\n").filter(Boolean) : []);
  const notifications = () => (existsSync(notifyLog) ? readFileSync(notifyLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const lockPath = join(home, "worker.lock");

  // Polls `check` until it returns something truthy, failing with the log after WAIT_MS.
  const waitFor = async (check, what) => {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const found = check();
      if (found) return found;
      if (Date.now() > deadline) {
        const log = existsSync(join(home, "evolo.log")) ? readFileSync(join(home, "evolo.log"), "utf8") : "(no log)";
        assert.fail(`${what()}; log:\n${log}`);
      }
      await sleep(100);
    }
  };
  // Waits until the background worker has written `id` with one of `statuses`, and has then finished and exited.
  const settled = (id, statuses = ["scored"]) =>
    waitFor(
      () => {
        const record = readRecord(home, REPO, id);
        const idle = listJobs(home).length === 0 && !existsSync(lockPath);
        return record && statuses.includes(record.status) && idle && record;
      },
      () => `${id} did not reach ${statuses.join("/")} (now ${readRecord(home, REPO, id)?.status ?? "absent"})`,
    );
  // Waits until the only queued job has failed `attempts` times with an error matching `pattern`.
  const retrying = (attempts, pattern) =>
    waitFor(
      () => {
        const [job, ...others] = listJobs(home);
        return others.length === 0 && job?.attempts === attempts && pattern.test(job.lastError) && job;
      },
      () => `no job retrying for the ${attempts} time with ${pattern}: ${JSON.stringify(listJobs(home))}`,
    );
  // Kills the worker the way a crash or a power cut would, leaving its lock behind.
  const crashWorker = () => process.kill(Number(readFileSync(lockPath, "utf8")), "SIGKILL");
  // Makes every queued job due now, and starts a worker in the background, as the next push would.
  const retryNow = () => {
    listJobs(home).forEach((job) => updateJob(home, { ...job, notBefore: 0 }));
    spawn(process.execPath, [BIN, "worker"], { cwd: work, env, stdio: "ignore", detached: true }).unref();
  };
  return {
    home, remote, work, git, commit, push, evolo, evoloRun, setGithub, setClaudeDown, setClaudeInvalid, setClaudeBadPath, judgeCalls, judgeTasks,
    notifications,
    settled, retrying, crashWorker, retryNow, lockPath, waitFor,
  };
}

export const short = (sha) => sha.slice(0, 7);
