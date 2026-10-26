// Ranks are a pure function of the level: one rung every five levels, with the last one open ended.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRankFor, rankFor } from "./rank.mjs";

test("rankFor gives each rung from its level, and the last one has no ceiling", () => {
  assert.equal(rankFor(0).name, "Intern");
  assert.equal(rankFor(2).name, "Intern");
  assert.equal(rankFor(4).name, "Intern");
  assert.equal(rankFor(5).name, "Junior Dev");
  assert.equal(rankFor(9).name, "Junior Dev");
  assert.equal(rankFor(10).name, "Mid-level Dev");
  assert.equal(rankFor(20).name, "Staff Engineer");
  assert.equal(rankFor(49).name, "Grandmaster");
  assert.equal(rankFor(50).name, "Legend");
  assert.equal(rankFor(999).name, "Legend");
});

test("a rank clamps a negative or unreadable level to the first rung", () => {
  for (const level of [-1, -999, Number.NaN, undefined, "12"]) {
    assert.equal(rankFor(level).name, "Intern", String(level));
  }
  assert.equal(rankFor(12.9).name, "Mid-level Dev");
});

test("each rung names the CSS effect that draws it", () => {
  assert.deepEqual(rankFor(0), { min: 0, name: "Intern", effect: "muted" });
  assert.equal(rankFor(15).effect, "gradient");
  assert.equal(rankFor(25).effect, "glow");
  assert.equal(rankFor(25).deep, true);
  assert.equal(rankFor(30).effect, "shimmer");
  assert.equal(rankFor(40).effect, "blaze");
  assert.equal(rankFor(50).effect, "legend");
});

test("nextRankFor names the rung after this level, and has nothing above Legend", () => {
  assert.equal(nextRankFor(0).name, "Junior Dev");
  assert.equal(nextRankFor(4).name, "Junior Dev");
  assert.equal(nextRankFor(5).name, "Mid-level Dev");
  assert.equal(nextRankFor(49).name, "Legend");
  assert.equal(nextRankFor(50), null);
  assert.equal(nextRankFor(999), null);
  assert.equal(nextRankFor(-1).name, "Junior Dev", "an unreadable level clamps to the first rung");
  assert.equal(nextRankFor(Number.NaN).name, "Junior Dev");
});
