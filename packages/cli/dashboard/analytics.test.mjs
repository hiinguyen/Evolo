// The Analytics screen, drawn from the sample model of fixtures.mjs; its numbers are checked against the lines `evolo
// stats` prints for the same computeStats. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStats } from "../src/views.mjs";
import { renderAnalytics } from "./analytics.mjs";
import { sampleModel } from "./fixtures.mjs";

const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const POISON = '<img src=x onerror="alert(1)">';
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " ");
const units = (count) => `${count} unit${count === "1" ? "" : "s"}`;

// The text of the row `name` of `evolo stats`, without its name.
const statsRow = (lines, name) => lines.find((line) => line.startsWith(name.padEnd(10))).slice(10);

// Every number `evolo stats` prints for `current` (against `previous`) is on the page, in the page's words.
function assertMatchesStats(html, current, previous) {
  const lines = formatStats(current, previous, { current: 0, longest: 0 });
  const text = textOf(html);
  const [, xp, xpChange = "", count, countChange = "", level, cost] =
    /^([\d,]+) XP(?: \(([+-][\d,]+)\))?  (\d+) units?(?: \(([+-]\d+)\))?  level (\d+)  judge (\$[\d.]+)$/.exec(lines[1]);
  assert.ok(text.includes(` XP ${xp} ${xpChange}`.trimEnd()), `XP ${xp} ${xpChange}`);
  assert.ok(text.includes(` Units ${count} ${countChange}`.trimEnd()), `Units ${count} ${countChange}`);
  assert.equal(xpChange === "", !text.includes(` XP ${xp} +`) && !text.includes(` XP ${xp} -`));
  assert.ok(text.includes(` Level ${level} `), `Level ${level}`);
  assert.ok(text.includes(` Judge cost ${cost} `), `Judge cost ${cost}`);

  for (const [, type, n, typeXp] of statsRow(lines, "types").matchAll(/(\S+) (\d+) \(([\d,]+) XP\)/g)) {
    assert.ok(text.includes(` ${type} ${units(n)} · ${typeXp} XP `), `type ${type}`);
  }
  const rubric = statsRow(lines, "rubric");
  for (const [, criterion, average, change] of rubric.matchAll(/(\w+) (\d\.\d)(?: \(([+-]\d\.\d)\))?/g)) {
    const before = change ? ` ${previous.rubric.averages[criterion].toFixed(1)} ${change}` : "";
    assert.ok(text.includes(` ${sentenceCase(criterion)} ${average}${before} `), `rubric ${criterion}`);
  }
  assert.ok(text.includes(` ${/\(n=(\d+)\)/.exec(rubric)[1]} judged unit`));
  const tests = statsRow(lines, "tests");
  if (tests === "no units with code in a repository with tests") {
    assert.ok(text.includes(" Tests 0 units with code in a repository with tests "));
  } else {
    const [, share, change] = /^(\d+ of \d+ units? with code touched tests \(\d+%\))(?: \(([+-]\d+)\))?$/.exec(tests);
    assert.ok(text.includes(share + (change ? ` · ${change} pts` : " ")), `${share} ${change}`);
  }
  const [, reverted, total] = /^(\d+) of (\d+)$/.exec(statsRow(lines, "reverted"));
  assert.ok(text.includes(` Reverted ${reverted} of ${units(total)} `), `reverted ${reverted} of ${total}`);
  for (const [, repo, repoXp, n] of statsRow(lines, "repos").matchAll(/(\S+) ([\d,]+) XP \((\d+)\)/g)) {
    assert.ok(text.includes(` ${repo} ${units(n)} · ${repoXp} XP `), `repo ${repo}`);
  }
  for (const [, dir, lines_] of statsRow(lines, "dirs").matchAll(/(\S+) ([\d,]+)/g)) {
    assert.ok(text.includes(` ${dir} ${lines_} line`), `dir ${dir}`);
  }
  for (const [, day, n] of statsRow(lines, "weekdays").matchAll(/(\w{3}) (\d+)/g)) {
    assert.ok(html.includes(`title="${day}: ${n} commit`), `weekday ${day}`);
  }
}

