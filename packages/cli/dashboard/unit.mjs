// The details of one unit (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): a hero with what the
// unit is and is worth, four tabs that are links, so each tab has its own address and Back goes to the tab before, and a
// rail of the facts behind the tab. Score says what `evolo why` says, Review what `evolo review` shows, Files and Commits
// what the judge was given. Every number comes from the model; the only arithmetic is the width of a rubric bar and the
// average of the judge's scores.
import { emptyPanel, escape, formatDuration, formatUsd, formatXp, hashOf, localDate, localTime, pageHead, plural, safeUrl, syncStatus } from "./html.mjs";
import { isBadStatus, statusText, typeTone, unitTitle, unitType, unitWorth } from "./overview.mjs";

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
const unitJudgeOf = (result) => result?.judge?.model ?? result?.judge?.backend;

// A panel with a heading; `title` and `aside` are markup the caller built. Analytics draws its panels with these too.
export const panel = (title, aside, body) =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${aside ? `<span class="muted">${aside}</span>` : ""}</div>${body}</section>`;
const diffOf = (additions, deletions) =>
  `<span class="diff"><span class="add">+${formatXp(additions)}</span> <span class="del">−${formatXp(deletions)}</span></span>`;

// The average of the judge's five scores, to one decimal, or null when there is no rubric. It is the number the hero and
// the Score tab's heading show beside the per-criterion bars.
function rubricAverage(result) {
  const scores = Object.values(result?.evaluation?.scores ?? {})
    .map((entry) => Number(entry?.score))
    .filter(Number.isFinite);
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

// The signals the judge read, as short chips in the hero; the Score tab spells them out in full.
function signalChips(signals) {
  if (!signals) return '<span class="signal-chip pending">Signals not read yet</span>';
  const chips = [
    ...(signals.ciFirstPass ? ["CI first pass +5%"] : []),
    ...(signals.cleanMerge ? ["Clean merge +5%"] : []),
    ...(signals.closesBugIssue ? [`Closes bug ${(signals.bugIssues ?? []).map((number) => `#${number}`).join(", ")} +10%`] : []),
    ...(signals.final ? [] : [`Sync pending${typeof signals.ci === "string" ? ` · CI ${signals.ci.toLowerCase()}` : ""}`]),
  ];
  if (chips.length === 0) return '<span class="signal-chip">No bonus signal</span>';
  return chips.map((chip) => `<span class="signal-chip">${escape(chip)}</span>`).join("");
}

// The crumb line above the hero, with the moment the page was written and the PR it belongs to. It stays at the top of
// the screen, as the mock's detail bar does.
function unitHead(unit, generatedAt) {
  const url = safeUrl(unit.result?.facts?.pr?.url);
  const link = url ? `<a class="head-action" href="${escape(url)}" target="_blank" rel="noreferrer">View PR on GitHub
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg></a>` : "";
  return '<header class="page-head unit-head"><div class="head-main"><div class="head-title">'
    + '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/timeline">Timeline</a><span aria-hidden="true">/</span>'
    + `<span>${escape(unit.repo)}</span><span aria-hidden="true">/</span><span>${escape(unit.label)}</span></nav></div>`
    + syncStatus(generatedAt)
    + `</div><div class="head-tools">${link}</div></header>`;
}

const testFilesOf = (unit) => (unit.result?.facts?.files ?? []).filter((file) => file.class === "test").length;
const unitJudge = (result) => result?.judge?.model ?? result?.judge?.backend;

// The four numbers under the hero, as the mock's PR screen has them. Each is read from the judge's result, not made up:
// the rubric average is shown out of 100, the spend and the engine come from the record, and tests are counted from
// the files the judge read.
function heroMetrics(unit) {
  const { result } = unit;
  const average = rubricAverage(result);
  const rubric = average === null ? "—" : Math.round((average / RUBRIC_MAX) * 100);
  const rubricFoot = average === null ? (result?.method === "rule" ? "triaged by rule" : "no rubric") : `${average.toFixed(1)} of ${RUBRIC_MAX} avg`;
  const tests = testFilesOf(unit);
  const engine = unitJudge(result);
  const version = result?.breakdown?.formula_version ? `formula ${escape(result.breakdown.formula_version)}` : (result?.method === "rule" ? "fixed score" : "not judged");
  return '<div class="hero-metrics">'
    + `<div class="hero-metric"><span class="metric-label">Code health</span><strong class="metric-value">${rubric}<span class="metric-unit">/100</span></strong><span class="metric-foot">${escape(rubricFoot)}</span></div>`
    + `<div class="hero-metric"><span class="metric-label">Judge spending</span><strong class="metric-value">${result?.costUsd ? formatUsd(result.costUsd) : "—"}</strong><span class="metric-foot">${result?.costUsd ? "for this unit" : "no judge run"}</span></div>`
    + `<div class="hero-metric"><span class="metric-label">Evaluator engine</span><strong class="metric-value metric-text">${engine ? escape(engine) : "—"}</strong><span class="metric-foot">${version}</span></div>`
    + `<div class="hero-metric"><span class="metric-label">Tests changed</span><strong class="metric-value">${formatXp(tests)}</strong><span class="metric-foot">${tests > 0 ? plural(tests, "test file") : "no test file"}</span></div>`
    + "</div>";
}

function unitHero(unit, stored) {
  const summary = unit.summary || unit.reason;
  const type = unitType(unit);
  const average = rubricAverage(unit.result);
  const title = unitTitle(unit);
  const heading = unit.kind === "pr" && title && title !== unit.label ? `${unit.label}: ${title}` : title || unit.label;
  const sub = unit.result?.method === "rule"
    ? "Fixed score · triaged by rule"
    : average !== null
      ? `Base ${formatXp(unit.result?.breakdown?.base ?? 0)} · Rubric ${average.toFixed(1)} / ${RUBRIC_MAX}`
      : unit.result ? "No rubric recorded" : "Not judged";
  return '<header class="detail-hero unit-hero">'
    + '<div class="detail-hero-main">'
    + `<div class="unit-badges"><span class="kind-chip">${unit.kind === "pr" ? "Pull request" : "Push"}</span>`
    + `<span class="type-chip type-${typeTone(type)}">${escape(type)}</span>`
    + `<span class="unit-repo">${escape(unit.repo)}</span></div>`
    + `<h1>${escape(heading)}</h1>`
    + (summary ? `<p class="unit-lede">${escape(summary)}</p>` : "")
    + `<p class="unit-facts">Landed <time datetime="${escape(unit.landedAt)}">${escape(localTime(unit.landedAt))}</time></p>`
    + `<div class="signal-chips">${signalChips(unit.signals)}</div>`
    + "</div>"
    + `<div class="award-panel${isBadStatus(unit.status) ? " award-bad" : ""}">`
    + `<span class="award-label">${unit.status === "scored" ? "Scored award" : "Unit status"}</span>`
    + `<span class="award-worth">${unitWorth(unit)}</span>`
    + `<span class="award-sub">${escape(sub)}</span>`
    + (stored ? `<span class="award-review">Reviewed ${escape(localDate(stored.at))}</span>` : "")
    + "</div>"
    + heroMetrics(unit)
    + "</header>";
}

// The tabs as a navigation of links (not ARIA tabs, which would need arrow-key handling); the open one is marked, and the
// Review tab counts the findings of the review when there is one.
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
  const average = rubricAverage(result);
  const aside = [
    average === null ? "" : `${average.toFixed(1)} avg`,
    unitJudgeOf(result) ? escape(unitJudgeOf(result)) : "",
    result.costUsd ? formatUsd(result.costUsd) : "",
  ].filter(Boolean).join(" · ");
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

// The Review tab's finding filter lives in the address as `?severity=`, so a filtered list can be bookmarked and Back
// undoes it, as the Reviews screen's filter does.
const reviewFilter = (query) => (FINDING_ORDER.includes(query?.severity) ? query.severity : "");

function reviewFindingHash(unit, severity) {
  const hash = hashOf("unit", ...unit.key.split("/"), "review");
  return severity === "" ? hash : `${hash}?${new URLSearchParams({ severity })}`;
}

function findingFilter(unit, findings, open) {
  const segment = (severity, label) =>
    `<a class="segment" href="${escape(reviewFindingHash(unit, severity))}"${severity === open ? ' aria-current="page"' : ""}>${label}`
    + `<span class="segment-count">${formatXp(severity === "" ? findings.length : findings.filter((finding) => severityOf(finding) === severity).length)}</span></a>`;
  return '<div class="finding-toolbar"><span class="finding-filter-label">Filter</span>'
    + `<div class="segmented finding-segments">${segment("", "All")}${FINDING_ORDER.map((severity) => segment(severity, sentenceCase(severity))).join("")}</div></div>`;
}

const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

const bulletPanel = (title, items, tone = "") => {
  if (!(items?.length > 0)) return "";
  const mark = tone === "good" ? CHECK_ICON : tone === "warn" ? WARN_ICON : "";
  const head = (mark ? `<span class="panel-icon ${tone}" aria-hidden="true">${mark}</span>` : "") + escape(title)
    + `<span class="panel-count">${formatXp(items.length)}</span>`;
  return panel(head, "", `<ul class="bullets">${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`);
};

function findingItem(finding, index = 0) {
  const severity = severityOf(finding);
  return `<li class="finding" data-severity="${severity}"><div class="finding-meta">`
    + `<span class="pill sev-${severity}">${escape(finding.severity)}</span>`
    + `<span class="muted">${escape(finding.category)}</span><code>${escape(finding.location)}</code>`
    + `<span class="finding-id">ID: FIND-${String(index + 1).padStart(3, "0")}</span></div>`
    + `<h3>${escape(finding.title)}</h3><p>${escape(finding.detail)}</p>`
    + (finding.suggestion ? `<p class="finding-fix"><span class="muted">Remediation suggestion</span> ${escape(finding.suggestion)}</p>` : "")
    + "</li>";
}

function findingsPanel(findings, shown = findings) {
  if (findings.length === 0) return panel("Findings", "", '<p class="panel-body muted">No findings.</p>');
  const sorted = [...shown].sort((a, b) => rankIn(FINDING_ORDER, severityOf(a)) - rankIn(FINDING_ORDER, severityOf(b)));
  const aside = shown.length === findings.length ? plural(findings.length, "finding") : `${formatXp(shown.length)} of ${plural(findings.length, "finding")}`;
  const body = sorted.length === 0 ? '<p class="panel-body muted">No finding of this severity.</p>'
    : `<ul class="findings">${sorted.map((finding, index) => findingItem(finding, index)).join("")}</ul>`;
  return panel("Inspection findings", aside, body);
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

function reviewTab(unit, stored, query = {}) {
  if (!stored) return noReview(unit);
  const { review } = stored;
  const warning = (review.flags ?? []).includes("suspected_injection")
    ? `<p class="notice notice-bad" role="alert">The reviewer suspected prompt injection: ${escape(review.notes || "read the findings with care")}</p>`
    : "";
  const aside = [localTime(stored.at), unitJudgeOf(stored), stored.costUsd ? formatUsd(stored.costUsd) : "", stored.durationMs ? formatDuration(stored.durationMs) : ""]
    .filter(Boolean).map((part) => escape(part)).join(" · ");
  const issues = stored.issues ?? [];
  const findings = review.findings ?? [];
  const open = reviewFilter(query);
  const shown = open === "" ? findings : findings.filter((finding) => severityOf(finding) === open);
  return warning
    + panel('<span class="panel-title-icon">✦</span>AI executive summary', aside, `<p class="panel-body review-overview-text">${escape(review.overview)}</p>`)
    + reviewColumns(bulletPanel("Strengths", review.strengths, "good"), bulletPanel("Improvements", review.improvements, "warn"))
    + findingFilter(unit, findings, open)
    + findingsPanel(findings, shown)
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

// The rail repeats the facts a tab cannot carry: what the unit is, what changed, how it was scored and whether it was
// reviewed. `open` marks the tab the reader is on, so the review link never points at the same page.
function unitRailCard(title, aside, body) {
  return `<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">${title}</h2>`
    + (aside ? `<span class="rail-aside">${aside}</span>` : "") + "</div>"
    + `<div class="rail-body">${body}</div></section>`;
}

