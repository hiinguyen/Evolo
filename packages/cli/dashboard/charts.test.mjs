// The dashboard's charts: columns by day, horizontal bars and the hour and weekday strips.
import assert from "node:assert/strict";
import { test } from "node:test";
import { barChart, hBars, strip } from "./charts.mjs";

const bars = (svg) => [...svg.matchAll(/<rect class="bar" ([^>]*)>/g)].map(([, attributes]) =>
  Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])));
const widths = (html) => [...html.matchAll(/style="width:([^"]*)%"/g)].map(([, width]) => Number(width));
const POISON = '<img src=x onerror="alert(1)">';

test("barChart draws one column per point, the tallest up to the top and a day without XP as nothing", () => {
  const points = [{ label: "2026-10-06", value: 120 }, { label: "2026-10-07", value: 0 }, { label: "2026-10-08", value: 300 }, { label: "2026-10-09", value: 150 }];
  const svg = barChart(points, { label: "XP by day" });
  const columns = bars(svg);
  assert.equal(columns.length, points.length);
  const [first, empty, tallest, half] = columns;
  assert.equal(tallest.y, "0");
  assert.equal(empty.height, "0");
  assert.ok(Number(first.height) > 0 && Number(first.height) < Number(tallest.height));
  // Half the tallest value starts half way down.
  assert.equal(Number(half.y), Number(tallest.height) - Number(half.height));
  assert.ok(Number(half.y) > 0);
  // The SVG scales with the width of its panel, and says what it shows.
  assert.match(svg, /<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.ok(!/<svg [^>]*\swidth=/.test(svg));
  assert.match(svg, /role="img" aria-label="XP by day: 4 days from 2026-10-06 to 2026-10-09, most 300 XP on 2026-10-08"/);
  assert.match(svg, /<title>2026-10-08: 300 XP<\/title>/);
  assert.match(svg, /<title>2026-10-07: 0 XP<\/title>/);
});

test("barChart escapes the labels it puts in titles and in its summary", () => {
  const svg = barChart([{ label: POISON, value: 5 }], { label: `${POISON} chart` });
  assert.ok(!svg.includes("<img"));
  assert.match(svg, /<title>&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;: 5 XP<\/title>/);
});

test("barChart of nothing but zeros draws columns of no height, never a division by zero", () => {
  const svg = barChart([{ label: "a", value: 0 }, { label: "b", value: 0 }], { label: "XP by day" });
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.deepEqual(bars(svg).map((bar) => bar.height), ["0", "0"]);
  assert.ok(!/NaN|Infinity/.test(barChart([], { label: "XP by day" })));
});

test("hBars draws each row as a share of its max, with its label and note", () => {
  const html = hBars([
    { label: "feature", value: 600, max: 600, note: "3 units · 600 XP" },
    { label: "bugfix", value: 300, max: 600, note: "1 unit · 300 XP" },
    { label: "docs", value: 0, max: 600, note: "1 unit · 0 XP" },
  ]);
  assert.deepEqual(widths(html), [100, 50, 0]);
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /feature 3 units · 600 XP .*bugfix 1 unit · 300 XP .*docs 1 unit · 0 XP/);
});

test("hBars escapes its text and draws a row of a zero max as empty", () => {
  const html = hBars([{ label: POISON, value: 0, max: 0, note: POISON }]);
  assert.ok(!html.includes("<img"));
  assert.ok(!/NaN|Infinity/.test(html));
  assert.deepEqual(widths(html), [0]);
});

test("strip draws one cell per value, the busiest the darkest and an empty one the lightest", () => {
  const hours = Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 4 : hour === 21 ? 1 : 0));
  const labels = hours.map((_, hour) => `${String(hour).padStart(2, "0")}:00`);
  const html = strip(hours, labels, { label: "Commits by hour" });
  const levels = [...html.matchAll(/<span class="cell level-(\d)"/g)].map(([, level]) => Number(level));
  assert.equal(levels.length, 24);
  assert.equal(levels[9], 4);
  assert.equal(levels[21], 1);
  assert.equal(levels[0], 0);
  assert.match(html, /title="09:00: 4 commits"/);
  assert.match(html, /title="21:00: 1 commit"/);
  assert.match(html, /role="img" aria-label="Commits by hour: [^"]*09:00 4, [^"]*"/);
});

test("strip of no commits draws every cell empty, and escapes its labels", () => {
  const html = strip([0, 0, 0], [POISON, "b", "c"], { label: POISON });
  assert.ok(!html.includes("<img"));
  assert.ok(!/NaN|Infinity/.test(html));
  assert.equal([...html.matchAll(/class="cell level-0"/g)].length, 3);
});
