import assert from "node:assert/strict";
import { test } from "node:test";
import { SIGNALS_SETTLE_MS, readSignals, referencedIssues, withSignals, withUnreadableSignals } from "./signals.mjs";

const sha = (digit) => digit.repeat(40);
const commit = (digit, subject = "work", body = "") => ({ sha: sha(digit), subject, body });
const pushFacts = { kind: "push", tip: sha("b"), commits: [commit("a"), commit("b")] };
const prFacts = { kind: "pr", tip: sha("b"), commits: [commit("a"), commit("b")], pr: { number: 7 } };
const scoredAt = "2026-10-20T08:00:00.000Z";
const soon = Date.parse(scoredAt) + 60 * 1000;
const activity = (checks, pr = null) => ({ checks: new Map(Object.entries(checks)), pr });
const pr = (change = {}) => ({ author: "me", reviews: [], commitDates: ["2026-10-20T07:00:00Z"], closingIssues: [], ...change });

test("CI passed the first time when the tip passed and no commit of the unit failed on the way", () => {
  const read = (checks) => readSignals({ facts: prFacts, activity: activity(checks, pr()), scoredAt, now: soon });
  assert.deepEqual(
    [read({ [sha("b")]: "SUCCESS" }), read({ [sha("a")]: "FAILURE", [sha("b")]: "SUCCESS" }), read({ [sha("b")]: "FAILURE" })]
      .map((signals) => [signals.ciFirstPass, signals.ci, signals.final]),
    [[true, "SUCCESS", true], [false, "SUCCESS", true], [false, "FAILURE", true]],
  );
});

test("CI that is running or has not started leaves the signals open until a day after scoring", () => {
  for (const checks of [{ [sha("b")]: "PENDING" }, {}]) {
    const early = readSignals({ facts: pushFacts, activity: activity(checks), scoredAt, now: soon });
    assert.equal(early.ciFirstPass, false);
    assert.equal(early.final, false);
    const late = readSignals({ facts: pushFacts, activity: activity(checks), scoredAt, now: Date.parse(scoredAt) + SIGNALS_SETTLE_MS });
    assert.equal(late.final, true);
  }
});

test("a PR merged clean was reviewed by someone else, with no changes asked and no commit after the first review", () => {
  const review = (state, submittedAt = "2026-10-20T07:30:00Z", author = "reviewer") => ({ author, state, submittedAt });
  const clean = (change) => readSignals({ facts: prFacts, activity: activity({}, pr(change)), scoredAt, now: soon }).cleanMerge;
  assert.equal(clean({ reviews: [review("APPROVED")] }), true);
  assert.equal(clean({ reviews: [review("COMMENTED"), review("APPROVED", "2026-10-20T07:40:00Z")] }), true);
  assert.equal(clean({ reviews: [] }), false, "no review, nothing to be clean after");
  assert.equal(clean({ reviews: [review("APPROVED", undefined, "me")] }), false, "the author's own review does not count");
  assert.equal(clean({ reviews: [review("CHANGES_REQUESTED"), review("APPROVED", "2026-10-20T07:50:00Z")] }), false);
  assert.equal(clean({ reviews: [review("DISMISSED")] }), false, "a dismissed review is set aside");
  assert.equal(clean({ reviews: [review("APPROVED")], commitDates: ["2026-10-20T07:00:00Z", "2026-10-20T07:45:00Z"] }), false);
  assert.equal(readSignals({ facts: pushFacts, activity: activity({}), scoredAt, now: soon }).cleanMerge, false, "a push has no review");
});

test("a PR closes a bug issue through GitHub's closing references, with a bug or security label", () => {
  const closing = (labels) => readSignals({ facts: prFacts, activity: activity({}, pr({ closingIssues: [{ number: 3, labels }] })), scoredAt, now: soon });
  assert.deepEqual([closing(["bug"]).bugIssues, closing(["type: Security"]).bugIssues, closing(["enhancement", "debug-ui"]).bugIssues], [[3], [3], []]);
  assert.equal(closing(["kind/bug"]).closesBugIssue, true);
});

