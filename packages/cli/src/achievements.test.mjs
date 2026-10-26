// Local times below are in a fixed zone without daylight saving, so hours and days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ACHIEVEMENTS, achievementsOf, notifyUnlocks, tierName, unlockedIn } from "./achievements.mjs";
import { VISIBLE } from "./achievements/catalog.mjs";
import { daily, day, file, many, unit } from "./achievements/fixtures.mjs";
import { landedAt, localDay } from "./ledger.mjs";
import { periodOf } from "./stats.mjs";

const find = (records, id) => achievementsOf(records).find((achievement) => achievement.id === id);
const tierOf = (records, id) => find(records, id).tier;
const code = [file("src/app.js", "source", 30)];
const WEEKEND = ["2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"];
const EXTENSIONS = ["a.js", "b.py", "c.go", "d.rs", "e.rb", "f.java"];
const COAUTHORED = "Adds it.\n\nCo-authored-by: Claude <noreply@anthropic.com>";
// Units on Monday to Friday of `weeks` calendar weeks from Monday 2026-10-05.
const fullWeeks = (weeks) => many(weeks * 5, (index) =>
  unit({ id: `w${index}`, landed: day(localDay(new Date(2026, 9, 5 + 7 * Math.floor(index / 5) + (index % 5)))) }));

// For each visible achievement, `count` units that each move it by one.
const FIRST_TIER = {
  contributor: (count) => daily(count),
  "merge-master": (count) => daily(count, { kind: "pr" }),
  builder: (count) => daily(count, { type: "feature", scores: { impact: 3 } }),
  "bug-hunter": (count) => daily(count, { type: "bugfix", scores: { impact: 3 } }),
  architect: (count) => daily(count, { type: "refactor", scores: { centrality: 3 } }),
  guardian: (count) => daily(count, { type: "security", scores: { impact: 3 } }),
  "speed-demon": (count) => daily(count, { type: "performance", scores: { impact: 3 } }),
  craftsman: (count) => daily(count, { scores: { quality: 4 } }),
  perfectionist: (count) => daily(count, { scores: { impact: 4, centrality: 4, difficulty: 4, quality: 4, scope_fit: 4 } }),
  "tiny-but-mighty": (count) => daily(count, { files: [file("src/a.js", "source", 6, 4)], scores: { impact: 3 } }),
  janitor: (count) => daily(count, { files: [file("src/a.js", "source", 5, 25)] }),
  "test-believer": (count) => daily(count, { files: code, testsTouched: true, scores: { quality: 3 } }),
  "green-light": (count) => daily(count, { kind: "pr", signals: { ciFirstPass: true } }),
  "core-contributor": (count) => daily(count, { scores: { impact: 4, centrality: 4 } }),
  streak: (count) => daily(count),
  "hat-trick": (count) => many(count, (index) => daily(3, { landed: day(`2026-10-0${index + 1}`) })).flat(),
  "night-owl": (count) => many(count, (index) => unit({ id: `u${index}`, commits: [{ date: day(`2026-10-0${index + 1}`, "02:30:00") }] })),
  "early-bird": (count) => many(count, (index) => unit({ id: `u${index}`, commits: [{ date: day(`2026-10-0${index + 1}`, "06:30:00") }] })),
  "weekend-warrior": (count) => many(count, (index) => unit({ id: `u${index}`, landed: day(WEEKEND[index]) })),
  explorer: (count) => daily(count).map((record, index) => ({ ...record, repo: `me/r${index}` })),
  polyglot: (count) => many(count, (index) => unit({ id: `u${index}`, files: [file(EXTENSIONS[index], "source", 10)] })),
  exterminator: (count) => daily(count, { signals: { closesBugIssue: true } }),
  "hard-mode": (count) => daily(count, { scores: { difficulty: 4 } }),
  "on-target": (count) => daily(count, { scores: { scope_fit: 4 } }),
  scribe: (count) => daily(count, { type: "docs", scores: { impact: 2 } }),
  "test-pilot": (count) => daily(count, { type: "test", scores: { quality: 3 } }),
  plumber: (count) => daily(count, { type: "infra", scores: { impact: 2 } }),
  jackpot: (count) => daily(count, { xp: 200 }),
  hoarder: (count) => [unit({ xp: count })],
  overdrive: (count) => [unit({ xp: count })],
  "full-week": (count) => fullWeeks(count),
  "by-the-book": (count) => daily(count),
  "co-pilot": (count) => daily(count).map((record) => ({
    ...record, result: { ...record.result, facts: { ...record.result.facts, commits: [{ date: record.landedAt, subject: "feat: x", body: COAUTHORED }] } },
  })),
};

