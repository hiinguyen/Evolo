import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { landedAt, localDay, readSummary, scoredRecord, writeRecord } from "./ledger.mjs";

const homes = [];
after(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const makeHome = () => {
  const home = mkdtempSync(join(tmpdir(), "evolo-ledger-"));
  homes.push(home);
  return home;
};
const record = (id, xp, status = "scored", at = new Date().toISOString()) => ({ id, kind: "push", status, xp, summary: "", at });

test("the summary counts scored XP of every repository by local day, and is rebuilt with each record", () => {
  const home = makeHome();
  writeRecord(home, "me/a", record("push-1", 100, "scored", "2026-10-01T12:00:00.000Z"));
  writeRecord(home, "me/b", record("pr-2", 50));
  writeRecord(home, "me/b", record("pr-3", 0, "failed"));
  assert.deepEqual(readSummary(home), {
    total: 150,
    xpByDay: { [localDay(new Date("2026-10-01T12:00:00.000Z"))]: 100, [localDay(new Date())]: 50 },
  });
  writeRecord(home, "me/b", { ...record("pr-2", 0, "reverted"), previousStatus: "scored" });
  assert.equal(readSummary(home).total, 100);
});

test("an unreadable record stops the summary, never the record being written", () => {
  const home = makeHome();
  writeRecord(home, "me/a", record("push-1", 100));
  writeFileSync(join(home, "ledger/me/a/push-broken.json"), "{");
  writeRecord(home, "me/a", record("push-2", 25));
  assert.equal(JSON.parse(readFileSync(join(home, "ledger/me/a/push-2.json"), "utf8")).xp, 25);
  assert.match(readFileSync(join(home, "evolo.log"), "utf8"), /summary not updated: cannot read .*push-broken\.json/);
});

test("a unit lands when it was pushed or merged, falling back to its last commit and then to when it was scored", () => {
  const commits = [{ date: "2026-10-01T09:00:00+07:00" }, { date: "2026-10-02T21:30:00+07:00" }];
  const facts = { pr: { mergedAt: "2026-10-03T10:00:00Z" }, commits };
  const scored = { ...record("pr-1", 10, "scored", "2026-10-05T00:00:00.000Z"), result: { facts } };
  assert.equal(landedAt({ ...scored, landedAt: "2026-10-04T00:00:00.000Z" }), "2026-10-04T00:00:00.000Z");
  assert.equal(landedAt(scored), "2026-10-03T10:00:00Z");
  assert.equal(landedAt({ ...scored, result: { facts: { pr: null, commits } } }), "2026-10-02T21:30:00+07:00");
  assert.equal(landedAt(record("push-1", 10, "scored", "2026-10-05T00:00:00.000Z")), "2026-10-05T00:00:00.000Z");
  // A time that cannot be read is skipped, so the unit still lands on a real day instead of none.
  assert.equal(landedAt({ ...scored, landedAt: "garbage", result: { facts: { pr: { mergedAt: "" }, commits } } }), "2026-10-02T21:30:00+07:00");
});

test("a scored record keeps when its unit landed", () => {
  const result = { status: "ok", xp: 20, facts: { id: "push-a-b", kind: "push", reverted: false }, evaluation: { summary: "s" } };
  assert.equal(scoredRecord(result, { landedAt: "2026-10-04T00:00:00.000Z" }).landedAt, "2026-10-04T00:00:00.000Z");
  assert.equal(scoredRecord(result).landedAt, null);
});

test("XP counts on the day the unit landed, not the day it was scored", () => {
  const home = makeHome();
  const landed = "2026-10-01T12:00:00.000Z";
  writeRecord(home, "me/a", { ...record("push-1", 40, "scored", "2026-10-03T12:00:00.000Z"), landedAt: landed });
  assert.deepEqual(readSummary(home).xpByDay, { [localDay(new Date(landed))]: 40 });
});