test("a push closes a bug issue only when one of its own commits closed it", () => {
  const issue = (closedBy, labels = ["bug"]) => ({ number: 12, labels, closedBy });
  const read = (issues) => readSignals({ facts: pushFacts, activity: activity({}), issues, scoredAt, now: soon });
  assert.deepEqual(read([issue(sha("a"))]).bugIssues, [12]);
  assert.deepEqual(read([issue(sha("c"))]).bugIssues, [], "closed by a commit of another unit");
  assert.deepEqual(read([issue(null)]).bugIssues, [], "open, or closed by hand");
  assert.deepEqual(read([issue(sha("a"), ["docs"])]).bugIssues, []);
  assert.deepEqual(read([null]).bugIssues, [], "no such issue");
});

test("the issues commit messages close are found with GitHub's keywords, once each and in order", () => {
  const commits = [
    commit("a", "Fix crash on start, fixes #12", "Also resolves: #3 and closes #12.\nSee #40, refs #41."),
    commit("b", "closed #7", "prefix#8 Fixed #9"),
  ];
  assert.deepEqual(referencedIssues(commits), [12, 3, 7, 9]);
  assert.equal(referencedIssues(Array.from({ length: 20 }, (_, index) => commit("c", `fixes #${index + 1}`))).length, 10);
});

test("signals raise a scored unit's XP from its stored scores, and leave a unit under review at 0 XP", () => {
  const criterion = (score) => ({ score, reason: "r", evidence: [] });
  const record = {
    id: "push-a-b", status: "scored", xp: 150, at: scoredAt,
    result: {
      xp: 150,
      facts: { totals: { countedLines: 400 }, reverted: false },
      evaluation: { contribution_type: "feature", scores: Object.fromEntries(["impact", "centrality", "difficulty", "quality", "scope_fit"].map((name) => [name, criterion(3)])) },
    },
  };
  const repo = { stars: 0, isOwnRepo: true };
  const none = withSignals(record, { ciFirstPass: false, cleanMerge: false, closesBugIssue: false, final: true }, repo);
  const all = withSignals(record, { ciFirstPass: true, cleanMerge: true, closesBugIssue: true, final: true }, repo);
  assert.equal(none.result.breakdown.mSignals, 1);
  assert.equal(all.result.breakdown.mSignals, 1.2);
  assert.equal(all.xp, Math.round((none.result.breakdown.raw * 1.2) / 5) * 5);
  assert.equal(all.result.xp, all.xp);
  assert.equal(all.signals.ciFirstPass, true);
  assert.equal(record.xp, 150, "the record given is not changed");
  const held = withSignals({ ...record, status: "needs_review", xp: 0 }, all.signals, repo);
  assert.equal(held.xp, 0);
  assert.equal(held.result.breakdown.mSignals, 1.2);
});

test("signals GitHub cannot answer for are tried again until a day after scoring, then the ones read so far are final", () => {
  const record = { id: "push-a-b", status: "scored", xp: 100, at: scoredAt, signals: { closesBugIssue: true, bugIssues: [12], ci: "PENDING", final: false } };
  const error = new Error("gh api failed: HTTP 500");
  assert.equal(withUnreadableSignals(record, error, soon), record);
  const settled = withUnreadableSignals(record, error, Date.parse(scoredAt) + SIGNALS_SETTLE_MS);
  assert.deepEqual(
    [settled.xp, settled.signals.closesBugIssue, settled.signals.ciFirstPass, settled.signals.final, settled.signals.unreadable],
    [100, true, false, true, "gh api failed: HTTP 500"],
  );
  const never = withUnreadableSignals({ ...record, signals: undefined }, error, Date.parse(scoredAt) + SIGNALS_SETTLE_MS);
  assert.deepEqual([never.signals.ciFirstPass, never.signals.closesBugIssue, never.signals.final], [false, false, true]);
});