test("every visible achievement reaches its first tier exactly at its threshold", () => {
  for (const rule of VISIBLE) {
    const make = FIRST_TIER[rule.id];
    assert.ok(make, `no ledger for ${rule.id}`);
    assert.equal(tierOf(make(rule.tiers[0]), rule.id), 1, `${rule.id} at ${rule.tiers[0]}`);
    assert.equal(tierOf(make(rule.tiers[0] - 1), rule.id), 0, `${rule.id} one short`);
  }
});

test("the ceilings are the one-year pace of the redesign, with at most six tiers", () => {
  const ceilings = Object.fromEntries(VISIBLE.map((rule) => [rule.id, rule.tiers.at(-1)]));
  assert.deepEqual(ceilings, {
    contributor: 500, "merge-master": 200, hoarder: 50000, jackpot: 100, overdrive: 2000,
    builder: 50, "bug-hunter": 50, architect: 40, guardian: 25, "speed-demon": 20,
    scribe: 60, "test-pilot": 60, plumber: 40, exterminator: 100, craftsman: 50,
    perfectionist: 10, "hard-mode": 50, "on-target": 100, "tiny-but-mighty": 30, janitor: 75,
    "test-believer": 100, "green-light": 200, "core-contributor": 15, streak: 120,
    "hat-trick": 100, "full-week": 52, "night-owl": 100, "early-bird": 100, "weekend-warrior": 100,
    explorer: 25, polyglot: 20, "by-the-book": 1000, "co-pilot": 300,
  });
  for (const rule of VISIBLE) {
    assert.ok(rule.tiers.length <= 6, `${rule.id} has ${rule.tiers.length} tiers`);
    assert.ok(rule.tiers.length <= 10, `${rule.id} fits the numerals`);
  }
});

// `count` scored units on consecutive calendar days, when a tier needs more days than October has.
const consecutive = (count, options = {}) => many(count, (index) => {
  const date = new Date(2026, 9, 1 + index);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return unit({ ...options, id: `c${index}`, landed: day(key) });
});

test("the highest new tiers open exactly at their thresholds", () => {
  assert.equal(tierOf(consecutive(500), "contributor"), 5);
  assert.equal(tierOf(consecutive(499), "contributor"), 4);
  assert.equal(tierOf(fullWeeks(52), "full-week"), 5);
  assert.equal(tierOf(fullWeeks(51), "full-week"), 4);
  assert.equal(tierOf(consecutive(1000), "by-the-book"), 5);
  assert.equal(tierOf(consecutive(999), "by-the-book"), 4);
});

test("achievements have unique ids and tiers that start at 1 or more and grow; secrets have one tier", () => {
  assert.equal(new Set(ACHIEVEMENTS.map((rule) => rule.id)).size, ACHIEVEMENTS.length);
  for (const rule of ACHIEVEMENTS) {
    assert.ok(rule.tiers[0] >= 1, rule.id);
    assert.ok(rule.tiers.every((threshold, index) => index === 0 || threshold > rule.tiers[index - 1]), rule.id);
    assert.ok(rule.name && rule.description, rule.id);
    if (rule.hidden) assert.deepEqual(rule.tiers, [1], rule.id);
  }
});

test("no achievement's value goes down as the ledger grows, which is what dates each tier", () => {
  const mixed = Object.values(FIRST_TIER)
    .flatMap((make, index) => make(3).map((record, at) => ({ ...record, id: `m${index}-${at}`, landedAt: day(`2026-10-${10 + at}`, `0${index % 10}:15:00`) })))
    .concat(daily(4, { status: "reverted", xp: 0 }), daily(2, { status: "superseded", xp: 0 }), daily(3, { method: "rule", xp: 5 }))
    .sort((a, b) => Date.parse(landedAt(a)) - Date.parse(landedAt(b)));
  for (const rule of ACHIEVEMENTS) {
    let before = 0;
    for (let length = 0; length <= mixed.length; length += 1) {
      const value = rule.value(mixed.slice(0, length));
      assert.ok(value >= before, `${rule.id} went from ${before} to ${value}`);
      before = value;
    }
  }
});

