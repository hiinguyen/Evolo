// End to end: a real clone with a bare repository as its remote, the real pre-push hook and a real background
// worker. Only `gh` and `claude` are stand-ins (fakes/gh.mjs, fakes/claude.mjs), put first on PATH.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { listRecords, readRecord } from "./ledger.mjs";
import { listJobs, updateJob } from "./queue.mjs";
import { loadRepos } from "./repos.mjs";

const BIN = fileURLToPath(new URL("../bin/evolo.mjs", import.meta.url));
const FAKES = fileURLToPath(new URL("../fakes/", import.meta.url));
const REPO = "me/proj";
const WAIT_MS = 30 * 1000;

const sandboxes = [];
after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const lines = (count, tag) => Array.from({ length: count }, (_, index) => `${tag} ${index}`).join("\n") + "\n";

function makeSandbox() {
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
  const setGithub = (change) => writeFileSync(ghState, JSON.stringify({ ...github, ...change }));
  const judgeCalls = () => (existsSync(claudeLog) ? readFileSync(claudeLog, "utf8").split("\n").filter(Boolean).length : 0);

  const setClaudeDown = (down) => (down ? writeFileSync(`${claudeLog}.down`, "") : rmSync(`${claudeLog}.down`, { force: true }));
  const setClaudeInvalid = (invalid) => (invalid ? writeFileSync(`${claudeLog}.invalid`, "") : rmSync(`${claudeLog}.invalid`, { force: true }));
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
    home, remote, work, git, commit, push, evolo, setGithub, setClaudeDown, setClaudeInvalid, judgeCalls, notifications,
    settled, retrying, crashWorker, retryNow, lockPath, waitFor,
  };
}

const short = (sha) => sha.slice(0, 7);

test("init chains an existing pre-push hook, every push still reaches it, and uninstall restores it", async () => {
  const box = makeSandbox();
  const seen = join(box.work, "..", "previous-hook-saw");
  const previous = `#!/bin/sh\ncat > '${seen}'\nexit 0\n`;
  writeFileSync(join(box.work, ".git/hooks/pre-push"), previous);
  chmodSync(join(box.work, ".git/hooks/pre-push"), 0o755);

  const output = box.evolo("init", "--remote", "origin");
  assert.match(output, /keeping the previous hook as pre-push.evolo-chained/);
  assert.deepEqual(loadRepos(box.home)[REPO].authors, ["dev@example.com"]);

  const first = box.commit("feat: start", { "app.js": lines(20, "app") });
  assert.equal(box.push(["origin", "main"]).status, 0);
  assert.match(readFileSync(seen, "utf8"), new RegExp(`refs/heads/main ${first} refs/heads/main 0{40}`));
  const record = await box.settled(`push-root-${short(first)}`);
  assert.ok(record.xp > 0);

  assert.match(box.evolo("uninstall"), /restored the previous hook/);
  assert.equal(readFileSync(join(box.work, ".git/hooks/pre-push"), "utf8"), previous);
  assert.deepEqual(loadRepos(box.home), {});
  assert.equal(listRecords(box.home, REPO).length, 1, "the ledger is kept");
});

test("a push to the default branch is scored once it lands, as one change set; other pushes are not", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);

  box.commit("feat: helper", { "helper.js": lines(30, "helper") });
  const tip = box.commit("feat: use helper", { "app.js": lines(25, "app") });
  box.push(["origin", "main"]);
  const record = await box.settled(`push-${short(base)}-${short(tip)}`);
  assert.equal(record.result.facts.diffMode, "net");
  assert.deepEqual(record.result.facts.commits.map((commit) => commit.subject), ["feat: helper", "feat: use helper"]);
  assert.equal(record.result.facts.totals.countedLines, 35);
  assert.equal(box.judgeCalls(), 2);

  box.git("checkout", "-q", "-b", "topic");
  box.commit("feat: topic", { "topic.js": lines(5, "topic") });
  box.push(["origin", "topic"]);
  box.git("checkout", "-q", "main");
  box.commit("feat: from a judge", { "judge.js": lines(5, "judge") });
  box.push(["origin", "main"], { EVOLO_JUDGE: "1" });
  assert.deepEqual(listJobs(box.home), [], "a feature branch and a push made under a judge are not queued");
  assert.equal(listRecords(box.home, REPO).length, 2);
});

