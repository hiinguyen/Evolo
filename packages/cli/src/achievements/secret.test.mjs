// Secret achievements: each unlocks when its condition holds and stays locked when it is barely missed.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { SECRET } from "./secret.mjs";
import { daily, day, file, many, unit } from "./fixtures.mjs";

const rule = (id) => SECRET.find((candidate) => candidate.id === id);
const unlocks = (id, records) => assert.equal(rule(id).value(records), 1, `${id} should unlock`);
const staysLocked = (id, records) => assert.equal(rule(id).value(records), 0, `${id} should stay locked`);
const committed = (date, extra = {}) => unit({ commits: [{ date, subject: "feat: add a thing", body: "", ...extra }] });

test("every secret has a test", () => {
  const tested = ["ctrl-z", "revisionist", "yolo-friday", "friday-13", "three-am", "new-year", "christmas", "thanos-snap", "monolith",
    "leet", "the-answer", "comeback", "very-descriptive", "novelist", "typo-lord", "for-nothing", "big-spender",
    "meta", "halloween", "pi-day", "valentine", "cinderella", "century", "speedrun", "prompt-engineer", "emoji", "caps-lock", "undo-the-undo",
    "shipper", "to-production", "one-point-oh"];
  assert.deepEqual(SECRET.map(({ id }) => id).sort(), tested.sort());
});

test("unit fates", () => {
  unlocks("ctrl-z", [unit({ status: "reverted", xp: 0 })]);
  staysLocked("ctrl-z", [unit({ status: "superseded", xp: 0 })]);
  unlocks("revisionist", [unit({ status: "superseded", xp: 0 })]);
  staysLocked("revisionist", [unit({ status: "failed", xp: 0 })]);
});

test("dates and hours", () => {
  unlocks("yolo-friday", [unit({ landed: day("2026-10-02", "17:00:00") })]);
  staysLocked("yolo-friday", [unit({ landed: day("2026-10-02", "16:59:00") }), unit({ landed: day("2026-10-01", "18:00:00") })]);
  staysLocked("yolo-friday", [unit({ landed: day("2026-10-02", "18:00:00"), status: "failed" })]);
  unlocks("friday-13", [committed(day("2026-11-13"))]);
  staysLocked("friday-13", [committed(day("2026-10-13")), committed(day("2026-11-20"))]);
  unlocks("three-am", [committed(day("2026-10-05", "03:59:00"))]);
  staysLocked("three-am", [committed(day("2026-10-05", "04:00:00")), committed(day("2026-10-05", "02:59:00"))]);
  unlocks("new-year", [committed(day("2027-01-01", "00:10:00"))]);
  staysLocked("new-year", [committed(day("2026-12-31", "23:50:00"))]);
  unlocks("christmas", [committed(day("2026-12-25"))]);
  staysLocked("christmas", [committed(day("2026-12-24"))]);
});

test("sizes", () => {
  unlocks("thanos-snap", [unit({ files: [file("a.js", "source", 99, 1000)] })]);
  staysLocked("thanos-snap", [unit({ files: [file("a.js", "source", 100, 1000)] }), unit({ files: [file("a.js", "source", 0, 999)] })]);
  unlocks("monolith", [unit({ files: [file("a.js", "source", 2000), file("a.test.js", "test", 1000)] })]);
  staysLocked("monolith", [unit({ files: [file("a.js", "source", 2999), file("README.md", "docs", 9000)] })]);
});

test("XP and level", () => {
  unlocks("leet", [unit({ xp: 1000 }), unit({ xp: 337 })]);
  staysLocked("leet", [unit({ xp: 1336 }), unit({ xp: 900, status: "reverted" })]);
  unlocks("the-answer", [unit({ xp: 20 * 42 * 51 })]);
  staysLocked("the-answer", [unit({ xp: 20 * 42 * 51 - 1 })]);
});

test("a comeback is a unit landing 14 days or more after the one before", () => {
  unlocks("comeback", [unit({ landed: day("2026-10-01") }), unit({ landed: day("2026-10-15") })]);
  staysLocked("comeback", [unit({ landed: day("2026-10-01") }), unit({ landed: day("2026-10-14", "23:00:00") })]);
  staysLocked("comeback", [unit({ landed: day("2026-10-15") })]);
});

test("commit messages", () => {
  unlocks("very-descriptive", [committed(day("2026-10-05"), { subject: "  WIP " })]);
  unlocks("very-descriptive", [committed(day("2026-10-05"), { subject: "..." })]);
  staysLocked("very-descriptive", [committed(day("2026-10-05"), { subject: "fix: retry the judge" })]);
  unlocks("novelist", [committed(day("2026-10-05"), { subject: "docs: explain", body: "x".repeat(990) })]);
  staysLocked("novelist", [committed(day("2026-10-05"), { subject: "docs: explain", body: "x".repeat(980) })]);
});

