// `evolo report` (docs/superpowers/specs/2026-10-22-evolo-report-design.md): a performance review of one calendar period.
// Code computes everything about the period, the numbers and the units worth highlighting (reportData); a judge task
// (judge/xp-report.md) only writes the words, from one input file and no access to any repository; validateReport keeps
// it to citing units the period really has and to stating no numbers. Saved reports live in
// <home>/reports/<kind>/<first day>.json and never affect XP.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { achievementsOf, unlockedIn } from "./achievements.mjs";
import { judgeWithRetries } from "./evaluate.mjs";
import { REPORT_TASK } from "./judges/common.mjs";
import { landedAt, localDay, localTime } from "./ledger.mjs";
import { terminalSafe } from "./safe-text.mjs";
import { CRITERIA } from "./score.mjs";
import { computeStats, periodOf } from "./stats.mjs";
import { readJson, readJsonTree, writeJson } from "./store.mjs";
import { formatStats, unitLabel } from "./views.mjs";

// The writer reads at most this many units, about 1.5 KB each, so its input stays near the size of a scored diff.
export const MAX_UNITS = 60;
// The most units code picks as the period's highlights.
export const MAX_HIGHLIGHTS = 5;
export const REPORT_FLAGS = ["suspected_injection"];

const keyOf = (record) => `${record.repo}/${record.id}`;
const labelOf = (record) => `${record.repo.split("/").at(-1)} ${unitLabel(record.id)}`;
const landedTime = (record) => Date.parse(landedAt(record));
const isWithin = (period) => (record) => landedTime(record) >= period.start.getTime() && landedTime(record) < period.end.getTime();
const isJudged = (record) => record.result?.method === "ai";
const impactOf = (record) => record.result?.evaluation?.scores?.impact?.score ?? 0;

// Units the judge scored first, the most impact, then the most XP, then the earliest; then units scored by rule, whose
// fixed scores say nothing about the work, the most XP first. A new array.
function byImportance(units) {
  const judged = units.filter(isJudged).sort((a, b) => impactOf(b) - impactOf(a) || b.xp - a.xp || landedTime(a) - landedTime(b));
  const ruled = units.filter((record) => !isJudged(record)).sort((a, b) => b.xp - a.xp || landedTime(a) - landedTime(b));
  return [...judged, ...ruled];
}

// Only what a look back needs from a code review: the findings' details and fixes stay with the review.
const reviewInput = (stored) => ({
  overview: stored.review.overview,
  strengths: stored.review.strengths,
  improvements: stored.review.improvements,
  findings: stored.review.findings.map(({ severity, category, title }) => ({ severity, category, title })),
});

// One unit as the writer reads it. The judge's evidence and notes are left out: the writer never sees the code.
function unitInput(record, review) {
  const { evaluation, facts = {} } = record.result;
  return {
    key: keyOf(record),
    label: labelOf(record),
    type: evaluation?.contribution_type ?? null,
    xp: record.xp,
    landedAt: landedAt(record),
    method: record.result.method,
    title: facts.pr?.title ?? facts.commits?.[0]?.subject ?? null,
    summary: record.summary ?? evaluation?.summary ?? "",
    scores: isJudged(record)
      ? Object.fromEntries(CRITERIA.map((criterion) => [criterion, { score: evaluation.scores[criterion].score, reason: evaluation.scores[criterion].reason }]))
      : null,
    files: facts.files?.length ?? 0,
    countedLines: facts.totals?.countedLines ?? 0,
    testsTouched: Boolean(facts.testsTouched),
    ...(review ? { review: reviewInput(review) } : {}),
  };
}

// The statistics the writer gets: enough to see the shape of the work, nothing it would only quote.
const numbersInput = ({ period, xp, units, level, types, rubric, tests, reverts, repos }) =>
  ({ label: period.label, xp, units, level, types, rubric, tests, reverts, repos });

// computeStats with its period's dates as ISO text, as the saved report and the dashboard hold it.
const serializable = (stats) => ({ ...stats, period: { ...stats.period, start: stats.period.start.toISOString(), end: stats.period.end.toISOString() } });

