// Evaluates one unit (a push or a merged PR, see units.mjs) end to end:
// facts, triage, AI judge in a worktree at the unit's tip, validation and XP.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { changeDiff, collectChangeFacts, collectRepoContext, diffBase, git } from "./facts.mjs";
import { FatalJudgeError, JudgeUnavailableError, SCORE_TASK } from "./judges/common.mjs";
import { computeXp, triage, validateEvaluation } from "./score.mjs";

const MAX_ATTEMPTS = 3;
const MAX_DIFF_BYTES = 80 * 1024;

function writeDiff(repoDir, facts, path) {
  const diff = changeDiff(repoDir, facts);
  const rest = facts.diffMode === "net" ? `git diff ${diffBase(repoDir, facts.base)} ${facts.tip}` : "git show on the commits in facts.json";
  const note = diff.length > MAX_DIFF_BYTES ? `\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes; use ${rest} for the rest]\n` : "";
  writeFileSync(path, diff.slice(0, MAX_DIFF_BYTES) + note);
}

// Paths a judge may cite: every file at the tip, plus the files the change touched (deleted ones included).
export function knownPathsFor(checkoutDir, facts) {
  const tracked = git(checkoutDir, ["ls-files", "-z"]).split("\0").filter(Boolean);
  return new Set([...tracked, ...facts.files.map((file) => file.path)]);
}

export function scoreValues(evaluation) {
  return Object.fromEntries(Object.entries(evaluation.scores).map(([criterion, entry]) => [criterion, entry.score]));
}

// Names the unit for a judge's instruction; everything it needs to know about the unit is in facts.json.
export function describeUnit(facts) {
  const range = `${facts.base ?? "(root)"}..${facts.tip}`;
  const commits = `${facts.commits.length} commit${facts.commits.length === 1 ? "" : "s"}`;
  const unit =
    facts.kind === "pr"
      ? `merged pull request #${facts.pr.number}: the change ${range} (${commits}). ` +
        "Its title and description are in facts.json under `pr`."
      : `a push to the default branch: the change ${range} (${commits}).`;
  const left = facts.excluded.length;
  const leftOut = left
    ? ` ${left} other commit${left === 1 ? " is" : "s are"} in that range but not part of this contribution (see \`excluded\` in facts.json); ` +
      "change.diff holds only the counted commits, one after another."
    : "";
  return `${unit}${leftOut}`;
}

const scoringTask = (facts) =>
  `Evaluate ${describeUnit(facts)} Judge the change set as one contribution. Answer with the JSON object defined in your instructions.`;

// Runs `spec` on the judge in `workDir` until `validate(output)` accepts its answer, at most MAX_ATTEMPTS times.
// Returns the validation and the run, or { ok: false, failures, unavailable } when no attempt was accepted.
export async function judgeWithRetries({ judge, spec = SCORE_TASK, validate, workDir, inputs, task, onProgress }) {
  const failures = [];
  let costUsd = 0;
  // Stays true while every attempt failed before the judge could answer: then nothing is wrong with this unit.
  let unavailable = true;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const run = await judge.judge({ workDir, inputs, task, spec, onProgress });
      costUsd += run.costUsd ?? 0;
      const validation = validate(run.output);
      if (validation.ok) return { ...validation, ...run, attempts: attempt, failures, costUsd };
      failures.push(`attempt ${attempt}: invalid output: ${validation.problems.join("; ")}`);
      unavailable = false;
    } catch (error) {
      // A run that ended in an error after the judge started still cost something (claude stopping at its budget).
      costUsd += error.costUsd ?? 0;
      failures.push(`attempt ${attempt}: ${error.message}`);
      unavailable &&= error instanceof JudgeUnavailableError;
      if (error instanceof FatalJudgeError) break;
    }
  }
  return { ok: false, failures, costUsd, unavailable };
}

