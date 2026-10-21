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
const linksOf = (html) => [...html.matchAll(/<a class="unit-row" href="([^"]*)"/g)].map(([, href]) => href);

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

test("every unit is listed newest first, each a link to its details", () => {
  const model = sampleModel();
  const html = renderTimeline(model, {});
  assert.equal(linksOf(html).length, model.units.length);
  assert.equal(linksOf(html)[0], "#/unit/hiinguyen/evolo/push-a2205df-b31f0c4");
  assert.match(textOf(html), /Timeline 9 units /);
  const filtered = renderTimeline(model, { repo: ORGS });
  assert.deepEqual(linksOf(filtered), ["#/unit/hiinguyen/ai-orgs/pr-1", "#/unit/hiinguyen/ai-orgs/push-root-3c4d5e6", "#/unit/hiinguyen/ai-orgs/push-root-0a1b2c3"]);
  assert.match(textOf(filtered), /Timeline 3 of 9 units /);
});

test("a unit not worth XP has its status, and the XP it lost is struck through", () => {
  const model = sampleModel();
  const html = renderTimeline(model, {});
  const rowOf = (id) => html.split('<a class="unit-row"').find((row) => row.includes(`/${id}"`));
  assert.match(rowOf("push-5e0b7a1-7c1d2e9"), /<span class="pill pill-bad">failed<\/span>/);
  assert.ok(!rowOf("push-5e0b7a1-7c1d2e9").includes("unit-lost"), "a failed unit never had XP to lose");
  assert.match(rowOf("push-c94e2f0-5e0b7a1"), /<s class="unit-lost"[^>]*>\+40 XP<\/s><span class="pill">reverted<\/span>/);
  assert.ok(!rowOf("pr-7").includes("unit-lost"));
  // A force push that took a scored unit's commits away: superseded, and its XP struck through too.
  const [, second] = model.units;
  const superseded = { ...second, status: "superseded", previousStatus: "scored", xp: 0 };
  const struck = renderTimeline({ ...model, units: [superseded] }, {});
  assert.match(struck, /<s class="unit-lost"[^>]*>\+60 XP<\/s><span class="pill">superseded<\/span>/);
});

test("filters that leave nothing say so, with a way to clear them", () => {
  const html = renderTimeline(sampleModel(), { repo: ORGS, type: "bugfix" });
  assert.match(textOf(html), /No units match these filters/);
  assert.match(html, /<a [^>]*href="#\/timeline"[^>]*>Clear filters<\/a>/);
  assert.ok(!html.includes("unit-row"));
  assert.match(textOf(html), /Timeline 0 of 9 units /);
});

test("an empty ledger shows how to get the first score, without filters", () => {
  const html = renderTimeline({ ...sampleModel(), units: [] }, {});
  assert.match(textOf(html), /No units yet/);
  assert.ok(!html.includes("<select"));
});

test("timelineHash puts only the chosen filters in the address, which parseHash reads back", () => {
  assert.equal(timelineHash({ repo: "", type: "", status: "" }), "#/timeline");
  assert.equal(timelineHash({}), "#/timeline");
  const hash = timelineHash({ repo: "me/a b&c", type: "", status: "scored" });
  assert.equal(hash, "#/timeline?repo=me%2Fa+b%26c&status=scored");
  assert.deepEqual(parseHash(hash).query, { repo: "me/a b&c", status: "scored" });
});

test("names from the ledger are escaped in the selects", () => {
  const model = sampleModel();
  const [first] = model.units;
  const html = renderTimeline({ ...model, units: [{ ...first, repo: '<img src=x onerror="alert(1)">' }] }, {});
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});
