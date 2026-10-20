import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalSafe } from "./safe-text.mjs";
import { explain, findByRef, formatStats, notification, recentXp, statusLine, unitLabel } from "./views.mjs";

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

test("without body markup a notification is plain text: the judge's tags are dropped and links read as text and URL", () => {
  const scored = {
    repo: "me/proj", id: "pr-12", status: "scored", xp: 105, summary: 'Uses <b>Map</b> & <a href="https://ex.com">docs</a>\u001b[1m',
    result: { evaluation: { contribution_type: "bugfix" } },
  };
  assert.deepEqual(notification(scored, 0), { title: "+105 XP · level 2!", body: "proj PR #12: bugfix\nUses Map & docs (https://ex.com)[1m" });
  assert.equal(notification({ ...scored, summary: "x", xp: 5, status: "scored" }, 0).title, "+5 XP");
});

test("with body markup the judge's bold and links render, links show their address, and nothing else renders", () => {
  const scored = {
    repo: "me/proj", id: "pr-12", status: "scored", xp: 105,
    summary: 'Uses <b>Map</b> & <a href="https://evil.example">x</a><img src="y">\u001b[1m',
    result: { evaluation: { contribution_type: "bugfix" } },
  };
  assert.deepEqual(notification(scored, 200, { markup: true }), {
    title: "+105 XP",
    body: '<b>proj PR #12</b>: bugfix\nUses <b>Map</b> &amp; <a href="https://evil.example">x</a> (https://evil.example)&lt;img src="y"&gt;[1m',
  });
  const failed = notification({ ...scored, status: "failed", reason: "exit <1> & more" }, 0, { markup: true });
  assert.equal(failed.body, "<b>proj PR #12</b>: exit &lt;1&gt; &amp; more\nRun `evolo retry` to try again.");
  assert.equal(notification({ ...scored, title: "x", xp: 5, summary: "\u001b]0;t\u0007ok" }, 0, { markup: true }).title, "+5 XP");
});

// Stats as stats.mjs's computeStats returns them, for a period given by its label.
function periodStats(label, overrides = {}) {
  return {
    period: { label },
    units: 3, xp: 300, costUsd: 0.42, level: 5,
    types: [{ type: "feature", units: 2, xp: 250 }, { type: "bugfix", units: 1, xp: 50 }],
    rubric: { n: 3, averages: { impact: 3, centrality: 2.5, difficulty: 2, quality: 3.67, scope_fit: 3 } },
    tests: { touched: 2, eligible: 3 },
    reverts: { reverted: 0, total: 3 },
    repos: [{ repo: "me/app", units: 3, xp: 300 }],
    dirs: [{ repo: "me/app", dir: "src", lines: 120 }, { repo: "me/app", dir: ".", lines: 4 }],
    hours: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 4 : hour === 14 ? 2 : 0)),
    weekdays: [3, 0, 1, 0, 0, 0, 2],
    ...overrides,
  };
}

test("stats show a period against the previous one, with changes only where the previous period has data", () => {
  const previous = periodStats("week 2026-10-12..2026-10-18", {
    units: 2, xp: 200, rubric: { n: 2, averages: { impact: 2.5, centrality: 2.5, difficulty: 2.5, quality: 4, scope_fit: 3 } },
    tests: { touched: 0, eligible: 0 },
  });
  const lines = formatStats(periodStats("week 2026-10-19..2026-10-25"), previous, { current: 4, longest: 9 });
  assert.deepEqual(lines, [
    "week 2026-10-19..2026-10-25  (vs week 2026-10-12..2026-10-18)",
    "300 XP (+100)  3 units (+1)  level 5  judge $0.42",
    "streak 4 workdays (longest 9)",
    "types     feature 2 (250 XP) · bugfix 1 (50 XP)",
    "rubric    impact 3.0 (+0.5)  centrality 2.5 (+0.0)  difficulty 2.0 (-0.5)  quality 3.7 (-0.3)  scope_fit 3.0 (+0.0)  (n=3)",
    "tests     2 of 3 units with code touched tests (67%)",
    "reverted  0 of 3",
    "repos     me/app 300 XP (3)",
    "dirs      app/src 120 · app 4",
    "hours     ▁▁▁▁▁▁▁▁▁█▁▁▁▁▅▁▁▁▁▁▁▁▁▁  (0-23)",
    "weekdays  Mon 3  Tue 0  Wed 1  Thu 0  Fri 0  Sat 0  Sun 2",
  ]);
});

test("stats without a previous period, or for an empty one, show no changes", () => {
  const empty = periodStats("2026-09", { units: 0, xp: 0, rubric: { n: 0, averages: {} }, tests: { touched: 0, eligible: 0 } });
  const lines = formatStats(periodStats("2026-10"), empty, { current: 1, longest: 1 });
  assert.equal(lines[1], "300 XP  3 units  level 5  judge $0.42");
  assert.equal(lines[2], "streak 1 workday (longest 1)");
  assert.equal(lines[4], "rubric    impact 3.0  centrality 2.5  difficulty 2.0  quality 3.7  scope_fit 3.0  (n=3)");
  assert.deepEqual(formatStats(empty, null, { current: 0, longest: 2 }), ["2026-09", "streak 0 workdays (longest 2)", "no contributions"]);
});

test("stats print repository names and paths without control characters", () => {
  const stats = periodStats("2026-10", {
    repos: [{ repo: "me/\u001b[2Japp", units: 1, xp: 10 }],
    dirs: [{ repo: "me/app", dir: "src/\u001b]0;x\u0007evil", lines: 1 }],
  });
  const printed = formatStats(stats, null, { current: 0, longest: 0 }).join("\n");
  assert.equal(printed, terminalSafe(printed));
  assert.match(printed, /me\/\[2Japp/);
});
