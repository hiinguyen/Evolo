import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { BudgetExceededError, assertWithinBudget, dailyBudget, nextLocalDay, spentOn } from "./budget.mjs";
import { setConfig } from "./config.mjs";
import { writeRecord } from "./ledger.mjs";
import { saveReport } from "./report.mjs";
import { writeReview } from "./review.mjs";

const homes = [];
after(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const makeHome = () => {
  const home = mkdtempSync(join(tmpdir(), "evolo-budget-"));
  homes.push(home);
  return home;
};

const noon = new Date(2026, 9, 20, 12, 0);
const at = (hours, day = 20) => new Date(2026, 9, day, hours, 0).toISOString();
const record = (id, when, costUsd) => ({ id, kind: "push", status: "scored", xp: 10, at: when, ...(costUsd !== undefined && { result: { costUsd } }) });

test("the day's spending adds every scoring, every review and every report of that local day", () => {
  const home = makeHome();
  writeRecord(home, "me/a", record("push-1", at(9), 0.5));
  writeRecord(home, "me/a", { ...record("push-2", at(10), 0.25), status: "failed" });
  writeRecord(home, "me/b", record("pr-3", at(11), 1));
  writeRecord(home, "me/b", record("push-4", at(11)));
  writeRecord(home, "me/b", record("push-5", at(23, 19), 4));
  writeReview(home, { unitId: "pr-3", repo: "me/b", at: at(11), costUsd: 0.25 });
  writeReview(home, { unitId: "push-5", repo: "me/b", at: at(8, 21), costUsd: 3 });
  saveReport(home, { id: "week/2026-10-19", at: at(12), costUsd: 0.5 });
  saveReport(home, { id: "month/2026-09-01", at: at(9, 19), costUsd: 0.75 });
  assert.equal(spentOn(home, "2026-10-20"), 2.5);
  assert.equal(spentOn(home, "2026-10-19"), 4.75);
  assert.equal(spentOn(home, "2026-10-22"), 0);
});

test("judging stops once the day's spending reaches the cap, $5 unless set", () => {
  const home = makeHome();
  assert.deepEqual(dailyBudget(home, noon), { spent: 0, limit: 5 });
  writeRecord(home, "me/a", record("push-1", at(9), 4.99));
  assertWithinBudget(home, noon);
  writeRecord(home, "me/a", record("push-2", at(10), 0.01));
  assert.throws(() => assertWithinBudget(home, noon), (error) => error instanceof BudgetExceededError && /\$5\.00 of \$5\.00 today/.test(error.message));
  setConfig(home, "budget.daily-usd", "10");
  assertWithinBudget(home, noon);
  assertWithinBudget(home, new Date(2026, 9, 21, 0, 0));
});

test("the next local day starts at local midnight", () => {
  assert.equal(nextLocalDay(noon), new Date(2026, 9, 21, 0, 0).getTime());
  assert.equal(nextLocalDay(new Date(2026, 11, 31, 23, 59)), new Date(2027, 0, 1, 0, 0).getTime());
});

test("a cap broken by hand in config.json falls back to the default instead of failing scoring", () => {
  const home = makeHome();
  writeFileSync(join(home, "config.json"), JSON.stringify({ budget: { "daily-usd": "lots" } }));
  assert.deepEqual(dailyBudget(home, noon), { spent: 0, limit: 5 });
  assert.match(readFileSync(join(home, "evolo.log"), "utf8"), /budget.daily-usd must be .*; using the default daily budget/);
});
