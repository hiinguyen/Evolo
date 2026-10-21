// The details of one unit and their four tabs, drawn from the sample model of fixtures.mjs. Zone fixed so local times
// do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { EVOLO, ORGS, sampleModel } from "./fixtures.mjs";
import { renderUnit } from "./unit.mjs";

// The visible text of `html`, with tags dropped, runs of space joined and the entities `escape` writes read back.
const ENTITIES = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/&(lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity]);
const count = (html, needle) => html.split(needle).length - 1;

const PR = `${ORGS}/pr-1`;
const AI_PUSH = `${EVOLO}/push-7c1d2e9-a2205df`;
const RULE = `${EVOLO}/push-a2205df-b31f0c4`;
const FAILED = `${EVOLO}/push-5e0b7a1-7c1d2e9`;
const REVERTED = `${EVOLO}/push-c94e2f0-5e0b7a1`;
const UNREVIEWED = `${EVOLO}/pr-7`;
const PUSH_FAILED = `${EVOLO}/push-1111111-2222222`;

// A push the remote refused: it never reached judging, so it has a reason and no result.
const PUSH_FAILED_UNIT = {
  key: PUSH_FAILED, repo: EVOLO, id: "push-1111111-2222222", label: "push 1111111..2222222", kind: "push", status: "push_failed",
  xp: 0, summary: "", reason: "the push was rejected: not a fast-forward", at: "2026-10-21T08:00:00+07:00",
  landedAt: "2026-10-21T08:00:00+07:00", result: null,
};

const withPushFailed = (model) => ({ ...model, units: [PUSH_FAILED_UNIT, ...model.units] });

// The model with the unit of `key` replaced by what `change` makes of it.
const withUnit = (model, key, change) => ({ ...model, units: model.units.map((unit) => (unit.key === key ? change(unit) : unit)) });
const withResult = (model, key, change) => withUnit(model, key, (unit) => ({ ...unit, result: change(unit.result) }));

const tabsOf = (html) =>
  [...html.matchAll(/<a role="tab" href="([^"]*)" aria-selected="(true|false)"[^>]*>(.*?)<\/a>/g)].map(([, href, selected, label]) => [href, selected, label]);