test("each kind and period shows its own numbers, the same as evolo stats", () => {
  const model = sampleModel();
  for (const kind of ["week", "month", "quarter"]) {
    const { current, previous } = model.periods[kind];
    const html = renderAnalytics(model, kind, "current");
    assert.match(textOf(html), new RegExp(`Analytics ${current.period.label.replace(/\./g, "\\.")} `));
    assertMatchesStats(html, current, previous);
  }
  for (const kind of ["month", "quarter"]) {
    const { previous } = model.periods[kind];
    const html = renderAnalytics(model, kind, "previous");
    assert.match(textOf(html), new RegExp(`Analytics ${previous.period.label} `));
    // The model holds two periods, so the previous one is shown on its own, as `evolo stats --previous` shows its numbers.
    assertMatchesStats(html, previous, null);
    assert.ok(!textOf(html).includes(" vs "));
  }
});

test("the month against the month before: its changes and the rubric of both", () => {
  const text = textOf(renderAnalytics(sampleModel(), "month", "current"));
  assert.match(text, / XP 795 \+550 vs 2026-09 /);
  assert.match(text, / Units 6 \+5 vs 2026-09 /);
  assert.match(text, / Impact 2\.6 3\.0 -0\.4 /);
  assert.match(text, / Centrality 2\.8 2\.0 \+0\.8 /);
  assert.match(text, /4 of 4 units with code touched tests \(100%\)/);
  assert.match(text, / Reverted 1 of 7 units /);
});

test("the share of units that touched tests is compared with the previous period's when it had any", () => {
  const model = sampleModel();
  const { current, previous } = model.periods.month;
  const withTests = { ...previous, tests: { touched: 1, eligible: 2 } };
  const html = renderAnalytics({ ...model, periods: { ...model.periods, month: { current, previous: withTests } } }, "month", "current");
  assertMatchesStats(html, current, withTests);
  assert.match(textOf(html), /4 of 4 units with code touched tests \(100%\) · \+50 pts /);
});

test("XP by day has one column per day of the period so far, each titled with its day and XP", () => {
  const model = sampleModel();
  const html = renderAnalytics(model, "month", "current");
  assert.equal([...html.matchAll(/<rect class="bar"/g)].length, model.periods.month.current.days.length);
  assert.equal(model.periods.month.current.days.length, 21);
  assert.match(html, /<title>2026-10-08: 300 XP<\/title>/);
  assert.match(html, /<title>2026-10-01: 0 XP<\/title>/);
  // The hours of the commits, one cell per hour.
  assert.match(html, /title="09:00: 1 commit"/);
  assert.equal([...html.matchAll(/<span class="cell level-/g)].length, 24 + 7);
});

test("the period switcher is links that keep the other choice, the open ones marked", () => {
  const html = renderAnalytics(sampleModel(), "month", "previous");
  const links = [...html.matchAll(/<a class="segment" href="([^"]*)"( aria-current="page")?>([^<]*)<\/a>/g)]
    .map(([, href, current, label]) => `${label} ${href}${current ? " *" : ""}`);
  assert.deepEqual(links, [
    "Week #/analytics/week/previous",
    "Month #/analytics/month/previous *",
    "Quarter #/analytics/quarter/previous",
    "This month #/analytics/month/current",
    "Previous month #/analytics/month/previous *",
  ]);
});

test("a period without units says so, under the switcher", () => {
  const model = sampleModel();
  const html = renderAnalytics(model, "week", "previous");
  assert.match(textOf(html), /Nothing landed in week 2026-10-12\.\.2026-10-18/);
  assert.match(html, /class="segment"/);
  assert.ok(!html.includes("<svg"));
});

test("the previous week has no units, so this week shows no change against it", () => {
  const text = textOf(renderAnalytics(sampleModel(), "week", "current"));
  assert.match(text, / XP 195 Units 3 /);
  assert.ok(!text.includes(" vs "));
});

test("text from the ledger is escaped", () => {
  const model = sampleModel();
  const { current } = model.periods.month;
  const poisoned = {
    ...current,
    period: { ...current.period, label: POISON },
    types: [{ type: POISON, units: 1, xp: 5 }],
    repos: [{ repo: POISON, units: 1, xp: 5 }],
    dirs: [{ repo: POISON, dir: POISON, lines: 3 }],
    days: [{ day: POISON, xp: 5 }],
  };
  const html = renderAnalytics({ ...model, periods: { ...model.periods, month: { ...model.periods.month, current: poisoned } } }, "month", "current");
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});