// Creates a worktree at `sha` plus the judge's input files, and removes both however the run ends.
async function withCheckout(repoDir, sha, work) {
  const checkoutDir = mkdtempSync(join(tmpdir(), "xp-judge-"));
  const inputsDir = mkdtempSync(join(tmpdir(), "xp-inputs-"));
  const cleanup = () => {
    rmSync(inputsDir, { recursive: true, force: true });
    git(repoDir, ["worktree", "remove", "--force", checkoutDir]);
  };
  // Signals end the process without running `finally`, so the same cleanup is also registered for exit.
  process.once("exit", cleanup);
  try {
    git(repoDir, ["worktree", "add", "--quiet", "--detach", "--force", checkoutDir, sha]);
    return await work(checkoutDir, inputsDir);
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
}

// Runs `work(checkoutDir, inputs)` with a worktree at the unit's tip and the judge's input files
// (facts.json, repo-context.json, change.diff), and removes both however it ends. options: { repo, url, stars, own }.
export function withJudgeInputs(options, facts, work) {
  return withCheckout(options.repo, facts.tip, (checkoutDir, inputsDir) => {
    const context = collectRepoContext(checkoutDir, {
      name: basename(options.repo), url: options.url, stars: options.stars, isOwnRepo: options.own,
    });
    const inputs = {
      facts: join(inputsDir, "facts.json"),
      context: join(inputsDir, "repo-context.json"),
      diff: join(inputsDir, "change.diff"),
    };
    writeFileSync(inputs.facts, JSON.stringify(facts, null, 2));
    writeFileSync(inputs.context, JSON.stringify(context, null, 2));
    writeDiff(options.repo, facts, inputs.diff);
    return work(checkoutDir, inputs);
  });
}

// options: { repo, url, stars, own }. judge: a backend from judges/index.mjs. unit: from units.mjs.
// `beforeJudging` runs once the unit needs the AI judge (triage did not settle it), and may throw to stop it.
export async function evaluateUnit({ options, judge, unit, onProgress, beforeJudging = () => {} }) {
  const startedAt = Date.now();
  const facts = collectChangeFacts(options.repo, unit);
  const signals = { reverted: facts.reverted };
  const xpInput = { countedLines: facts.totals.countedLines, stars: options.stars, isOwnRepo: options.own, signals };
  const elapsed = () => ({ durationMs: Date.now() - startedAt });

  const triaged = triage(facts);
  if (triaged) {
    const { xp, breakdown } = computeXp({ ...xpInput, type: triaged.contribution_type, scores: scoreValues(triaged) });
    return { facts, method: "rule", status: "ok", evaluation: triaged, issues: [], xp, breakdown, ...elapsed() };
  }

  beforeJudging();

  const judged = await withJudgeInputs(options, facts, (checkoutDir, inputs) => {
    const knownPaths = knownPathsFor(checkoutDir, facts);
    return judgeWithRetries({
      judge, workDir: checkoutDir, inputs, onProgress,
      task: scoringTask(facts),
      validate: (output) => validateEvaluation(output, facts, knownPaths),
    });
  });

  const judgeInfo = { backend: judge.backend, model: judge.model };
  const common = { facts, method: "ai", judge: judgeInfo, failures: judged.failures, costUsd: judged.costUsd };
  // `judgeUnavailable`: the judge could not be reached at all, so the caller may try again later.
  if (!judged.ok) return { ...common, status: "failed", judgeUnavailable: judged.unavailable, ...elapsed() };

  const { xp, breakdown } = computeXp({ ...xpInput, type: judged.evaluation.contribution_type, scores: scoreValues(judged.evaluation) });
  return {
    ...common,
    status: judged.status,
    evaluation: judged.evaluation,
    issues: judged.issues,
    attempts: judged.attempts,
    toolCalls: judged.toolCalls,
    sessionID: judged.sessionID,
    deniedCommands: judged.deniedCommands ?? [],
    xp: judged.status === "ok" ? xp : 0,
    breakdown,
    ...elapsed(),
  };
}
