#!/usr/bin/env node
// Prototype of the Evolo XP pipeline for direct commits (change sets of one commit).
//
// Usage:
//   node scripts/evaluate.mjs --repo <clone dir> --out <results dir> [--stars N] [--own] [--model provider/model] <sha>...
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { collectCommitFacts, collectRepoContext, git } from "./xp/facts.mjs";
import { judgeOnce } from "./xp/judge.mjs";
import { computeXp, triage, validateEvaluation } from "./xp/score.mjs";

const MAX_ATTEMPTS = 3;
const MAX_DIFF_BYTES = 80 * 1024;

function logProgress(sha, event) {
  if (event.type !== "tool_use") return;
  const input = event.part.state?.input ?? {};
  const detail = input.command ?? input.filePath ?? input.pattern ?? input.path ?? "";
  console.error(`  [${sha.slice(0, 7)}] ${event.part.tool} ${String(detail).slice(0, 100)}`);
}

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

async function judgeWithRetries({ checkoutDir, facts, attachments, model }) {
  const prompt =
    `Evaluate commit ${facts.sha} (parent ${facts.parent}). ` +
    "It was pushed directly to the default branch. Return only the JSON object defined in your instructions.";
  const knownPaths = knownPathsFor(checkoutDir, facts);
  const failures = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const onEvent = (event) => logProgress(facts.sha, event);
      const { output, toolCalls, sessionID } = await judgeOnce({ checkoutDir, prompt, attachments, model, onEvent });
      const validation = validateEvaluation(output, facts, knownPaths);
      if (validation.ok) return { ...validation, attempts: attempt, toolCalls, sessionID, failures };
      failures.push(`attempt ${attempt}: invalid output: ${validation.problems.join("; ")}`);
    } catch (error) {
      failures.push(`attempt ${attempt}: ${error.message}`);
    }
  }
  return { ok: false, failures };
}

async function evaluateCommit(options, sha) {
  const facts = collectCommitFacts(options.repo, sha);
  const triaged = triage(facts);
  const signals = { reverted: facts.revertedBy.length > 0 };
  const xpInput = { countedLines: facts.totals.countedLines, stars: options.stars, isOwnRepo: options.own, signals };

  if (triaged) {
    const { xp, breakdown } = computeXp({ ...xpInput, type: triaged.contribution_type, scores: scoreValues(triaged) });
    return { facts, method: "rule", status: "ok", evaluation: triaged, issues: [], xp, breakdown };
  }

  const checkoutDir = mkdtempSync(join(tmpdir(), "xp-judge-"));
  const inputsDir = mkdtempSync(join(tmpdir(), "xp-inputs-"));
  const cleanup = () => {
    rmSync(inputsDir, { recursive: true, force: true });
    git(options.repo, ["worktree", "remove", "--force", checkoutDir]);
  };
  // Signals end the process without running `finally`, so the same cleanup is also registered for exit.
  process.once("exit", cleanup);
  try {
    git(options.repo, ["worktree", "add", "--detach", "--force", checkoutDir, facts.sha]);
    const context = collectRepoContext(checkoutDir, {
      name: basename(options.repo), url: options.url, stars: options.stars, isOwnRepo: options.own,
    });
    const attachments = [join(inputsDir, "facts.json"), join(inputsDir, "repo-context.json"), join(inputsDir, "change.diff")];
    writeFileSync(attachments[0], JSON.stringify(facts, null, 2));
    writeFileSync(attachments[1], JSON.stringify(context, null, 2));
    writeDiff(options.repo, facts, attachments[2]);

    const judged = await judgeWithRetries({ checkoutDir, facts, attachments, model: options.model });
    if (!judged.ok) return { facts, method: "ai", status: "failed", failures: judged.failures };

    const type = judged.evaluation.contribution_type;
    const { xp, breakdown } = computeXp({ ...xpInput, type, scores: scoreValues(judged.evaluation) });
    return {
      facts,
      method: "ai",
      status: judged.status,
      evaluation: judged.evaluation,
      issues: judged.issues,
      attempts: judged.attempts,
      failures: judged.failures,
      toolCalls: judged.toolCalls,
      sessionID: judged.sessionID,
      xp: judged.status === "ok" ? xp : 0,
      breakdown,
    };
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
}

function scoreValues(evaluation) {
  return Object.fromEntries(Object.entries(evaluation.scores).map(([criterion, entry]) => [criterion, entry.score]));
}

function printRow(result) {
  const shortSha = result.facts.sha.slice(0, 7);
  if (result.status === "failed") {
    console.log(`${shortSha}  FAILED  ${result.failures.join(" | ")}`);
    return;
  }
  const s = scoreValues(result.evaluation);
  console.log(
    [
      shortSha,
      result.method.padEnd(4),
      result.evaluation.contribution_type.padEnd(8),
      `I${s.impact} C${s.centrality} D${s.difficulty} Q${s.quality} S${s.scope_fit}`,
      `${String(result.facts.totals.countedLines).padStart(5)} lines`,
      `${String(result.xp).padStart(4)} XP`,
      result.facts.subject,
    ].join("  "),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      out: { type: "string" },
      url: { type: "string", default: "" },
      stars: { type: "string", default: "0" },
      own: { type: "boolean", default: false },
      model: { type: "string" },
    },
  });
  if (!values.repo || !values.out || positionals.length === 0) {
    console.error("usage: evaluate.mjs --repo <dir> --out <dir> [--url U] [--stars N] [--own] [--model M] <sha>...");
    process.exit(2);
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
  const options = { ...values, stars: Number(values.stars) };
  mkdirSync(options.out, { recursive: true });

  for (const sha of positionals) {
    const result = await evaluateCommit(options, sha);
    writeFileSync(join(options.out, `${result.facts.sha.slice(0, 7)}.json`), JSON.stringify(result, null, 2));
    printRow(result);
  }
}

await main();
