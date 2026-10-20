// Code review of one unit (docs/review.md): a separate judge task (judge/xp-review.md) that reads the change the way
// a reviewer reads a pull request. Reviews never affect XP, and live apart from the ledger, in
// <home>/reviews/<owner>/<name>/<unit id>.json, so scoring a unit again leaves its review in place.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeUnit, judgeWithRetries, withJudgeInputs } from "./evaluate.mjs";
import { REVIEW_TASK } from "./judges/common.mjs";
import { evidencePath } from "./score.mjs";
import { readJson, writeJson } from "./store.mjs";
import { unitLabel } from "./views.mjs";

export const SEVERITIES = ["high", "medium", "low"];
export const CATEGORIES = ["bug", "security", "performance", "test", "design", "readability", "other"];
export const REVIEW_FLAGS = ["suspected_injection", "incomplete_investigation"];

const reviewPath = (home, key, id) => join(home, "reviews", ...key.split("/"), `${id}.json`);

// The stored review of unit `id` in repository `key`, or null when it has none.
export function readReview(home, key, id) {
  return readJson(reviewPath(home, key, id), null);
}

// stored: { unitId, repo, tip, at, language, judge, costUsd, durationMs, review, issues }
export function writeReview(home, stored) {
  writeJson(reviewPath(home, stored.repo, stored.unitId), stored);
}

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isTextList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

function checkFinding(finding, index) {
  const at = `findings[${index}]`;
  if (!finding || typeof finding !== "object") return [`${at} is not an object`];
  return [
    ...(SEVERITIES.includes(finding.severity) ? [] : [`${at}.severity must be one of ${SEVERITIES.join(", ")}`]),
    ...(CATEGORIES.includes(finding.category) ? [] : [`${at}.category must be one of ${CATEGORIES.join(", ")}`]),
    ...["location", "title", "detail"].filter((field) => !isText(finding[field])).map((field) => `${at}.${field} is missing`),
    ...(typeof finding.suggestion === "string" ? [] : [`${at}.suggestion must be text`]),
  ];
}

function checkShape(raw) {
  if (!raw || typeof raw !== "object") return ["output is not a JSON object"];
  return [
    ...(isText(raw.overview) ? [] : ["overview is missing"]),
    ...["strengths", "improvements"].filter((field) => !isTextList(raw[field])).map((field) => `${field} must be a list of text`),
    ...(Array.isArray(raw.findings) ? raw.findings.flatMap(checkFinding) : ["findings must be a list"]),
    ...(raw.flags === undefined || isTextList(raw.flags) ? [] : ["flags must be a list of text"]),
    ...(raw.notes === undefined || typeof raw.notes === "string" ? [] : ["notes must be text"]),
  ];
}

// "src/a.js:10-12" -> 12, "src/a.js:7" -> 7, "src/a.js" -> null.
const lastLine = (location) => {
  const match = /:(\d+)(?:-(\d+))?$/.exec(location);
  return match ? Number(match[2] ?? match[1]) : null;
};

// Files larger than this are not read for their line count; their findings keep their line numbers unchecked.
const MAX_COUNTED_BYTES = 4 * 1024 * 1024;

