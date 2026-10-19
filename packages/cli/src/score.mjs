// Pure functions: triage, validation of the judge's output, and the XP formula from docs/xp-evaluation.md section 7.

export const RUBRIC_VERSION = "1.0";
export const FORMULA_VERSION = "1.2";
export const LEVEL_FORMULA_VERSION = "1.0";

export const CRITERIA = ["impact", "centrality", "difficulty", "quality", "scope_fit"];
const EVIDENCE_REQUIRED = CRITERIA.filter((criterion) => criterion !== "scope_fit");
const ALLOWED_FLAGS = new Set(["suspected_injection", "mostly_generated_code", "unclear_intent", "incomplete_investigation"]);

export const BASE_XP = {
  security: 80,
  feature: 60,
  bugfix: 60,
  performance: 60,
  refactor: 50,
  test: 40,
  infra: 35,
  docs: 25,
  chore: 10,
};

const VALUE_WEIGHTS = { impact: 0.35, centrality: 0.25, difficulty: 0.25, quality: 0.15 };
const CENTRALITY_FULL_AT_IMPACT = 2;
const TRIAGE_MAX_LINES = 20;
const UNSUPPORTED_SCORE_CAP = 2;
const UNTESTED_QUALITY_CAP = 3;
const UNFOCUSED_SIZE_CAP = 1.0;
// XP is awarded in steps of XP_STEP, and a contribution that counts earns at least one step.
const XP_STEP = 5;
// Reaching level L takes LEVEL_XP_FACTOR × L² XP in total.
const LEVEL_XP_FACTOR = 20;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;

function fixedScores(type, values, reason) {
  const scores = Object.fromEntries(
    CRITERIA.map((criterion, index) => [criterion, { score: values[index], reason, evidence: [] }]),
  );
  return { rubric_version: RUBRIC_VERSION, contribution_type: type, scores, summary: reason, flags: [], notes: "triaged by rule" };
}

// Returns a rule-based evaluation for trivial changes, or null when the change needs the AI judge.
export function triage(facts) {
  const changedLines = facts.totals.additions + facts.totals.deletions;
  const classes = new Set(facts.files.map((file) => file.class));
  const onlyIn = (allowed) => [...classes].every((fileClass) => allowed.includes(fileClass));

  if (changedLines <= TRIAGE_MAX_LINES && onlyIn(["docs"])) {
    return fixedScores("docs", [1, 0, 0, 2, 4], "Small documentation edit.");
  }
  if (onlyIn(["lockfile", "generated"])) {
    return fixedScores("chore", [0, 0, 0, 2, 4], "Dependency, lockfile or generated-file update.");
  }
  return null;
}

function evidencePath(reference) {
  return reference.replace(/:\d+(-\d+)?$/, "");
}

function checkShape(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") return ["output is not a JSON object"];
  if (!(raw.contribution_type in BASE_XP)) problems.push(`unknown contribution_type "${raw.contribution_type}"`);
  for (const criterion of CRITERIA) {
    const entry = raw.scores?.[criterion];
    if (!entry || !Number.isInteger(entry.score) || entry.score < 0 || entry.score > 4) {
      problems.push(`${criterion}.score must be an integer 0-4`);
    } else if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      problems.push(`${criterion}.reason is missing`);
    } else if (!Array.isArray(entry.evidence)) {
      problems.push(`${criterion}.evidence must be an array`);
    }
  }
  if (typeof raw.summary !== "string" || raw.summary.trim() === "") problems.push("summary is missing");
  return problems;
}