test("a rejected push is recorded as push_failed without calling the judge", async () => {
  const box = makeSandbox();
  writeFileSync(join(box.remote, "hooks/pre-receive"), "#!/bin/sh\necho rejected by policy >&2\nexit 1\n");
  chmodSync(join(box.remote, "hooks/pre-receive"), 0o755);
  box.evolo("init", "--remote", "origin");
  const sha = box.commit("feat: start", { "app.js": lines(20, "app") });

  assert.notEqual(box.push(["origin", "main"]).status, 0);
  const record = await box.settled(`push-root-${short(sha)}`, ["push_failed"]);
  assert.match(record.reason, /never reached origin refs\/heads\/main/);
  assert.equal(box.judgeCalls(), 0);
});

test("a force push scores only the commits it added and supersedes the unit it replaced", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);
  const discarded = box.commit("feat: first try", { "try.js": lines(40, "try") });
  box.push(["origin", "main"]);
  await box.settled(`push-${short(base)}-${short(discarded)}`);

  // A remote that takes a while, like GitHub: the worker must not re-check the ledger before the push lands.
  writeFileSync(join(box.remote, "hooks/pre-receive"), "#!/bin/sh\nsleep 2\n");
  chmodSync(join(box.remote, "hooks/pre-receive"), 0o755);
  box.git("reset", "-q", "--hard", base);
  const redone = box.commit("feat: second try", { "try.js": lines(10, "again") });
  assert.equal(box.push(["--force", "origin", "main"]).status, 0);
  const record = await box.settled(`push-${short(base)}-${short(redone)}`);
  assert.deepEqual(record.result.facts.commits.map((commit) => commit.subject), ["feat: second try"]);
  const replaced = await box.settled(`push-${short(base)}-${short(discarded)}`, ["superseded"]);
  assert.equal(replaced.xp, 0);
});

test("a merged PR is found by sync and scored, and its commits are left out of the push that carries them", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);

  box.git("checkout", "-q", "-b", "feature");
  const prCommit = box.commit("feat: pr work", { "pr.js": lines(15, "pr") });
  box.git("checkout", "-q", "main");
  box.git("merge", "-q", "--no-ff", "-m", "Merge pull request #7", "feature");
  const merge = box.git("rev-parse", "HEAD");
  const direct = box.commit("fix: direct", { "app.js": lines(22, "app") });
  box.setGithub({
    commitPrs: { [prCommit]: [{ number: 7, merged: true, baseRefOid: base }] },
    prs: [
      {
        number: 7, title: "PR work", body: "Adds pr.js", url: "https://github.com/me/proj/pull/7", state: "MERGED",
        mergedAt: new Date().toISOString(), baseRefName: "main", baseRefOid: base, headRefOid: prCommit, mergeCommit: { oid: merge },
      },
    ],
  });
  box.push(["origin", "main"]);

  const push = await box.settled(`push-${short(base)}-${short(direct)}`);
  assert.equal(push.result.facts.diffMode, "per-commit");
  assert.deepEqual(push.result.facts.commits.map((commit) => commit.subject), ["fix: direct"]);
  assert.deepEqual(push.result.facts.excluded.map((commit) => commit.reason), ["part of merged PR #7"]);
  const pr = await box.settled("pr-7");
  assert.deepEqual(pr.result.facts.commits.map((commit) => commit.subject), ["feat: pr work"]);
  assert.equal(pr.result.facts.pr.title, "PR work");

  assert.equal(box.evolo("sync").trim(), "nothing new", "a scored PR is not queued again");
});

test("a revert pushed later takes the reverted unit's XP away", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);
  const change = box.commit("feat: risky", { "risky.js": lines(30, "risky") });
  box.push(["origin", "main"]);
  await box.settled(`push-${short(base)}-${short(change)}`);

  box.git("revert", "--no-edit", change);
  const revert = box.git("rev-parse", "HEAD");
  box.push(["origin", "main"]);
  await box.settled(`push-${short(change)}-${short(revert)}`);
  const reverted = await box.settled(`push-${short(base)}-${short(change)}`, ["reverted"]);
  assert.equal(reverted.xp, 0);
  assert.equal(reverted.previousStatus, "scored");
});

