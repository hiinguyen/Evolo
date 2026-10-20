// Judge backend that runs a task (scoring or review) as an opencode agent.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JudgeUnavailableError, READ_ONLY_COMMANDS, runJsonl, SCORE_TASK, taskPrompt } from "./common.mjs";

// Deny everything (including MCP tools from the user's global config), then allow read-only inspection.
function agentFrontmatter(spec) {
  const bashRules = READ_ONLY_COMMANDS.map((command) => `    "${command}*": allow`).join("\n");
  return [
    "---",
    `description: Evolo ${spec.name}: evaluates one git contribution and returns JSON. Read-only.`,
    "mode: primary",
    "temperature: 0.1",
    "steps: 30",
    "permission:",
    '  "*": deny',
    "  read: allow",
    "  grep: allow",
    "  glob: allow",
    "  list: allow",
    "  bash:",
    '    "*": deny',
    bashRules,
    "---",
    "",
  ].join("\n");
}

// The agent is written to a private config dir for each call, so the task prompt has one source (judge/).
function writeAgentConfig(spec) {
  const configDir = mkdtempSync(join(tmpdir(), "xp-opencode-"));
  mkdirSync(join(configDir, "agent"));
  writeFileSync(join(configDir, "agent", `${spec.name}.md`), agentFrontmatter(spec) + taskPrompt(spec));
  return configDir;
}

export function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in final message");
  return JSON.parse(text.slice(start, end + 1));
}

function describeTool(event) {
  const input = event.part.state?.input ?? {};
  return [event.part.tool, input.command ?? input.filePath ?? input.pattern ?? input.path ?? ""];
}

function readOpencodeRun({ events, timedOut, code, stderr }) {
  const error = events.find((event) => event.type === "error");
  if (error) throw new Error(`opencode error: ${error.error?.message ?? JSON.stringify(error.error)}`);
  if (timedOut) throw new Error("opencode timed out");
  const texts = events.filter((event) => event.type === "text").map((event) => event.part.text);
  if (texts.length === 0) throw new JudgeUnavailableError(`opencode produced no text (exit ${code}): ${stderr.slice(-500)}`);
  return {
    output: extractJsonObject(texts.at(-1)),
    toolCalls: events.filter((event) => event.type === "tool_use").length,
    sessionID: events[0]?.sessionID,
    costUsd: null,
  };
}

export function createOpencodeJudge({ model } = {}) {
  return {
    backend: "opencode",
    model: model ?? "opencode default",
    async judge({ checkoutDir, inputs, task, spec = SCORE_TASK, onProgress }) {
      const configDir = writeAgentConfig(spec);
      try {
        const args = [
          "run", "--standalone", "--agent", spec.name, "--format", "json",
          ...(model ? ["--model", model] : []),
          ...Object.values(inputs).flatMap((path) => ["--file", path]),
          "--", task,
        ];
        // Ignore any .opencode config inside the evaluated repo so it cannot swap the agent or its permissions.
        // opencode resolves the project from PWD, so it must point at the checkout, not at our own cwd.
        const env = { ...process.env, PWD: checkoutDir, OPENCODE_CONFIG_DIR: configDir, OPENCODE_DISABLE_PROJECT_CONFIG: "1" };
        const onEvent = (event) => event.type === "tool_use" && onProgress?.(...describeTool(event));
        // `opencode run` does not exit after an error event, so it is stopped as soon as one arrives.
        const run = await runJsonl("opencode", args, { cwd: checkoutDir, env, onEvent, isFatal: (event) => event.type === "error" });
        return readOpencodeRun(run);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    },
  };
}
