// Stand-in for `claude -p` in end-to-end tests: logs each call to $FAKE_CLAUDE_LOG and answers like a judge,
// citing the first changed file from the facts.json it was given, as a stream-json `result` event.
// While the file $FAKE_CLAUDE_LOG.down exists it fails like a signed-out CLI, without answering;
// while $FAKE_CLAUDE_LOG.invalid exists it answers without a summary, which the validator rejects.
// Given the review schema (judge/review.schema.json) it answers like a reviewer instead, with one finding in the first
// changed file; while $FAKE_CLAUDE_LOG.badpath exists it adds a finding in a file that does not exist.
// While $FAKE_CLAUDE_LOG.summary exists, its content is the judge's summary.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("0.0.0 (fake claude)\n");
  process.exit(0);
}
if (existsSync(`${process.env.FAKE_CLAUDE_LOG}.down`)) {
  process.stderr.write("Not logged in · Please run /login\n");
  process.exit(1);
}
const task = args.at(-1);
appendFileSync(process.env.FAKE_CLAUDE_LOG, `${task.split("\n")[0]}\n`);
const factsPath = /^- (.*facts\.json)$/m.exec(task)[1];
const facts = JSON.parse(readFileSync(factsPath, "utf8"));
const evidence = [facts.files[0].path];
const schema = args[args.indexOf("--json-schema") + 1];
const finding = (location) => ({
  severity: "medium", category: "test", location, title: "Fake finding", detail: "Fake detail.", suggestion: "Fake fix.",
});
const review = {
  overview: `Reviewed ${facts.files.length} file(s).`,
  strengths: ["Fake strength."],
  improvements: ["Fake improvement."],
  findings: [finding(`${evidence[0]}:1`), ...(existsSync(`${process.env.FAKE_CLAUDE_LOG}.badpath`) ? [finding("ghost/nowhere.js:1")] : [])],
  flags: [],
  notes: "",
};
const criterion = (score) => ({ score, reason: "Fake judgement.", evidence });
const answer = {
  rubric_version: "1.0",
  contribution_type: "feature",
  scores: { impact: criterion(2), centrality: criterion(2), difficulty: criterion(2), quality: criterion(2), scope_fit: criterion(3) },
  summary: existsSync(`${process.env.FAKE_CLAUDE_LOG}.invalid`)
    ? ""
    : existsSync(`${process.env.FAKE_CLAUDE_LOG}.summary`)
      ? readFileSync(`${process.env.FAKE_CLAUDE_LOG}.summary`, "utf8")
      : `Changed ${facts.files.length} file(s).`,
  flags: [],
  notes: "",
};
const output = schema.includes('"findings"') ? review : answer;
const result = { type: "result", subtype: "success", is_error: false, session_id: "fake", total_cost_usd: 0.01, structured_output: output };
process.stdout.write(`${JSON.stringify(result)}\n`);