test("rubric achievements leave out units triaged by rule", () => {
  assert.equal(tierOf(daily(3, { type: "bugfix", scores: { impact: 3 }, method: "rule" }), "bug-hunter"), 0);
  assert.equal(tierOf(daily(5, { scores: { quality: 4 }, method: "rule" }), "craftsman"), 0);
});

test("a tier's progress and the day it unlocked come from the unit that reached it, in any input order", () => {
  const records = daily(12).reverse();
  const contributor = find(records, "contributor");
  assert.equal(contributor.value, 12);
  assert.equal(contributor.tier, 2);
  assert.deepEqual(contributor.unlocked, [{ tier: 1, at: day("2026-10-01") }, { tier: 2, at: day("2026-10-10") }]);
  assert.deepEqual(find([], "contributor").unlocked, []);
});

test("a tier is lost when the unit that held it is reverted", () => {
  const records = daily(10);
  assert.equal(tierOf(records, "contributor"), 2);
  const reverted = records.map((record, index) => (index === 3 ? { ...record, status: "reverted", xp: 0 } : record));
  assert.equal(tierOf(reverted, "contributor"), 1);
});

test("test discipline runs over units with code in tested repositories; the others neither count nor break it", () => {
  const tested = (index) => unit({ id: `t${index}`, landed: day(`2026-10-0${index + 1}`), files: code, testsTouched: true, scores: { quality: 3 } });
  const docsOnly = unit({ id: "docs", landed: day("2026-10-02", "18:00:00"), files: [file("README.md", "docs", 40)] });
  const untestedRepo = unit({ id: "x", landed: day("2026-10-02", "19:00:00"), files: code, repoHasTests: false });
  assert.equal(find([tested(0), tested(1), docsOnly, untestedRepo, tested(2)], "test-believer").value, 3);
  const careless = unit({ id: "careless", landed: day("2026-10-02", "18:00:00"), files: code });
  assert.equal(find([tested(0), tested(1), careless, tested(2)], "test-believer").value, 2);
  const sloppy = unit({ id: "sloppy", landed: day("2026-10-02", "18:00:00"), files: code, testsTouched: true, scores: { quality: 2 } });
  assert.equal(find([tested(0), tested(1), sloppy, tested(2)], "test-believer").value, 2);
});

test("core work counts per repository, the best one wins", () => {
  const core = daily(6, { scores: { impact: 4, centrality: 4 } }).map((record, index) => ({ ...record, repo: index < 3 ? "me/a" : "me/b" }));
  assert.equal(find(core, "core-contributor").value, 3);
});

test("languages come from source files' extensions; one language has many extensions and an unknown one is not counted", () => {
  const files = [file("a.js", "source", 1), file("b.mjs", "source", 1), file("c.xyz", "source", 1), file("d.py", "docs", 1), file("Makefile", "source", 1)];
  assert.equal(find([unit({ files })], "polyglot").value, 1);
});

test("hours are the local hour of each commit, and a hat trick needs three units on one day", () => {
  const owl = (date) => unit({ commits: [{ date }] });
  assert.equal(find([owl("2026-10-19T19:30:00Z")], "night-owl").value, 1, "02:30 local");
  assert.equal(find([owl("2026-10-19T02:30:00Z")], "night-owl").value, 0, "09:30 local");
  assert.equal(find(daily(2, { landed: day("2026-10-05") }), "hat-trick").value, 0);
});

test("a janitor deletes at least 20 more counted lines than they add", () => {
  assert.equal(find([unit({ files: [file("a.js", "source", 5, 25)] })], "janitor").value, 1);
  assert.equal(find([unit({ files: [file("a.js", "source", 5, 24)] })], "janitor").value, 0);
  assert.equal(find([unit({ files: [file("a.js", "source", 0, 10), file("docs/x.md", "docs", 0, 900)] })], "janitor").value, 0);
});

test("tiers are named with Roman numerals", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(tierName), ["I", "II", "III", "IV", "V"]);
});

test("a period lists the tiers that unlocked in it, oldest first", () => {
  const week = periodOf("week", new Date(2026, 9, 7));
  const records = [...daily(12), unit({ id: "x", repo: "me/b", landed: day("2026-10-06", "18:00:00") })];
  assert.deepEqual(unlockedIn(achievementsOf(records), week).map(({ id, tier, label, at }) => [id, tier, label, at]), [
    ["streak", 1, "Streak I", day("2026-10-05")],
    ["explorer", 1, "Explorer I", day("2026-10-06", "18:00:00")],
    ["contributor", 2, "Contributor II", day("2026-10-09")], // x is the 10th unit
    ["full-week", 1, "Full Week I", day("2026-10-09")],
    ["by-the-book", 1, "By the Book I", day("2026-10-09")],
    ["streak", 2, "Streak II", day("2026-10-10")],
    ["weekend-warrior", 1, "Weekend Warrior I", day("2026-10-10")],
  ]);
});

