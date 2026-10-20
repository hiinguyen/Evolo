// Pieces shared by every judge backend: the task specs and their prompts, the read-only command allowlist,
// and a JSONL child-process runner that never leaves orphans behind.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const judgeFile = (name) => fileURLToPath(new URL(`../../judge/${name}`, import.meta.url));

// What a judge is asked to do: its instructions and the shape of its answer.
// Every backend runs any task; `name` names the agent where a backend needs one.
export const SCORE_TASK = { name: "xp-judge", promptPath: judgeFile("xp-judge.md"), schemaPath: judgeFile("output.schema.json") };
export const REVIEW_TASK = { name: "xp-review", promptPath: judgeFile("xp-review.md"), schemaPath: judgeFile("review.schema.json") };
export const ATTEMPT_TIMEOUT_MS = 20 * 60 * 1000;

// Errors a retry cannot fix; retrying would only spend more.
export class FatalJudgeError extends Error {}

// The judge never got to judge: the CLI could not start, reach the API or sign in, or the API refused the call
// (overloaded, rate or usage limit). Waiting can fix this, so the worker keeps the unit queued and tries later.
export class JudgeUnavailableError extends Error {}

// The task's instructions, with the input description and trust rules every task shares (judge/shared.md).
export const taskPrompt = (spec) =>
  readFileSync(spec.promptPath, "utf8").replace("{{shared}}", () => readFileSync(judgeFile("shared.md"), "utf8").trimEnd());

// The only shell commands a judge may run: read-only inspection of the checkout.
// Each backend translates this list into its own permission format.
export const READ_ONLY_COMMANDS = [
  "git log", "git show", "git diff", "git blame", "git ls-files", "git rev-list", "git grep", "git cat-file", "wc",
];

// Judges still running when this process exits are stopped too, so none are orphaned.
const runningJudges = new Set();
process.on("exit", () => runningJudges.forEach((child) => child.kill("SIGTERM")));

function parseEvent(line) {
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Runs a command that prints one JSON event per line.
// `isFatal(event)` stops the child early, for CLIs that keep running after reporting an error.
export function runJsonl(command, args, { cwd, env, onEvent, isFatal = () => false }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    runningJudges.add(child);
    const events = [];
    let pending = "";
    let stderr = "";
    let timedOut = false;
    const accept = (event) => {
      events.push(event);
      onEvent?.(event);
      if (isFatal(event)) child.kill("SIGTERM");
    };
    child.stdout.on("data", (chunk) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop();
      lines.map(parseEvent).filter(Boolean).forEach(accept);
    });
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    child.on("error", (error) => (stderr += `\nspawn failed: ${error.message}`));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, ATTEMPT_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      runningJudges.delete(child);
      const last = parseEvent(pending);
      if (last) accept(last);
      resolve({ code, timedOut, stderr, events });
    });
  });
}
