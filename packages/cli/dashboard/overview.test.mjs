// The Overview screen, drawn from the sample model of fixtures.mjs. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleModel } from "./fixtures.mjs";
import { badge, renderOverview, unitRow } from "./overview.mjs";

// The visible text of `html`, with tags dropped and runs of space joined, to match sentences that span elements.
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (html, needle) => html.split(needle).length - 1;

test("the level card shows the level, the total and the XP to the next level", () => {
  const model = sampleModel();
  const text = textOf(renderOverview(model));
  assert.match(text, /Level 7 /);
  assert.match(text, / 1,040 XP /);
  assert.match(text, / 240 XP to level 8 /);
  // (1040 - 980) / (1280 - 980) of the way from level 7 to level 8.
  assert.match(renderOverview(model), /aria-valuenow="20"[^>]*><span style="width:20%"><\/span>/);
});

test("today, the last 7 days, the streak, the judge's spending and the queue are shown", () => {
  const text = textOf(renderOverview(sampleModel()));
  assert.match(text, /Today \+70 XP /);
  assert.match(text, /Last 7 days \+195 XP /);
  assert.match(text, /Streak 2 workdays longest 3 /);
  // The day's scorings and review, and the sample's weekly report written that morning ($0.04).
  assert.match(text, /Judge today \$0\.37 of \$5\.00 daily limit /);
  assert.match(text, /Queue 1 waiting 1 job waiting for tomorrow's budget /);
});

test("the queue says nothing of tomorrow when no job is parked, and one workday is singular", () => {
  const model = sampleModel();
  const text = textOf(renderOverview({ ...model, queue: { waiting: 0, parked: 0 }, streak: { current: 1, longest: 3 } }));
  assert.match(text, /Queue 0 waiting /);
  assert.ok(!text.includes("tomorrow"));
  assert.match(text, /Streak 1 workday longest 3 /);
});

test("the five latest units are listed, newest first, each a link to its details", () => {
  const model = sampleModel();
  const html = renderOverview(model);
  const links = [...html.matchAll(/<a class="unit-row" href="([^"]*)"/g)].map(([, href]) => href);
  assert.deepEqual(links, [
    "#/unit/hiinguyen/evolo/push-a2205df-b31f0c4",
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df",
    "#/unit/hiinguyen/ai-orgs/pr-1",
    "#/unit/hiinguyen/evolo/push-5e0b7a1-7c1d2e9",
    "#/unit/hiinguyen/evolo/push-c94e2f0-5e0b7a1",
  ]);
  assert.ok(!html.includes("pr-7"), "the sixth unit is left for the Timeline");
  assert.match(html, /href="#\/timeline"/);
});

test("a unit row shows the label, summary, repo, type, XP and the day it landed", () => {
  const [, ai, pr, failed, reverted] = sampleModel().units;
  const text = textOf(unitRow(pr));
  assert.match(text, /PR #1 Built the phase 1 foundation/);
  assert.match(text, /hiinguyen\/ai-orgs · feature · 2026-10-20/);
  assert.match(text, /\+125 XP/);
  assert.match(textOf(unitRow(ai)), /push 7c1d2e9\.\.a2205df .* bugfix · 2026-10-21 \+60 XP/);
  // A unit that is not worth XP shows its status instead.
  assert.match(unitRow(failed), /<span class="pill pill-bad">failed<\/span>/);
  assert.ok(!textOf(unitRow(failed)).includes("XP"));
  assert.match(unitRow(reverted), /<span class="pill">reverted<\/span>/);
  assert.match(textOf(unitRow(failed)), /hiinguyen\/evolo · push · 2026-10-19/, "a failed unit has no judged type");
});

test("text from the ledger is escaped in a unit row", () => {
  const [first] = sampleModel().units;
  const row = unitRow({ ...first, summary: "<script>alert(1)</script>", label: "<b>x</b>", repo: 'a"b' });
  assert.ok(!row.includes("<script>"));
  assert.ok(!row.includes("<b>"));
  assert.ok(row.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(row.includes("a&quot;b"));
  const page = renderOverview({ ...sampleModel(), units: [{ ...first, summary: "<script>alert(1)</script>" }] });
  assert.ok(!page.includes("<script>"));
});

test("a key with characters of a URL is encoded in the link", () => {
  const [first] = sampleModel().units;
  const row = unitRow({ ...first, key: 'me/a"b/pr-1' });
  assert.match(row, /href="#\/unit\/me\/a%22b\/pr-1"/);
});

test("the achievements unlocked this week are a strip of badges, hidden when there are none", () => {
  const model = sampleModel();
  const html = renderOverview(model);
  assert.match(textOf(html), /Unlocked this week 4 achievements /);
  assert.equal(count(html, 'class="badge"'), 4);
  const empty = renderOverview({ ...model, achievements: { ...model.achievements, recent: [] } });
  assert.ok(!empty.includes("Unlocked this week"));
  assert.ok(!empty.includes('class="badge'));
});

test("an achievement that rose two tiers this week is one badge at the higher tier, in the model's order", () => {
  const model = sampleModel();
  const entry = (id, name, tier) => ({ id, name, label: `${name} ${tier}`, description: "", hidden: false, tier, at: "2026-10-20T05:00:00.000Z" });
  const recent = [entry("overdrive", "Overdrive", 1), entry("polyglot", "Polyglot", 1), entry("overdrive", "Overdrive", 2), entry("polyglot", "Polyglot", 2)];
  const html = renderOverview({ ...model, achievements: { ...model.achievements, recent } });
  const badges = [...html.matchAll(/aria-hidden="true">([^<]*)<\/span><span class="badge-name">([^<]*)</g)].map(([, mark, name]) => `${name} ${mark}`);
  assert.deepEqual(badges, ["Overdrive II", "Polyglot II"]);
  assert.match(textOf(html), /Unlocked this week 2 achievements /);
  assert.equal(model.achievements.recent.length, 4, "the model passed in is not changed");
});

test("money takes thousands separators, and a long amount stays one value", () => {
  const model = sampleModel();
  const text = textOf(renderOverview({ ...model, budget: { spent: 1234.5, limit: 9999.99 } }));
  assert.match(text, /Judge today \$1,234\.50 of \$9,999\.99 daily limit /);
});

test("a badge's numeral and tier label are escaped like any other text", () => {
  // A tier that compares as 12 but prints as markup: the numeral falls back to the tier's text.
  const tier = { valueOf: () => 12, toString: () => "<b>x</b>" };
  const html = badge({ name: "Odd", description: "", tiers: [1, 2] }, tier);
  assert.ok(!html.includes("<b>"));
  assert.match(html, /aria-hidden="true">&lt;b&gt;x&lt;\/b&gt;</);
  assert.match(html, /aria-label="Tier &lt;b&gt;x&lt;\/b&gt; of 2"/);
});

test("a badge has the tier's numeral, the name and one pip per tier", () => {
  const html = badge({ name: "Bug Hunter", description: "Fix <bugs>", tiers: [3, 10, 30] }, 2);
  assert.match(html, /<span class="emblem" aria-hidden="true">II<\/span>/);
  assert.match(html, /<span class="badge-name">Bug Hunter<\/span>/);
  assert.equal(count(html, 'class="pip on"'), 2);
  assert.equal(count(html, 'class="pip"'), 1);
  assert.match(html, /aria-label="Tier 2 of 3"/);
  assert.match(html, /title="Fix &lt;bugs&gt;"/);
  assert.match(badge({ name: "Secret", description: "", tiers: [1], hidden: true }, 1), /aria-hidden="true">★</);
  assert.match(badge({ name: "Locked", description: "", tiers: [1, 5] }, 0), /class="badge locked"/);
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
  assert.ok(!html.includes("unit-row"));
  assert.ok(!html.includes("Level 7"));
});

test("the strip shows at most 10 badges in the model's order and ends with a link to the rest", () => {
  const model = sampleModel();
  const names = Array.from({ length: 12 }, (_, index) => `Badge${String(index + 1).padStart(2, "0")}`);
  const recent = names.map((name, index) => ({ id: `id${index}`, name, label: `${name} 1`, description: "", hidden: false, tier: 1, at: "2026-10-20T05:00:00.000Z" }));
  const html = renderOverview({ ...model, achievements: { ...model.achievements, recent } });
  assert.equal(count(html, 'class="badge"'), 10);
  assert.match(textOf(html), /Unlocked this week 12 achievements /);
  assert.ok(html.includes("Badge10") && !html.includes("Badge11"));
  assert.match(html, /<a class="badges-more" href="#\/achievements">\+2 more<\/a>/);
  const exact = renderOverview({ ...model, achievements: { ...model.achievements, recent: recent.slice(0, 10) } });
  assert.ok(!exact.includes("badges-more"));
});
