// The secret drawings: one per secret rule, each its own, and each only a shape the page can draw inline. The map lives
// on the Node side, so this test also guards that no drawing is mistaken for visible achievement art.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SECRET } from "./secret.mjs";
import { SECRET_ICONS, secretIcon } from "./secret-icons.mjs";

test("every secret has one drawing and the map has nothing else", () => {
  assert.deepEqual(Object.keys(SECRET_ICONS), SECRET.map((rule) => rule.id));
  const drawings = Object.values(SECRET_ICONS);
  assert.equal(new Set(drawings).size, drawings.length, "each secret gets a drawing of its own");
  assert.equal(secretIcon("not-a-secret"), "");
});

test("each secret drawing is an inline shape that cannot load or run anything", () => {
  for (const [id, drawing] of Object.entries(SECRET_ICONS)) {
    assert.match(drawing, /<(path|circle|ellipse|rect)\b/, id);
    assert.match(drawing, /^</, id);
    assert.ok(!/<(text|image|foreignObject|script|style)\b/.test(drawing), `${id} draws no text, outside image or script`);
    assert.ok(!/\b(href|xlink:href|on\w+)=/.test(drawing), `${id} links nothing and runs nothing`);
    assert.ok(!/<\/?(g|svg)\b/.test(drawing), `${id} is a fragment, not a document`);
  }
});
