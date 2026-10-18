import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASE_XP, CRITERIA } from "../score.mjs";
import { claudeArgs, readClaudeRun } from "./claude.mjs";
import { FatalJudgeError, OUTPUT_SCHEMA_PATH } from "./common.mjs";

const answer = { contribution_type: "bugfix" };
const run = (events, overrides = {}) => ({ events, timedOut: false, code: 0, stderr: "", ...overrides });
const toolUse = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const result = (overrides) => ({ type: "result", subtype: "success", is_error: false, session_id: "s1", total_cost_usd: 0.12, ...overrides });

test("readClaudeRun returns the structured output, cost and tool count, ignoring the output tool itself", () => {
  const events = [toolUse("Bash", { command: "git log -3" }), toolUse("StructuredOutput", answer), result({ structured_output: answer })];
  assert.deepEqual(readClaudeRun(run(events)), { output: answer, toolCalls: 1, sessionID: "s1", costUsd: 0.12, deniedCommands: [] });
});

test("readClaudeRun lists the commands the sandbox refused", () => {
  const denial = { tool_name: "Bash", tool_input: { command: "touch x" } };
  const events = [result({ structured_output: answer, permission_denials: [denial] })];
  assert.deepEqual(readClaudeRun(run(events)).deniedCommands, ["touch x"]);
});

test("readClaudeRun stops retries when the budget limit is hit", () => {
  const events = [result({ subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 1.01 })];
  assert.throws(() => readClaudeRun(run(events)), FatalJudgeError);
});

test("readClaudeRun reports runs without a usable answer as retryable errors", () => {
  const cases = [
    run([], { code: 1, stderr: "not logged in" }),
    run([result({ subtype: "error_during_execution", is_error: true })]),
    run([result({})]),
    run([], { timedOut: true }),
  ];
  for (const failed of cases) {
    assert.throws(() => readClaudeRun(failed), (error) => !(error instanceof FatalJudgeError));
  }
});

test("claudeArgs sandboxes the judge and allows only read-only git commands", () => {
  const args = claudeArgs({ model: "m", budgetUsd: 1, inputsDir: "/in", task: "t" });
  for (const flag of ["--restricted", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Grep,Glob,Bash");
  const allow = JSON.parse(args[args.indexOf("--settings") + 1]).permissions.allow;
  assert.ok(allow.includes("Bash(git log:*)"));
  assert.ok(allow.every((rule) => /^Bash\((git [a-z-]+|wc):\*\)$/.test(rule)), allow.join(", "));
});

test("the output schema accepts exactly the types and criteria the validator knows", () => {
  const schema = JSON.parse(readFileSync(OUTPUT_SCHEMA_PATH, "utf8"));
  assert.deepEqual([...schema.properties.contribution_type.enum].sort(), Object.keys(BASE_XP).sort());
  assert.deepEqual([...schema.properties.scores.required].sort(), [...CRITERIA].sort());
});