// The number of lines of each file in `checkoutDir` (a final newline does not start a line), or null for a path
// that is not a regular file there: deleted by the change, a directory (submodule), or a symlink, which is never
// followed, since a tracked link can point anywhere on the machine. Called only with paths the validator knows.
export const lineCounter = (checkoutDir) => (path) => {
  const file = join(checkoutDir, path);
  let stats;
  try {
    stats = lstatSync(file);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  if (stats.size > MAX_COUNTED_BYTES) return Infinity;
  const text = readFileSync(file, "utf8");
  return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

// A finding's location with line numbers the file at the tip cannot have removed (a reviewer can quote line numbers
// of change.diff instead of the file); the finding itself stays, at its file. Records what it changed in `issues`.
function checkLines(finding, lineCount, issues) {
  const line = lastLine(finding.location);
  if (line === null) return finding;
  const path = evidencePath(finding.location);
  const count = lineCount(path);
  if (count !== null && line <= count) return finding;
  issues.push(
    count === null
      ? `dropped line numbers of a file not at the tip: ${finding.location} "${finding.title}"`
      : `dropped line numbers past the end of ${path} (${count} lines): ${finding.location} "${finding.title}"`,
  );
  return { ...finding, location: path };
}

// Validates the reviewer's raw output. Shape errors and self-reported incomplete investigations are rejected (the caller
// retries); findings at paths that exist neither in the repository nor in the change are dropped, and line numbers
// past the end of their file (`lineCount(path)`) are removed; both are recorded as issues.
export function validateReview(raw, knownPaths, lineCount = () => Infinity) {
  const problems = checkShape(raw);
  if (problems.length > 0) return { ok: false, problems };
  if (raw.flags?.includes("incomplete_investigation")) {
    return { ok: false, problems: [`reviewer reported an incomplete investigation: ${raw.notes ?? ""}`.trim()] };
  }
  const issues = [];
  const findings = raw.findings
    .filter((finding) => {
      if (knownPaths.has(evidencePath(finding.location))) return true;
      issues.push(`dropped a finding at an unknown path: ${finding.location} "${finding.title}"`);
      return false;
    })
    .map((finding) => checkLines(finding, lineCount, issues));
  const flags = (raw.flags ?? []).filter((flag) => REVIEW_FLAGS.includes(flag));
  return { ok: true, review: { ...raw, findings, flags, notes: raw.notes ?? "" }, issues };
}

const reviewTask = (facts, language) =>
  `Review ${describeUnit(facts)} Review the change set as one contribution. ` +
  `Write the prose fields in this language: ${language}. Answer with the JSON object defined in your instructions.`;

// Reviews the unit described by `facts` (as stored in the ledger). options: { repo, url, stars, own }.
// Returns { ok: true, review, issues, judge, costUsd, durationMs }, or { ok: false, failures, unavailable, costUsd }.
export async function reviewUnit({ options, judge, facts, language, onProgress }) {
  const startedAt = Date.now();
  const judged = await withJudgeInputs(options, facts, (checkoutDir, inputs) =>
    judgeWithRetries({
      judge, spec: REVIEW_TASK, checkoutDir, facts, inputs, onProgress,
      task: reviewTask(facts, language),
      validate: (output, knownPaths) => validateReview(output, knownPaths, lineCounter(checkoutDir)),
    }),
  );
  const common = { judge: { backend: judge.backend, model: judge.model }, costUsd: judged.costUsd, durationMs: Date.now() - startedAt };
  if (!judged.ok) return { ok: false, failures: judged.failures, unavailable: judged.unavailable, ...common };
  return { ok: true, review: judged.review, issues: judged.issues, ...common };
}

const bySeverity = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
const bullets = (title, items) => (items.length === 0 ? [] : ["", `${title}:`, ...items.map((item) => `  - ${item}`)]);

// The stored review as text for the terminal: the most severe findings first.
export function formatReview(stored) {
  const { review } = stored;
  const cost = stored.costUsd ? ` · $${stored.costUsd.toFixed(2)}` : "";
  const lines = [
    `${stored.repo} ${unitLabel(stored.unitId)}  review in ${stored.language}  ${stored.at.slice(0, 16).replace("T", " ")}` +
      ` · ${stored.judge.model ?? stored.judge.backend}${cost}`,
  ];
  if (review.flags.includes("suspected_injection")) {
    lines.push(`WARNING: the reviewer suspected prompt injection: ${review.notes || "see the change"}`);
  }
  lines.push("", review.overview, ...bullets("strengths", review.strengths), ...bullets("improvements", review.improvements), "");
  const findings = [...review.findings].sort(bySeverity);
  if (findings.length === 0) lines.push("findings: none");
  else lines.push(`findings (${findings.length}):`);
  for (const finding of findings) {
    lines.push(`  [${finding.severity}] ${finding.category}  ${finding.location}  ${finding.title}`, `      ${finding.detail}`);
    if (finding.suggestion) lines.push(`      fix: ${finding.suggestion}`);
  }
  if (stored.issues.length > 0) lines.push("", "validator:", ...stored.issues.map((issue) => `  ${issue}`));
  return lines.join("\n");
}
