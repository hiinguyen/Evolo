// The details of one unit (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): a head with what the
// unit is and is worth, and four tabs that are links, so each tab has its own address and Back goes to the tab before.
// Score says what `evolo why` says, Review what `evolo review` shows, Files and Commits what the judge was given.
// Every number comes from the model; the only arithmetic is the width of a rubric bar.
import { escape, formatUsd, formatXp, hashOf, localTime, pageHead, plural, safeUrl } from "./html.mjs";
import { unitType, unitWorth } from "./overview.mjs";

export const UNIT_TABS = ["score", "review", "files", "commits"];

export const RUBRIC_MAX = 4;
export const FINDING_ORDER = ["high", "medium", "low"];
// A finding's severity as the page shows it: one the page does not know is styled and counted as low.
export const severityOf = (finding) => (FINDING_ORDER.includes(finding.severity) ? finding.severity : "low");
// The classes of facts.mjs, the ones that count toward size first; a class this list does not know comes last.
const FILE_CLASS_ORDER = ["source", "test", "fixture", "docs", "config", "lockfile", "generated"];

// "scope_fit" -> "Scope fit".
export const sentenceCase = (text) => {
  const words = String(text).replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const shortSha = (sha) => String(sha).slice(0, 7);
const rankIn = (order, value) => (order.includes(value) ? order.indexOf(value) : order.length);

// A panel with a heading; `title` and `aside` are markup the caller built. Analytics draws its panels with these too.
export const panel = (title, aside, body) =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${aside ? `<span class="muted">${aside}</span>` : ""}</div>${body}</section>`;
export const emptyPanel = (text) => `<section class="panel empty"><p>${text}</p></section>`;
const diffOf = (additions, deletions) =>
  `<span class="diff"><span class="add">+${formatXp(additions)}</span> <span class="del">−${formatXp(deletions)}</span></span>`;

function unitHead(unit) {
  const url = safeUrl(unit.result?.facts?.pr?.url);
  const link = url ? ` · <a class="ext-link" href="${escape(url)}" target="_blank" rel="noreferrer">View PR on GitHub</a>` : "";
  const summary = unit.summary || unit.reason;
  return '<header class="unit-head">'
    + `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/timeline">Timeline</a><span aria-hidden="true">/</span><span>${escape(unit.repo)}</span></nav>`
    + `<div class="unit-heading"><h1>${escape(unit.label)}</h1>${unitWorth(unit)}</div>`
    + `<p class="unit-facts">${escape(unitType(unit))} · <time datetime="${escape(unit.landedAt)}">${escape(localTime(unit.landedAt))}</time>${link}</p>`
    + (summary ? `<p class="unit-lede">${escape(summary)}</p>` : "")
    + "</header>";
}

// The tabs as a navigation of links (not ARIA tabs, which would need arrow-key handling); the open one is marked, and the Review tab counts the findings of the review when there is one.
function unitTabs(unit, stored, open) {
  const labels = { score: "Score", review: stored ? `Review · ${formatXp(stored.review.findings?.length ?? 0)}` : "Review", files: "Files", commits: "Commits" };
  const links = UNIT_TABS.map((tab) => {
    const href = escape(hashOf("unit", ...unit.key.split("/"), tab));
    const current = tab === open ? ' aria-current="page"' : "";
    return `<a href="${href}"${current}>${labels[tab]}</a>`;
  });
  return `<nav class="tabs" aria-label="Unit sections">${links.join("")}</nav>`;
}

