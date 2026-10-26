// The Timeline screen, drawn from the sample model of fixtures.mjs. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHash } from "./app.mjs";
import { EVOLO, ORGS, sampleModel } from "./fixtures.mjs";
import { filterUnits, renderTimeline, timelineHash } from "./timeline.mjs";

// The visible text of `html`, with tags dropped and runs of space joined, to match sentences that span elements.
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const idsOf = (units) => units.map((unit) => unit.id);
const linksOf = (html) => [...html.matchAll(/<a class="activity-card"[^>]* href="([^"]*)"/g)].map(([, href]) => href);
const cardOf = (html, id) => html.split('<a class="activity-card"').find((card) => card.includes(`/${id}"`));

// The options of the select called `name`: [value, text, selected].
function optionsOf(html, name) {
  const [, body] = new RegExp(`<select name="${name}"[^>]*>(.*?)</select>`).exec(html);
  return [...body.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map(([, value, selected, text]) => [value, text, Boolean(selected)]);
}

test("filterUnits keeps the units equal to each filter, alone and together", () => {
  const { units } = sampleModel();
  assert.deepEqual(idsOf(filterUnits(units, { repo: ORGS })), ["pr-1", "push-root-3c4d5e6", "push-root-0a1b2c3"]);
  assert.deepEqual(idsOf(filterUnits(units, { type: "docs" })), ["push-a2205df-b31f0c4", "push-root-0a1b2c3"]);
  assert.deepEqual(idsOf(filterUnits(units, { status: "reverted" })), ["push-c94e2f0-5e0b7a1"]);
  // A unit never judged has its kind for a type, as its row shows.
  assert.deepEqual(idsOf(filterUnits(units, { type: "push" })), ["push-5e0b7a1-7c1d2e9"]);
  assert.deepEqual(idsOf(filterUnits(units, { repo: EVOLO, type: "feature" })), ["push-c94e2f0-5e0b7a1", "pr-7", "push-9a8b7c6-1f2e3d4"]);
  assert.deepEqual(idsOf(filterUnits(units, { repo: EVOLO, type: "feature", status: "scored" })), ["pr-7", "push-9a8b7c6-1f2e3d4"]);
  assert.deepEqual(idsOf(filterUnits(units, { repo: ORGS, type: "bugfix" })), []);
});

test("filterUnits compares exactly and ignores an empty or unknown filter", () => {
  const { units } = sampleModel();
  assert.equal(filterUnits(units, {}).length, units.length);
  assert.equal(filterUnits(units, { repo: "", type: "", status: "" }).length, units.length);
  assert.equal(filterUnits(units, { severity: "high" }).length, units.length);
  assert.deepEqual(filterUnits(units, { repo: "hiinguyen" }), [], "a prefix is not a match");
  assert.deepEqual(filterUnits(units, { repo: EVOLO.toUpperCase() }), [], "case counts");
  const before = structuredClone(units);
  filterUnits(units, { repo: ORGS });
  assert.deepEqual(units, before, "the units passed in are not changed");
});

test("each select offers the values found in the units, sorted, and marks the chosen one", () => {
  const model = sampleModel();
  const html = renderTimeline(model, {});
  assert.deepEqual(optionsOf(html, "repo"), [["", "All repositories", true], [ORGS, ORGS, false], [EVOLO, EVOLO, false]]);
  assert.deepEqual(optionsOf(html, "type").map(([value]) => value), ["", "bugfix", "chore", "docs", "feature", "push"]);
  assert.deepEqual(optionsOf(html, "status"), [["", "All statuses", true], ["failed", "failed", false], ["reverted", "reverted", false], ["scored", "scored", false]]);
  const chosen = renderTimeline(model, { repo: ORGS, status: "scored" });
  assert.deepEqual(optionsOf(chosen, "repo").filter(([, , selected]) => selected).map(([value]) => value), [ORGS]);
  assert.deepEqual(optionsOf(chosen, "type").filter(([, , selected]) => selected).map(([value]) => value), [""]);
  assert.deepEqual(optionsOf(chosen, "status").filter(([, , selected]) => selected).map(([value]) => value), ["scored"]);
  // Each select has a visible label.
  for (const name of ["repo", "type", "status"]) assert.match(html, new RegExp(`<label[^>]*><span[^>]*>[A-Z][a-z]+</span><select name="${name}"`));
});

test("a value only an old bookmark knows is still offered, so the select shows what filters the list", () => {
  const html = renderTimeline(sampleModel(), { type: "perf" });
  assert.deepEqual(optionsOf(html, "type").filter(([, , selected]) => selected), [["perf", "perf", true]]);
});

test("every unit is listed newest first, each a card linking to its details", () => {
  const model = sampleModel();
  const html = renderTimeline(model, {});
  assert.equal(linksOf(html).length, model.units.length);
  assert.equal(linksOf(html)[0], "#/unit/hiinguyen/evolo/push-a2205df-b31f0c4");
  assert.match(textOf(html), /Timeline 9 recorded units /);
  const filtered = renderTimeline(model, { repo: ORGS });
  assert.deepEqual(linksOf(filtered), ["#/unit/hiinguyen/ai-orgs/pr-1", "#/unit/hiinguyen/ai-orgs/push-root-3c4d5e6", "#/unit/hiinguyen/ai-orgs/push-root-0a1b2c3"]);
  assert.match(textOf(filtered), /Timeline 3 of 9 recorded units /);
});

test("units are grouped under the local day they landed, newest day first", () => {
  const html = renderTimeline(sampleModel(), {});
  const groups = [...html.matchAll(/<section class="timeline-group" aria-label="([^"]*)">([\s\S]*?)<\/section>/g)];
  assert.deepEqual(groups.map(([, label]) => label),
    ["October 21, 2026", "October 20, 2026", "October 19, 2026", "October 16, 2026", "October 8, 2026", "October 7, 2026", "October 6, 2026", "September 29, 2026"]);
  const [, , first] = groups[0];
  assert.match(first, /<span class="day-marker">21<\/span>/);
  assert.match(first, /<span class="day-count">\(2 updates\)<\/span>/);
  assert.equal((first.match(/class="activity-card"/g) ?? []).length, 2, "the two units of the day share one group");
});

test("the search matches every word across the card, the commits and the PR title", () => {
  const { units } = sampleModel();
  assert.deepEqual(idsOf(filterUnits(units, { q: "local time" })), ["push-a2205df-b31f0c4", "push-7c1d2e9-a2205df"]);
  assert.deepEqual(idsOf(filterUnits(units, { q: "time local" })), ["push-a2205df-b31f0c4", "push-7c1d2e9-a2205df"], "word order does not matter");
  assert.deepEqual(idsOf(filterUnits(units, { q: "simulation engine" })), ["pr-1"], "a PR title is searched");
  assert.deepEqual(idsOf(filterUnits(units, { q: "reverted" })), ["push-c94e2f0-5e0b7a1"], "the status is searched");
  assert.equal(filterUnits(units, { q: "   " }).length, units.length, "blank text is no search");
  assert.deepEqual(filterUnits(units, { q: "no such text" }), []);
});

test("the search box remembers the query and the count says how many match", () => {
  const html = renderTimeline(sampleModel(), { q: "local time" });
  assert.match(html, /<input type="search" name="q" data-filter value="local time"/);
  assert.equal(linksOf(html).length, 2);
  assert.match(textOf(html), /Timeline 2 of 9 recorded units /);
});

test("a unit not worth XP has its status, and the XP it lost is struck through", () => {
  const model = sampleModel();
  const html = renderTimeline(model, {});
  const failed = cardOf(html, "push-5e0b7a1-7c1d2e9");
  assert.match(failed, /<span class="pill activity-state pill-bad">failed<\/span>/);
  assert.ok(!failed.includes("unit-lost"), "a failed unit never had XP to lose");
  const reverted = cardOf(html, "push-c94e2f0-5e0b7a1");
  assert.match(reverted, /<s class="unit-lost activity-lost"[^>]*>\+40 XP<\/s>/);
  assert.match(reverted, /<span class="pill activity-state">reverted<\/span>/);
  assert.ok(!cardOf(html, "pr-7").includes("unit-lost"));
  // A force push that took a scored unit's commits away: superseded, and its XP struck through too.
  const [, second] = model.units;
  const superseded = { ...second, status: "superseded", previousStatus: "scored", xp: 0 };
  const struck = renderTimeline({ ...model, units: [superseded] }, {});
  assert.match(struck, /<s class="unit-lost activity-lost"[^>]*>\+60 XP<\/s>/);
  assert.match(struck, /<span class="pill activity-state">superseded<\/span>/);
});

test("filters that leave nothing say so, with a way to clear them", () => {
  const html = renderTimeline(sampleModel(), { repo: ORGS, type: "bugfix" });
  assert.match(textOf(html), /No units match these filters/);
  assert.match(html, /<a [^>]*href="#\/timeline"[^>]*>Clear filters<\/a>/);
  assert.ok(!html.includes("activity-card"));
  assert.match(textOf(html), /Timeline 0 of 9 recorded units /);
});

test("an empty ledger shows how to get the first score, without filters", () => {
  const html = renderTimeline({ ...sampleModel(), units: [] }, {});
  assert.match(textOf(html), /No units yet/);
  assert.ok(!html.includes("<select"));
});

test("timelineHash puts only the chosen search and filters in the address, which parseHash reads back", () => {
  assert.equal(timelineHash({ repo: "", type: "", status: "", q: "" }), "#/timeline");
  assert.equal(timelineHash({}), "#/timeline");
  const hash = timelineHash({ repo: "me/a b&c", type: "", status: "scored", q: "local time" });
  assert.equal(hash, "#/timeline?repo=me%2Fa+b%26c&status=scored&q=local+time");
  assert.deepEqual(parseHash(hash).query, { repo: "me/a b&c", status: "scored", q: "local time" });
});

test("names from the ledger are escaped in the selects", () => {
  const model = sampleModel();
  const [first] = model.units;
  const html = renderTimeline({ ...model, units: [{ ...first, repo: '<img src=x onerror="alert(1)">' }] }, {});
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});
