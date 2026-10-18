#!/usr/bin/env node
// Evolo CLI. Only `evaluate` exists so far; init, enqueue and worker follow docs/auto-scoring.md.
//
//   evolo evaluate --repo <clone> --out <results dir> [--judge claude|opencode] [--model M]
//                  [--budget USD] [--url U] [--stars N] [--own] <sha>...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { evaluateCommit, scoreValues } from "../src/evaluate.mjs";
import { git } from "../src/facts.mjs";
import { createJudge } from "../src/judges/index.mjs";

const USAGE =
  "usage: evolo evaluate --repo <dir> --out <dir> [--judge claude|opencode] [--model M] [--budget USD] " +
  "[--url U] [--stars N] [--own] <sha>...";

function printRow(result) {
  const shortSha = result.facts.sha.slice(0, 7);
  if (result.status === "failed") {
    console.log(`${shortSha}  FAILED  ${result.failures.join(" | ")}`);
    return;
  }
  const s = scoreValues(result.evaluation);
  const cost = result.costUsd ? `$${result.costUsd.toFixed(2)}` : "-";
  console.log(
    [
      shortSha,
      result.method.padEnd(4),
      result.evaluation.contribution_type.padEnd(8),
      `I${s.impact} C${s.centrality} D${s.difficulty} Q${s.quality} S${s.scope_fit}`,
      `${String(result.facts.totals.countedLines).padStart(5)} lines`,
      `${String(result.xp).padStart(4)} XP`,
      cost.padStart(6),
      `${Math.round(result.durationMs / 1000)}s`.padStart(5),
      result.facts.subject,
    ].join("  "),
  );
}

async function evaluate(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      out: { type: "string" },
      judge: { type: "string", default: "claude" },
      model: { type: "string" },
      budget: { type: "string" },
      url: { type: "string", default: "" },
      stars: { type: "string", default: "0" },
      own: { type: "boolean", default: false },
    },
  });
  if (!values.repo || !values.out || positionals.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  // Resolve every commit before spending anything on the judge, so a typo fails fast and clearly.
  const unknown = positionals.filter((sha) => {
    try {
      git(values.repo, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
      return false;
    } catch {
      return true;
    }
  });
  if (unknown.length > 0) {
    console.error(`not a commit in ${values.repo}: ${unknown.map((sha) => JSON.stringify(sha)).join(", ")}`);
    process.exit(2);
  }
  const judge = createJudge({ backend: values.judge, model: values.model, budgetUsd: values.budget && Number(values.budget) });
  const options = { repo: values.repo, url: values.url, stars: Number(values.stars), own: values.own };
  mkdirSync(values.out, { recursive: true });

  for (const sha of positionals) {
    const onProgress = (tool, detail) => console.error(`  [${sha.slice(0, 7)}] ${tool} ${String(detail).slice(0, 100)}`);
    const result = await evaluateCommit({ options, judge, sha, onProgress });
    writeFileSync(join(values.out, `${result.facts.sha.slice(0, 7)}.json`), JSON.stringify(result, null, 2));
    printRow(result);
  }
}

const COMMANDS = { evaluate };

const [command, ...rest] = process.argv.slice(2);
if (!COMMANDS[command]) {
  console.error(USAGE);
  process.exit(2);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
await COMMANDS[command](rest);