// What the XP signals added, worded as `evolo why` words them (views.mjs's signalsLine).
function signalsText(signals) {
  if (!signals) return "not read from GitHub yet";
  const found = [
    ...(signals.ciFirstPass ? ["CI passed the first time +5%"] : []),
    ...(signals.cleanMerge ? ["merged without rework after review +5%"] : []),
    ...(signals.closesBugIssue ? [`closes bug issue ${(signals.bugIssues ?? []).map((number) => `#${number}`).join(", ")} +10%`] : []),
  ];
  const ci = typeof signals.ci === "string" ? signals.ci.toLowerCase() : "none yet";
  const awaited = signals.final ? "" : `; read again at the next sync (CI: ${ci})`;
  return `${found.length > 0 ? found.join(", ") : "none"}${awaited}`;
}

function criterionRow(criterion, entry) {
  const score = Number(entry.score);
  const share = Number.isFinite(score) ? Math.min(100, Math.max(0, (score / RUBRIC_MAX) * 100)) : 0;
  const evidence = (entry.evidence ?? []).map((reference) => `<code>${escape(reference)}</code>`).join("");
  return '<li class="criterion"><div class="criterion-head">'
    + `<span class="criterion-name">${escape(sentenceCase(criterion))}</span>`
    + `<span class="score-bar" role="img" aria-label="${escape(entry.score)} of ${RUBRIC_MAX}"><span style="width:${share}%"></span></span>`
    + `<span class="criterion-score">${escape(entry.score)}<span class="muted">/${RUBRIC_MAX}</span></span></div>`
    + (entry.reason ? `<p class="criterion-reason">${escape(entry.reason)}</p>` : "")
    + (evidence ? `<p class="evidence">${evidence}</p>` : "")
    + "</li>";
}

function rubricPanel(criteria, result) {
  const { scores } = result.evaluation;
  const judge = result.judge?.model ?? result.judge?.backend;
  const aside = [judge ? escape(judge) : "", result.costUsd ? formatUsd(result.costUsd) : ""].filter(Boolean).join(" · ");
  const rows = criteria.filter((criterion) => scores?.[criterion]).map((criterion) => criterionRow(criterion, scores[criterion])).join("");
  return panel("Rubric", aside, `<ul class="criteria">${rows}</ul>`);
}

// `base × value × size × repo × signals = raw -> XP`, as `evolo why` writes it, one term to a chip so it wraps cleanly.
function formulaLine(unit) {
  const { breakdown: b, evaluation, facts } = unit.result;
  const term = (value, name, detail) =>
    `<span class="term"><strong>${escape(formatXp(value))}</strong>${name ? ` ${name}` : ""}${detail ? ` <span class="muted">(${escape(detail)})</span>` : ""}</span>`;
  const op = (sign) => `<span class="op">${sign}</span>`;
  const xp = unit.result.xp ?? unit.xp;
  return '<p class="formula">'
    + [term(b.base, "base", evaluation.contribution_type), term(b.mValue, "value"),
      term(b.mSize, "size", plural(facts.totals?.countedLines ?? 0, "line")), term(b.mRepo, "repo"), term(b.mSignals, "signals")].join(op("×"))
    + op("=") + term(b.raw) + op("-&gt;") + `<span class="term term-xp"><strong>${formatXp(xp)}</strong> XP</span>`
    + (b.reverted ? ' <span class="pill">reverted</span>' : "")
    + "</p>";
}

// One labelled line under the formula: the signals, the validator's issues, the judge's flags.
const factRow = (name, value) => `<div class="fact-row"><dt>${name}</dt><dd>${value}</dd></div>`;

function formulaPanel(unit) {
  const { result } = unit;
  const issues = result.issues ?? [];
  const flags = result.evaluation.flags ?? [];
  const rows = [
    factRow("Signals", escape(signalsText(unit.signals))),
    ...(issues.length > 0 ? [factRow("Validator", `<ul class="plain-list">${issues.map((issue) => `<li>${escape(issue)}</li>`).join("")}</ul>`)] : []),
    ...(flags.length > 0 ? [factRow("Flags", `<span class="pills">${flags.map((flag) => `<span class="pill">${escape(flag)}</span>`).join("")}</span>`)] : []),
  ];
  const version = result.breakdown?.formula_version ? `formula ${escape(result.breakdown.formula_version)}` : "";
  const formula = result.breakdown ? formulaLine(unit) : "";
  return panel("XP", version, `<div class="panel-body stack">${formula}<dl class="fact-list">${rows.join("")}</dl></div>`);
}

// A unit the judge never scored: the failures of each attempt, or the reason it stopped before judging.
function notScoredPanel(unit) {
  const failures = unit.result?.failures ?? [];
  const why = failures.length > 0
    ? `<ul class="plain-list">${failures.map((failure) => `<li>${escape(failure)}</li>`).join("")}</ul>`
    : `<p>${escape(unit.reason || unit.summary || "No reason was recorded.")}</p>`;
  const retry = unit.status === "failed" ? '<p class="muted">Run <code>evolo retry</code> to try again.</p>' : "";
  return panel(unit.result ? "Scoring failed" : "Never judged", "", `<div class="panel-body stack">${why}${retry}</div>`);
}

// The XP the rule gave; once the unit no longer counts (a revert, a force push) it is struck through, as in the head.
function rulePanel(unit) {
  const xp = unit.result.xp ?? unit.xp;
  const worth = `<strong>+${formatXp(xp)}</strong> XP`;
  const shown = unit.status === "scored" ? worth : `<s class="unit-lost" title="No longer counted">${worth}</s> <span class="muted">No longer counted</span>`;
  return panel("Triaged by rule", "", '<div class="panel-body stack">'
    + `<p class="rule-xp">${shown}</p>`
    + '<p class="muted">Small documentation edits and lockfile or generated-file updates get fixed scores, without the judge.</p>'
    + "</div>");
}

function scoreTab(model, unit) {
  if (!unit.result?.evaluation) return notScoredPanel(unit);
  if (unit.result.method === "rule") return rulePanel(unit);
  return rubricPanel(model.criteria, unit.result) + formulaPanel(unit);
}

const bulletPanel = (title, items) =>
  (items?.length > 0 ? panel(title, "", `<ul class="bullets">${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`) : "");

function findingItem(finding) {
  return '<li class="finding"><div class="finding-meta">'
    + `<span class="pill sev-${severityOf(finding)}">${escape(finding.severity)}</span>`
    + `<span class="muted">${escape(finding.category)}</span><code>${escape(finding.location)}</code></div>`
    + `<h3>${escape(finding.title)}</h3><p>${escape(finding.detail)}</p>`
    + (finding.suggestion ? `<p class="finding-fix"><span class="muted">Suggestion</span> ${escape(finding.suggestion)}</p>` : "")
    + "</li>";
}

function findingsPanel(findings) {
  if (findings.length === 0) return panel("Findings", "", '<p class="panel-body muted">No findings.</p>');
  const sorted = [...findings].sort((a, b) => rankIn(FINDING_ORDER, a.severity) - rankIn(FINDING_ORDER, b.severity));
  return panel("Findings", plural(findings.length, "finding"), `<ul class="findings">${sorted.map(findingItem).join("")}</ul>`);
}

function noReview(unit) {
  if (!unit.result) return emptyPanel("Nothing to review: this unit ended before its changes were read.");
  const command = `evolo review ${unit.id}`;
  return panel("No review yet", "", '<div class="panel-body stack">'
    + `<p>A separate judge reads the change and writes a code review. Run this in a clone of ${escape(unit.repo)}:</p>`
    + `<div class="command"><code>${escape(command)}</code>`
    + `<button type="button" class="copy" data-copy="${escape(command)}" aria-live="polite" hidden>Copy</button></div>`
    + "</div>");
}

// Strengths and improvements side by side where there is room; nothing at all when the review has neither.
const reviewColumns = (...panels) => (panels.join("") === "" ? "" : `<div class="review-columns">${panels.join("")}</div>`);

function reviewTab(unit, stored) {
  if (!stored) return noReview(unit);
  const { review } = stored;
  const warning = (review.flags ?? []).includes("suspected_injection")
    ? `<p class="notice notice-bad" role="alert">The reviewer suspected prompt injection: ${escape(review.notes || "read the findings with care")}</p>`
    : "";
  const judge = stored.judge?.model ?? stored.judge?.backend;
  const aside = [escape(localTime(stored.at)), judge ? escape(judge) : "", stored.costUsd ? formatUsd(stored.costUsd) : ""].filter(Boolean).join(" · ");
  const issues = stored.issues ?? [];
  return warning
    + panel("Review", aside, `<p class="panel-body">${escape(review.overview)}</p>`)
    + reviewColumns(bulletPanel("Strengths", review.strengths), bulletPanel("Improvements", review.improvements))
    + findingsPanel(review.findings ?? [])
    + bulletPanel("Validator", issues);
}

function fileGroup(kind, files) {
  const rows = files.map((file) => `<li class="file-row"><span class="file-path">${escape(file.path)}</span>${diffOf(file.additions, file.deletions)}</li>`);
  return panel(escape(sentenceCase(kind)), plural(files.length, "file"), `<ul class="rows">${rows.join("")}</ul>`);
}

function filesTab(unit) {
  const facts = unit.result?.facts;
  if (!facts) return emptyPanel("No files were read: this unit ended before judging.");
  const files = facts.files ?? [];
  if (files.length === 0) return emptyPanel("This unit changed no files.");
  const totals = facts.totals ?? {};
  const kinds = [...new Set(files.map((file) => file.class))]
    .sort((a, b) => rankIn(FILE_CLASS_ORDER, a) - rankIn(FILE_CLASS_ORDER, b) || String(a).localeCompare(String(b)));
  return `<p class="tab-summary"><strong>${plural(totals.files ?? files.length, "file")}</strong> ${diffOf(totals.additions ?? 0, totals.deletions ?? 0)}`
    + ` <span class="muted">· ${plural(totals.countedLines ?? 0, "line")} counted toward size</span></p>`
    + kinds.map((kind) => fileGroup(kind, files.filter((file) => file.class === kind))).join("");
}

function commitRow(commit) {
  const reverts = commit.revertedBy ?? [];
  return `<li class="commit-row"><code class="sha">${escape(shortSha(commit.sha))}</code>`
    + `<span class="commit-subject">${escape(commit.subject)}</span>`
    + (reverts.length > 0 ? `<span class="pill pill-bad">reverted by ${escape(reverts.map(shortSha).join(", "))}</span>` : "")
    + `<time class="muted" datetime="${escape(commit.date)}">${escape(localTime(commit.date))}</time></li>`;
}

function commitsTab(unit) {
  const facts = unit.result?.facts;
  if (!facts) return emptyPanel("No commits were read: this unit ended before judging.");
  const commits = facts.commits ?? [];
  const excluded = facts.excluded ?? [];
  const counted = commits.length === 0
    ? panel("Counted", "", '<p class="panel-body muted">No commits were counted.</p>')
    : panel("Counted", plural(commits.length, "commit"), `<ul class="rows">${commits.map(commitRow).join("")}</ul>`);
  if (excluded.length === 0) return counted;
  const rows = excluded.map((commit) => `<li class="commit-row"><code class="sha">${escape(shortSha(commit.sha))}</code>`
    + `<span class="commit-subject">${escape(commit.subject)}</span><span class="muted">${escape(commit.reason)}</span></li>`);
  return counted + panel("Left out", plural(excluded.length, "commit"), `<ul class="rows">${rows.join("")}</ul>`);
}

export function renderUnit(model, key, tab) {
  const unit = model.units.find((entry) => entry.key === key);
  if (!unit) {
    return `<div class="screen">${pageHead("Unit not found")}<section class="panel empty"><p>This unit is no longer in the ledger.</p>`
      + '<p><a class="panel-link" href="#/timeline">Back to the timeline</a></p></section></div>';
  }
  const stored = model.reviews.find((review) => review.repo === unit.repo && review.unitId === unit.id);
  const content = { score: () => scoreTab(model, unit), review: () => reviewTab(unit, stored), files: () => filesTab(unit), commits: () => commitsTab(unit) };
  const open = Object.hasOwn(content, tab) ? tab : "score";
  return `<div class="screen">${unitHead(unit)}${unitTabs(unit, stored, open)}`
    + `<div class="tab-panel">${content[open]()}</div></div>`;
}
