// End to end: a real clone with a bare repository as its remote, the real pre-push hook and a real background
// worker, from the sandbox in sandbox.mjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { listRecords, readRecord } from "./ledger.mjs";
import { listJobs } from "./queue.mjs";
import { loadRepos } from "./repos.mjs";
import { periodOf } from "./stats.mjs";
import { lines, makeSandbox, REPO, short } from "./sandbox.mjs";

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
  const pushStarted = Date.now();
  box.push(["origin", "main"]);
  const pushEnded = Date.now();
  const record = await box.settled(`push-${short(base)}-${short(tip)}`);
  const landed = Date.parse(record.landedAt);
  assert.ok(landed >= pushStarted && landed <= pushEnded, `a push lands when it is pushed, not when it is scored: ${record.landedAt}`);
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
  const mergedAt = new Date().toISOString();
  box.setGithub({
    commitPrs: { [prCommit]: [{ number: 7, merged: true, baseRefOid: base }] },
    prs: [
      {
        number: 7, title: "PR work", body: "Adds pr.js", url: "https://github.com/me/proj/pull/7", state: "MERGED",
        mergedAt, baseRefName: "main", baseRefOid: base, headRefOid: prCommit, mergeCommit: { oid: merge },
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
  assert.equal(pr.landedAt, mergedAt, "a PR lands when GitHub merged it");

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
  assert.equal(record.landedAt, failed.landedAt, "a unit scored again keeps the day it was pushed on");
  assert.ok(Date.parse(record.landedAt) < Date.parse(failed.at));
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

// A push whose judge summary carries markup and an escape sequence, scored with or without body markup on the desktop.
async function notifiedWith(markup) {
  const box = makeSandbox();
  box.setNotifyMarkup(markup);
  box.evolo("init", "--remote", "origin");
  box.setClaudeSummary('Added <a href="https://evil.example">a link</a> & <b>bold</b>\u001b[31m<img src="x">');
  const sha = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(sha)}`);
  const [shown] = box.notifications();
  assert.match(shown.title, /^Evolo \+\d+ XP/);
  return { body: shown.body, label: `proj push ..${short(sha)}` };
}

test("a desktop without body markup gets the judge's text without tags, links as text and URL, and no control characters", async () => {
  const { body, label } = await notifiedWith(false);
  assert.equal(body, `${label}: feature\nAdded a link (https://evil.example) & bold[31m<img src="x">`);
});

test("a desktop with body markup renders the judge's bold and links, with the link address, and shows other tags as text", async () => {
  const { body, label } = await notifiedWith(true);
  assert.equal(
    body,
    `<b>${label}</b>: feature\nAdded <a href="https://evil.example">a link</a> (https://evil.example) &amp; <b>bold</b>[31m&lt;img src="x"&gt;`,
  );
});

test("signals: a push gains XP for the bug issue it closes at once, and for CI that passes later, read at the next sync", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);

  const fix = box.commit("fix: crash on start\n\nFixes #12", { "app.js": lines(200, "app") });
  // GitHub closes the issue as the push lands, and starts CI.
  const issues = { 12: { state: "closed", labels: ["bug"], closedBy: fix } };
  box.setGithub({ checks: { [fix]: "PENDING" }, issues });
  box.push(["origin", "main"]);
  const scored = await box.settled(`push-${short(base)}-${short(fix)}`);
  assert.deepEqual(
    [scored.signals.closesBugIssue, scored.signals.bugIssues, scored.signals.ciFirstPass, scored.signals.ci, scored.signals.final],
    [true, [12], false, "PENDING", false],
  );
  assert.equal(scored.result.breakdown.mSignals, 1.1);
  assert.match(box.notifications().at(-1).title, new RegExp(`^Evolo \\+${scored.xp} XP`), "the notification has the XP with the signals so far");
  assert.match(box.evolo("why", scored.id), /^signals: closes bug issue #12 \+10%; read again at the next sync \(CI: pending\)$/m);

  box.setGithub({ checks: { [fix]: "SUCCESS" }, issues });
  const synced = box.evolo("sync");
  const settled = readRecord(box.home, REPO, scored.id);
  assert.deepEqual([settled.signals.ciFirstPass, settled.signals.final], [true, true]);
  assert.equal(settled.result.breakdown.mSignals, 1.15);
  assert.ok(settled.xp > scored.xp, `${settled.xp} > ${scored.xp}`);
  assert.equal(settled.result.xp, settled.xp);
  assert.match(synced, new RegExp(`${scored.id}: signals, ${scored.xp} -> ${settled.xp} XP`));
  assert.match(box.evolo("why", scored.id), /^signals: CI passed the first time \+5%, closes bug issue #12 \+10%$/m);
  assert.match(box.evolo("status"), new RegExp(`^level \\d+  ${readRecord(box.home, REPO, `push-root-${short(base)}`).xp + settled.xp} XP`, "m"));

  box.setGithub({ down: true });
  assert.equal(box.evolo("sync").trim(), `${REPO}: sync failed: gh pr list failed: error connecting to api.github.com`, "final signals are not read again");
});

test("a merged PR reviewed without rework, closing a bug issue with CI green, is scored with every signal", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);

  box.git("checkout", "-q", "-b", "feature");
  const prCommit = box.commit("fix: pr work", { "pr.js": lines(150, "pr") });
  box.git("checkout", "-q", "main");
  box.git("merge", "-q", "--no-ff", "-m", "Merge pull request #7", "feature");
  const merge = box.git("rev-parse", "HEAD");
  box.setGithub({
    checks: { [prCommit]: "SUCCESS" },
    commitPrs: { [prCommit]: [{ number: 7, merged: true, baseRefOid: base }] },
    prs: [
      {
        number: 7, title: "PR work", body: "Fixes #3", url: "https://github.com/me/proj/pull/7", state: "MERGED",
        mergedAt: new Date().toISOString(), baseRefName: "main", baseRefOid: base, headRefOid: prCommit, mergeCommit: { oid: merge },
        author: "me",
        reviews: [{ author: "friend", state: "APPROVED", submittedAt: new Date(Date.now() + 1000).toISOString() }],
        commitDates: [new Date().toISOString()],
        closingIssues: [{ number: 3, labels: ["bug"] }],
      },
    ],
  });
  box.push(["origin", "main"]);
  const pr = await box.settled("pr-7");
  assert.deepEqual(
    [pr.signals.ciFirstPass, pr.signals.cleanMerge, pr.signals.closesBugIssue, pr.signals.final],
    [true, true, true, true],
  );
  assert.equal(pr.result.breakdown.mSignals, 1.2);
  assert.ok(box.notifications().some((shown) => shown.title.startsWith(`Evolo +${pr.xp} XP`) && shown.body.startsWith("proj PR #7")));
  assert.match(
    box.evolo("why", "#7"),
    /^signals: CI passed the first time \+5%, merged without rework after review \+5%, closes bug issue #3 \+10%$/m,
  );
});

test("once the day's judge budget is spent, units wait for the next day while units triaged by rule are still scored", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  // Every run of the fake judge costs $0.01.
  box.evolo("config", "set", "budget.daily-usd", "0.01");
  const base = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  await box.settled(`push-root-${short(base)}`);

  const second = box.commit("feat: more", { "more.js": lines(30, "more") });
  box.push(["origin", "main"]);
  const parked = () => {
    const jobs = listJobs(box.home);
    return !existsSync(box.lockPath) && jobs.length > 0 && jobs.every((job) => job.budgetDay) && jobs;
  };
  await box.waitFor(parked, () => `the push was not left waiting: ${JSON.stringify(listJobs(box.home))}`);
  const third = box.commit("feat: even more", { "even.js": lines(30, "even") });
  box.push(["origin", "main"]);
  await box.waitFor(() => parked()?.length === 2, () => `the second push was not left waiting: ${JSON.stringify(listJobs(box.home))}`);
  const docs = box.commit("docs: typo", { "README.md": "hello\n" });
  box.push(["origin", "main"]);
  const triaged = await box.waitFor(
    () => !existsSync(box.lockPath) && readRecord(box.home, REPO, `push-${short(third)}-${short(docs)}`),
    () => "the docs push was not scored",
  );
  assert.equal(triaged.result.method, "rule");
  assert.equal(box.judgeCalls(), 1);
  assert.deepEqual(box.notifications().filter((shown) => shown.title === "Evolo Daily budget spent").length, 1, "one notice a day");

  const status = box.evolo("status");
  assert.match(status, /^ {2}me\/proj push \w{7} {2}\(waits for tomorrow: the daily budget is spent\)$/m);
  assert.match(status, /^judge spending today \$0\.01 of \$0\.01$/m);

  // Raising the cap, as the notification suggests, has what waited scored at once.
  box.evolo("config", "set", "budget.daily-usd", "1");
  await box.settled(`push-${short(second)}-${short(third)}`);
  assert.equal(readRecord(box.home, REPO, `push-${short(base)}-${short(second)}`).status, "scored");
  assert.equal(box.judgeCalls(), 3);
});

test("stats show this week's scored push and today's streak, and refuse an unknown period", async () => {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const sha = box.commit("feat: start", { "app.js": lines(20, "app") });
  box.push(["origin", "main"]);
  const record = await box.settled(`push-root-${short(sha)}`);

  const output = box.evolo("stats");
  assert.match(output, new RegExp(`^${periodOf("week").label}  \\(vs ${periodOf("week", new Date(), 1).label}\\)$`, "m"));
  assert.match(output, new RegExp(`^${record.xp} XP  1 unit  level \\d+`, "m"));
  // The push landed today, and a day with work counts toward the streak whether or not it is a workday.
  assert.match(output, /^streak 1 workday \(longest 1\)$/m);
  assert.match(output, /^dirs {6}proj 20$/m);
  assert.match(box.evolo("stats", "month", "--previous"), /^streak 1 workday/m);
  const refused = box.evoloRun("stats", "year");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /expected: evolo stats \[week\|month\|quarter\] \[--previous\]/);
  const mistyped = box.evoloRun("stats", "--prev");
  assert.equal(mistyped.status, 2);
  assert.match(mistyped.stderr, /^Unknown option '--prev'/);
  assert.doesNotMatch(mistyped.stderr, /    at /, "no stack trace");
});
