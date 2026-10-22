import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASE_XP, CRITERIA } from "../score.mjs";
import { claudeArgs, readClaudeRun } from "./claude.mjs";
import { FatalJudgeError, JudgeUnavailableError, REPORT_TASK, REVIEW_TASK, SCORE_TASK, taskPrompt } from "./common.mjs";
import { agentFrontmatter } from "./opencode.mjs";

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

test("readClaudeRun tells a judge that never reached the API from one that answered badly", () => {
  const unavailable = [
    run([], { code: 1, stderr: "not logged in" }),
    run([result({ is_error: true, result: "Invalid API key · Please run /login" })]),
    run([result({ is_error: true, api_error_status: 529 })]),
  ];
  for (const failed of unavailable) assert.throws(() => readClaudeRun(failed), JudgeUnavailableError);
  const answeredBadly = [run([result({ subtype: "error_during_execution", is_error: true })]), run([result({})]), run([], { timedOut: true })];
  for (const failed of answeredBadly) assert.throws(() => readClaudeRun(failed), (error) => !(error instanceof JudgeUnavailableError));
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
  const schema = JSON.parse(readFileSync(SCORE_TASK.schemaPath, "utf8"));
  assert.deepEqual([...schema.properties.contribution_type.enum].sort(), Object.keys(BASE_XP).sort());
  assert.deepEqual([...schema.properties.scores.required].sort(), [...CRITERIA].sort());
});

test("claudeArgs runs the task spec it is given: its prompt and its output schema", () => {
  const scoring = claudeArgs({ model: "m", budgetUsd: 1, inputsDir: "/in", task: "t" });
  assert.equal(scoring[scoring.indexOf("--append-system-prompt") + 1], taskPrompt(SCORE_TASK));
  assert.equal(scoring[scoring.indexOf("--json-schema") + 1], readFileSync(SCORE_TASK.schemaPath, "utf8"));
  const review = claudeArgs({ model: "m", budgetUsd: 1, inputsDir: "/in", task: "t", spec: REVIEW_TASK });
  assert.equal(review[review.indexOf("--append-system-prompt") + 1], taskPrompt(REVIEW_TASK));
  assert.equal(review[review.indexOf("--json-schema") + 1], readFileSync(REVIEW_TASK.schemaPath, "utf8"));
});

test("every task prompt carries the shared input and trust rules", () => {
  for (const spec of [SCORE_TASK, REVIEW_TASK]) {
    const prompt = taskPrompt(spec);
    assert.match(prompt, /# Trust rules/);
    assert.match(prompt, /# Inputs/);
    assert.doesNotMatch(prompt, /\{\{shared\}\}/);
  }
});

test("a task without commands runs with the file-reading tool alone, and may run no command", () => {
  const args = claudeArgs({ model: "m", budgetUsd: 1, inputsDir: "/in", task: "t", spec: REPORT_TASK });
  assert.equal(args[args.indexOf("--tools") + 1], "Read");
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]).permissions.allow, []);
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], taskPrompt(REPORT_TASK));
  assert.equal(args[args.indexOf("--json-schema") + 1], readFileSync(REPORT_TASK.schemaPath, "utf8"));
});

test("the opencode agent of a task may run exactly the task's commands", () => {
  const bashRules = (spec) => agentFrontmatter(spec).split("  bash:\n")[1].split("\n---")[0].split("\n");
  assert.deepEqual(bashRules(REPORT_TASK), ['    "*": deny']);
  assert.ok(bashRules(SCORE_TASK).includes('    "git log*": allow'));
  assert.equal(bashRules(SCORE_TASK)[0], '    "*": deny');
});

test("the report prompt has its own inputs and trust rules, and forbids numbers", () => {
  const prompt = taskPrompt(REPORT_TASK);
  assert.match(prompt, /# Inputs/);
  assert.match(prompt, /# Trust rules/);
  assert.match(prompt, /period\.json/);
  assert.match(prompt, /digit/);
  assert.doesNotMatch(prompt, /change\.diff/);
});
