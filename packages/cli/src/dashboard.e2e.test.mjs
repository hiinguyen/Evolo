// End to end: `evolo dashboard` on a unit the real worker scored, in the sandbox of sandbox.mjs. The sandbox's
// `xdg-open` is a fake (fakes/xdg-open.mjs), so no browser opens.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { modelIn } from "../dashboard/fixtures.mjs";
import { readRecord } from "./ledger.mjs";
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

const pageModel = (box) => modelIn(readFileSync(join(box.home, "dashboard.html"), "utf8"));

// A push of `app.js` with `count` lines on top of `base`; returns the unit id once the worker has scored it.
async function pushMore(box, base, count) {
  const sha = box.commit("feat: more", { "app.js": lines(count, "app") });
  box.push(["origin", "main"]);
  const id = `push-${short(base)}-${short(sha)}`;
  await box.settled(id);
  return { id, sha };
}

test("the worker writes the page again after scoring, but only once `evolo dashboard` has made it", async () => {
  const { box, id } = await scoredPush();
  assert.equal(existsSync(join(box.home, "dashboard.html")), false, "scoring alone does not create the page");
  box.evolo("dashboard", "--no-open");
  const base = box.git("rev-parse", "HEAD");
  const next = await pushMore(box, base, 40);
  const keys = pageModel(box).units.map((unit) => unit.key);
  assert.deepEqual(keys.toSorted(), [`${REPO}/${id}`, `${REPO}/${next.id}`].toSorted());
});

test("evolo review writes the page again with that review", async () => {
  const { box, id } = await scoredPush();
  box.evolo("dashboard", "--no-open");
  assert.deepEqual(pageModel(box).reviews, []);
  box.evolo("review", id);
  assert.deepEqual(pageModel(box).reviews.map((review) => review.key), [`${REPO}/${id}`]);
});

test("a merged PR found by the sync appears in the page", async () => {
  const { box } = await scoredPush();
  box.evolo("dashboard", "--no-open");
  const base = box.git("rev-parse", "HEAD");
  box.git("checkout", "-q", "-b", "feature");
  const prCommit = box.commit("feat: pr work", { "pr.js": lines(15, "pr") });
  box.git("checkout", "-q", "main");
  box.git("merge", "-q", "--no-ff", "-m", "Merge pull request #7", "feature");
  const merge = box.git("rev-parse", "HEAD");
  box.setGithub({
    commitPrs: { [prCommit]: [{ number: 7, merged: true, baseRefOid: base }] },
    prs: [{
      number: 7, title: "PR work", body: "Adds pr.js", url: "https://github.com/me/proj/pull/7", state: "MERGED",
      mergedAt: new Date().toISOString(), baseRefName: "main", baseRefOid: base, headRefOid: prCommit, mergeCommit: { oid: merge },
    }],
  });
  box.evolo("sync", "--background");
  await box.settled("pr-7");
  assert.ok(pageModel(box).units.some((unit) => unit.key === `${REPO}/pr-7` && unit.status === "scored"));
});

test("a page that cannot be written is logged and does not stop the worker scoring", async () => {
  const { box } = await scoredPush();
  // refreshDashboard only looks that the path exists, so a directory there makes the write fail and nothing else.
  mkdirSync(join(box.home, "dashboard.html"));
  const base = box.git("rev-parse", "HEAD");
  const { id } = await pushMore(box, base, 40);
  assert.equal(readRecord(box.home, REPO, id).status, "scored");
  assert.match(readFileSync(join(box.home, "evolo.log"), "utf8"), /dashboard not updated/);
  assert.deepEqual(readdirSync(box.home).filter((name) => name.startsWith(".tmp-")), [], "a failed refresh leaves no temporary file");
});