test("a rejected push is scored when the same commits are pushed again", async () => {
  const box = makeSandbox();
  const policy = join(box.remote, "hooks/pre-receive");
  writeFileSync(policy, "#!/bin/sh\nexit 1\n");
  chmodSync(policy, 0o755);
  box.evolo("init", "--remote", "origin");
  const sha = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(sha)}`, ["push_failed"]);

  rmSync(policy);
  assert.equal(box.push(["origin", "main"]).status, 0);
  const record = await box.settled(`push-root-${short(sha)}`);
  assert.ok(record.xp > 0);
});

test("pushes in quick succession are each scored, in order", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const shas = [];
  for (const name of ["a", "b", "c"]) {
    shas.push(box.commit(`feat: ${name}`, { [`${name}.js`]: lines(10, name) }));
    assert.equal(box.push(["origin", "main"]).status, 0);
  }
  await box.settled(`push-${short(shas[1])}-${short(shas[2])}`);
  const ids = listRecords(box.home, REPO).sort((a, b) => a.at.localeCompare(b.at)).map((record) => record.id);
  assert.deepEqual(ids, [`push-root-${short(shas[0])}`, `push-${short(shas[0])}-${short(shas[1])}`, `push-${short(shas[1])}-${short(shas[2])}`]);

  const xps = listRecords(box.home, REPO).map((record) => record.xp);
  assert.ok(xps.every((xp) => xp > 0 && xp % 5 === 0), `XP comes in steps of 5: ${xps}`);
  const total = xps.reduce((sum, xp) => sum + xp, 0);
  const level = Math.floor(Math.sqrt(total / 20));
  assert.match(box.evolo("status"), new RegExp(`^level ${level}  ${total} XP  \\(${20 * (level + 1) ** 2 - total} XP to level ${level + 1}\\)$`, "m"));
});

test("while GitHub or the judge cannot be reached the unit waits in the queue, and survives a crashed worker", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  box.setGithub({ down: true });
  const sha = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.retrying(1, /error connecting to api.github.com/);
  box.crashWorker();

  box.setGithub({});
  box.setClaudeDown(true);
  box.retryNow();
  await box.retrying(2, /judge unavailable: .*Not logged in/);
  assert.equal(readRecord(box.home, REPO, `push-root-${short(sha)}`), null, "nothing is recorded while the judge is away");
  box.crashWorker();

  box.setClaudeDown(false);
  box.retryNow();
  const record = await box.settled(`push-root-${short(sha)}`);
  assert.ok(record.xp > 0);
});

test("a force push over commits this clone never fetched scores only this clone's new commits", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);
  // Someone else pushes a commit this clone never fetches; this clone then force-pushes over it.
  const other = join(box.work, "..", "other");
  execFileSync("git", ["clone", "-q", box.remote, other]);
  execFileSync("git", ["-c", "user.name=O", "-c", "user.email=o@example.com", "commit", "-q", "--allow-empty", "-m", "theirs"], { cwd: other });
  execFileSync("git", ["push", "-q", "origin", "main"], { cwd: other });
  const mine = box.commit("feat: mine", { "mine.js": lines(5, "mine") });

  assert.equal(box.push(["--force", "origin", "main"]).status, 0);
  const record = await box.settled(`push-${short(base)}-${short(mine)}`);
  assert.deepEqual(record.result.facts.commits.map((commit) => commit.subject), ["feat: mine"]);
});

test("a scored push raises a desktop notification, shows in the status line and is explained by why", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const sha = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  const record = await box.settled(`push-root-${short(sha)}`);

  const [shown, ...more] = box.notifications();
  assert.deepEqual(more, []);
  assert.match(shown.title, new RegExp(`^Evolo \\+${record.xp} XP · level \\d+!$`), "the first score is a level up");
  assert.equal(shown.body, `proj push ..${short(sha)}: feature\nChanged 1 file(s).`);
  assert.match(box.evolo("statusline").trim(), new RegExp(`^Lv \\d+ · ${record.xp} XP · \\+${record.xp} today$`));
  assert.match(box.evolo("status"), new RegExp(`^today \\+${record.xp} XP  last 7 days \\+${record.xp} XP$`, "m"));

  const explained = box.evolo("why", short(sha));
  assert.match(explained, new RegExp(`^me/proj push \\.\\.${short(sha)}  ${record.xp} XP`));
  assert.match(explained, /^impact {6}2  Fake judgement\.$/m);
  assert.match(explained, /^ {15}evidence: app\.js$/m);
  assert.match(explained, new RegExp(`^XP = 60 base \\(feature\\) × .* = [\\d.]+ -> ${record.xp}  \\[formula 1\\.2\\]$`, "m"));
  assert.equal(box.evolo("why"), explained, "without a ref, why explains the latest unit");
  assert.equal(box.evolo("why", "HEAD"), explained, "a ref is resolved in the clone");
});

test("a unit the judge keeps answering wrongly is failed, notified, and scored by retry", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);

  box.setClaudeInvalid(true);
  const tip = box.commit("feat: more", { "more.js": lines(30, "more") });
  box.push(["origin", "main"]);
  const id = `push-${short(base)}-${short(tip)}`;
  const failed = await box.settled(id, ["failed"]);
  assert.match(failed.summary, /summary is missing/);
  assert.equal(box.notifications().at(-1).title, "Evolo Scoring failed");
  assert.match(box.evolo("status"), /^1 failed: `evolo retry`/m);
  assert.match(box.evolo("why", id), /attempt 3: invalid output: summary is missing/);

  box.setClaudeInvalid(false);
  assert.equal(box.evolo("retry").trim(), `me/proj ${id}: queued again`);
  const record = await box.settled(id);
  assert.ok(record.xp > 0);
  assert.equal(box.evolo("retry").trim(), "nothing to retry");
});

test("sync --background prints nothing and leaves the sync and the scoring to a worker", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);
  box.git("checkout", "-q", "-b", "feature");
  const head = box.commit("feat: pr work", { "pr.js": lines(15, "pr") });
  box.git("checkout", "-q", "main");
  box.git("merge", "-q", "--no-ff", "-m", "Merge pull request #3", "feature");
  // Merged on GitHub: the remote has the merge, and nothing was pushed from here.
  box.git("push", "-q", "--no-verify", "origin", "main");
  box.setGithub({
    prs: [
      {
        number: 3, title: "PR work", body: "", url: "https://github.com/me/proj/pull/3", state: "MERGED",
        mergedAt: new Date().toISOString(), baseRefName: "main", baseRefOid: base, headRefOid: head, mergeCommit: { oid: box.git("rev-parse", "HEAD") },
      },
    ],
  });

  assert.equal(box.evolo("sync", "--background"), "");
  const record = await box.settled("pr-3");
  assert.ok(record.xp > 0);
  assert.match(box.evolo("why", "#3"), /^me\/proj PR #3  \d+ XP/);
  assert.match(box.evolo("why", short(head)), /^me\/proj PR #3 /, "a commit is explained by the unit that counted it");
});

test("sync --background reaches a worker that is waiting to retry a job", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);
  box.setClaudeDown(true);
  const tip = box.commit("feat: more", { "more.js": lines(10, "more") });
  box.push(["origin", "main"]);
  await box.retrying(1, /judge unavailable/);
  box.setGithub({
    prs: [
      {
        number: 4, title: "Old PR", body: "", url: "https://github.com/me/proj/pull/4", state: "MERGED",
        mergedAt: new Date().toISOString(), baseRefName: "main", baseRefOid: base, headRefOid: tip, mergeCommit: null,
      },
    ],
  });

  assert.equal(box.evolo("sync", "--background"), "");
  await box.waitFor(
    () => listJobs(box.home).some((job) => job.type === "pr" && job.number === 4),
    () => `PR #4 was not queued: ${JSON.stringify(listJobs(box.home))}`,
  );
  assert.ok(existsSync(box.lockPath), "the waiting worker did the sync");
  box.setClaudeDown(false);
  box.retryNow();
  await box.settled("pr-4");
});

test("retrying a failed push that a force push removed ends it at once instead of waiting for it to land", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);
  box.setClaudeInvalid(true);
  const gone = box.commit("feat: gone", { "gone.js": lines(30, "gone") });
  box.push(["origin", "main"]);
  const id = `push-${short(base)}-${short(gone)}`;
  await box.settled(id, ["failed"]);
  box.setClaudeInvalid(false);
  box.git("reset", "-q", "--hard", base);
  box.git("push", "-q", "--no-verify", "--force", "origin", "main");

  box.evolo("retry");
  const record = await box.settled(id, ["push_failed"]);
  assert.match(record.reason, new RegExp(`${short(gone)} is no longer on origin refs/heads/main`));
});
