// End to end: `evolo dashboard` on a unit the real worker scored, in the sandbox of sandbox.mjs. The sandbox's
// `xdg-open` is a fake (fakes/xdg-open.mjs), so no browser opens.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { modelIn } from "../dashboard/fixtures.mjs";
import { lines, makeSandbox, REPO, short } from "./sandbox.mjs";

// How long a detached `xdg-open` (a Node script here) is given to log its call; it takes about a tenth of this.
const OPENER_SETTLE_MS = 1000;

// A sandbox with one scored push of `app.js`, and its unit id.
async function scoredPush() {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const sha = box.commit("feat: start", { "app.js": lines(30, "app") });
  box.push(["origin", "main"]);
  const id = `push-root-${short(sha)}`;
  await box.settled(id);
  return { box, id };
}

test("evolo dashboard --no-open writes the page of the scored unit and prints its path; without it xdg-open gets the path", async () => {
  const { box, id } = await scoredPush();
  const path = join(box.home, "dashboard.html");
  assert.equal(box.evolo("dashboard", "--no-open"), `${path}\n`);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const model = modelIn(readFileSync(path, "utf8"));
  assert.deepEqual(model.units.map((unit) => unit.key), [`${REPO}/${id}`]);
  assert.equal(model.units[0].status, "scored");
  // An opener is detached, so the command returns before it runs: give a wrongly started one time to show itself.
  await sleep(OPENER_SETTLE_MS);
  assert.deepEqual(box.opened(), []);

  assert.equal(box.evolo("dashboard"), `${path}\n`);
  await box.waitFor(() => box.opened().length > 0, () => "xdg-open was not called");
  await sleep(OPENER_SETTLE_MS);
  assert.deepEqual(box.opened(), [[path]], "one call, with the path as its only argument");
});

test("evolo dashboard takes no other argument", () => {
  const box = makeSandbox();
  const result = box.evoloRun("dashboard", "now");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /evolo dashboard \[--no-open\]/);
});
