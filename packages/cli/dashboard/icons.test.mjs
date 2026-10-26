// The achievement icons, checked against the visible catalog: the drawing layer hard-codes one per id, so a new
// achievement or a renamed id fails here instead of drawing an empty emblem.
import assert from "node:assert/strict";
import { test } from "node:test";
import { VISIBLE } from "../src/achievements/catalog.mjs";
import { ACHIEVEMENT_ICONS, achievementEmblem, secretEmblem } from "./icons.mjs";

test("every visible achievement has one icon, and the map has nothing else", () => {
  assert.deepEqual(Object.keys(ACHIEVEMENT_ICONS), VISIBLE.map((achievement) => achievement.id));
  const drawings = Object.values(ACHIEVEMENT_ICONS);
  assert.equal(new Set(drawings).size, drawings.length, "each achievement gets a drawing of its own");
  assert.equal(achievementEmblem("not-an-achievement"), "");
});

test("each emblem is an inline drawing in its frame that cannot load or run anything", () => {
  for (const id of Object.keys(ACHIEVEMENT_ICONS)) {
    const emblem = achievementEmblem(id);
    assert.match(emblem, /^<svg class="emblem-art[^"]*" data-frame="[a-z]+" viewBox="0 0 80 80"/, id);
    if (/data-frame="none"/.test(emblem)) {
      assert.ok(!emblem.includes("emblem-frame"), `${id} wears no frame`);
    } else {
      assert.match(emblem, /class="emblem-frame"/, id);
    }
    assert.match(emblem, /class="emblem-glyph"/, id);
    assert.ok(!/<(text|image|foreignObject)\b/.test(emblem), `${id} draws no text or outside image`);
    assert.ok(!/\b(href|xlink:href)=/.test(emblem), `${id} links nothing`);
  }
  assert.ok(!/emblem-frame/.test(secretEmblem()), "a secret's emblem is its drawing alone, without the frame");
  assert.ok(!/<text\b/.test(secretEmblem()));
});

test("a drawing that already fills its own silhouette wears no frame behind it", () => {
  const frameless = Object.keys(ACHIEVEMENT_ICONS).filter((id) => achievementEmblem(id).includes('data-frame="none"'));
  assert.deepEqual(frameless, [
    "guardian", "speed-demon", "perfectionist", "on-target", "tiny-but-mighty",
    "core-contributor", "full-week", "night-owl", "explorer", "by-the-book",
  ]);
  // A frameless drawing grows to the footprint a frame would have given it; a framed one keeps the inner scale.
  assert.match(achievementEmblem("explorer"), /translate\(10 10\) scale\(2\.5\)/);
  assert.match(achievementEmblem("builder"), /translate\(16 16\) scale\(2\)/);
});

test("a found secret draws its own art without any frame, and falls back to the plain star", () => {
  const drawing = '<path d="M4 12h16"/><circle cx="12" cy="12" r="3"/>';
  const emblem = secretEmblem(drawing);
  assert.ok(emblem.includes(drawing));
  assert.ok(!emblem.includes("emblem-frame"));
  assert.match(secretEmblem(""), /<g class="emblem-glyph" transform="translate\(10 10\) scale\(2\.5\)"><path d="m12 3 2\.5 5\.5/);
});
