// The Overview screen, drawn from the sample model of fixtures.mjs. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleModel } from "./fixtures.mjs";
import { activityCard, badge, renderOverview } from "./overview.mjs";

// The visible text of `html`, with tags dropped and runs of space joined, to match sentences that span elements.
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (html, needle) => html.split(needle).length - 1;

test("the hero shows the rank, the level, the total, the next level and the next rank milestone", () => {
  const model = sampleModel();
  const html = renderOverview(model);
  const text = textOf(html);
  assert.match(text, /Current rank Intern Level 4 /);
  assert.match(text, /1,040 XP 360 XP to level 5 /);
  // 1,040 XP is exactly where level 4 starts.
  assert.match(html, /aria-valuenow="0"[^>]*><span style="width:0%"><\/span>/);
  assert.match(html, /class="level-rank rank-muted">Intern<\/h2>/);
  assert.match(text, /Next rank milestone: Junior Dev Level 5 · 360 XP away/);
  assert.match(html, /href="#\/achievements"/);
});

test("the top rank becomes an open-ended milestone instead of a next one", () => {
  const model = sampleModel();
  const top = { ...model, nextRank: null, rank: { name: "Legend", effect: "legend" }, level: { ...model.level, level: 50, from: 59000, next: 61000, total: 60000 } };
  const text = textOf(renderOverview(top));
  assert.match(text, /Top rank reached: Legend the ladder is open ended/);
  assert.doesNotMatch(text, /Next rank milestone/);
});