// The checklist the mock's PR screen shows: the facts a reader would otherwise have to open other tabs to confirm. A
// row is green when the record says it is true, amber when the record is silent or still waiting.
function verificationCard(unit, stored) {
  const { result, signals } = unit;
  const average = rubricAverage(result);
  const testFiles = testFilesOf(unit);
  const issues = result?.issues ?? [];
  const ciText = signals?.ciFirstPass
    ? "Passed on the first run"
    : signals?.ci
      ? `CI reported ${String(signals.ci).toLowerCase()}`
      : signals?.final
        ? "No first-pass signal"
        : "Not read from GitHub yet";
  const ciGood = Boolean(signals?.ciFirstPass);
  const rubricText = result?.evaluation
    ? `Rubric ${average === null ? "—" : average.toFixed(1)} of ${RUBRIC_MAX}, validated`
    : result?.method === "rule" ? "Triaged by rule, no judge" : "Not judged";
  const rubricGood = Boolean(result?.evaluation || result?.method === "rule");
  const testsGood = testFiles > 0;
  const cleanGood = issues.length === 0;
  const rows = [
    { good: ciGood, title: "CI / GitHub Actions", text: ciText },
    { good: rubricGood, title: "Automated rubric", text: rubricText },
    { good: testsGood, title: "Tests changed", text: testsGood ? plural(testFiles, "test file") : "No test file in this unit" },
    { good: cleanGood, title: "Validator notes", text: cleanGood ? "Nothing was dropped" : plural(issues.length, "note") },
  ];
  const complete = rows.filter((row) => row.good).length;
  const body = rows.map((row) => `<div class="check-row"><span class="check-mark ${row.good ? "good" : "warn"}" aria-hidden="true">`
    + `${row.good ? CHECK_ICON : WARN_ICON}</span><span><strong>${escape(row.title)}</strong><span class="check-note">${escape(row.text)}</span></span></div>`).join("");
  return unitRailCard("Verification checklist", `${complete} / ${rows.length} complete`, `<div class="check-list">${body}</div>`);
}

