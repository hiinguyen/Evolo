import assert from "node:assert/strict";
import { test } from "node:test";
import { explain, findByRef, notification, notificationSafe, recentXp, statusLine, terminalSafe, unitLabel } from "./views.mjs";

const NOW = new Date(2026, 9, 19, 15, 0);

test("unit labels name PRs and the two ends of a push", () => {
  assert.equal(unitLabel("pr-12"), "PR #12");
  assert.equal(unitLabel("push-89fd4e3-8c68e65"), "push 89fd4e3..8c68e65");
  assert.equal(unitLabel("push-root-8c68e65"), "push ..8c68e65");
});

test("recent XP counts today and the six local days before it", () => {
  const summary = { total: 1360, xpByDay: { "2026-10-19": 105, "2026-10-13": 50, "2026-10-12": 1000, "2026-10-18": 205 } };
  assert.deepEqual(recentXp(summary, NOW), { today: 105, week: 360 });
});

test("the status line shows the level and total, and today and the queue only when there is something", () => {
  assert.equal(statusLine({ total: 1245, xpByDay: { "2026-10-19": 105 } }, 2, NOW), "Lv 7 · 1,245 XP · +105 today · 2 queued");
  assert.equal(statusLine({ total: 0, xpByDay: {} }, 0, NOW), "Lv 0 · 0 XP");
});

test("a notification tells the XP, the unit and a level up, and stays quiet for rejected or skipped pushes", () => {
  const scored = {
    repo: "me/proj", id: "pr-12", status: "scored", xp: 105, summary: "Adds retries.",
    result: { evaluation: { contribution_type: "bugfix" } },
  };
  assert.deepEqual(notification(scored, 200), { title: "+105 XP", body: "proj PR #12: bugfix\nAdds retries." });
  assert.equal(notification(scored, 300).title, "+105 XP · level 4!", "300 + 105 crosses 320, where level 4 starts");
  assert.match(notification({ ...scored, status: "failed", reason: "boom" }, 0).body, /^proj PR #12: boom\nRun `evolo retry`/);
  assert.equal(notification({ ...scored, status: "push_failed" }, 0), null);
  assert.equal(notification({ ...scored, status: "skipped" }, 0), null);
});

test("a ref finds a unit by id, by PR number, or by a commit it counted before one it left out", () => {
  const facts = (commits, excluded = []) => ({ result: { facts: { commits, excluded } } });
  const push = { id: "push-aaaaaaa-bbbbbbb", ...facts([{ sha: "bbbbbbb111" }], [{ sha: "ccccccc222" }]) };
  const pr = { id: "pr-7", result: { facts: { commits: [{ sha: "ccccccc222" }], excluded: [], pr: { mergeCommit: "fffffff333" } } } };
  const ended = { id: "push-ddddddd-eeeeeee", reason: "never reached origin" };
  const records = [push, ended, pr];
  assert.equal(findByRef(records, "pr-7"), pr);
  assert.equal(findByRef(records, "#7"), pr);
  assert.equal(findByRef(records, "push-ddddddd-eeeeeee"), ended);
  assert.equal(findByRef(records, "bbbb"), push);
  assert.equal(findByRef(records, "CCCCCCC"), pr, "the PR scored the commit the push left out");
  assert.equal(findByRef(records, "fffffff"), pr, "the merge commit names its PR");
  assert.equal(findByRef(records, "abc"), null, "too short to be a commit");
  assert.equal(findByRef(records, "#8"), null);
});

// Text from the judge and from the repository (commit subjects, PR titles) can carry terminal escape sequences.
const HOSTILE = "a\u001b[2J\u001b[31mb\u001b]0;title\u0007c\rd\u202ee\u009bf\u007fg";

test("terminalSafe removes control and bidi characters but keeps text, newlines and tabs", () => {
  assert.equal(terminalSafe(HOSTILE), "a[2J[31mb]0;titlecdefg");
  assert.equal(terminalSafe("Tiếng Việt\n\tok · 5 XP"), "Tiếng Việt\n\tok · 5 XP");
});

test("why never prints control characters from the judge or the repository", () => {
  const scores = Object.fromEntries(["impact", "centrality", "difficulty", "quality", "scope_fit"].map((c) => [c, { score: 1, reason: HOSTILE, evidence: [] }]));
  const record = {
    id: "push-root-abc1234", repo: "me/proj", kind: "push", status: "scored", xp: 5, at: "2026-10-20T08:00:00.000Z", summary: HOSTILE,
    result: {
      method: "rule",
      facts: { commits: [{ sha: "abc1234567", subject: HOSTILE }], excluded: [], totals: { files: 1, additions: 1, deletions: 0, countedLines: 1 } },
      evaluation: { contribution_type: "docs", summary: HOSTILE, scores, flags: [] },
      xp: 5,
      breakdown: { base: 25, mValue: 1, mSize: 1, mRepo: 1, mSignals: 1, raw: 5, formula_version: "1.2" },
    },
  };
  const text = explain(record);
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
  assert.match(text, /abc1234 a\[2J\[31mb\]0;titlecdefg/);
});

test("notificationSafe shows markup as text and drops control characters", () => {
  assert.equal(notificationSafe('<a href="x">y</a> & <b>z</b>\u001b[1m\nnext'), '&lt;a href="x"&gt;y&lt;/a&gt; &amp; &lt;b&gt;z&lt;/b&gt;[1m\nnext');
  assert.equal(notificationSafe("+50 XP · level 1!"), "+50 XP · level 1!");
});