test("units the judge never saw, or that earned nothing", () => {
  unlocks("typo-lord", daily(5, { method: "rule", xp: 5 }));
  staysLocked("typo-lord", daily(4, { method: "rule", xp: 5 }));
  unlocks("for-nothing", [unit({ xp: 0 })]);
  staysLocked("for-nothing", [unit({ xp: 0, method: "rule" }), unit({ xp: 0, status: "reverted" })]);
});

test("the judge's bill counts every unit it judged", () => {
  unlocks("big-spender", many(100, () => unit({ costUsd: 0.1 })));
  unlocks("big-spender", [...many(50, () => unit({ costUsd: 0.1 })), ...many(50, () => unit({ costUsd: 0.1, status: "reverted" }))]);
  staysLocked("big-spender", many(99, () => unit({ costUsd: 0.1 })));
});

test("where and when, again", () => {
  unlocks("meta", [unit({ repo: "someone/Evolo" })]);
  staysLocked("meta", [unit({ repo: "evolo/app" }), unit({ repo: "me/evolo-fork" })]);
  unlocks("halloween", [committed(day("2026-10-31", "23:59:00"))]);
  staysLocked("halloween", [committed(day("2026-11-01", "00:00:00"))]);
  unlocks("pi-day", [committed(day("2027-03-14"))]);
  staysLocked("pi-day", [committed(day("2027-03-15"))]);
  unlocks("valentine", [committed(day("2027-02-14", "21:00:00"))]);
  staysLocked("valentine", [committed(day("2027-02-13", "21:00:00"))]);
  unlocks("cinderella", [committed(day("2026-10-06", "00:00:30"))]);
  staysLocked("cinderella", [committed(day("2026-10-06", "00:01:00")), committed(day("2026-10-05", "23:59:59"))]);
});

test("XP to the unit, and two units close together", () => {
  unlocks("century", [unit({ xp: 100 })]);
  staysLocked("century", [unit({ xp: 105 }), unit({ xp: 100, status: "reverted" })]);
  unlocks("speedrun", [unit({ id: "a", landed: day("2026-10-05", "10:00:00") }), unit({ id: "b", landed: day("2026-10-05", "10:05:00") })]);
  staysLocked("speedrun", [unit({ id: "a", landed: day("2026-10-05", "10:00:00") }), unit({ id: "b", landed: day("2026-10-05", "10:05:01") })]);
  staysLocked("speedrun", [unit({ id: "a", landed: day("2026-10-05", "10:00:00") }), unit({ id: "b", landed: day("2026-10-05", "10:01:00"), status: "failed" })]);
});

test("what the judge noticed", () => {
  unlocks("prompt-engineer", many(5, () => unit({ flags: ["mostly_generated_code"] })));
  staysLocked("prompt-engineer", [...many(4, () => unit({ flags: ["mostly_generated_code"] })), unit({ flags: ["unclear_intent"] })]);
});

test("commit subjects, again", () => {
  unlocks("emoji", [committed(day("2026-10-05"), { subject: "feat: ship it 🚀" })]);
  staysLocked("emoji", [committed(day("2026-10-05"), { subject: "feat: ship it :rocket: -> done" })]);
  unlocks("caps-lock", [committed(day("2026-10-05"), { subject: "FIX THE BUILD!!!" })]);
  staysLocked("caps-lock", [committed(day("2026-10-05"), { subject: "FIX CI" }), committed(day("2026-10-05"), { subject: "FIX THE build" })]);
  unlocks("undo-the-undo", [committed(day("2026-10-05"), { subject: 'Revert "Revert "feat: add stats""' })]);
  staysLocked("undo-the-undo", [committed(day("2026-10-05"), { subject: 'Revert "feat: add stats"' })]);
});

test("publishing: a release subject, a deploy commit or workflow, and 1.0.0", () => {
  unlocks("shipper", [committed(day("2026-10-05"), { subject: "chore(release): publish 2.1.0" })]);
  unlocks("shipper", [committed(day("2026-10-05"), { subject: "feat: v1.2.3" })]);
  staysLocked("shipper", [committed(day("2026-10-05"), { subject: "feat: v1.2" }), unit({ status: "failed", xp: 0 })]);
  unlocks("to-production", [committed(day("2026-10-05"), { subject: "deploy: the new worker" })]);
  unlocks("to-production", [unit({ files: [file(".github/workflows/deploy.yml", "config", 10)] })]);
  staysLocked("to-production", [committed(day("2026-10-05"), { subject: "fix: redeploy the worker" })]);
  staysLocked("to-production", [unit({ files: [file(".github/workflows/ci.yml", "config", 10)] })]);
  unlocks("one-point-oh", [committed(day("2026-10-05"), { subject: "feat: release 1.0.0" })]);
  unlocks("one-point-oh", [committed(day("2026-10-05"), { subject: "feat: v1.0.0" })]);
  staysLocked("one-point-oh", [committed(day("2026-10-05"), { subject: "feat: 1.0.1" }), committed(day("2026-10-05"), { subject: "feat: 11.0.0" })]);
});
