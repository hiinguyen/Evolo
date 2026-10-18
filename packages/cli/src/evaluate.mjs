// Evaluates one commit end to end: facts, triage, AI judge in a worktree, validation and XP.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { collectCommitFacts, collectRepoContext, git } from "./facts.mjs";
import { FatalJudgeError } from "./judges/common.mjs";
import { computeXp, triage, validateEvaluation } from "./score.mjs";

const MAX_ATTEMPTS = 3;
const MAX_DIFF_BYTES = 80 * 1024;

function writeDiff(repoDir, facts, path) {
  const diff = git(repoDir, ["show", "--format=", "--patch", facts.sha]);
  const truncated = diff.length > MAX_DIFF_BYTES;
  const note = truncated ? `\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes; use git show for the rest]\n` : "";
  writeFileSync(path, diff.slice(0, MAX_DIFF_BYTES) + note);
}

function knownPathsFor(checkoutDir, facts) {
  const tracked = git(checkoutDir, ["ls-files", "-z"]).split("\0").filter(Boolean);
  return new Set([...tracked, ...facts.files.map((file) => file.path)]);
}

export function scoreValues(evaluation) {
  return Object.fromEntries(Object.entries(evaluation.scores).map(([criterion, entry]) => [criterion, entry.score]));
}

async function judgeWithRetries({ judge, checkoutDir, facts, inputs, onProgress }) {
  const task =
    `Evaluate commit ${facts.sha} (parent ${facts.parent}). ` +
    "It was pushed directly to the default branch. Answer with the JSON object defined in your instructions.";
  const knownPaths = knownPathsFor(checkoutDir, facts);
  const failures = [];
  let costUsd = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const run = await judge.judge({ checkoutDir, inputs, task, onProgress });
      costUsd += run.costUsd ?? 0;
      const validation = validateEvaluation(run.output, facts, knownPaths);
      if (validation.ok) return { ...validation, ...run, attempts: attempt, failures, costUsd };
      failures.push(`attempt ${attempt}: invalid output: ${validation.problems.join("; ")}`);
    } catch (error) {
      failures.push(`attempt ${attempt}: ${error.message}`);
      if (error instanceof FatalJudgeError) break;
    }
  }
  return { ok: false, failures, costUsd };
}

// Creates a worktree at the commit plus the judge's input files, and removes both however the run ends.
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
    git(repoDir, ["worktree", "add", "--detach", "--force", checkoutDir, sha]);
    return await work(checkoutDir, inputsDir);
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
}

// options: { repo, url, stars, own }. judge: a backend from judges/index.mjs.
export async function evaluateCommit({ options, judge, sha, onProgress }) {
  const startedAt = Date.now();
  const facts = collectCommitFacts(options.repo, sha);
  const signals = { reverted: facts.revertedBy.length > 0 };
  const xpInput = { countedLines: facts.totals.countedLines, stars: options.stars, isOwnRepo: options.own, signals };
  const elapsed = () => ({ durationMs: Date.now() - startedAt });

  const triaged = triage(facts);
  if (triaged) {
    const { xp, breakdown } = computeXp({ ...xpInput, type: triaged.contribution_type, scores: scoreValues(triaged) });
    return { facts, method: "rule", status: "ok", evaluation: triaged, issues: [], xp, breakdown, ...elapsed() };
  }

  const judged = await withCheckout(options.repo, facts.sha, (checkoutDir, inputsDir) => {
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
    return judgeWithRetries({ judge, checkoutDir, facts, inputs, onProgress });
  });

  const judgeInfo = { backend: judge.backend, model: judge.model };
  const common = { facts, method: "ai", judge: judgeInfo, failures: judged.failures, costUsd: judged.costUsd };
  if (!judged.ok) return { ...common, status: "failed", ...elapsed() };

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
