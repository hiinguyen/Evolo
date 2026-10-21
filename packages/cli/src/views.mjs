// What Evolo shows the user: desktop notifications, the status line and `evolo why` (docs/auto-scoring.md section 6).
// Pure functions of ledger records and the summary, so every view is tested without a terminal or a desktop.
import { tierName } from "./achievements.mjs";
import { CRITERIA, levelFor } from "./score.mjs";
import { localDay, localTime } from "./ledger.mjs";
import { escapeMarkup, richText, terminalSafe } from "./safe-text.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // Evolo's own part is bold with markup; the judge's text keeps only the markup richText allows.
  const text = (value) => (markup ? escapeMarkup(terminalSafe(value)) : terminalSafe(value));
  const judged = (value) => richText(value, { markup });
  const label = text(`${repoName(record.repo)} ${unitLabel(record.id)}`);
  const where = markup ? `<b>${label}</b>` : label;
  if (record.status === "scored") {
    const before = levelFor(totalBefore).level;
    const after = levelFor(totalBefore + record.xp).level;
    const type = record.result?.evaluation?.contribution_type;
    return {
      title: `+${record.xp} XP${after > before ? ` · level ${after}!` : ""}`,
      body: `${where}${type ? `: ${text(type)}` : ""}\n${judged(record.summary)}`,
    };
  }
  if (record.status === "needs_review") {
    return { title: "Needs review", body: `${where}: the judge suspected prompt injection. See \`evolo why ${text(record.id)}\`.` };
  }
  if (record.status === "failed") {
    return { title: "Scoring failed", body: `${where}: ${judged(record.reason ?? record.summary)}\nRun \`evolo retry\` to try again.` };
  }
  return null;
}

// The notification the worker sends when the day's judge budget stops it; `reason` says what was spent.
export function budgetNotification(reason) {
  return {
    title: "Daily budget spent",
    body: terminalSafe(`${reason}. The next units are scored tomorrow; \`evolo config set budget.daily-usd <USD>\` raises the cap.`),
  };
}

const short = (sha) => sha.slice(0, 7);

