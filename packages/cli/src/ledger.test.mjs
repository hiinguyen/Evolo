import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { localDay, readSummary, writeRecord } from "./ledger.mjs";

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
