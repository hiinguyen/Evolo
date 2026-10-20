// The daily cap on what the background worker spends on the judge (docs/auto-scoring.md section 7).
// What was spent is read from what the judge's runs left behind, the ledger and the saved reviews, so there is no
// separate counter to keep in step. The cap is checked before a unit is judged, never during it: a unit that starts
// below the cap finishes, so a day can end above it by at most one unit (each run stops at --max-budget-usd).
import { CONFIG_KEYS, getConfig } from "./config.mjs";
import { listAllRecords, localDay } from "./ledger.mjs";
import { logLine } from "./store.mjs";
import { listAllReviews } from "./review.mjs";

// Thrown instead of judging once the day's spending has reached the cap; the unit waits for the next local day.
export class BudgetExceededError extends Error {}

const spentBy = (entries, day) =>
  entries.filter((entry) => entry.at && localDay(new Date(entry.at)) === day).reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);

// USD the judge spent on the local day `day` ("YYYY-MM-DD"): every unit scored (or failed) and every review written.
// A failed unit scored again replaces its record, so what the failed attempts cost is no longer counted.
export function spentOn(home, day) {
  const scorings = listAllRecords(home).map((record) => ({ at: record.at, costUsd: record.result?.costUsd }));
  return spentBy(scorings, day) + spentBy(listAllReviews(home), day);
}

// The cap; a value broken by hand in config.json falls back to the default, so it never fails a unit's scoring.
function dailyLimit(home) {
  try {
    return Number(getConfig(home, "budget.daily-usd"));
  } catch (error) {
    logLine(home, `${error.message}; using the default daily budget`);
    return Number(CONFIG_KEYS["budget.daily-usd"].default);
  }
}

// { spent, limit } for the local day of `now`.
export function dailyBudget(home, now = new Date()) {
  return { spent: spentOn(home, localDay(now)), limit: dailyLimit(home) };
}

export function isWithinBudget(home, now = new Date()) {
  const { spent, limit } = dailyBudget(home, now);
  return spent < limit;
}

export function assertWithinBudget(home, now = new Date()) {
  const { spent, limit } = dailyBudget(home, now);
  if (spent >= limit) {
    throw new BudgetExceededError(`the daily judge budget is spent: $${spent.toFixed(2)} of $${limit.toFixed(2)} today`);
  }
}

// The start of the local day after `now`, as epoch milliseconds.
export function nextLocalDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}