// A fingerprint of everything a report of `period` (stats.mjs's periodOf) is written from and shows: each unit that
// landed in it or in the period before (any status) with its status and XP, when each code review of the period's units
// was written, and the achievement tiers unlocked in it. A saved report whose basis no longer matches was written from
// other data, and says so. `achievements` is achievementsOf(records), passed in by a caller that already has it.
export function basisOf(records, reviews, period, achievements = achievementsOf(records)) {
  const inPeriod = records.filter(isWithin(period));
  const before = records.filter(isWithin(periodOf(period.kind, period.start, 1)));
  const keys = new Set(inPeriod.map(keyOf));
  const lines = [
    ...inPeriod.map((record) => `${keyOf(record)} ${record.status} ${record.xp}`),
    ...before.map((record) => `before ${keyOf(record)} ${record.status} ${record.xp}`),
    ...reviews.filter((stored) => keys.has(`${stored.repo}/${stored.unitId}`)).map((stored) => `${stored.repo}/${stored.unitId} review ${stored.at}`),
    ...unlockedIn(achievements, period).map(({ label }) => `unlocked ${label}`),
  ].sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

// Everything code computes for the report of `period`, as of `now`: the writer's input (period.json), the statistics
// of the period and the one before it, how many of its units failed to score, and the basis.
export function reportData(records, reviews, period, now = new Date()) {
  const inPeriod = records.filter(isWithin(period));
  const ranked = byImportance(inPeriod.filter((record) => record.status === "scored"));
  const kept = ranked.slice(0, MAX_UNITS);
  const reviewOf = new Map(reviews.map((stored) => [`${stored.repo}/${stored.unitId}`, stored]));
  const current = computeStats(records, period);
  const previous = computeStats(records, periodOf(period.kind, period.start, 1));
  const input = {
    period: {
      kind: period.kind, label: period.label, start: period.start.toISOString(), end: period.end.toISOString(),
      inProgress: now.getTime() < period.end.getTime(),
    },
    numbers: { current: numbersInput(current), previous: numbersInput(previous) },
    unlocked: unlockedIn(achievementsOf(records), period).map(({ label }) => label),
    highlights: kept.filter(isJudged).slice(0, MAX_HIGHLIGHTS).map(keyOf),
    units: kept.map((record) => unitInput(record, reviewOf.get(keyOf(record)))),
    reverted: inPeriod.filter((record) => record.status === "reverted")
      .map((record) => ({ key: keyOf(record), label: labelOf(record), summary: record.summary ?? "" })),
    omitted: ranked.length - kept.length,
  };
  return {
    input,
    stats: { current: serializable(current), previous: serializable(previous) },
    failed: inPeriod.filter((record) => record.status === "failed").length,
    basis: basisOf(records, reviews, period),
  };
}

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isTextList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

function checkPoints(points, field) {
  if (!Array.isArray(points)) return [`${field} must be a list`];
  return points.flatMap((point, index) =>
    (point && isText(point.text) && isTextList(point.units) ? [] : [`${field}[${index}] needs a text and a list of units`]));
}

function checkShape(raw) {
  if (!raw || typeof raw !== "object") return ["output is not a JSON object"];
  const highlights = Array.isArray(raw.highlights) && raw.highlights.every((entry) => entry && typeof entry.unit === "string" && isText(entry.text));
  return [
    ...(isText(raw.overview) ? [] : ["overview is missing"]),
    ...(highlights ? [] : ["highlights must be a list of { unit, text }"]),
    ...checkPoints(raw.strengths, "strengths"),
    ...checkPoints(raw.improvements, "improvements"),
    ...(raw.flags === undefined || isTextList(raw.flags) ? [] : ["flags must be a list of text"]),
    ...(raw.notes === undefined || typeof raw.notes === "string" ? [] : ["notes must be text"]),
  ];
}

// Inline code may name a thing with a digit in it (`Node 20`, `SHA-256`, `i18n`): it starts with a letter, and a bare
// number can only be its last word. `100 XP` or `about 40 lines` in backticks is still a count the writer made up.
const isName = (code) => {
  const words = code.trim().split(/\s+/);
  return /^\p{L}/u.test(code.trim()) && words.slice(0, -1).every((word) => !/^\p{Nd}+$/u.test(word));
};

// A digit outside inline code, or inline code with a digit that does not name a thing: every number the report shows
// comes from code.
const hasDigit = (text) => {
  const spans = [...text.matchAll(/`([^`]*)`/g)].map(([, code]) => code);
  return /\p{Nd}/u.test(text.replace(/`[^`]*`/g, "")) || spans.some((code) => /\p{Nd}/u.test(code) && !isName(code));
};

