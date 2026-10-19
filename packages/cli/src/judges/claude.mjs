// Judge backend that runs the rubric in a sandboxed, headless Claude Code session (`claude -p`).
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { FatalJudgeError, JudgeUnavailableError, OUTPUT_SCHEMA_PATH, PROMPT_PATH, READ_ONLY_COMMANDS, runJsonl } from "./common.mjs";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
const DEFAULT_BUDGET_USD = 1;
const JUDGE_TOOLS = "Read,Grep,Glob,Bash";

export function claudeArgs({ model, budgetUsd, inputsDir, task }) {
  const settings = { permissions: { allow: READ_ONLY_COMMANDS.map((command) => `Bash(${command}:*)`) } };
  return [
    "-p",
    // --restricted ignores user, project and local settings and every CLAUDE.md, so neither the user's setup
    // nor the evaluated repo can add hooks, plugins, permissions or instructions to the judge.
    // Unlike --bare it keeps the user's OAuth login.
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--model", model,
    "--tools", JUDGE_TOOLS,
    // In print mode any command not allowed here is denied, because nobody can approve it.
    "--settings", JSON.stringify(settings),
    // --restricted confines file tools to the working directories, so the inputs dir is added explicitly.
    "--add-dir", inputsDir,
    "--append-system-prompt-file", PROMPT_PATH,
    "--json-schema", readFileSync(OUTPUT_SCHEMA_PATH, "utf8"),
    "--max-budget-usd", String(budgetUsd),
    "--output-format", "stream-json",
    "--verbose",
    task,
  ];
}

function toolUses(event) {
  if (event.type !== "assistant") return [];
  return (event.message?.content ?? []).filter((block) => block.type === "tool_use" && block.name !== "StructuredOutput");
}

function describeTool(block) {
  const input = block.input ?? {};
  return [block.name, input.command ?? input.file_path ?? input.pattern ?? input.path ?? ""];
}

// Turns the stream of a finished `claude -p` run into the judge's answer, or throws why there is none.
export function readClaudeRun({ events, timedOut, code, stderr }) {
  if (timedOut) throw new Error("claude timed out");
  const result = events.findLast((event) => event.type === "result");
  if (!result) throw new JudgeUnavailableError(`claude produced no result (exit ${code}): ${stderr.slice(-500)}`);
  if (result.subtype === "error_max_budget_usd") {
    throw new FatalJudgeError(`claude stopped at the budget limit after $${result.total_cost_usd?.toFixed(2)}`);
  }
  // A run that ends as "success" yet is an error never got an answer from the API: sign-in, network, limits.
  if (result.is_error && result.subtype === "success") {
    throw new JudgeUnavailableError(`claude: ${String(result.result ?? result.api_error_status ?? "").slice(0, 300)}`);
  }
  if (result.is_error || result.subtype !== "success") {
    throw new Error(`claude ${result.subtype}: ${String(result.result ?? result.api_error_status ?? "").slice(0, 300)}`);
  }
  if (!result.structured_output) throw new Error("claude returned no structured output");
  return {
    output: result.structured_output,
    toolCalls: events.flatMap(toolUses).length,
    sessionID: result.session_id,
    costUsd: result.total_cost_usd ?? null,
    deniedCommands: (result.permission_denials ?? []).map((denial) => denial.tool_input?.command ?? denial.tool_name),
  };
}

export function createClaudeJudge({ model = DEFAULT_CLAUDE_MODEL, budgetUsd = DEFAULT_BUDGET_USD } = {}) {
  return {
    backend: "claude",
    model,
    async judge({ checkoutDir, inputs, task, onProgress }) {
      const inputList = Object.values(inputs).map((path) => `- ${path}`).join("\n");
      const args = claudeArgs({ model, budgetUsd, inputsDir: dirname(inputs.facts), task: `${task}\n\nInput files:\n${inputList}` });
      // EVOLO_JUDGE marks every process below this one, so Evolo's git hooks ignore anything a judge might trigger.
      const env = { ...process.env, EVOLO_JUDGE: "1" };
      const onEvent = (event) => toolUses(event).forEach((block) => onProgress?.(...describeTool(block)));
      return readClaudeRun(await runJsonl("claude", args, { cwd: checkoutDir, env, onEvent }));
    },
  };
}
