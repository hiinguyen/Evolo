// Picks a judge backend. Every backend takes the same inputs and returns { output, toolCalls, sessionID, costUsd }.
import { createClaudeJudge } from "./claude.mjs";
import { createOpencodeJudge } from "./opencode.mjs";

const BACKENDS = { claude: createClaudeJudge, opencode: createOpencodeJudge };

export function createJudge({ backend, model, budgetUsd }) {
  const create = BACKENDS[backend];
  if (!create) throw new Error(`unknown judge "${backend}", expected one of: ${Object.keys(BACKENDS).join(", ")}`);
  return create({ ...(model && { model }), ...(budgetUsd && { budgetUsd }) });
}
