// What Evolo shows the user: desktop notifications, the status line and `evolo why` (docs/auto-scoring.md section 6).
// Pure functions of ledger records and the summary, so every view is tested without a terminal or a desktop.
import { CRITERIA, levelFor } from "./score.mjs";
import { localDay } from "./ledger.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
// C0 controls but tab and newline, DEL, C1 controls, and the bidi embedding, override and isolate characters.
const UNSAFE_FOR_TERMINAL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

// Text from the judge or the repository (reasons, summaries, commit subjects, PR titles), made safe to print:
// without its control characters, an escape sequence cannot clear the screen, retitle the terminal, or hide text
// behind a carriage return or a bidi override. Applied when printing, so records saved earlier are covered too.
export const terminalSafe = (text) => String(text).replace(UNSAFE_FOR_TERMINAL, "");

const MARKUP_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

const formatXp = (xp) => xp.toLocaleString("en-US");
const repoName = (key) => key.split("/").at(-1);

// "PR #5", "push 89fd4e3..8c68e65", or "push ..8c68e65" for the first push of a branch.
export function unitLabel(id) {
  if (id.startsWith("pr-")) return `PR #${id.slice(3)}`;
  const [, from, to] = /^push-(\w+)-(\w+)$/.exec(id) ?? [];
  if (!to) return id;
  return from === "root" ? `push ..${to}` : `push ${from}..${to}`;
}

// XP earned on the local day of `now` and in the seven days ending with it.
export function recentXp(summary, now = new Date()) {
  const today = summary.xpByDay[localDay(now)] ?? 0;
  const week = Array.from({ length: 7 }, (_, back) => summary.xpByDay[localDay(new Date(now - back * DAY_MS))] ?? 0)
    .reduce((sum, xp) => sum + xp, 0);
  return { today, week };
}

// One line for Claude Code's status line: "Lv 3 · 245 XP · +105 today · 1 queued".
export function statusLine(summary, queued, now = new Date()) {
  const { level } = levelFor(summary.total);
  const { today } = recentXp(summary, now);
  return [
    `Lv ${level}`,
    `${formatXp(summary.total)} XP`,
    ...(today > 0 ? [`+${formatXp(today)} today`] : []),
    ...(queued > 0 ? [`${queued} queued`] : []),
  ].join(" · ");
}

// The desktop notification for a record the worker has just written, as { title, body }, or null when there is
// nothing worth interrupting the user for (a rejected push or a skipped unit: the user already knows).
// `totalBefore` is the user's total before the record, to tell a level up. `markup`: the notification server reads
// the body as markup (freedesktop.org body-markup); the title is always plain text. Text never has control characters.
export function notification(record, totalBefore, { markup = false } = {}) {
  // With markup, Evolo's own part is bold and every other text is escaped, so the judge's text cannot add markup.
  const text = (value) => (markup ? terminalSafe(value).replace(/[&<>]/g, (char) => MARKUP_ESCAPES[char]) : terminalSafe(value));
  const label = text(`${repoName(record.repo)} ${unitLabel(record.id)}`);
  const where = markup ? `<b>${label}</b>` : label;
  if (record.status === "scored") {
    const before = levelFor(totalBefore).level;
    const after = levelFor(totalBefore + record.xp).level;
    const type = record.result?.evaluation?.contribution_type;
    return {
      title: `+${record.xp} XP${after > before ? ` · level ${after}!` : ""}`,
      body: `${where}${type ? `: ${text(type)}` : ""}\n${text(record.summary)}`,
    };
  }
  if (record.status === "needs_review") {
    return { title: "Needs review", body: `${where}: the judge suspected prompt injection. See \`evolo why ${text(record.id)}\`.` };
  }
  if (record.status === "failed") {
    return { title: "Scoring failed", body: `${where}: ${text(record.reason ?? record.summary)}\nRun \`evolo retry\` to try again.` };
  }
  return null;
}

const short = (sha) => sha.slice(0, 7);

