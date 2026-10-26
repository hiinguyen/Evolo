// The helpers every screen of the dashboard draws with. Zone fixed so local times do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { escape, formatDuration, formatUsd, formatXp, hashOf, localDate, localTime, pageHead, periodChip, periodLabel, plural, safeUrl, syncStatus } from "./html.mjs";

test("escape turns every value into text with & < > \" ' escaped", () => {
  assert.equal(escape("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(escape('say "hi"'), "say &quot;hi&quot;");
  assert.equal(escape("it's"), "it&#39;s");
  assert.equal(escape("a & b"), "a &amp; b");
  assert.equal(escape("&lt;"), "&amp;lt;", "escaped text is escaped again, never trusted");
  assert.equal(escape(null), "");
  assert.equal(escape(undefined), "");
  assert.equal(escape(42), "42");
  assert.equal(escape(0), "0");
});

test("safeUrl keeps only https links", () => {
  assert.equal(safeUrl("https://github.com/a/b/pull/1"), "https://github.com/a/b/pull/1");
  for (const url of ["javascript:alert(1)", "http://x", "data:text/html,<b>x</b>", " https://x", "HTTPS://x", null, undefined, 3]) {
    assert.equal(safeUrl(url), null, String(url));
  }
});

test("numbers and money are formatted the way the CLI prints them", () => {
  assert.equal(formatXp(1040), "1,040");
  assert.equal(formatXp(0), "0");
  assert.equal(formatXp(1234567), "1,234,567");
  assert.equal(formatUsd(0.32999999999999996), "$0.33");
  assert.equal(formatUsd(5), "$5.00");
  assert.equal(formatUsd(9999.99), "$9,999.99");
  assert.equal(formatUsd(1234.5), "$1,234.50");
  assert.equal(plural(1, "job"), "1 job");
  assert.equal(plural(2, "job"), "2 jobs");
  assert.equal(plural(0, "unit"), "0 units");
});

test("a judge's duration reads in seconds until a minute, then minutes and hours", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(9000), "9s");
  assert.equal(formatDuration(41000), "41s");
  assert.equal(formatDuration(125000), "2m 05s");
  assert.equal(formatDuration(3_600_000), "1h 00m");
  assert.equal(formatDuration(4_320_000), "1h 12m");
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration(-1), "");
});

test("times and days are shown in the local zone", () => {
  assert.equal(localTime("2026-10-20T23:33:00Z"), "2026-10-21 06:33");
  assert.equal(localDate("2026-10-20T23:33:00Z"), "2026-10-21");
  assert.equal(localDate("2026-10-21T00:10:00+07:00"), "2026-10-21");
  assert.equal(localTime("not a time"), "");
  assert.equal(localDate(undefined), "");
});

test("hashOf joins the parts of a hash path, each one encoded", () => {
  assert.equal(hashOf("unit", "me", "a", "pr-1"), "#/unit/me/a/pr-1");
  assert.equal(hashOf("unit", "me", "a b", "x/y", "score"), "#/unit/me/a%20b/x%2Fy/score");
  assert.equal(hashOf(), "#/");
});

test("pageHead escapes its title and detail", () => {
  const head = pageHead("Overview", "<b>x</b>");
  assert.match(head, /<h1>Overview<\/h1>/);
  assert.ok(head.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!pageHead("Overview").includes("<p"), "no empty detail line");
});

test("a head can carry a sync mark, a period and a note beside its title", () => {
  const head = pageHead("Reviews", "3 reviews", {
    status: syncStatus("2026-10-21T06:00:00+07:00"),
    meta: periodChip("2026-10-19T00:00:00+07:00", "2026-10-25T23:59:59+07:00"),
    note: "Written from <the ledger>",
  });
  assert.match(head, /<p>3 reviews<\/p>/);
  assert.match(head, /<span data-synced="2026-10-21T06:00:00\+07:00">Synced just now<\/span>/);
  assert.match(head, /class="head-chip"/);
  assert.match(head, /Oct 19 - Oct 25, 2026/);
  assert.match(head, /Written from &lt;the ledger&gt;/);
  assert.ok(!head.includes("<the ledger>"));
});

test("a period label crosses a year when it has to, and an unreadable date is no chip", () => {
  assert.equal(periodLabel("2026-10-19T00:00:00+07:00", "2026-10-25T23:59:59+07:00"), "Oct 19 - Oct 25, 2026");
  assert.equal(periodLabel("2025-12-29T00:00:00+07:00", "2026-01-04T23:59:59+07:00"), "Dec 29, 2025 - Jan 4, 2026");
  assert.equal(periodLabel("not a date", "2026-10-25T00:00:00+07:00"), "");
  assert.equal(periodChip("not a date", "2026-10-25T00:00:00+07:00"), "");
});