// Validates the judge's raw output against the schema and the measured facts.
// Shape errors and self-reported incomplete investigations are rejected (the caller retries);
// fact contradictions adjust scores and are recorded as issues.
export function validateEvaluation(raw, facts, knownPaths) {
  const shapeProblems = checkShape(raw);
  if (shapeProblems.length > 0) return { ok: false, problems: shapeProblems };
  // A judge that admits it did not read the change has not produced an evaluation, only a guess.
  if (raw.flags?.includes("incomplete_investigation")) {
    return { ok: false, problems: [`judge reported an incomplete investigation: ${raw.notes ?? ""}`.trim()] };
  }

  const issues = [];
  const scores = Object.fromEntries(
    CRITERIA.map((criterion) => {
      const entry = raw.scores[criterion];
      const evidence = entry.evidence.filter((reference) => knownPaths.has(evidencePath(String(reference))));
      const dropped = entry.evidence.length - evidence.length;
      if (dropped > 0) issues.push(`${criterion}: dropped ${dropped} evidence reference(s) to unknown paths`);

      let score = entry.score;
      if (EVIDENCE_REQUIRED.includes(criterion) && evidence.length === 0 && score > UNSUPPORTED_SCORE_CAP) {
        issues.push(`${criterion}: no valid evidence, capped ${score} -> ${UNSUPPORTED_SCORE_CAP}`);
        score = UNSUPPORTED_SCORE_CAP;
      }
      if (criterion === "quality" && !facts.testsTouched && facts.repoHasTests && score > UNTESTED_QUALITY_CAP) {
        issues.push(`quality: no tests touched in a tested repo, capped ${score} -> ${UNTESTED_QUALITY_CAP}`);
        score = UNTESTED_QUALITY_CAP;
      }
      return [criterion, { ...entry, score, evidence }];
    }),
  );

  const flags = (Array.isArray(raw.flags) ? raw.flags : []).filter((flag) => ALLOWED_FLAGS.has(flag));
  const status = flags.includes("suspected_injection") ? "needs_review" : "ok";
  return { ok: true, evaluation: { ...raw, scores, flags }, issues, status };
}

// Centrality amplifies impact rather than adding value on its own:
// a no-op change in the core is still a no-op, so it earns no centrality credit until impact reaches 2.
function contributionValue(scores) {
  const centralityGate = Math.min(1, scores.impact / CENTRALITY_FULL_AT_IMPACT);
  return (
    VALUE_WEIGHTS.impact * scores.impact +
    VALUE_WEIGHTS.centrality * scores.centrality * centralityGate +
    VALUE_WEIGHTS.difficulty * scores.difficulty +
    VALUE_WEIGHTS.quality * scores.quality
  );
}

export function computeXp({ type, scores, countedLines, stars, isOwnRepo, signals = {} }) {
  const value = contributionValue(scores);
  const mValue = 0.25 + value * 0.6875;
  const sizeCap = scores.scope_fit <= 1 ? UNFOCUSED_SIZE_CAP : 1.5;
  const mSize = clamp(0.5 + 0.25 * Math.log2(1 + countedLines / 50), 0.5, sizeCap);
  const mRepo = clamp(0.8 + 0.1 * Math.log10(1 + stars) + (isOwnRepo ? 0 : 0.3), 0.8, 1.6);
  const mSignals =
    1 + (signals.ciFirstPass ? 0.05 : 0) + (signals.cleanMerge ? 0.05 : 0) + (signals.closesBugIssue ? 0.1 : 0);
  const raw = BASE_XP[type] * mValue * mSize * mRepo * mSignals;
  const xp = signals.reverted ? 0 : Math.max(XP_STEP, Math.round(raw / XP_STEP) * XP_STEP);

  return {
    xp,
    breakdown: {
      formula_version: FORMULA_VERSION,
      base: BASE_XP[type],
      raw: round2(raw),
      value: round2(value),
      mValue: round2(mValue),
      mSize: round2(mSize),
      mRepo: round2(mRepo),
      mSignals: round2(mSignals),
      reverted: Boolean(signals.reverted),
    },
  };
}

// The level reached with `totalXp`, and the XP totals where it started and where the next one starts.
export function levelFor(totalXp) {
  const level = Math.floor(Math.sqrt(Math.max(0, totalXp) / LEVEL_XP_FACTOR));
  return { level, from: LEVEL_XP_FACTOR * level ** 2, next: LEVEL_XP_FACTOR * (level + 1) ** 2 };
}