function digitProblems(raw) {
  const prose = [
    ["overview", raw.overview],
    ...raw.highlights.map((entry, index) => [`highlights[${index}]`, entry.text]),
    ...raw.strengths.map((point, index) => [`strengths[${index}]`, point.text]),
    ...raw.improvements.map((point, index) => [`improvements[${index}]`, point.text]),
  ];
  return prose.filter(([, text]) => hasDigit(text)).map(([field, text]) => `${field} has a digit outside inline code or a number in it: "${text}"`);
}

// The points of one list whose citations are all units of the period, each citation once; the rest are recorded.
function citedPoints(points, noun, citable, issues) {
  return points.flatMap((point) => {
    const units = [...new Set(point.units)];
    const unknown = units.filter((key) => !citable.has(key));
    if (unknown.length > 0) issues.push(`dropped ${noun} citing a unit not in the period (${unknown.join(", ")}): "${point.text}"`);
    else if (units.length === 0) issues.push(`dropped ${noun} without a citation: "${point.text}"`);
    else return [{ text: point.text, units }];
    return [];
  });
}

// Checks the writer's raw output against its input. A wrong shape, highlights other than the ones code picked, or a
// digit in the prose rejects it (the caller retries). A strength or improvement citing a unit the input does not have,
// or none, is dropped and recorded in `issues`, the way a review's finding at an unknown path is.
export function validateReport(raw, input) {
  const shape = checkShape(raw);
  if (shape.length > 0) return { ok: false, problems: shape };
  const written = raw.highlights.map((entry) => entry.unit);
  const problems = [
    ...(written.join("\n") === input.highlights.join("\n") ? [] : [`highlights must be exactly ${input.highlights.join(", ") || "none"}, in that order`]),
    ...digitProblems(raw),
  ];
  if (problems.length > 0) return { ok: false, problems };
  const citable = new Set([...input.units, ...input.reverted].map((unit) => unit.key));
  const issues = [];
  const report = {
    overview: raw.overview,
    highlights: raw.highlights.map(({ unit, text }) => ({ unit, text })),
    strengths: citedPoints(raw.strengths, "a strength", citable, issues),
    improvements: citedPoints(raw.improvements, "an improvement", citable, issues),
    flags: (raw.flags ?? []).filter((flag) => REPORT_FLAGS.includes(flag)),
    notes: raw.notes ?? "",
  };
  return { ok: true, report, issues };
}

const reportTask = (period, language) =>
  `Write the performance review of ${period.label}${period.inProgress ? `, a ${period.kind} that is not over yet` : ""}. ` +
  `Write the prose fields in this language: ${language}. Answer with the JSON object defined in your instructions.`;

// Has the judge write the report of `input` (reportData's), from period.json in a directory of its own that is removed
// however the run ends. Returns { ok: true, report, issues, judge, costUsd, durationMs }, or { ok: false, failures,
// unavailable, judge, costUsd, durationMs }.
export async function writeReport({ judge, input, language, onProgress }) {
  const startedAt = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), "xp-report-"));
  const cleanup = () => rmSync(workDir, { recursive: true, force: true });
  // Signals end the process without running `finally`, so the same cleanup is also registered for exit.
  process.once("exit", cleanup);
  try {
    const inputs = { period: join(workDir, "period.json") };
    writeFileSync(inputs.period, JSON.stringify(input, null, 2));
    const judged = await judgeWithRetries({
      judge, spec: REPORT_TASK, workDir, inputs, onProgress,
      task: reportTask(input.period, language),
      validate: (output) => validateReport(output, input),
    });
    const common = { judge: { backend: judge.backend, model: judge.model }, costUsd: judged.costUsd, durationMs: Date.now() - startedAt };
    if (!judged.ok) return { ok: false, failures: judged.failures, unavailable: judged.unavailable, ...common };
    return { ok: true, report: judged.report, issues: judged.issues, ...common };
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
}

// "week/2026-10-19": a report is named by its kind and the local day its period starts.
const reportId = (kind, start) => `${kind}/${localDay(new Date(start))}`;
const reportPath = (home, id) => join(home, "reports", `${id}.json`);

