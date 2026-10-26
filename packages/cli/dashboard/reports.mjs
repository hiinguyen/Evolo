// The Reports screen (docs/superpowers/specs/2026-10-22-evolo-report-design.md section 9): every saved performance
// review, the latest period featured first, the rest as an archive; and one review in full, its highlights and every
// citation a link to the unit it names. The numbers are the ones saved with the report, as `evolo report` prints them;
// whether the ledger changed since is the model's `stale`. The rail reads only the saved report and its units.
import { emptyPanel, escape, formatDuration, formatUsd, formatXp, hashOf, localDate, localTime, pageHead, periodChip, plural, syncStatus } from "./html.mjs";
import { delta, figure } from "./analytics.mjs";
import { typeFill, typeTone } from "./overview.mjs";
import { panel } from "./unit.mjs";

const KIND_NAMES = { week: "Week", month: "Month", quarter: "Quarter" };

// The writer's words as markup: escaped first, then each `inline code` span, which the prompt asks for around technical
// names, drawn as code. Escaping leaves backticks alone, so a span can only wrap text that is already safe.
const prose = (text) => escape(text).replace(/`([^`]+)`/g, "<code>$1</code>");

// "#/reports/week/2026-10-19".
const reportHash = (report) => hashOf("reports", ...report.id.split("/"));
const unitHash = (key) => hashOf("unit", ...key.split("/"));

const judgeOf = (report) => report.judge?.model ?? report.judge?.backend;

// "Oct 19": a saved period on the velocity chart, short enough to sit under a bar.
const shortDate = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// The pills of a report written before its period ended, or from data that changed since.
function reportPills(report) {
  const pills = [
    ...(report.inProgress ? ['<span class="pill">In progress</span>'] : []),
    ...(report.stale ? ['<span class="pill sev-medium">Stale</span>'] : []),
  ];
  return pills.length > 0 ? `<span class="report-pills">${pills.join("")}</span>` : "";
}

// The facts under a report's label, in the order a reader asks for them. An archived card already has its day on the
// top line, so it asks for `written: false` and does not repeat it.
function reportMeta(report, { written = true, withTime = false } = {}) {
  return [
    ...(written ? [KIND_NAMES[report.kind] ?? report.kind] : []),
    report.language,
    ...(written ? [`written ${withTime ? localTime(report.at) : localDate(report.at)}`] : []),
    judgeOf(report),
    report.costUsd ? formatUsd(report.costUsd) : "",
    report.durationMs ? formatDuration(report.durationMs) : "",
  ].filter(Boolean).join(" · ");
}

// A unit the report names: a link to its Score tab while the model still has it, else its label as plain text.
function citation(report, key, known) {
  const label = report.units.find((unit) => unit.key === key)?.label ?? key;
  return known.has(key) ? `<a class="cite" href="${escape(unitHash(key))}">${escape(label)}</a>` : `<span class="cite">${escape(label)}</span>`;
}

// The report's cited units with the most XP first, each with the type it was saved with.
function topUnits(report, known, limit = 5) {
  return [...report.units]
    .filter((unit) => unit.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit)
    .map((unit) => `<li class="unit-cite"><span class="unit-cite-main">${citation(report, unit.key, known)}`
      + (unit.type ? `<span class="unit-cite-type type-${typeTone(unit.type)}">${escape(unit.type)}</span>` : "")
      + `</span><span class="unit-cite-xp">+${formatXp(unit.xp)} XP</span></li>`).join("");
}

// The share of the report's listed XP by contribution type.
function contributionMix(units) {
  const totals = new Map();
  for (const unit of units) {
    if (!unit.type) continue;
    const entry = totals.get(unit.type) ?? { units: 0, xp: 0 };
    totals.set(unit.type, { units: entry.units + 1, xp: entry.xp + unit.xp });
  }
  const ranked = [...totals].sort(([, a], [, b]) => b.xp - a.xp);
  const total = ranked.reduce((sum, [, entry]) => sum + entry.xp, 0);
  if (total === 0) return '<p class="rail-empty">This report lists no scored units.</p>';
  const stack = ranked.map(([type, entry]) =>
    `<span class="mix-seg fill-${typeFill(type)}" style="width:${(entry.xp / total) * 100}%" title="${escape(type)} ${Math.round((entry.xp / total) * 100)}%"></span>`).join("");
  const rows = ranked.map(([type, entry]) =>
    `<div class="mix-row"><span class="mix-dot fill-${typeFill(type)}" aria-hidden="true"></span><span class="mix-name">${escape(type)}</span>`
    + `<span class="mix-value">${Math.round((entry.xp / total) * 100)}%</span><span class="mix-units">${plural(entry.units, "unit")}</span></div>`).join("");
  return `<div class="mix-bar" aria-hidden="true">${stack}</div><div class="mix-list">${rows}</div>`;
}

// A report's highlights, each a cited unit and the writer's line about it. `limit` keeps the featured card short; the
// report itself has them all.
function highlightList(report, known, limit = Infinity) {
  const rows = report.report.highlights.slice(0, limit).map(({ unit, text }) => {
    const saved = report.units.find((each) => each.key === unit);
    const worth = saved ? `<span class="highlight-worth">${formatXp(saved.xp)} XP${saved.type ? ` · ${escape(saved.type)}` : ""}</span>` : "";
    return `<li class="highlight"><span class="highlight-head">${citation(report, unit, known)}${worth}</span><p>${prose(text)}</p></li>`;
  });
  return `<ul class="rows">${rows.join("")}</ul>`;
}

// The latest report as a featured card: its words, its four numbers, and the units it was proudest of.
function featuredReport(report, known) {
  const { current } = report.numbers;
  const kids = [
    report.report.highlights.length > 0 ? highlightList(report, known, 3) : "",
    report.unlocked.length > 0 ? `<p class="featured-unlocked">Unlocked ${escape(report.unlocked.join(" · "))}</p>` : "",
  ].join("");
  return '<article class="panel featured-report">'
    + '<div class="featured-top"><div class="featured-title">'
    + `<span class="featured-badge${report.stale || report.inProgress ? " warn" : ""}"><span class="status-dot ${report.stale || report.inProgress ? "warn" : "good"}" aria-hidden="true"></span>`
    + `${report.stale || report.inProgress ? "Report needs a check" : "Verified report"}</span>`
    + `<h2>${escape(report.label)}</h2>`
    + `<p class="featured-meta">${escape(reportMeta(report))}</p>`
    + "</div>"
    + `<a class="featured-open" href="${escape(reportHash(report))}">Read full narrative <span aria-hidden="true">→</span></a></div>`
    + `<p class="featured-overview">${prose(report.report.overview)}</p>`
    + '<div class="featured-metrics">'
    + `<div class="feat-stat"><span class="feat-label">XP earned</span><strong class="feat-value">${formatXp(current.xp)}</strong><span class="feat-unit">XP</span></div>`
    + `<div class="feat-stat"><span class="feat-label">Scored units</span><strong class="feat-value">${formatXp(current.units)}</strong></div>`
    + `<div class="feat-stat"><span class="feat-label">Level</span><strong class="feat-value">${formatXp(current.level)}</strong></div>`
    + `<div class="feat-stat"><span class="feat-label">Report cost</span><strong class="feat-value">${formatUsd(report.costUsd ?? 0)}</strong></div>`
    + "</div>"
    + `<section class="featured-highlights"><div class="featured-subhead"><h3>Key deliverables</h3>`
    + `<span class="rail-aside">${plural(report.report.highlights.length, "highlight")}</span></div>${kids}</section>`
    + `<div class="featured-foot">${reportPills(report)}`
    + `<span class="featured-foot-note">${plural(report.issues.length, "validator note")} · ${report.failed > 0 ? plural(report.failed, "failed unit") : "no failed units"}</span>`
    + "</div></article>";
}

// One archived report: a compact row with the same facts as a card, the first two lines of its overview.
function reportCard(report) {
  return `<li><a class="report-card" href="${escape(reportHash(report))}">`
    + '<div class="report-card-top">'
    + `<span class="kind-chip">${escape(KIND_NAMES[report.kind] ?? report.kind)}</span>`
    + `<span class="report-label">${escape(report.label)}</span>`
    + `<time class="report-at" datetime="${escape(report.at)}">${escape(localDate(report.at))}</time>`
    + "</div>"
    + `<p class="report-card-meta">${escape(reportMeta(report, { written: false }))}</p>`
    + `<p class="report-overview">${prose(report.report.overview)}</p>`
    + '<div class="report-card-foot">'
    + `<span class="report-xp">+${formatXp(report.numbers.current.xp)} XP</span>`
    + `<span class="report-units">${plural(report.numbers.current.units, "unit")}</span>`
    + reportPills(report)
    + '<span class="report-open">Open <span aria-hidden="true">→</span></span>'
    + "</div></a></li>";
}

function reportCount(reports) {
  return `${formatXp(reports.length)} ${reports.length === 1 ? "report" : "reports"}`;
}

// How many saved reports match the ledger they were written from: not stale, and written after their period ended.
const verifiedCount = (reports) => reports.filter((report) => !report.stale && !report.inProgress).length;

function latestFactsCard(report) {
  const { current } = report.numbers;
  const avg = current.units > 0 ? Math.round(current.xp / current.units) : 0;
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Latest period</h2>'
    + `<span class="rail-aside">${escape(KIND_NAMES[report.kind] ?? report.kind)}</span></div>`
    + '<div class="rail-body"><div class="mini-grid">'
    + `<div class="mini"><span class="mini-label">XP</span><strong class="mini-value">${formatXp(current.xp)}</strong></div>`
    + `<div class="mini"><span class="mini-label">Units</span><strong class="mini-value">${formatXp(current.units)}</strong></div>`
    + `<div class="mini"><span class="mini-label">Avg / unit</span><strong class="mini-value">${formatXp(avg)}</strong></div>`
    + `<div class="mini"><span class="mini-label">Level</span><strong class="mini-value">${formatXp(current.level)}</strong></div>`
    + "</div>"
    + '<dl class="rail-facts">'
    + `<div><dt>Written</dt><dd>${escape(localTime(report.at))}</dd></div>`
    + `<div><dt>Judge</dt><dd>${escape(judgeOf(report) ?? "—")}</dd></div>`
    + `<div><dt>Cost</dt><dd>${formatUsd(report.costUsd ?? 0)}</dd></div>`
    + `<div><dt>Duration</dt><dd>${report.durationMs ? escape(formatDuration(report.durationMs)) : "—"}</dd></div>`
    + "</dl></div></section>";
}

// The saved reports as a short velocity chart: the XP of each period, oldest first, so the latest bar is the week just
// written. It answers the question a single featured report cannot.
function velocityHistoryCard(reports) {
  const points = [...reports].slice(0, 4).reverse();
  if (points.length === 0) return "";
  const max = Math.max(1, ...points.map((report) => report.numbers.current.xp));
  const total = points.reduce((sum, report) => sum + report.numbers.current.xp, 0);
  const bars = points.map((report) => {
    const xp = report.numbers.current.xp;
    const share = Math.max(6, Math.round((xp / max) * 100));
    return `<div class="velocity-col"><span class="velocity-value">${formatXp(xp)}</span>`
      + `<span class="velocity-bar${report === points.at(-1) ? " today" : ""}" style="height:${share}%" title="${escape(report.label)}: ${formatXp(xp)} XP"></span>`
      + `<span class="velocity-day">${escape(shortDate(report.start))}</span></div>`;
  }).join("");
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Velocity history</h2>'
    + `<span class="rail-aside">${plural(points.length, "report")}</span></div>`
    + `<div class="rail-body"><div class="velocity" role="img" aria-label="${formatXp(total)} XP across ${plural(points.length, "report")}">${bars}</div>`
    + `<p class="rail-note-sub">Avg ${formatXp(Math.round(total / points.length))} XP / report</p></div></section>`;
}

// The repositories a report cites, with how many of its units each contributed. A unit that left the ledger still has
// its key, so the repo is read from the leading owner/name of the key.
function syncSourcesCard(report, units) {
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  const repos = new Map();
  for (const unit of report.units) {
    const repo = byKey.get(unit.key)?.repo;
    if (!repo) continue;
    repos.set(repo, (repos.get(repo) ?? 0) + 1);
  }
  if (repos.size === 0) return "";
  const rows = [...repos].sort(([, a], [, b]) => b - a).map(([repo, count]) =>
    `<div class="source-row"><span class="source-name">${escape(repo)}</span><span class="source-count">${plural(count, "unit")}</span></div>`).join("");
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Sync sources</h2>'
    + `<span class="rail-aside">${formatXp(repos.size)} ${repos.size === 1 ? "repository" : "repositories"}</span></div>`
    + `<div class="rail-body"><div class="source-list">${rows}</div></div></section>`;
}


function integrityCard(report) {
  const row = (tone, text) => `<div class="check-row"><span class="status-dot ${tone}" aria-hidden="true"></span><span>${text}</span></div>`;
  const rows = [
    report.inProgress ? row("warn", "The period was not over when the report was written.") : row("good", "The period was complete."),
    report.stale ? row("warn", "The ledger changed since it was written.") : row("good", "The ledger matches the report."),
    report.failed > 0 ? row("warn", `${plural(report.failed, "unit")} failed to score.`) : row("good", "No unit failed to score."),
    report.omitted > 0 ? row("warn", `${plural(report.omitted, "unit")} left out as the least impactful.`) : row("good", "Every unit was read."),
    report.issues.length > 0 ? row("warn", `${plural(report.issues.length, "validator note")}.`) : row("good", "The validator dropped nothing."),
  ].join("");
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Report integrity</h2>'
    + `<span class="rail-aside">${report.stale || report.inProgress ? "check" : "verified"}</span></div>`
    + `<div class="rail-body"><div class="check-list">${rows}</div></div></section>`;
}

function unlockedCard(report) {
  if (report.unlocked.length === 0) return "";
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Unlocked this period</h2>'
    + `<span class="rail-aside">${formatXp(report.unlocked.length)}</span></div>`
    + `<div class="rail-body"><div class="unlock-list">${report.unlocked.map((label) => `<span class="unlock-chip">${escape(label)}</span>`).join("")}</div></div></section>`;
}

function reportsRail(report, reports, units) {
  return '<aside class="rail" aria-label="Report overview">'
    + latestFactsCard(report)
    + velocityHistoryCard(reports)
    + '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Report focus mix</h2>'
    + `<span class="rail-aside">${plural(report.units.filter((unit) => unit.xp > 0).length, "scored unit")}</span></div>`
    + `<div class="rail-body">${contributionMix(report.units)}</div></section>`
    + syncSourcesCard(report, units)
    + integrityCard(report)
    + unlockedCard(report)
    + "</aside>";
}

export function renderReports(model) {
  const { reports, units } = model;
  if (reports.length === 0) {
    return `<div class="screen reports-screen">${pageHead("Reports")}`
      + `${emptyPanel("No reports yet: <code>evolo report</code> writes one for this week.")}</div>`;
  }
  const [latest, ...archive] = reports;
  const known = new Set(units.map((unit) => unit.key));
  const archiveSection = archive.length === 0 ? "" : '<section class="archive" aria-label="Archived reports">'
    + '<div class="section-heading"><div><h2>Past &amp; archived reports</h2>'
    + `<p>Showing ${plural(archive.length, "earlier report")}</p></div>`
    + '<a class="panel-link" href="#/analytics">Open analytics</a></div>'
    + `<ul class="report-grid">${archive.map(reportCard).join("")}</ul></section>`;
  return `<div class="screen reports-screen">${pageHead("Reports", reportCount(reports), {
    status: syncStatus(model.generatedAt),
    meta: periodChip(latest.start, latest.end),
    note: `${formatXp(verifiedCount(reports))} verified · performance reviews written from the ledger and the stored code reviews`,
  })}`
    + `<div class="reports-hero-grid">${featuredReport(latest, known)}${reportsRail(latest, reports, units)}</div>`
    + archiveSection
    + "</div>";
}

// Why the report may not tell the whole story, each a notice above it; nothing when the report needs none.
function notices(report) {
  const notice = (text, bad = false) => `<p class="notice${bad ? " notice-bad" : ""}" role="${bad ? "alert" : "status"}">${text}</p>`;
  const again = report.again ? `: <code>${escape(report.again)}</code> writes it again` : "";
  const failed = report.failed === 1 ? "1 unit of this period failed" : `${formatXp(report.failed)} units of this period failed`;
  const omitted = report.omitted === 1 ? "1 more unit was" : `${formatXp(report.omitted)} more units were`;
  const shown = [
    report.inProgress ? notice(`The ${escape(report.kind)} was not over when this report was written.`) : "",
    report.stale ? notice(`The ledger changed since this report was written${again}.`) : "",
    report.failed > 0 ? notice(`${failed} to score and ${report.failed === 1 ? "is" : "are"} not in this report: <code>evolo retry</code> scores them again.`) : "",
    report.omitted > 0 ? notice(`${omitted} left out of what the writer read: the least impactful.`) : "",
    report.report.flags.includes("suspected_injection")
      ? notice(`The writer suspected prompt injection: ${escape(report.report.notes || "read the period's units with care")}`, true)
      : "",
  ].join("");
  return shown === "" ? "" : `<div class="report-notices">${shown}</div>`;
}

// XP and units against the previous period when it had units, as `evolo stats` compares them, and the level.
function reportFigures(report) {
  const { current, previous } = report.numbers;
  const before = previous.units > 0 ? previous : null;
  const versus = (now, then) => (before ? `${delta(now, then)} vs ${escape(before.label)}` : "");
  return '<div class="stat-grid report-figures">'
    + figure("XP", formatXp(current.xp), "", versus(current.xp, before?.xp))
    + figure("Units", formatXp(current.units), "", versus(current.units, before?.units))
    + figure("Level", formatXp(current.level), "", report.inProgress ? "when written" : "at the end of the period")
    + "</div>";
}

function highlightsPanel(report, known) {
  if (report.report.highlights.length === 0) return "";
  return panel("Highlights", "", highlightList(report, known));
}

function pointsPanel(title, report, points, known) {
  const items = points.map((point) =>
    `<li><p>${prose(point.text)}</p><span class="cites">${point.units.map((key) => citation(report, key, known)).join("")}</span></li>`);
  const body = items.length > 0 ? `<ul class="rows report-points">${items.join("")}</ul>` : '<p class="panel-body muted">None.</p>';
  return panel(title, "", body);
}

function validatorPanel(issues) {
  if (issues.length === 0) return "";
  return panel("Validator", "", `<ul class="bullets">${issues.map((issue) => `<li>${escape(issue)}</li>`).join("")}</ul>`);
}

function reportHero(report) {
  const { current } = report.numbers;
  return '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/reports">Reports</a><span aria-hidden="true">/</span>'
    + `<span>${escape(report.label)}</span></nav>`
    + '<header class="detail-hero report-hero">'
    + '<div class="detail-hero-main"><span class="featured-badge' + (report.stale || report.inProgress ? " warn" : "") + '">'
    + `<span class="status-dot ${report.stale || report.inProgress ? "warn" : "good"}" aria-hidden="true"></span>`
    + `${report.stale || report.inProgress ? "Report needs a check" : "Verified report"}</span>`
    + `<h1>${escape(report.label)}</h1>`
    + `<p class="detail-meta">${escape(reportMeta(report, { withTime: true }))}</p>`
    + `<div class="detail-pills">${reportPills(report)}</div></div>`
    + '<div class="award-panel"><span class="award-label">XP earned</span>'
    + `<strong class="award-value">${formatXp(current.xp)}</strong>`
    + `<span class="award-sub">${plural(current.units, "scored unit")} · Level ${formatXp(current.level)}</span></div>`
    + "</header>";
}

function reportRail(report, known, units) {
  const order = [...report.units].filter((unit) => unit.xp > 0).sort((a, b) => b.xp - a.xp).slice(0, 6);
  const cited = order.length === 0 ? '<p class="rail-empty">No scored unit is listed.</p>'
    : `<ul class="unit-cites">${topUnits(report, known, 6)}</ul>`;
  return '<aside class="rail" aria-label="Report details">'
    + latestFactsCard(report)
    + '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Units in the report</h2>'
    + `<span class="rail-aside">${plural(report.units.length, "listed unit")}</span></div>`
    + `<div class="rail-body">${cited}</div></section>`
    + '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Report focus mix</h2></div>'
    + `<div class="rail-body">${contributionMix(report.units)}</div></section>`
    + syncSourcesCard(report, units)
    + integrityCard(report)
    + unlockedCard(report)
    + "</aside>";
}

export function renderReport(model, id) {
  const report = model.reports.find((each) => each.id === id);
  if (!report) {
    return `<div class="screen reports-screen">${pageHead("Report")}`
      + `${emptyPanel("No saved report has this address.", '<a class="panel-link" href="#/reports">All reports</a>')}</div>`;
  }
  const known = new Set(model.units.map((unit) => unit.key));
  return `<div class="screen reports-screen">${reportHero(report)}`
    + notices(report)
    + '<div class="detail-layout">'
    + `<div class="report-main">${reportFigures(report)}`
    + panel("Overview", "", `<p class="panel-body">${prose(report.report.overview)}</p>`)
    + highlightsPanel(report, known)
    + '<div class="review-columns">'
    + pointsPanel("Strengths", report, report.report.strengths, known)
    + pointsPanel("Improvements", report, report.report.improvements, known)
    + "</div>"
    + validatorPanel(report.issues)
    + "</div>"
    + reportRail(report, known, model.units)
    + "</div></div>";
}