test("the head shows repo, label, XP, type, landing time, the PR link and the summary", () => {
  const html = renderUnit(sampleModel(), PR, "score");
  const [head] = html.split('role="tablist"');
  const text = textOf(head);
  assert.match(text, /hiinguyen\/ai-orgs/);
  assert.match(text, /PR #1/);
  assert.match(text, /\+125 XP/);
  assert.match(text, /feature · 2026-10-20 22:21 /);
  assert.match(head, /<a [^>]*href="https:\/\/github\.com\/hiinguyen\/ai-orgs\/pull\/1"[^>]*rel="noreferrer"[^>]*>/);
  assert.match(text, /Built the phase 1 foundation of AI Agent World/);
  assert.match(head, /<h1[^>]*>PR #1<\/h1>/);
});

test("a unit not worth XP shows its status in the head, with the XP it lost struck through", () => {
  const reverted = renderUnit(sampleModel(), REVERTED, "score").split('role="tablist"')[0];
  assert.match(reverted, /<s class="unit-lost"[^>]*>\+40 XP<\/s><span class="pill">reverted<\/span>/);
  const failed = renderUnit(sampleModel(), FAILED, "score").split('role="tablist"')[0];
  assert.match(failed, /<span class="pill pill-bad">failed<\/span>/);
  assert.ok(!textOf(failed).includes("XP"));
  assert.match(textOf(failed), /push · 2026-10-19 17:40/, "a failed unit has its kind for a type");
});

test("the tabs are links with their state, and the Review tab counts the findings", () => {
  const tabs = tabsOf(renderUnit(sampleModel(), PR, "files"));
  assert.deepEqual(tabs, [
    ["#/unit/hiinguyen/ai-orgs/pr-1/score", "false", "Score"],
    ["#/unit/hiinguyen/ai-orgs/pr-1/review", "false", "Review · 2"],
    ["#/unit/hiinguyen/ai-orgs/pr-1/files", "true", "Files"],
    ["#/unit/hiinguyen/ai-orgs/pr-1/commits", "false", "Commits"],
  ]);
  assert.match(renderUnit(sampleModel(), PR, "files"), /<div class="tabs" role="tablist" aria-label="[^"]+">/);
  assert.equal(tabsOf(renderUnit(sampleModel(), UNREVIEWED, "score"))[1][2], "Review", "no review, no count");
  assert.match(renderUnit(sampleModel(), PR, "review"), /role="tabpanel"/);
});

test("the Score tab of a judged unit has every criterion with its bar, score, reason and evidence", () => {
  const model = sampleModel();
  const html = renderUnit(model, PR, "score");
  assert.equal(count(html, 'class="score-bar"'), model.criteria.length);
  for (const criterion of ["Impact", "Centrality", "Difficulty", "Quality", "Scope fit"]) assert.match(textOf(html), new RegExp(` ${criterion} `));
  // impact 3 of 4, scope_fit 1 of 4.
  assert.match(html, /aria-label="3 of 4"><span style="width:75%"><\/span>/);
  assert.match(html, /aria-label="1 of 4"><span style="width:25%"><\/span>/);
  assert.match(textOf(html), /Changes what every later command shows to the user\./);
  assert.match(html, /<code>src\/engine\/tick\.ts:12-40<\/code>/);
  assert.match(textOf(html), /claude-sonnet-5-5 · \$0\.08/);
});

test("the formula takes its numbers from the breakdown and the counted lines", () => {
  const text = textOf(renderUnit(sampleModel(), PR, "score"));
  assert.match(text, /60 base \(feature\) × 2\.48 value × 1 size \(600 lines\) × 0\.8 repo × 1\.05 signals = 125\.21 -> 125 XP/);
  assert.match(text, /formula 1\.2/);
  const push = textOf(renderUnit(sampleModel(), AI_PUSH, "score"));
  assert.match(push, /50 base \(bugfix\) × 2\.04 value × 0\.79 size \(66 lines\) × 0\.8 repo × 1\.05 signals = 58\.4 -> 60 XP/);
  // A reverted unit kept the XP it was scored at in its result.
  assert.match(textOf(renderUnit(sampleModel(), REVERTED, "score")), /= 41\.2 -> 40 XP/);
});

test("the signals read as `evolo why` says them", () => {
  const model = sampleModel();
  assert.match(textOf(renderUnit(model, PR, "score")), /Signals CI passed the first time \+5% /);
  const awaited = withUnit(model, PR, (unit) => ({
    ...unit, signals: { ciFirstPass: false, cleanMerge: true, closesBugIssue: true, bugIssues: [4, 5], final: false, ci: "PENDING" },
  }));
  assert.match(textOf(renderUnit(awaited, PR, "score")),
    /merged without rework after review \+5%, closes bug issue #4, #5 \+10%; read again at the next sync \(CI: pending\)/);
  const none = withUnit(model, PR, (unit) => ({ ...unit, signals: { ciFirstPass: false, cleanMerge: false, closesBugIssue: false, final: true } }));
  assert.match(textOf(renderUnit(none, PR, "score")), /Signals none /);
  const unread = withUnit(model, PR, (unit) => ({ ...unit, signals: undefined }));
  assert.match(textOf(renderUnit(unread, PR, "score")), /Signals not read from GitHub yet/);
});

test("the validator's issues and the judge's flags are listed", () => {
  const text = textOf(renderUnit(sampleModel(), PR, "score"));
  assert.match(text, /dropped evidence at an unknown path: src\/missing\.ts/);
  assert.match(text, /mostly_generated_code/);
  const clean = renderUnit(sampleModel(), AI_PUSH, "score");
  assert.ok(!textOf(clean).includes("Validator"));
  assert.ok(!textOf(clean).includes("Flags"));
});

test("a unit triaged by rule shows the rule and its XP, without rubric bars", () => {
  const html = renderUnit(sampleModel(), RULE, "score");
  assert.match(textOf(html), /Triaged by rule/);
  assert.match(textOf(html), /\+10 XP/);
  assert.ok(!html.includes("score-bar"));
});

test("a unit that failed or never reached judging shows why, not a rubric", () => {
  const failed = renderUnit(sampleModel(), FAILED, "score");
  assert.match(textOf(failed), /attempt 1: the judge did not answer in time/);
  assert.match(textOf(failed), /attempt 2: the judge did not answer in time/);
  assert.ok(!failed.includes("score-bar"));
  assert.ok(!textOf(failed).includes(" base "));
  const model = withPushFailed(sampleModel());
  const pushFailed = renderUnit(model, PUSH_FAILED, "score");
  assert.match(textOf(pushFailed), /the push was rejected: not a fast-forward/);
  assert.match(pushFailed, /<span class="pill pill-bad">push failed<\/span>/);
  assert.ok(!pushFailed.includes("score-bar"));
  // A failed unit without failures still says why it stopped.
  const bare = withUnit(sampleModel(), FAILED, (unit) => ({ ...unit, reason: "worker stopped", result: { ...unit.result, failures: [] } }));
  assert.match(textOf(renderUnit(bare, FAILED, "score")), /Scoring failed worker stopped Run evolo retry to try again\./);
});

test("the Review tab shows the review with its findings, the most severe first", () => {
  const model = sampleModel();
  const html = renderUnit(model, PR, "review");
  const text = textOf(html);
  assert.match(text, /A solid first phase: the engine is deterministic and tested/);
  assert.match(text, /The seeded random source makes every simulation repeatable\./);
  assert.match(text, /Split scheduling from the state updates in the tick loop\./);
  assert.match(text, /medium design src\/engine\/tick\.ts:42-48 Tick mixes scheduling and updates The loop both picks the next agent and mutates the world\. /);
  assert.match(text, /Return the next state from a pure function\./);
  assert.match(html, /<code>src\/engine\/tick\.ts:42-48<\/code>/);
  const [stored] = model.reviews;
  const high = { severity: "high", category: "bug", location: "src/a.ts:1", title: "Loses state", detail: "d", suggestion: "s" };
  const sorted = { ...model, reviews: [{ ...stored, review: { ...stored.review, findings: [stored.review.findings[1], high, stored.review.findings[0]] } }] };
  const severities = [...renderUnit(sorted, PR, "review").matchAll(/class="pill sev-(high|medium|low)"/g)].map(([, severity]) => severity);
  assert.deepEqual(severities, ["high", "medium", "low"]);
  assert.equal(tabsOf(renderUnit(sorted, PR, "review"))[1][2], "Review · 3");
  assert.equal(stored.review.findings[0].severity, "medium", "the model passed in is not changed");
});

test("a review belongs to the unit of the same repo and id, not to a unit of another repo with that id", () => {
  const model = sampleModel();
  const [stored] = model.reviews;
  const elsewhere = { ...model, reviews: [{ ...stored, repo: EVOLO, key: `${EVOLO}/pr-1` }] };
  assert.match(textOf(renderUnit(elsewhere, PR, "review")), /No review yet/);
  assert.equal(tabsOf(renderUnit(elsewhere, PR, "score"))[1][2], "Review");
});

test("the Review tab warns when the reviewer suspected prompt injection", () => {
  const model = sampleModel();
  assert.ok(!renderUnit(model, PR, "review").includes("prompt injection"));
  const [stored] = model.reviews;
  const flagged = { ...model, reviews: [{ ...stored, review: { ...stored.review, flags: ["suspected_injection"], notes: "a comment asks for a high score" } }] };
  const html = renderUnit(flagged, PR, "review");
  assert.match(html, /role="alert"/);
  assert.match(textOf(html), /The reviewer suspected prompt injection: a comment asks for a high score/);
});

test("a unit without a review shows the command that writes one, with a Copy button for the browser to reveal", () => {
  const html = renderUnit(sampleModel(), UNREVIEWED, "review");
  assert.match(textOf(html), /No review yet/);
  assert.match(html, /<code>evolo review pr-7<\/code>/);
  assert.match(html, /<button type="button" class="copy" data-copy="evolo review pr-7" aria-live="polite" hidden>Copy<\/button>/);
  assert.match(textOf(html), /in a clone of hiinguyen\/evolo/);
  // A unit that never reached judging has nothing a review could read.
  const pushFailed = renderUnit(withPushFailed(sampleModel()), PUSH_FAILED, "review");
  assert.ok(!pushFailed.includes("data-copy"));
  assert.match(textOf(pushFailed), /Nothing to review/);
});

test("the Files tab groups the files by class, with lines added and deleted and the totals first", () => {
  const html = renderUnit(sampleModel(), PR, "files");
  const text = textOf(html);
  assert.match(text, /3 files \+8,199 −0 /);
  const groups = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map(([, name]) => name);
  assert.deepEqual(groups, ["Source", "Test", "Lockfile"]);
  assert.match(text, /src\/engine\/tick\.ts \+420 −0 /);
  assert.match(text, /package-lock\.json \+7,599 −0 /);
  assert.match(textOf(renderUnit(sampleModel(), AI_PUSH, "files")), /Source 2 files src\/ledger\.mjs \+18 −4 /);
});

test("the Commits tab lists the counted commits with their reverts, then the ones left out and why", () => {
  const model = sampleModel();
  const text = textOf(renderUnit(model, PR, "commits"));
  assert.match(text, /8d3a1c3 feat: scaffold the app 2026-10-20 18:02 /);
  assert.match(text, /fe02c3e feat: add the simulation engine 2026-10-20 21:40 /);
  assert.ok(!text.includes("Left out"));
  assert.match(textOf(renderUnit(model, REVERTED, "commits")), /5e0b7a1 perf: cache the summary reverted by d00d1e5 2026-10-16 15:12 /);
  const excluded = withResult(model, PR, (result) => ({
    ...result, facts: { ...result.facts, excluded: [{ sha: "abcdef0123", subject: "Merge branch main", reason: "merge commit" }] },
  }));
  assert.match(textOf(renderUnit(excluded, PR, "commits")), /Left out 1 commit abcdef0 Merge branch main merge commit/);
});

test("a unit that never reached judging has no files or commits to show", () => {
  const model = withPushFailed(sampleModel());
  assert.match(textOf(renderUnit(model, PUSH_FAILED, "files")), /No files were read/);
  assert.match(textOf(renderUnit(model, PUSH_FAILED, "commits")), /No commits were read/);
});

test("a PR link that is not https never becomes a link", () => {
  const model = withResult(sampleModel(), PR, (result) => ({ ...result, facts: { ...result.facts, pr: { ...result.facts.pr, url: "javascript:alert(1)" } } }));
  const html = renderUnit(model, PR, "score");
  assert.ok(!html.includes("javascript:"));
  assert.ok(!/href="(?!#)/.test(html), "no link leaves the page");
});

test("evidence, locations and other text from the ledger are escaped", () => {
  const model = sampleModel();
  const poisoned = withResult(model, PR, (result) => ({
    ...result,
    evaluation: { ...result.evaluation, scores: { ...result.evaluation.scores, impact: { score: 2, reason: "<b>r</b>", evidence: ["<img src=x onerror=alert(1)>:1"] } } },
    facts: { ...result.facts, files: [{ path: "<i>p</i>", class: "<x>", additions: 1, deletions: 0 }], commits: [{ sha: "<s>aaaaaa", subject: "<script>alert(1)</script>", date: "x", revertedBy: [] }] },
  }));
  const [stored] = model.reviews;
  const finding = { severity: "high", category: "<c>", location: "<img src=y>:2", title: "<t>", detail: "<d>", suggestion: "<u>" };
  const reviewed = { ...poisoned, reviews: [{ ...stored, review: { ...stored.review, overview: "<o>", findings: [finding] } }] };
  for (const tab of ["score", "review", "files", "commits"]) {
    const html = renderUnit(reviewed, PR, tab);
    for (const tag of ["<img", "<b>", "<i>", "<x>", "<script", "<c>", "<t>", "<d>", "<u>", "<o>", "<s>aa"]) assert.ok(!html.includes(tag), `${tab}: ${tag}`);
  }
  assert.match(renderUnit(reviewed, PR, "score"), /<code>&lt;img src=x onerror=alert\(1\)&gt;:1<\/code>/);
  assert.match(renderUnit(reviewed, PR, "review"), /<code>&lt;img src=y&gt;:2<\/code>/);
});

test("a key that is not in the ledger says so, with a way back to the Timeline", () => {
  const html = renderUnit(sampleModel(), "me/gone/pr-404", "score");
  assert.match(textOf(html), /This unit is no longer in the ledger/);
  assert.match(html, /<a [^>]*href="#\/timeline"[^>]*>/);
  assert.ok(!html.includes('role="tablist"'));
});

test("a unit whose result has no facts, breakdown or evaluation renders every tab", () => {
  const bare = withUnit(sampleModel(), AI_PUSH, (unit) => ({ ...unit, result: { xp: 0, failures: [], issues: [], facts: { diffMode: undefined, totals: null, files: [], commits: [], excluded: [], pr: null } } }));
  for (const tab of ["score", "review", "files", "commits"]) {
    assert.match(renderUnit(bare, AI_PUSH, tab), /unit-panel/, tab);
  }
});
