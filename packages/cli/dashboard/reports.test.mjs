// The Reports screen, drawn from the sample model of fixtures.mjs. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { EVOLO, ORGS, sampleModel } from "./fixtures.mjs";
import { renderReport, renderReports } from "./reports.mjs";

// The visible text of `html`: tags dropped, runs of space joined, and the apostrophe `escape` encodes read back.
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replaceAll("&#39;", "'");
const count = (html, needle) => html.split(needle).length - 1;
const ID = "week/2026-10-19";

// The sample model with the sample's weekly report and an older, finished month written from data that has changed.
function twoReports() {
  const model = sampleModel();
  const [week] = model.reports;
  const month = {
    ...week, id: "month/2026-09-01", kind: "month", label: "2026-09", start: "2026-08-31T17:00:00.000Z", end: "2026-09-30T17:00:00.000Z",
    inProgress: false, stale: true, again: null, failed: 0, at: "2026-10-01T09:00:00+07:00", language: "vi",
    report: { ...week.report, overview: "Một tháng <b>đầy</b> việc." },
  };
  return { ...model, reports: [week, month] };
}

test("the latest report is featured and the rest are an archive, each linking to its own address", () => {
  const html = renderReports(twoReports());
  assert.equal(count(html, "featured-report"), 1);
  assert.equal(count(html, 'class="report-card"'), 1);
  assert.match(html, /<a class="featured-open" href="#\/reports\/week\/2026-10-19">/);
  const links = [...html.matchAll(/<a class="report-card" href="([^"]*)"/g)].map(([, href]) => href);
  assert.deepEqual(links, ["#/reports/month/2026-09-01"]);
  const text = textOf(html);
  assert.match(text, /Reports 2 reports /);
  assert.match(text, /Report needs a check week 2026-10-19\.\.2026-10-25 Week · en · written 2026-10-21 · claude-sonnet-5-5 · \$0\.04 · 9s/);
  assert.match(text, /A week split between Evolo's views/);
  assert.match(text, /Month 2026-09 2026-10-01 vi · claude-sonnet-5-5 · \$0\.04 · 9s Một tháng/);
  assert.match(text, /Past &amp; archived reports Showing 1 earlier report/);
  assert.match(text, /XP earned 195 XP Scored units 3 Level 4 Report cost \$0\.04/);
  assert.match(text, /Velocity history 2 reports/);
  assert.match(text, /Sync sources 2 repositories/);
});

test("the featured report and the archive carry their state, and the writer's words are escaped", () => {
  const html = renderReports(twoReports());
  const [week] = html.split('<article class="panel featured-report">').slice(1);
  const [month] = html.split('<li><a class="report-card"').slice(1);
  assert.match(week, /<span class="pill">In progress<\/span>/);
  assert.doesNotMatch(week.split("Report focus mix")[0], /Stale/);
  assert.match(month, /<span class="pill sev-medium">Stale<\/span>/);
  assert.doesNotMatch(month, /In progress/);
  assert.match(month, /Một tháng &lt;b&gt;đầy&lt;\/b&gt; việc\./);
  assert.match(week, /The week was not over|Report integrity/);
});

test("without a saved report the screen says how to write one", () => {
  const html = renderReports({ ...sampleModel(), reports: [] });
  assert.match(html, /No reports yet: <code>evolo report<\/code> writes one for this week\./);
});

test("a report shows its figures, its words, and each highlight with the XP and type it was written with", () => {
  const html = renderReport(sampleModel(), ID);
  const text = textOf(html);
  assert.match(text, /Reports \/ week 2026-10-19\.\.2026-10-25 Report needs a check week 2026-10-19\.\.2026-10-25 Week · en · written 2026-10-21 08:00 · claude-sonnet-5-5 · \$0\.04 · 9s/);
  assert.match(text, /XP earned 195 3 scored units · Level 4/);
  assert.match(text, /XP 195 /);
  assert.match(text, /Units 3 /);
  assert.match(text, /Level 4 when written /);
  assert.doesNotMatch(text, /vs week/, "the previous week had no units to compare with");
  assert.match(text, /Overview A week split between Evolo's views/);
  assert.match(text, /Highlights ai-orgs PR #1 125 XP · feature It laid the agent world's foundation/);
  assert.match(text, /evolo push 7c1d2e9\.\.a2205df 60 XP · bugfix It fixed the times every view shows\./);
  assert.match(text, /Strengths Kept each change small and tested\. ai-orgs PR #1 evolo push 7c1d2e9\.\.a2205df /);
  assert.match(text, /Improvements The tick loop mixes scheduling/);
  assert.match(html, /<nav class="crumbs" aria-label="Breadcrumb"><a href="#\/reports">Reports<\/a>/);
});

test("every citation is a link to the unit's page, or plain text once the unit is gone", () => {
  const model = sampleModel();
  const html = renderReport(model, ID);
  assert.match(html, new RegExp(`<a class="cite" href="#/unit/${ORGS}/pr-1">ai-orgs PR #1</a>`));
  assert.match(html, new RegExp(`<a class="cite" href="#/unit/${EVOLO}/push-7c1d2e9-a2205df">evolo push 7c1d2e9\\.\\.a2205df</a>`));
  const gone = { ...model, units: model.units.filter((unit) => unit.key !== `${ORGS}/pr-1`) };
  const without = renderReport(gone, ID);
  assert.match(without, /<span class="cite">ai-orgs PR #1<\/span>/);
  assert.doesNotMatch(without, /href="#\/unit\/hiinguyen\/ai-orgs\/pr-1"/);
});

test("a report says why it may not tell the whole story", () => {
  const model = twoReports();
  const week = renderReport(model, ID);
  assert.match(textOf(week), /The week was not over when this report was written\./);
  assert.match(textOf(week), /1 unit of this period failed to score and is not in this report: evolo retry scores them again\./);
  assert.doesNotMatch(week, /ledger changed/);

  const [first] = model.reports;
  const stale = { ...first, stale: true, omitted: 4, report: { ...first.report, flags: ["suspected_injection"], notes: "A commit said <ignore rules>." } };
  const html = renderReport({ ...model, reports: [stale] }, ID);
  assert.match(html, /The ledger changed since this report was written: <code>evolo report week --again<\/code> writes it again\./);
  assert.match(textOf(html), /4 more units were left out of what the writer read: the least impactful\./);
  assert.match(html, /<p class="notice notice-bad" role="alert">The writer suspected prompt injection: A commit said &lt;ignore rules&gt;\.<\/p>/);
  assert.match(renderReport(model, "month/2026-09-01"), /The ledger changed since this report was written\.<\/p>/, "too old to write again");
});

test("a report compares XP and units with the previous period when it had units, and lists what the validator dropped", () => {
  const model = sampleModel();
  const [report] = model.reports;
  const compared = { ...report, numbers: { ...report.numbers, previous: { label: "week 2026-10-12..2026-10-18", xp: 95, units: 4, level: 6 } },
    issues: ['dropped a strength citing a unit not in the period (x/y/z): "<b>Invented</b>"'] };
  const html = renderReport({ ...model, reports: [compared] }, ID);
  assert.match(html, /<span class="delta delta-up">\+100<\/span> vs week 2026-10-12\.\.2026-10-18/);
  assert.match(html, /<span class="delta delta-down">-1<\/span> vs week 2026-10-12\.\.2026-10-18/);
  assert.match(html, /Validator.*dropped a strength citing a unit not in the period \(x\/y\/z\): &quot;&lt;b&gt;Invented&lt;\/b&gt;&quot;/s);
  assert.doesNotMatch(renderReport(model, ID), /Validator/);
});

test("inline code in the writer's words is drawn as code, after everything else in them is escaped", () => {
  const model = sampleModel();
  const [report] = model.reports;
  const coded = { ...report, report: { ...report.report, overview: "Added `evolo report` and <i>`a<b>`</i>; an odd ` stays." } };
  const html = renderReport({ ...model, reports: [coded] }, ID);
  assert.match(html, /Added <code>evolo report<\/code> and &lt;i&gt;<code>a&lt;b&gt;<\/code>&lt;\/i&gt;; an odd ` stays\./);
});

test("a list without points says so, and an address without a saved report says it has none", () => {
  const model = sampleModel();
  const [report] = model.reports;
  const empty = { ...report, report: { ...report.report, highlights: [], strengths: [] } };
  const html = renderReport({ ...model, reports: [empty] }, ID);
  assert.doesNotMatch(html, /Highlights/);
  assert.match(textOf(html), /Strengths None\. /);
  assert.match(renderReport(model, "week/2020-01-06"), /No saved report has this address\./);
});