test("unlocks are announced once: the first time every tier held, then only new ones", () => {
  const home = mkdtempSync(join(tmpdir(), "evolo-achievements-"));
  try {
    assert.deepEqual(notifyUnlocks(home, achievementsOf(daily(1))).map(({ label }) => label), ["Contributor I"]);
    assert.deepEqual(notifyUnlocks(home, achievementsOf(daily(1))), []);
    const unlocks = notifyUnlocks(home, achievementsOf(daily(10)));
    assert.deepEqual(unlocks.map(({ label }) => label), ["Contributor II", "Streak I", "Streak II", "Full Week I", "Weekend Warrior I", "By the Book I"]);
    assert.equal(unlocks[0].description, "scored units");
    // A tier lost and held again is not announced twice.
    assert.deepEqual(notifyUnlocks(home, achievementsOf(daily(3))), []);
    assert.deepEqual(notifyUnlocks(home, achievementsOf(daily(10))), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a scored record without files, or an achievements.json in another shape, does not stop anything", () => {
  const bare = unit();
  const withoutFiles = { ...bare, result: { ...bare.result, facts: { ...bare.result.facts, files: undefined } } };
  assert.equal(find([withoutFiles], "contributor").tier, 1);
  const home = mkdtempSync(join(tmpdir(), "evolo-achievements-"));
  try {
    writeFileSync(join(home, "achievements.json"), JSON.stringify({ notified: { "contributor:1": true } }));
    assert.deepEqual(notifyUnlocks(home, achievementsOf(daily(1))).map(({ label }) => label), ["Contributor I"]);
    assert.deepEqual(notifyUnlocks(home, achievementsOf(daily(1))), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("type achievements need the judge's score for their type, and XP achievements read the units still scored", () => {
  assert.equal(find(daily(3, { type: "docs", scores: { impact: 1 } }), "scribe").value, 0);
  assert.equal(find(daily(3, { type: "test", scores: { quality: 2 } }), "test-pilot").value, 0);
  assert.equal(find([unit({ xp: 195 }), unit({ xp: 900, status: "reverted" })], "jackpot").value, 0);
  assert.equal(find([unit({ xp: 600 }), unit({ xp: 900, status: "reverted" })], "hoarder").value, 600);
});

test("overdrive is the best day's XP, counted on the local day each unit landed", () => {
  const records = [
    unit({ id: "a", xp: 200, landed: day("2026-10-05", "00:30:00") }),
    unit({ id: "b", xp: 150, landed: day("2026-10-05", "23:30:00") }),
    unit({ id: "c", xp: 300, landed: day("2026-10-06", "00:10:00") }),
  ];
  assert.equal(find(records, "overdrive").value, 350);
});

test("a full week has a unit on each of Monday to Friday of one calendar week; weekends neither help nor hurt", () => {
  assert.equal(find(fullWeeks(2), "full-week").value, 2);
  assert.equal(find(fullWeeks(1).filter((record) => record.id !== "w2"), "full-week").value, 0, "no Wednesday");
  // Thursday and Friday of one week with Monday to Wednesday of the next is no full week.
  assert.equal(find(daily(7, { landed: undefined }).map((record, index) => ({ ...record, landedAt: day(localDay(new Date(2026, 9, 8 + index))) })), "full-week").value, 0);
});

test("commit subjects count when they follow Conventional Commits, and pairing needs a Co-authored-by trailer", () => {
  const subjects = (...list) => unit({ commits: list.map((subject) => ({ date: day("2026-10-05"), subject, body: "" })) });
  assert.equal(find([subjects("feat(cli): add stats", "fix!: drop Node 18", "Update README", "feature: nope", "WIP")], "by-the-book").value, 2);
  const mentioned = unit({ commits: [{ date: day("2026-10-05"), subject: "docs: thank Claude", body: "Thanks to Claude for the idea." }] });
  assert.equal(find([mentioned], "co-pilot").value, 0);
});
