// Runs the xp-judge opencode agent in a checkout and returns its parsed JSON output.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const AGENT_CONFIG_DIR = fileURLToPath(new URL("../../.opencode", import.meta.url));
const ATTEMPT_TIMEOUT_MS = 20 * 60 * 1000;

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

// Streams opencode's JSON events. `opencode run` does not exit after an error event,
// so the process is stopped as soon as one arrives instead of waiting for the timeout.
function runOpencode(checkoutDir, args, onEvent) {
  return new Promise((resolve) => {
    const child = spawn("opencode", args, {
      cwd: checkoutDir,
      // Load xp-judge from Evolo and ignore any .opencode config inside the evaluated repo,
      // so the repo under evaluation cannot swap the agent or its permissions.
      // opencode resolves the project from PWD, so it must point at the checkout, not at our own cwd.
      env: {
        ...process.env,
        PWD: checkoutDir,
        OPENCODE_CONFIG_DIR: AGENT_CONFIG_DIR,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    runningJudges.add(child);
    const events = [];
    let pending = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop();
      for (const event of lines.map(parseEvent).filter(Boolean)) {
        events.push(event);
        onEvent?.(event);
        if (event.type === "error") child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, ATTEMPT_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      runningJudges.delete(child);
      const last = parseEvent(pending);
      resolve({ code, timedOut, stderr, events: last ? [...events, last] : events });
    });
  });
}

export function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in final message");
  return JSON.parse(text.slice(start, end + 1));
}

// One judge call. Throws with a descriptive message on transport errors, timeouts or unparsable output.
export async function judgeOnce({ checkoutDir, prompt, attachments, model, onEvent }) {
  const args = [
    "run", "--standalone", "--agent", "xp-judge", "--format", "json",
    ...(model ? ["--model", model] : []),
    ...attachments.flatMap((path) => ["--file", path]),
    "--", prompt,
  ];
  const { events, timedOut, code, stderr } = await runOpencode(checkoutDir, args, onEvent);
  const error = events.find((event) => event.type === "error");
  if (error) throw new Error(`opencode error: ${error.error?.message ?? JSON.stringify(error.error)}`);
  if (timedOut) throw new Error(`opencode timed out after ${ATTEMPT_TIMEOUT_MS / 1000}s`);

  const texts = events.filter((event) => event.type === "text").map((event) => event.part.text);
  if (texts.length === 0) {
    throw new Error(`opencode produced no text (exit ${code}): ${stderr.slice(-500)}`);
  }
  const toolCalls = events.filter((event) => event.type === "tool_use").length;
  return { output: extractJsonObject(texts.at(-1)), toolCalls, sessionID: events[0]?.sessionID };
}
