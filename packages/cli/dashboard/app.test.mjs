// The router and the frame of the dashboard (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6).
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { drawScreen, parseHash, readModel, renderRoute, renderShell } from "./app.mjs";
import { sampleModel } from "./fixtures.mjs";
import { renderOverview } from "./overview.mjs";
import { renderTimeline } from "./timeline.mjs";
import { renderUnit } from "./unit.mjs";

const route = (screen, params = {}, query = {}) => ({ screen, params, query });

test("parseHash reads every address of the spec", () => {
  assert.deepEqual(parseHash(""), route("overview"));
  assert.deepEqual(parseHash("#"), route("overview"));
  assert.deepEqual(parseHash("#/"), route("overview"));
  assert.deepEqual(parseHash("#/timeline"), route("timeline"));
  assert.deepEqual(parseHash("#/unit/hiinguyen/evolo/pr-9"), route("unit", { key: "hiinguyen/evolo/pr-9", tab: "score" }));
  for (const tab of ["score", "review", "files", "commits"]) {
    assert.deepEqual(parseHash(`#/unit/me/a/push-65d6615-a2205df/${tab}`), route("unit", { key: "me/a/push-65d6615-a2205df", tab }));
  }
  assert.deepEqual(parseHash("#/analytics"), route("analytics", { kind: "week", which: "current" }));
  for (const kind of ["week", "month", "quarter"]) {
    for (const which of ["current", "previous"]) {
      assert.deepEqual(parseHash(`#/analytics/${kind}/${which}`), route("analytics", { kind, which }));
    }
  }
  assert.deepEqual(parseHash("#/achievements"), route("achievements"));
  assert.deepEqual(parseHash("#/reviews"), route("reviews"));
});

test("parseHash decodes the query and each part of the path", () => {
  assert.deepEqual(parseHash("#/timeline?repo=a%2Fb&type=feature"), route("timeline", {}, { repo: "a/b", type: "feature" }));
  assert.deepEqual(parseHash("#/reviews?severity=high"), route("reviews", {}, { severity: "high" }));
  assert.deepEqual(parseHash("#/unit/me/a%20b/pr-1/review"), route("unit", { key: "me/a b/pr-1", tab: "review" }));
});

test("parseHash sends an address it does not know to notFound", () => {
  for (const hash of ["#/nowhere", "#main", "#/unit/me/a", "#/unit/me/a/pr-1/diff", "#/unit/me/a/pr-1/score/extra",
    "#/analytics/year/current", "#/analytics/week/next", "#/timeline/extra", "#/unit/%E0%A4%A/a/pr-1"]) {
    assert.equal(parseHash(hash).screen, "notFound", hash);
  }
  assert.deepEqual(parseHash("#/nowhere?x=1").query, { x: "1" });
});

test("renderShell lists the five screens and marks the open one", () => {
  const model = sampleModel();
  const current = (html) => [...html.matchAll(/<a href="([^"]*)" aria-current="page"/g)].map(([, href]) => href);
  const shell = renderShell(model, route("overview"), "<p>content</p>");
  for (const name of ["Overview", "Timeline", "Analytics", "Achievements", "Reviews"]) assert.match(shell, new RegExp(`<span>${name}</span>`));
  assert.match(shell, /<a class="brand" href="#\/">/);
  assert.deepEqual(current(shell), ["#/"]);
  assert.ok(shell.includes("<p>content</p>"));
  assert.deepEqual(current(renderShell(model, route("reviews"), "")), ["#/reviews"]);
  assert.deepEqual(current(renderShell(model, route("analytics", { kind: "month", which: "previous" }), "")), ["#/analytics"]);
  // A unit's details belong to the Timeline; an unknown address shows the Overview.
  assert.deepEqual(current(renderShell(model, route("unit", { key: "me/a/pr-1", tab: "score" }), "")), ["#/timeline"]);
  assert.deepEqual(current(renderShell(model, route("notFound"), "")), ["#/"]);
  assert.match(shell, /Level 7 · 1,040 XP/);
});

test("renderRoute draws the overview, and the overview with a notice for an unknown address", () => {
  const model = sampleModel();
  assert.equal(renderRoute(model, parseHash("#/")), renderOverview(model));
  const missing = renderRoute(model, parseHash("#/nowhere"));
  assert.match(missing, /Nothing at this address/);
  assert.ok(missing.endsWith(renderOverview(model)));
});

test("renderRoute draws the timeline with the filters of the address, and a unit's details on the tab it names", () => {
  const model = sampleModel();
  assert.equal(renderRoute(model, parseHash("#/timeline")), renderTimeline(model, {}));
  assert.equal(renderRoute(model, parseHash("#/timeline?repo=hiinguyen%2Fevolo&type=feature")),
    renderTimeline(model, { repo: "hiinguyen/evolo", type: "feature" }));
  assert.equal(renderRoute(model, parseHash("#/unit/hiinguyen/ai-orgs/pr-1")), renderUnit(model, "hiinguyen/ai-orgs/pr-1", "score"));
  assert.equal(renderRoute(model, parseHash("#/unit/hiinguyen/ai-orgs/pr-1/commits")), renderUnit(model, "hiinguyen/ai-orgs/pr-1", "commits"));
  assert.match(renderRoute(model, parseHash("#/unit/me/gone/pr-1")), /This unit is no longer in the ledger/);
});

test("drawScreen draws the frame and the screen into the root", () => {
  const model = sampleModel();
  const root = { innerHTML: "" };
  drawScreen(root, model, parseHash("#/"));
  assert.equal(root.innerHTML, renderShell(model, parseHash("#/"), renderOverview(model)));
});

test("a page that cannot be drawn shows an escaped message and a way back, never a blank page", (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const root = { innerHTML: "" };
  // A model without the fields the frame reads makes renderShell itself throw.
  drawScreen(root, { units: [] }, parseHash("#/"));
  assert.match(root.innerHTML, /^<div class="failure" role="alert"><p>The dashboard could not draw this page: /);
  assert.match(root.innerHTML, /<a href="#\/">Back to the overview<\/a>/);
  assert.ok(!root.innerHTML.includes('class="frame"'));

  const unreadable = { innerHTML: "" };
  assert.equal(readModel(unreadable, "<b>x</b>"), null);
  // The parser quotes the bad text in its message; it arrives escaped.
  const [, message] = /could not draw this page: (.*?)<\/p>/.exec(unreadable.innerHTML);
  assert.match(message, /&lt;/);
  assert.ok(!message.includes("<"));
  assert.deepEqual(readModel({ innerHTML: "" }, '{"a":1}'), { a: 1 });
  assert.equal(logged.mock.callCount(), 2);
});