// The report to save: the period, what the judge wrote, and what it was written from, so it prints the same later.
// `data` is reportData's, `written` writeReport's successful result.
export function storedReport({ data, written, language, at }) {
  const { period } = data.input;
  return {
    id: reportId(period.kind, period.start),
    kind: period.kind, label: period.label, start: period.start, end: period.end, inProgress: period.inProgress,
    at, language, judge: written.judge, costUsd: written.costUsd, durationMs: written.durationMs,
    basis: data.basis,
    numbers: data.stats,
    unlocked: data.input.unlocked,
    failed: data.failed,
    omitted: data.input.omitted,
    units: [
      ...data.input.units.map(({ key, label, type, xp }) => ({ key, label, type, xp })),
      ...data.input.reverted.map(({ key, label }) => ({ key, label, type: null, xp: 0 })),
    ],
    report: written.report,
    issues: written.issues,
  };
}

// The saved report of `period` (stats.mjs's periodOf), or null when it has none.
export function readReport(home, period) {
  return readJson(reportPath(home, reportId(period.kind, period.start)), null);
}

export function saveReport(home, stored) {
  writeJson(reportPath(home, stored.id), stored);
}

// Every saved report, of every kind of period.
export function listAllReports(home) {
  return readJsonTree(join(home, "reports"));
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function points(title, list, labelOf) {
  const lines = list.map((point) => `  - ${point.text}  [${point.units.map(labelOf).join(" · ")}]`);
  return ["", `${title}:`, ...(lines.length > 0 ? lines : ["  none"])];
}

// What the saved report says about how it was written: the period not over yet, the ledger changed since (`stale`, with
// the command `again` that writes it again), units it could not include, and a suspected injection.
function notices(stored, { stale, again }) {
  const { failed, omitted } = stored;
  return [
    ...(stored.inProgress ? [`the ${stored.kind} was not over when this report was written`] : []),
    ...(stale ? [`the ledger changed since this report was written: \`${again}\` writes it again`] : []),
    ...(failed > 0
      ? [`${plural(failed, "unit")} of this period failed to score and ${failed === 1 ? "is" : "are"} not in this report: \`evolo retry\` scores them again`]
      : []),
    ...(omitted > 0
      ? [`${omitted} more ${omitted === 1 ? "unit" : "units"} of this period ${omitted === 1 ? "was" : "were"} left out of what the writer read: the least impactful`]
      : []),
    ...(stored.report.flags.includes("suspected_injection")
      ? [`WARNING: the writer suspected prompt injection: ${stored.report.notes || "see the units of the period"}`]
      : []),
  ];
}

// The saved report as text for the terminal: the period's numbers as they were, then the writer's words, each point
// with the units it cites. Everything in it can quote a repository, so it is printed without control characters.
export function formatReport(stored, { stale = false, again = `evolo report ${stored.kind} --again` } = {}) {
  const units = new Map(stored.units.map((unit) => [unit.key, unit]));
  const nameOf = (key) => units.get(key)?.label ?? key;
  const [heading, ...numbers] = formatStats(stored.numbers.current, stored.numbers.previous, null, stored.unlocked.map((label) => ({ label })));
  const cost = stored.costUsd ? ` · $${stored.costUsd.toFixed(2)}` : "";
  const { report } = stored;
  const highlights = report.highlights.flatMap(({ unit, text }) => {
    const known = units.get(unit);
    const detail = known ? `  ${known.xp} XP${known.type ? `  ${known.type}` : ""}` : "";
    return [`  ${nameOf(unit)}${detail}`, `    ${text}`];
  });
  const lines = [
    heading,
    `report in ${stored.language}  ${localTime(stored.at)} · ${stored.judge.model ?? stored.judge.backend}${cost}`,
    ...notices(stored, { stale, again }),
    ...numbers,
    "", "overview:", `  ${report.overview}`,
    ...(highlights.length > 0 ? ["", "highlights:", ...highlights] : []),
    ...points("strengths", report.strengths, nameOf),
    ...points("improvements", report.improvements, nameOf),
    ...(stored.issues.length > 0 ? ["", "validator:", ...stored.issues.map((issue) => `  ${issue}`)] : []),
  ];
  return terminalSafe(lines.join("\n"));
}