// The formula in the rail, one factor to a row, so a reader sees what the judge's score became.
function signalBreakdownCard(unit) {
  const { result } = unit;
  if (!result) return "";
  const b = result.breakdown;
  if (!b) {
    return result.method === "rule"
      ? unitRailCard("XP signals", "fixed", `<p class="rail-empty">Rule-triaged: +${formatXp(result.xp ?? unit.xp)} XP, no signals.</p>`)
      : "";
  }
  const row = (name, value) => `<div class="factor-row"><span class="factor-name">${name}</span><span class="factor-value">${value}</span></div>`;
  const body = row("Base score", formatXp(b.base))
    + row("Value", `× ${escape(formatXp(b.mValue))}`)
    + row("Size", `× ${escape(formatXp(b.mSize))}`)
    + row("Repository", `× ${escape(formatXp(b.mRepo))}`)
    + row("Signals", `× ${escape(formatXp(b.mSignals))}`)
    + row("Raw", formatXp(b.raw))
    + `<div class="factor-net"><span>Net earned</span><strong>+${formatXp(result.xp ?? unit.xp)} XP</strong></div>`;
  return unitRailCard("XP signals", `formula ${escape(b.formula_version ?? "—")}`, `<div class="factor-list">${body}</div>`);
}

// What the judge run cost and how long it took; the mock's "Autonomous judge run" without inventing token counts Evolo
// does not record.
function judgeRunCard(unit, stored) {
  const { result } = unit;
  if (!result) return "";
  const rows = [
    ["Judge", unitJudgeOf(result) ?? "—"],
    ["Duration", result.durationMs ? formatDuration(result.durationMs) : "—"],
    ["Cost", result.costUsd ? formatUsd(result.costUsd) : "—"],
    ["Formula", result.breakdown?.formula_version ?? (result.method === "rule" ? "rule" : "—")],
    ...(stored?.durationMs ? [["Review", formatDuration(stored.durationMs)]] : []),
  ];
  const body = `<dl class="rail-facts">${rows.map(([term, value]) => `<div><dt>${escape(term)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
  return unitRailCard('<span class="panel-title-icon orange">✦</span>Judge run', "", body);
}


function unitRail(unit, stored, open) {
  const { result } = unit;
  const facts = result?.facts;
  const totals = facts?.totals;
  const judge = unitJudgeOf(result);
  const average = rubricAverage(result);
  const status = unit.status === "scored" ? "Scored" : statusText(unit.status);
  const factsRows = [
    ["Repository", escape(unit.repo)],
    ["Kind", escape(unit.kind === "pr" ? "Pull request" : "Push")],
    ["Landed", escape(localDate(unit.landedAt))],
    ["Status", escape(status)],
    ...(judge ? [["Judge", escape(judge)]] : []),
    ...(result?.costUsd ? [["Cost", formatUsd(result.costUsd)]] : []),
    ...(result?.durationMs ? [["Duration", escape(formatDuration(result.durationMs))]] : []),
  ];
  const factsBody = `<dl class="detail-facts">${factsRows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
  const changeBody = totals
    ? '<div class="mini-grid">'
      + `<div class="mini"><span class="mini-label">Files</span><strong class="mini-value">${formatXp(totals.files ?? 0)}</strong></div>`
      + `<div class="mini"><span class="mini-label">Counted lines</span><strong class="mini-value">${formatXp(totals.countedLines ?? 0)}</strong></div>`
      + `<div class="mini"><span class="mini-label">Commits</span><strong class="mini-value">${formatXp(facts.commits?.length ?? 0)}</strong></div>`
      + `<div class="mini"><span class="mini-label">Diff</span><strong class="mini-value">${diffOf(totals.additions ?? 0, totals.deletions ?? 0)}</strong></div>`
      + "</div>"
    : '<p class="rail-empty">No change was read.</p>';
  const scoreBody = result?.evaluation
    ? '<div class="score-rail">'
      + `<div class="score-rail-value"><strong>${average === null ? "—" : average.toFixed(1)}</strong><span>/ ${RUBRIC_MAX}</span></div>`
      + '<p class="rail-note">Average of the judge\'s rubric, as the Score tab shows each bar.</p>'
      + (result.breakdown ? `<p class="rail-note">Base ${formatXp(result.breakdown.base)} → raw ${formatXp(result.breakdown.raw)}</p>` : "")
      + "</div>"
    : result?.method === "rule"
      ? `<p class="rail-empty">Fixed score of +${formatXp(result.xp)} XP, triaged by rule.</p>`
      : '<p class="rail-empty">No rubric was recorded.</p>';
  const reviewBody = stored
    ? `<div class="review-rail"><div class="mini-grid">`
      + `<div class="mini"><span class="mini-label">Findings</span><strong class="mini-value">${formatXp(stored.review.findings?.length ?? 0)}</strong></div>`
      + `<div class="mini"><span class="mini-label">Review time</span><strong class="mini-value">${stored.durationMs ? escape(formatDuration(stored.durationMs)) : "—"}</strong></div>`
      + "</div>"
      + `<p class="rail-note">${escape(unitJudgeOf(stored) ?? "reviewer")} · ${stored.costUsd ? formatUsd(stored.costUsd) : "cost not recorded"}</p>`
      + (open === "review" ? "" : `<a class="rail-more" href="${escape(hashOf("unit", ...unit.key.split("/"), "review"))}">Open the review <span aria-hidden="true">→</span></a>`)
      + "</div>"
    : '<p class="rail-empty">This unit has no code review yet.</p>';
  if (open === "review" && stored) {
    return '<aside class="rail" aria-label="Unit facts">'
      + verificationCard(unit, stored)
      + signalBreakdownCard(unit)
      + judgeRunCard(unit, stored)
      + unitRailCard("Unit facts", "", factsBody)
      + "</aside>";
  }
  return '<aside class="rail" aria-label="Unit facts">'
    + unitRailCard("Unit facts", "", factsBody)
    + unitRailCard("Change", totals ? plural(totals.files ?? 0, "file") : "", changeBody)
    + unitRailCard(result?.evaluation ? "Score" : "Method", "", scoreBody)
    + unitRailCard("Review", stored ? localDate(stored.at) : "", reviewBody)
    + "</aside>";
}

export function renderUnit(model, key, tab, query = {}) {
  const unit = model.units.find((entry) => entry.key === key);
  if (!unit) {
    return `<div class="screen unit-screen">${pageHead("Unit not found")}<section class="panel empty"><p>This unit is no longer in the ledger.</p>`
      + '<p><a class="panel-link" href="#/timeline">Back to the timeline</a></p></section></div>';
  }
  const stored = model.reviews.find((review) => review.repo === unit.repo && review.unitId === unit.id);
  const content = { score: () => scoreTab(model, unit), review: () => reviewTab(unit, stored, query), files: () => filesTab(unit), commits: () => commitsTab(unit) };
  const open = Object.hasOwn(content, tab) ? tab : "score";
  return `<div class="screen unit-screen">${unitHead(unit, model.generatedAt)}${unitHero(unit, stored)}${unitTabs(unit, stored, open)}`
    + `<div class="detail-layout"><div class="tab-panel">${content[open]()}</div>${unitRail(unit, stored, open)}</div></div>`;
}
