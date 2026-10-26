// The router and the frame of the dashboard (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6).
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAchievements } from "./achievements.mjs";
import { renderAnalytics } from "./analytics.mjs";
import { drawScreen, feedSelection, parseHash, readModel, renderRoute, renderShell, syncText } from "./app.mjs";
import { sampleModel } from "./fixtures.mjs";
import { renderOverview } from "./overview.mjs";
import { renderReport, renderReports } from "./reports.mjs";
import { renderReviews } from "./reviews.mjs";
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
  assert.deepEqual(parseHash("#/reports"), route("reports"));
  for (const kind of ["week", "month", "quarter"]) {
    assert.deepEqual(parseHash(`#/reports/${kind}/2026-10-01`), route("reports", { id: `${kind}/2026-10-01` }));
  }
});

test("parseHash decodes the query and each part of the path", () => {
  assert.deepEqual(parseHash("#/timeline?repo=a%2Fb&type=feature"), route("timeline", {}, { repo: "a/b", type: "feature" }));
  assert.deepEqual(parseHash("#/timeline?q=local+time"), route("timeline", {}, { q: "local time" }));
  assert.deepEqual(parseHash("#/reviews?severity=high"), route("reviews", {}, { severity: "high" }));
  assert.deepEqual(parseHash("#/unit/me/a%20b/pr-1/review"), route("unit", { key: "me/a b/pr-1", tab: "review" }));
});

test("parseHash sends an address it does not know to notFound", () => {
  for (const hash of ["#/nowhere", "#main", "#/unit/me/a", "#/unit/me/a/pr-1/diff", "#/unit/me/a/pr-1/score/extra",
    "#/analytics/year/current", "#/analytics/week/next", "#/timeline/extra", "#/unit/%E0%A4%A/a/pr-1",
    "#/reports/week", "#/reports/year/2026-10-01", "#/reports/week/latest", "#/reports/week/2026-10-19/extra"]) {
    assert.equal(parseHash(hash).screen, "notFound", hash);
  }
  assert.deepEqual(parseHash("#/nowhere?x=1").query, { x: "1" });
});

test("renderShell lists the six screens and marks the open one", () => {
  const model = sampleModel();
  const current = (html) => [...html.matchAll(/<a href="([^"]*)"[^>]*aria-current="page"/g)].map(([, href]) => href);
  const shell = renderShell(model, route("overview"), "<p>content</p>");
  for (const name of ["Overview", "Timeline", "Analytics", "Achievements", "Reviews", "Reports"]) assert.match(shell, new RegExp(`<span>${name}</span>`));
  assert.match(shell, /<a class="brand" href="#\/">/);
  assert.match(shell, /<span class="brand-version">v\d+\.\d+\.\d+<\/span>/);
  assert.match(shell, /<span>Timeline<\/span><span class="nav-badge">9<\/span>/);
  assert.match(shell, /<span>Achievements<\/span><span class="nav-dot"/);
  assert.deepEqual(current(shell), ["#/"]);
  assert.ok(shell.includes("<p>content</p>"));
  assert.deepEqual(current(renderShell(model, route("reviews"), "")), ["#/reviews"]);
  assert.deepEqual(current(renderShell(model, route("reports", { id: "week/2026-10-19" }), "")), ["#/reports"]);
  assert.deepEqual(current(renderShell(model, route("analytics", { kind: "month", which: "previous" }), "")), ["#/analytics"]);
  // A unit's details belong to the Timeline; an unknown address shows the Overview.
  assert.deepEqual(current(renderShell(model, route("unit", { key: "me/a/pr-1", tab: "score" }), "")), ["#/timeline"]);
  assert.deepEqual(current(renderShell(model, route("notFound"), "")), ["#/"]);
  assert.match(shell, /<span class="rank-chip rank-muted">Intern<\/span>/);
  assert.match(shell, /aria-label="Level 4, 0% to level 5"/);
  assert.match(shell, /class="identity-meta">1,040 XP</);
  assert.match(shell, /<button type="button" class="segment" data-theme-choice="system" aria-pressed="true">System<\/button>/);
});