test("the five KPI cards show today, the week, the streak, the judge's spending and the queue", () => {
  const html = renderOverview(sampleModel());
  const text = textOf(html);
  assert.match(text, /Today −55 vs yest\. \+70 XP 2 scored units logged/);
  assert.match(text, /Last 7 days 5 units \+195 XP 3 scored units across seven days/);
  assert.match(text, /Streak 2 workdays longest streak: 3/);
  // The day's scorings and review, and the sample's weekly report written that morning ($0.04).
  assert.match(text, /Judge today 7% \$0\.37 of \$5\.00 daily limit/);
  assert.match(text, /Queue queued 1 waiting/);
  assert.match(text, /1 job waiting for tomorrow's budget/);
  assert.equal(count(html, 'class="spark-bar"'), 14, "the week and the seven days each draw seven bars");
});

test("the queue says nothing of tomorrow when no job is parked, and one workday is singular", () => {
  const model = sampleModel();
  const text = textOf(renderOverview({ ...model, queue: { waiting: 0, parked: 0 }, streak: { current: 1, longest: 3 } }));
  assert.match(text, /Queue idle 0 waiting/);
  assert.ok(!text.includes("tomorrow"));
  assert.match(text, /Streak 1 workday longest streak: 3/);
});

test("the latest units are listed, newest first, five shown and the rest waiting behind the feed tabs", () => {
  const model = sampleModel();
  const html = renderOverview(model);
  const links = [...html.matchAll(/<a class="activity-card"[^>]* href="([^"]*)"/g)].map(([, href]) => href);
  assert.deepEqual(links.slice(0, 5), [
    "#/unit/hiinguyen/evolo/push-a2205df-b31f0c4",
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df",
    "#/unit/hiinguyen/ai-orgs/pr-1",
    "#/unit/hiinguyen/evolo/push-5e0b7a1-7c1d2e9",
    "#/unit/hiinguyen/evolo/push-c94e2f0-5e0b7a1",
  ]);
  assert.equal(links.length, 9, "the page carries a short list for the tabs");
  assert.equal((html.match(/<a class="activity-card" hidden/g) ?? []).length, 4, "only the five newest are visible before a tab is pressed");
  assert.match(html, /data-kind="pr" data-xp="125" data-order="2"/);
  assert.match(html, /data-feed-filter="all" aria-pressed="true">All units/);
  assert.match(html, /data-feed-filter="pr"[^>]*>PRs only/);
  assert.match(html, /data-feed-filter="top"[^>]*>Top XP/);
  assert.match(html, /href="#\/timeline">View full timeline \(7 scored units\)<\/a>/);
});

test("an activity card shows the label, summary, repo, type, XP and the day it landed", () => {
  const [, ai, pr, failed, reverted] = sampleModel().units;
  const text = textOf(activityCard(pr));
  assert.match(text, /PR #1 hiinguyen\/ai-orgs • feature /);
  assert.match(text, /Phase 1 - scaffold, domain model and simulation engine/);
  assert.match(text, /Built the phase 1 foundation/);
  assert.match(text, /\+125 XP 2026-10-20/);
  assert.match(textOf(activityCard(ai)), /push 7c1d2e9\.\.a2205df hiinguyen\/evolo • bugfix .* \+60 XP 2026-10-21/);
  // A unit that is not worth XP shows its status and the zero it is worth now.
  assert.match(activityCard(failed), /<span class="pill activity-state pill-bad">failed<\/span>/);
  assert.match(textOf(activityCard(failed)), /0 XP 2026-10-19/);
  assert.match(activityCard(reverted), /<span class="pill activity-state">reverted<\/span>/);
  assert.match(textOf(activityCard(reverted)), /\+40 XP 2026-10-16/);
  assert.match(textOf(activityCard(failed)), /hiinguyen\/evolo • push failed/, "a failed unit has its kind for a type");
});

test("text from the ledger is escaped in an activity card", () => {
  const [first] = sampleModel().units;
  const card = activityCard({ ...first, summary: "<script>alert(1)</script>", label: "<b>x</b>", repo: 'a"b' });
  assert.ok(!card.includes("<script>"));
  assert.ok(!card.includes("<b>"));
  assert.ok(card.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(card.includes("a&quot;b"));
  const page = renderOverview({ ...sampleModel(), units: [{ ...first, summary: "<script>alert(1)</script>" }] });
  assert.ok(!page.includes("<script>"));
});

test("a key with characters of a URL is encoded in the link", () => {
  const [first] = sampleModel().units;
  const card = activityCard({ ...first, key: 'me/a"b/pr-1' });
  assert.match(card, /href="#\/unit\/me\/a%22b\/pr-1"/);
});

test("the rail shows XP by type for the week", () => {
  const text = textOf(renderOverview(sampleModel()));
  assert.match(text, /XP by type This week/);
  assert.match(text, /feature 64% 1 unit/);
  assert.match(text, /bugfix 31% 1 unit/);
  assert.match(text, /docs 5% 1 unit/);
});

test("the rail shows the achievements that moved this week, four at most, hidden when there are none", () => {
  const model = sampleModel();
  const html = renderOverview(model);
  assert.match(textOf(html), /Achievements 4 moved/);
  assert.equal(count(html, 'class="badge"'), 4);
  const empty = renderOverview({ ...model, achievements: { ...model.achievements, recent: [] } });
  assert.ok(!empty.includes('class="badge'));
  assert.match(textOf(empty), /Achievements No achievement moved this week\./);
});

test("an achievement that rose two tiers this week is one badge at the higher tier, in the model's order", () => {
  const model = sampleModel();
  const entry = (id, name, tier) => ({ id, name, label: `${name} ${tier}`, description: "", hidden: false, tier, at: "2026-10-20T05:00:00.000Z" });
  const recent = [entry("overdrive", "Overdrive", 1), entry("polyglot", "Polyglot", 1), entry("overdrive", "Overdrive", 2), entry("polyglot", "Polyglot", 2)];
  const html = renderOverview({ ...model, achievements: { ...model.achievements, recent } });
  const badges = [...html.matchAll(/<span class="emblem-tier">([^<]*)<\/span><\/span><span class="badge-name">([^<]*)</g)].map(([, mark, name]) => `${name} ${mark}`);
  assert.deepEqual(badges, ["Overdrive II", "Polyglot II"]);
  assert.match(textOf(html), /Achievements 2 moved/);
  assert.equal(model.achievements.recent.length, 4, "the model passed in is not changed");
});

test("the rail shows the last seven days and ends with a link to the rest when more than four moved", () => {
  const model = sampleModel();
  const names = Array.from({ length: 6 }, (_, index) => `Badge${index + 1}`);
  const recent = names.map((name, index) => ({ id: `id${index}`, name, label: `${name} 1`, description: "", hidden: false, tier: 1, at: "2026-10-20T05:00:00.000Z" }));
  const html = renderOverview({ ...model, achievements: { ...model.achievements, recent } });
  assert.equal(count(html, 'class="badge"'), 4);
  assert.ok(html.includes("Badge4") && !html.includes("Badge5"));
  assert.match(html, /<a class="rail-more" href="#\/achievements">\+2 more this week<\/a>/);
  assert.match(textOf(html), /Weekly velocity 7 days/);
  assert.match(textOf(html), /195 XP in seven days · best Tue 125 XP/);
});

test("money takes thousands separators, and a long amount stays one value", () => {
  const model = sampleModel();
  const text = textOf(renderOverview({ ...model, budget: { spent: 1234.5, limit: 9999.99 } }));
  assert.match(text, /Judge today 12% \$1,234\.50 of \$9,999\.99 daily limit/);
});

test("a badge's numeral and tier label are escaped like any other text", () => {
  // A tier that compares as 12 but prints as markup: the numeral falls back to the tier's text.
  const tier = { valueOf: () => 12, toString: () => "<b>x</b>" };
  const html = badge({ name: "Odd", description: "", tiers: [1, 2] }, tier);
  assert.ok(!html.includes("<b>"));
  assert.match(html, /aria-hidden="true">&lt;b&gt;x&lt;\/b&gt;</);
  assert.match(html, /aria-label="Tier &lt;b&gt;x&lt;\/b&gt; of 2"/);
});

test("a badge wears the achievement's framed emblem, the tier's numeral and one pip per tier", () => {
  const html = badge({ id: "bug-hunter", name: "Bug Hunter", description: "Fix <bugs>", tiers: [3, 10, 30] }, 2);
  assert.match(html, /<span class="emblem" aria-hidden="true"><svg class="emblem-art dashed" data-frame="hex"/);
  assert.match(html, /class="emblem-frame"/);
  assert.match(html, /<span class="emblem-tier">II<\/span>/);
  assert.match(html, /<span class="badge-name">Bug Hunter<\/span>/);
  assert.equal(count(html, 'class="pip on"'), 2);
  assert.equal(count(html, 'class="pip"'), 1);
  assert.match(html, /aria-label="Tier 2 of 3"/);
  assert.match(html, /title="Fix &lt;bugs&gt;"/);
  assert.match(badge({ name: "Secret", description: "", tiers: [1], hidden: true }, 1), /class="emblem-glyph"/);
  assert.ok(!badge({ name: "Secret", description: "", tiers: [1], hidden: true }, 1).includes("emblem-frame"), "a secret's badge has no frame polygon");
  assert.match(badge({ id: "bug-hunter", name: "Locked", description: "", tiers: [1, 5] }, 0), /class="badge locked"/);
  assert.ok(!badge({ id: "bug-hunter", name: "Locked", description: "", tiers: [1, 5] }, 0).includes("emblem-tier"));
  assert.match(badge({ name: "<i>", description: "", tiers: [1] }, 1), /&lt;i&gt;/);
});

test("the footer says when the page was made, in local time", () => {
  const text = textOf(renderOverview(sampleModel()));
  assert.match(text, /Generated 2026-10-21 13:00 · updates after each scored unit/);
});

test("an empty ledger shows how to get the first score", () => {
  const model = sampleModel();
  const html = renderOverview({ ...model, units: [], achievements: { ...model.achievements, recent: [] } });
  assert.match(textOf(html), /No scored units yet: push to the default branch or merge a PR in a repository set up with evolo init \./);
  assert.match(html, /<code>evolo init<\/code>/);
  assert.ok(!html.includes("activity-card"));
  assert.ok(!html.includes("Level 4"));
});
