// Analytics over the ledger (docs/superpowers/specs/2026-10-20-evolo-stats-design.md): what the user's work looks like
// over a calendar period, and their streak of workdays. Pure functions of ledger records, computed again on every call,
// so a unit later reverted or replaced changes them at once. Dates are local time, and a unit belongs to the day it
// landed (ledger.mjs's landedAt).
import { posix } from "node:path";
import { COUNTED_CLASSES } from "./facts.mjs";
import { landedAt, localDay } from "./ledger.mjs";
import { CRITERIA, levelFor } from "./score.mjs";

export const PERIODS = ["week", "month", "quarter"];

const round2 = (value) => Math.round(value * 100) / 100;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const landedTime = (record) => Date.parse(landedAt(record));
// Monday is 0: the week starts on Monday.
const weekdayOf = (date) => (date.getDay() + 6) % 7;
const isWeekend = (date) => weekdayOf(date) >= 5;
// Day arithmetic on the calendar, so a day is always one day whatever the clock does.
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const pad = (value) => String(value).padStart(2, "0");

// The calendar `kind` period holding `now`, or the one `back` periods earlier: { kind, start, end, label }.
// `end` is the start of the next period and is not part of this one.
export function periodOf(kind, now = new Date(), back = 0) {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (kind === "week") {
    const start = addDays(now, -weekdayOf(now) - 7 * back);
    const end = addDays(start, 7);
    return { kind, start, end, label: `week ${localDay(start)}..${localDay(addDays(end, -1))}` };
  }
  if (kind === "month") {
    const start = new Date(year, month - back, 1);
    return { kind, start, end: new Date(year, month - back + 1, 1), label: `${start.getFullYear()}-${pad(start.getMonth() + 1)}` };
  }
  if (kind === "quarter") {
    const first = month - (month % 3) - 3 * back;
    const start = new Date(year, first, 1);
    return { kind, start, end: new Date(year, first + 3, 1), label: `${start.getFullYear()} Q${start.getMonth() / 3 + 1}` };
  }
  throw new Error(`unknown period "${kind}": expected ${PERIODS.join(", ")}`);
}

// [key, { units, xp }] per key, the most XP first.
function tally(units, keyOf) {
  const totals = new Map();
  for (const record of units) {
    const key = keyOf(record);
    const { units: count = 0, xp = 0 } = totals.get(key) ?? {};
    totals.set(key, { units: count + 1, xp: xp + record.xp });
  }
  return [...totals].sort(([, a], [, b]) => b.xp - a.xp || b.units - a.units);
}

// Averages of the judge's scores; units triaged by rule carry fixed scores that say nothing about the work.
function rubricOf(units) {
  const judged = units.filter((record) => record.result?.method === "ai");
  if (judged.length === 0) return { n: 0, averages: {} };
  const average = (criterion) => round2(sum(judged.map((record) => record.result.evaluation.scores[criterion].score)) / judged.length);
  return { n: judged.length, averages: Object.fromEntries(CRITERIA.map((criterion) => [criterion, average(criterion)])) };
}

// Units that changed code in a repository with tests, and how many of them touched a test.
function testsOf(units) {
  const eligible = units.filter((record) => record.result.facts.totals.countedLines > 0 && record.result.facts.repoHasTests);
  return { touched: eligible.filter((record) => record.result.facts.testsTouched).length, eligible: eligible.length };
}

// Counted lines by the directory holding each source or test file, per repository, the most lines first.
function dirsOf(units) {
  const lines = new Map();
  for (const record of units) {
    for (const file of record.result.facts.files.filter((candidate) => COUNTED_CLASSES.has(candidate.class))) {
      const key = JSON.stringify([record.repo, posix.dirname(file.path)]);
      lines.set(key, (lines.get(key) ?? 0) + file.additions + file.deletions);
    }
  }
  return [...lines]
    .map(([key, count]) => {
      const [repo, dir] = JSON.parse(key);
      return { repo, dir, lines: count };
    })
    .sort((a, b) => b.lines - a.lines);
}

// The user's commits in these units by local hour (24) and by weekday (7, Monday first).
function rhythmOf(units) {
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  for (const date of units.flatMap((record) => record.result.facts.commits.map((commit) => new Date(commit.date)))) {
    hours[date.getHours()] += 1;
    weekdays[weekdayOf(date)] += 1;
  }
  return { hours, weekdays };
}

// What the scored units that landed in `period` add up to; reverted units count only toward stability.
export function computeStats(records, period) {
  const inPeriod = (record) => landedTime(record) >= period.start.getTime() && landedTime(record) < period.end.getTime();
  const scored = records.filter((record) => record.status === "scored");
  const units = scored.filter(inPeriod);
  const xpBeforeEnd = sum(scored.filter((record) => landedTime(record) < period.end.getTime()).map((record) => record.xp));
  const reverted = records.filter((record) => record.status === "reverted" && inPeriod(record)).length;
  return {
    period,
    units: units.length,
    xp: sum(units.map((record) => record.xp)),
    costUsd: round2(sum(units.map((record) => record.result?.costUsd ?? 0))),
    level: levelFor(xpBeforeEnd).level,
    types: tally(units, (record) => record.result.evaluation.contribution_type).map(([type, totals]) => ({ type, ...totals })),
    rubric: rubricOf(units),
    tests: testsOf(units),
    reverts: { reverted, total: units.length + reverted },
    repos: tally(units, (record) => record.repo).map(([repo, totals]) => ({ repo, ...totals })),
    dirs: dirsOf(units),
    ...rhythmOf(units),
  };
}

// Workdays in a row with a scored unit, as of `now`, and the longest such run ever: { current, longest }.
// A Saturday or Sunday without work never breaks the run, and one with work adds to it. Today without work yet does
// not break it either, since the day is not over.
export function streakOf(records, now = new Date()) {
  const worked = new Set(records.filter((record) => record.status === "scored").map((record) => localDay(new Date(landedAt(record)))));
  if (worked.size === 0) return { current: 0, longest: 0 };
  const today = addDays(now, 0);
  let current = 0;
  for (let date = worked.has(localDay(today)) ? today : addDays(today, -1); ; date = addDays(date, -1)) {
    if (worked.has(localDay(date))) current += 1;
    else if (!isWeekend(date)) break;
  }
  let longest = 0;
  let run = 0;
  const first = [...worked].sort()[0];
  for (let date = new Date(`${first}T00:00:00`); date <= today; date = addDays(date, 1)) {
    if (worked.has(localDay(date))) run += 1;
    else if (!isWeekend(date)) run = 0;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}