test("the identity block escapes the name and wears the rank's effect, and the theme control marks the configured theme", () => {
  const model = sampleModel();
  const shell = renderShell({ ...model, name: "<b>Minh</b>", theme: "dark", rank: { name: "Senior Dev", effect: "gradient" } }, route("overview"), "");
  assert.match(shell, /<span class="identity-name">&lt;b&gt;Minh&lt;\/b&gt;<\/span>/);
  assert.ok(!shell.includes("<b>Minh</b>"));
  assert.match(shell, /<span class="rank-chip rank-gradient">Senior Dev<\/span>/);
  assert.match(shell, /data-theme-choice="dark" aria-pressed="true"/);
  assert.match(shell, /data-theme-choice="system" aria-pressed="false"/);
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
  assert.equal(renderRoute(model, parseHash("#/timeline?q=local+time")), renderTimeline(model, { q: "local time" }));
  assert.equal(renderRoute(model, parseHash("#/unit/hiinguyen/ai-orgs/pr-1")), renderUnit(model, "hiinguyen/ai-orgs/pr-1", "score"));
  assert.equal(renderRoute(model, parseHash("#/unit/hiinguyen/ai-orgs/pr-1/commits")), renderUnit(model, "hiinguyen/ai-orgs/pr-1", "commits"));
  assert.match(renderRoute(model, parseHash("#/unit/me/gone/pr-1")), /This unit is no longer in the ledger/);
});

test("renderRoute draws the analytics of the period the address names, this week by default", () => {
  const model = sampleModel();
  assert.equal(renderRoute(model, parseHash("#/analytics")), renderAnalytics(model, "week", "current"));
  assert.equal(renderRoute(model, parseHash("#/analytics/month/previous")), renderAnalytics(model, "month", "previous"));
  assert.ok(!renderRoute(model, parseHash("#/analytics/quarter/current")).includes("Nothing at this address"));
});

test("renderRoute draws the achievements, and the reviews with the severity of the address", () => {
  const model = sampleModel();
  assert.equal(renderRoute(model, parseHash("#/achievements")), renderAchievements(model));
  assert.equal(renderRoute(model, parseHash("#/reviews")), renderReviews(model, {}));
  assert.equal(renderRoute(model, parseHash("#/reviews?severity=high")), renderReviews(model, { severity: "high" }));
  assert.equal(renderRoute(model, parseHash("#/reports")), renderReports(model));
  assert.equal(renderRoute(model, parseHash("#/reports/week/2026-10-19")), renderReport(model, "week/2026-10-19"));
  assert.ok(!renderRoute(model, parseHash("#/reviews?severity=low")).includes("Nothing at this address"));
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

test("the sync mark grows older in the reader's time instead of claiming a live sync", () => {
  const at = "2026-10-21T06:00:00+07:00";
  assert.equal(syncText(at, new Date("2026-10-21T06:00:30+07:00")), "Synced just now");
  assert.equal(syncText(at, new Date("2026-10-21T06:05:00+07:00")), "Synced 5 min ago");
  assert.equal(syncText(at, new Date("2026-10-21T09:00:00+07:00")), "Synced 3 h ago");
  assert.equal(syncText(at, new Date("2026-10-24T09:00:00+07:00")), "Synced 2026-10-21");
  assert.equal(syncText("not a time", new Date()), "Synced");
  assert.equal(syncText(at, new Date("2026-10-21T05:00:00+07:00")), "Synced just now", "a clock behind the page is not negative");
});

test("a feed tab keeps the newest five of its kind, or the five worth the most", () => {
  const cards = [
    { order: 0, kind: "push", xp: 10 },
    { order: 1, kind: "pr", xp: 40 },
    { order: 2, kind: "push", xp: 5 },
    { order: 3, kind: "push", xp: 90 },
    { order: 4, kind: "pr", xp: 20 },
    { order: 5, kind: "pr", xp: 70 },
  ];
  assert.deepEqual(feedSelection(cards, "all", 3), [0, 1, 2]);
  assert.deepEqual(feedSelection(cards, "pr", 2), [1, 4]);
  assert.deepEqual(feedSelection(cards, "push", 2), [0, 2]);
  assert.deepEqual(feedSelection(cards, "top", 3), [3, 5, 1]);
  assert.deepEqual(feedSelection([], "all"), []);
});
