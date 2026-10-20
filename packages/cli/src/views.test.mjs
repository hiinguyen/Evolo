import assert from "node:assert/strict";
import { test } from "node:test";
import { findByRef, notification, recentXp, statusLine, unitLabel } from "./views.mjs";

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
