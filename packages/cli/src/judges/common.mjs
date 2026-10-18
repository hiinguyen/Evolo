// Pieces shared by every judge backend: the rubric prompt, the read-only command allowlist,
// and a JSONL child-process runner that never leaves orphans behind.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROMPT_PATH = fileURLToPath(new URL("../../judge/xp-judge.md", import.meta.url));
export const OUTPUT_SCHEMA_PATH = fileURLToPath(new URL("../../judge/output.schema.json", import.meta.url));
export const ATTEMPT_TIMEOUT_MS = 20 * 60 * 1000;

// Errors a retry cannot fix; retrying would only spend more.
export class FatalJudgeError extends Error {}

export const judgePrompt = () => readFileSync(PROMPT_PATH, "utf8");

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