function judgedLines(result) {
  const { facts, evaluation, breakdown: b } = result;
  const width = Math.max(...CRITERIA.map((criterion) => criterion.length));
  const lines = [""];
  for (const criterion of CRITERIA) {
    const { score, reason, evidence } = evaluation.scores[criterion];
    lines.push(`${criterion.padEnd(width)}  ${score}  ${reason}`);
    if (evidence.length > 0) lines.push(`${" ".repeat(width + 5)}evidence: ${evidence.join(", ")}`);
  }
  lines.push(
    "",
    `XP = ${b.base} base (${evaluation.contribution_type}) × ${b.mValue} value × ${b.mSize} size (${facts.totals.countedLines} lines)` +
      ` × ${b.mRepo} repo × ${b.mSignals} signals = ${b.raw} -> ${result.xp}` +
      `${b.reverted ? " (reverted)" : ""}  [formula ${b.formula_version}]`,
  );
  if (result.issues?.length > 0) lines.push("validator:", ...result.issues.map((issue) => `  ${issue}`));
  if (evaluation.flags?.length > 0) lines.push(`flags: ${evaluation.flags.join(", ")}`);
  return lines;
}

// The full account of one record for `evolo why`: what was scored, every rubric score with its reason and evidence,
// how the XP formula turned them into XP, and whether the unit has a review (`reviewed`).
export function explain(record, { reviewed = false } = {}) {
  const result = record.result;
  const worth = record.status === "scored" ? `${record.xp} XP` : record.status;
  const was = record.previousStatus ? ` (was ${record.previousStatus})` : "";
  const lines = [`${record.repo} ${unitLabel(record.id)}  ${worth}${was}  ${record.at.slice(0, 16).replace("T", " ")}`];
  if (!result) {
    // Ended before judging: a rejected push, a unit with nothing to score, or an error after every retry.
    lines.push(record.reason);
    return terminalSafe(lines.join("\n"));
  }
  const { facts } = result;
  const judge = result.method === "rule" ? "triaged by rule" : `judge ${result.judge.model ?? result.judge.backend}`;
  const cost = result.costUsd ? ` · $${result.costUsd.toFixed(2)}` : "";
  const commits = `${facts.commits.length} commit${facts.commits.length === 1 ? "" : "s"}`;
  lines.push(`${commits} · ${facts.totals.files} files +${facts.totals.additions} -${facts.totals.deletions} · ${judge}${cost}`);
  if (facts.pr) lines.push(`${facts.pr.title}  ${facts.pr.url}`);
  if (result.evaluation) {
    lines.push("", result.evaluation.summary, ...judgedLines(result));
  } else {
    lines.push("", ...result.failures.map((failure) => `  ${failure}`));
  }
  lines.push("", "commits:", ...facts.commits.map((commit) => `  ${short(commit.sha)} ${commit.subject}`));
  if (facts.excluded.length > 0) {
    lines.push("left out:", ...facts.excluded.map((commit) => `  ${short(commit.sha)} ${commit.subject} (${commit.reason})`));
  }
  lines.push("", reviewed ? `review: saved, see \`evolo review ${record.id}\`` : `review: none yet, \`evolo review ${record.id}\` writes one`);
  return terminalSafe(lines.join("\n"));
}

// The record that `ref` names among `records`: a unit id ("pr-5", "push-89fd4e3-8c68e65"), "#5" for a PR,
// or a commit (full sha or a prefix of at least 4 hex digits) that the unit counted, merged a PR, or left out.
// A commit can belong to several units (a push left it out, the PR scored it): the one that counted it wins.
// Returns null when nothing matches.
export function findByRef(records, ref) {
  const id = /^#\d+$/.test(ref) ? `pr-${ref.slice(1)}` : ref;
  const byId = records.find((record) => record.id === id);
  if (byId) return byId;
  if (!/^[0-9a-f]{4,64}$/i.test(ref)) return null;
  const prefix = ref.toLowerCase();
  const has = (commits) => commits?.some((commit) => commit.sha.startsWith(prefix));
  return (
    records.find((record) => has(record.result?.facts.commits)) ??
    records.find((record) => record.result?.facts.pr?.mergeCommit?.startsWith(prefix)) ??
    records.find((record) => has(record.result?.facts.excluded)) ??
    null
  );
}
