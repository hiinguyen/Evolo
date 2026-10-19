#!/usr/bin/env node
// Evolo CLI (docs/auto-scoring.md).
//
//   evolo init [--repo <clone>] [--author EMAIL]... [--remote NAME]
//       registers the clone and installs the pre-push hook; from then on every push to the default branch
//       and every merged PR of yours is scored in the background
//   evolo uninstall [--repo <clone>]      removes the hook and the registration, keeps the scores
//   evolo sync                            queues newly merged PRs, re-checks the ledger, starts the worker
//   evolo status                          the queue and the latest scores
//   evolo worker                          scores the queue until it is empty (started by the hook and by sync)
//   evolo enqueue push --pusher PID -- <remote> <url>   called by the hook, with git's pre-push input on stdin
//   evolo evaluate --repo <clone> --out <results dir> [--judge claude|opencode] [--model M]
//                  [--budget USD] [--url U] [--stars N] [--own] [--author EMAIL]...
//                  [--range <from>..<to>]... [--pr <number>]... [<sha>...]
//       scores in the foreground and writes the results to a directory, outside the ledger
//
// For evaluate, each --range is one push, each --pr one merged PR, and each bare <sha> a push of that commit alone.
// A range leaves out commits that belong to a merged PR (they are scored with the PR) and, when --author is given,
// commits by anyone else.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { evaluateUnit, scoreValues } from "../src/evaluate.mjs";
import { levelFor } from "../src/score.mjs";
import { git } from "../src/facts.mjs";
import { mergedPrsOfCommits } from "../src/github.mjs";
import { createJudge } from "../src/judges/index.mjs";
import { listRecords } from "../src/ledger.mjs";
import { listJobs, spawnWorker } from "../src/queue.mjs";
import { initRepo, loadRepos, uninstallRepo } from "../src/repos.mjs";
import { evoloHome, logLine } from "../src/store.mjs";
import { commitUnit, fetchPullRequest, rangeUnit } from "../src/units.mjs";
import { enqueuePush, runWorker, syncAll } from "../src/worker.mjs";

const USAGE = `usage: evolo <init|uninstall|sync|status|worker|enqueue|evaluate> [options]
  evolo init [--repo <dir>] [--author EMAIL]... [--remote NAME]
  evolo uninstall [--repo <dir>]
  evolo sync | evolo status | evolo worker
  evolo evaluate --repo <dir> --out <dir> [--judge claude|opencode] [--model M] [--budget USD]
                 [--url U] [--stars N] [--own] [--author EMAIL]... [--range <from>..<to>]... [--pr <number>]... [<sha>...]`;

function usageError(message) {
  console.error(message ? `${message}\n${USAGE}` : USAGE);
  process.exit(2);
}

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
      author: { type: "string", multiple: true, default: [] },
      range: { type: "string", multiple: true, default: [] },
      pr: { type: "string", multiple: true, default: [] },
    },
  });
  const filters = {
    authors: values.author.length > 0 ? new Set(values.author.map((email) => email.toLowerCase())) : undefined,
    mergedPrsOf: (shas) => mergedPrsOfCommits(values.repo, shas),
  };
  const targets = [
    ...values.range.map((range) => () => rangeUnit(values.repo, range, filters)),
    ...values.pr.map((number) => () => fetchPullRequest(values.repo, number)),
    ...positionals.map((sha) => () => commitUnit(values.repo, sha)),
  ];
  if (!values.repo || !values.out || targets.length === 0) usageError();
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

// The argv the hook runs this CLI with: absolute paths, so the hook works whatever PATH git runs it with.
const SELF = [process.execPath, fileURLToPath(import.meta.url)];

function init(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string", default: "." },
      author: { type: "string", multiple: true, default: [] },
      remote: { type: "string" },
    },
  });
  const { notes } = initRepo(evoloHome(), values.repo, { authors: values.author, remote: values.remote, command: SELF });
  notes.forEach((note) => console.log(note));
  console.log("pushes to the default branch and your merged PRs are now scored in the background; see `evolo status`");
}

function uninstall(argv) {
  const { values } = parseArgs({ args: argv, options: { repo: { type: "string", default: "." } } });
  uninstallRepo(evoloHome(), values.repo).forEach((note) => console.log(note));
}

// Runs inside the pre-push hook, so it must be quick and must never fail the push: errors go to the log.
function enqueue(argv) {
  const home = evoloHome();
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { pusher: { type: "string" } } });
    const [kind, remote] = positionals;
    if (kind !== "push" || !remote) usageError("expected: enqueue push --pusher PID -- <remote> <url>");
    const pusher = values.pusher ? Number(values.pusher) : null;
    const jobs = enqueuePush(home, process.cwd(), { remote, pusher, input: readFileSync(0, "utf8") });
    if (jobs.length > 0) spawnWorker(home);
  } catch (error) {
    logLine(home, `enqueue failed: ${error.message}`);
  }
}

async function worker() {
  const home = evoloHome();
  if (!(await runWorker(home))) logLine(home, "another worker is running");
}

function sync() {
  const home = evoloHome();
  const notes = syncAll(home);
  notes.forEach((note) => console.log(note));
  if (listJobs(home).length > 0) spawnWorker(home);
  if (notes.length === 0) console.log("nothing new");
}

const STATUS_RECORDS = 15;

function status() {
  const home = evoloHome();
  const jobs = listJobs(home);
  console.log(jobs.length === 0 ? "queue: empty" : `queue: ${jobs.length} job(s)`);
  for (const job of jobs) {
    const what = job.type === "pr" ? `PR #${job.number}` : `push ${job.to.slice(0, 7)}`;
    console.log(`  ${job.repo} ${what}${job.lastError ? `  (retry ${job.attempts}: ${job.lastError})` : ""}`);
  }
  const all = Object.keys(loadRepos(home)).flatMap((key) => listRecords(home, key));
  const total = all.filter((record) => record.status === "scored").reduce((sum, record) => sum + record.xp, 0);
  const { level, next } = levelFor(total);
  console.log(`level ${level}  ${total} XP  (${next - total} XP to level ${level + 1})`);
  const records = all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, STATUS_RECORDS);
  console.log(records.length === 0 ? "no scores yet" : "latest:");
  for (const record of records) {
    const xp = record.status === "scored" ? `${record.xp} XP` : record.status;
    console.log(`  ${record.at.slice(0, 16).replace("T", " ")}  ${record.repo} ${record.id}  ${xp}  ${record.summary || record.reason || ""}`);
  }
}

const COMMANDS = { init, uninstall, enqueue, worker, sync, status, evaluate };

const [command, ...rest] = process.argv.slice(2);
if (!COMMANDS[command]) usageError();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
await COMMANDS[command](rest);