// What the XP signals added, and whether they are still awaited: "signals: CI passed the first time +5%".
function signalsLine(signals) {
  if (!signals) return "signals: not read from GitHub yet";
  const found = [
    ...(signals.ciFirstPass ? ["CI passed the first time +5%"] : []),
    ...(signals.cleanMerge ? ["merged without rework after review +5%"] : []),
    ...(signals.closesBugIssue ? [`closes bug issue ${signals.bugIssues.map((number) => `#${number}`).join(", ")} +10%`] : []),
  ];
  const awaited = signals.final ? "" : `; read again at the next sync (CI: ${signals.ci?.toLowerCase() ?? "none yet"})`;
  return `signals: ${found.length > 0 ? found.join(", ") : "none"}${awaited}`;
}

function judgedLines(result, signals) {
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
    signalsLine(signals),
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
  const lines = [`${record.repo} ${unitLabel(record.id)}  ${worth}${was}  ${localTime(record.at)}`];
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
    lines.push("", result.evaluation.summary, ...judgedLines(result, record.signals));
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

// Rows of `evolo stats` show this many repositories and directories at most.
const STATS_TOP = 5;
const SPARK = "▁▂▃▄▅▆▇█";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const row = (name, text) => `${name.padEnd(10)}${text}`;
const percent = (part, whole) => Math.round((part / whole) * 100);

// " (+3)", " (-0.4)": the change from the previous period, with `digits` decimals.
function change(now, before, digits = 0) {
  const text = Math.abs(now - before).toFixed(digits);
  const sign = now < before && Number(text) !== 0 ? "-" : "+";
  return ` (${sign}${text})`;
}

// One character per hour, the busiest hour full height; an hour without commits is the lowest bar.
function sparkline(counts) {
  const most = Math.max(...counts);
  return counts.map((count) => (count === 0 ? SPARK[0] : SPARK[Math.max(1, Math.round((count / most) * (SPARK.length - 1)))])).join("");
}

// `evolo stats`: the lines for stats.mjs's computeStats of a period, against the previous period when it has data,
// and the streak. Repository names and paths come from the ledger, so the lines are printed without control characters.
// `unlocks` are the achievement tiers reached in the period (achievements.mjs's unlockedIn).
export function formatStats(current, previous, streak, unlocks = []) {
  const header = [
    previous ? `${current.period.label}  (vs ${previous.period.label})` : current.period.label,
    `streak ${plural(streak.current, "workday")} (longest ${streak.longest})`,
    ...(unlocks.length > 0 ? [row("unlocked", unlocks.map(({ label }) => label).join(" · "))] : []),
  ];
  if (current.units === 0) return [...header, "no contributions"].map(terminalSafe);
  const before = previous?.units > 0 ? previous : null;
  const { rubric, tests, reverts } = current;
  const rubricBefore = previous?.rubric.n > 0 ? previous.rubric.averages : null;
  const rubricText = rubric.n === 0 ? "no units scored by the judge"
    : `${CRITERIA.map((criterion) => {
      const average = rubric.averages[criterion];
      return `${criterion} ${average.toFixed(1)}${rubricBefore ? change(average, rubricBefore[criterion], 1) : ""}`;
    }).join("  ")}  (n=${rubric.n})`;
  const testsBefore = previous?.tests.eligible > 0 ? percent(previous.tests.touched, previous.tests.eligible) : null;
  const testsShare = tests.eligible > 0 ? percent(tests.touched, tests.eligible) : null;
  const testsText = testsShare === null ? "no units with code in a repository with tests"
    : `${tests.touched} of ${plural(tests.eligible, "unit")} with code touched tests (${testsShare}%)${testsBefore === null ? "" : change(testsShare, testsBefore)}`;
  const dirName = ({ repo, dir }) => (dir === "." ? repoName(repo) : `${repoName(repo)}/${dir}`);
  return [
    header[0],
    `${formatXp(current.xp)} XP${before ? change(current.xp, before.xp) : ""}  ` +
      `${plural(current.units, "unit")}${before ? change(current.units, before.units) : ""}  ` +
      `level ${current.level}  judge $${current.costUsd.toFixed(2)}`,
    ...header.slice(1),
    row("types", current.types.map(({ type, units, xp }) => `${type} ${units} (${formatXp(xp)} XP)`).join(" · ")),
    row("rubric", rubricText),
    row("tests", testsText),
    row("reverted", `${reverts.reverted} of ${reverts.total}`),
    row("repos", current.repos.slice(0, STATS_TOP).map(({ repo, units, xp }) => `${repo} ${formatXp(xp)} XP (${units})`).join(" · ")),
    row("dirs", current.dirs.slice(0, STATS_TOP).map((dir) => `${dirName(dir)} ${formatXp(dir.lines)}`).join(" · ") || "no code"),
    row("hours", `${sparkline(current.hours)}  (0-23)`),
    row("weekdays", WEEKDAYS.map((day, index) => `${day} ${current.weekdays[index]}`).join("  ")),
  ].map(terminalSafe);
}

// Width of the progress column of `evolo achievements`: "123/500" or "60 (max)".
const PROGRESS_WIDTH = 9;

// `evolo achievements`: the visible achievements (achievements.mjs's achievementsOf) in catalog order with their tier
// and progress, then the secrets found; a secret still locked shows nothing but that it exists.
export function formatAchievements(achievements) {
  const visible = achievements.filter((achievement) => !achievement.hidden);
  const secrets = achievements.filter((achievement) => achievement.hidden);
  const found = secrets.filter((achievement) => achievement.tier > 0);
  const width = Math.max(...[...visible, ...found].map((achievement) => achievement.name.length));
  const line = (name, tier, progress, description) => `${name.padEnd(width)}  ${tier.padEnd(4)} ${progress.padEnd(PROGRESS_WIDTH)} ${description}`;
  const progress = ({ tier, tiers, value }) => (tier === tiers.length ? `${value} (max)` : `${value}/${tiers[tier]}`);
  const hidden = secrets.length - found.length;
  return [
    `${visible.filter((achievement) => achievement.tier > 0).length} of ${visible.length} unlocked · ` +
      `${plural(found.length, "secret")} found, ${hidden} still hidden`,
    ...visible.map((achievement) => line(achievement.name, achievement.tier > 0 ? tierName(achievement.tier) : "-", progress(achievement), achievement.description)),
    ...found.map((achievement) => line(achievement.name, "★", "", achievement.description)),
    ...(hidden > 0 ? [`??? × ${hidden}`] : []),
  ].map(terminalSafe);
}

// The desktop notification for achievement tiers just reached (achievements.mjs's notifyUnlocks), as { title, body },
// or null when there are none. The text is Evolo's own, escaped all the same.
export function achievementNotification(unlocks, { markup = false } = {}) {
  if (unlocks.length === 0) return null;
  const text = (value) => (markup ? escapeMarkup(terminalSafe(value)) : terminalSafe(value));
  if (unlocks.length === 1) return { title: `achievement unlocked: ${unlocks[0].label}`, body: text(unlocks[0].description) };
  const label = (value) => (markup ? `<b>${text(value)}</b>` : text(value));
  return {
    title: `${unlocks.length} achievements unlocked`,
    body: unlocks.map((unlock) => `${label(unlock.label)}: ${text(unlock.description)}`).join("\n"),
  };
}
