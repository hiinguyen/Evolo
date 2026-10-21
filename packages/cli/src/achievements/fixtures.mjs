// Ledger records for the achievement tests, with only the fields the rules read. Not a test file itself: the
// visible and the secret achievements' tests both build their ledgers with it.
import { CRITERIA } from "../score.mjs";

// "2026-10-19T12:00:00+07:00": a local time in the zone the tests fix with TZ.
export const day = (date, time = "12:00:00") => `${date}T${time}+07:00`;

export const file = (path, cls, additions, deletions = 0) => ({ path, class: cls, additions, deletions });

export const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));

// A record as the worker writes it; every criterion scores 2 unless `scores` says otherwise.
export function unit({
  id = "push-a-b", repo = "me/a", kind = "push", status = "scored", xp = 50, landed = day("2026-10-19"), type = "feature",
  method = "ai", scores = {}, files = [], commits, testsTouched = false, repoHasTests = true, costUsd = 0.1, signals, flags = [],
} = {}) {
  const all = Object.fromEntries(CRITERIA.map((criterion) => [criterion, { score: scores[criterion] ?? 2 }]));
  return {
    id, repo, kind, status, xp, at: landed, landedAt: landed,
    ...(signals ? { signals } : {}),
    result: {
      method, costUsd,
      evaluation: { contribution_type: type, scores: all, flags },
      facts: { files, commits: commits ?? [{ date: landed, subject: "feat: add a thing", body: "" }], testsTouched, repoHasTests },
    },
  };
}

// `count` units on consecutive days from 2026-10-01 (a Thursday), with ids u0, u1...
export const daily = (count, options = {}) =>
  many(count, (index) => unit({ id: `u${index}`, landed: day(`2026-10-${String(index + 1).padStart(2, "0")}`), ...options }));
