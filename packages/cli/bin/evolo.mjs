#!/usr/bin/env node
// Evolo CLI. Only `evaluate` exists so far; init, enqueue and worker follow docs/auto-scoring.md.
//
//   evolo evaluate --repo <clone> --out <results dir> [--judge claude|opencode] [--model M]
//                  [--budget USD] [--url U] [--stars N] [--own]
//                  [--range <from>..<to>]... [--pr <number>]... [<sha>...]
//
// Each --range is one push, each --pr one merged PR, and each bare <sha> a push of that commit alone.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { evaluateUnit, scoreValues } from "../src/evaluate.mjs";
import { git } from "../src/facts.mjs";
import { createJudge } from "../src/judges/index.mjs";
import { commitUnit, fetchPullRequest, rangeUnit } from "../src/units.mjs";

const USAGE =
  "usage: evolo evaluate --repo <dir> --out <dir> [--judge claude|opencode] [--model M] [--budget USD] " +
  "[--url U] [--stars N] [--own] [--range <from>..<to>]... [--pr <number>]... [<sha>...]";

function describe(facts) {
  if (facts.kind === "pr") return `#${facts.pr.number} ${facts.pr.title}`;
  const [first] = facts.commits;
  return facts.commits.length === 1 ? first.subject : `${facts.commits.length} commits, from "${first.subject}"`;
}

function printRow(result) {
  const { id } = result.facts;
  if (result.status === "failed") {
    console.log(`${id}  FAILED  ${result.failures.join(" | ")}`);
    return;
  }
  const s = scoreValues(result.evaluation);
  const cost = result.costUsd ? `$${result.costUsd.toFixed(2)}` : "-";
  console.log(
    [
      id,
      result.method.padEnd(4),
      result.evaluation.contribution_type.padEnd(8),
      `I${s.impact} C${s.centrality} D${s.difficulty} Q${s.quality} S${s.scope_fit}`,
      `${String(result.facts.totals.countedLines).padStart(5)} lines`,
      `${String(result.xp).padStart(4)} XP`,
      cost.padStart(6),
      `${Math.round(result.durationMs / 1000)}s`.padStart(5),
      describe(result.facts),
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
      range: { type: "string", multiple: true, default: [] },
      pr: { type: "string", multiple: true, default: [] },
    },
  });
  const targets = [
    ...values.range.map((range) => () => rangeUnit(values.repo, range)),
    ...values.pr.map((number) => () => fetchPullRequest(values.repo, number)),
    ...positionals.map((sha) => () => commitUnit(values.repo, sha)),
  ];
  if (!values.repo || !values.out || targets.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    git(values.repo, ["rev-parse", "--git-dir"]);
  } catch {
    console.error(`not a git repository: ${values.repo}`);
    process.exit(2);
  }
  // Resolve every unit before spending anything on the judge, so a typo fails fast and clearly.
  const errors = [];
  const units = targets.flatMap((resolve) => {
    try {
      return [resolve()];
    } catch (error) {
      errors.push(error.message);
      return [];
    }
  });
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(2);
  }
  const judge = createJudge({ backend: values.judge, model: values.model, budgetUsd: values.budget && Number(values.budget) });
  const options = { repo: values.repo, url: values.url, stars: Number(values.stars), own: values.own };
  mkdirSync(values.out, { recursive: true });

  for (const unit of units) {
    const onProgress = (tool, detail) => console.error(`  [${unit.id}] ${tool} ${String(detail).slice(0, 100)}`);
    const result = await evaluateUnit({ options, judge, unit, onProgress });
    writeFileSync(join(values.out, `${unit.id}.json`), JSON.stringify(result, null, 2));
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
