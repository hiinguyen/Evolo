// The Reports screen (docs/superpowers/specs/2026-10-22-evolo-report-design.md section 9): every saved performance
// review, the latest period first as the model holds them, one card each; and one review in full, its highlights and
// every citation a link to the unit it names. The numbers are the ones saved with the report, as `evolo report` prints
// them; whether the ledger changed since is the model's `stale`.
import { escape, formatUsd, formatXp, hashOf, localDate, localTime, pageHead } from "./html.mjs";
import { delta, figure } from "./analytics.mjs";
import { emptyPanel, panel } from "./unit.mjs";

const KIND_NAMES = { week: "Week", month: "Month", quarter: "Quarter" };

// The writer's words as markup: escaped first, then each `inline code` span, which the prompt asks for around technical
// names, drawn as code. Escaping leaves backticks alone, so a span can only wrap text that is already safe.
const prose = (text) => escape(text).replace(/`([^`]+)`/g, "<code>$1</code>");

// "#/reports/week/2026-10-19".
const reportHash = (report) => hashOf("reports", ...report.id.split("/"));
const unitHash = (key) => hashOf("unit", ...key.split("/"));

// The pills of a report written before its period ended, or from data that changed since.
function reportPills(report) {
  const pills = [
    ...(report.inProgress ? ['<span class="pill">In progress</span>'] : []),
    ...(report.stale ? ['<span class="pill sev-medium">Stale</span>'] : []),
  ];
  return pills.length > 0 ? `<span class="report-pills">${pills.join("")}</span>` : "";
}

function reportCard(report) {
  return `<li><a class="report-card" href="${escape(reportHash(report))}">`
    + `<span class="report-head"><span class="report-label">${escape(report.label)}</span>`
    + `<span class="report-meta">${escape(KIND_NAMES[report.kind] ?? report.kind)} · ${escape(report.language)} · written `
    + `<time datetime="${escape(report.at)}">${escape(localDate(report.at))}</time></span></span>`
    + `<p class="report-overview">${prose(report.report.overview)}</p>`
    + reportPills(report)
    + "</a></li>";
}

export function renderReports(model) {
  const { reports } = model;
  if (reports.length === 0) {
    return `<div class="screen">${pageHead("Reports")}`
      + `${emptyPanel("No reports yet: <code>evolo report</code> writes one for this week.")}</div>`;
  }
  const count = `${formatXp(reports.length)} ${reports.length === 1 ? "report" : "reports"}`;
  return `<div class="screen">${pageHead("Reports", count)}<ul class="report-grid">${reports.map(reportCard).join("")}</ul></div>`;
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

// A unit the report names: a link to its Score tab while the model still has it, else its label as plain text.
function citation(report, key, known) {
  const label = report.units.find((unit) => unit.key === key)?.label ?? key;
  return known.has(key) ? `<a class="cite" href="${escape(unitHash(key))}">${escape(label)}</a>` : `<span class="cite">${escape(label)}</span>`;
}

function highlightsPanel(report, known) {
  if (report.report.highlights.length === 0) return "";
  const rows = report.report.highlights.map(({ unit, text }) => {
    const saved = report.units.find((each) => each.key === unit);
    const worth = saved ? `<span class="highlight-worth">${formatXp(saved.xp)} XP${saved.type ? ` · ${escape(saved.type)}` : ""}</span>` : "";
    return `<li class="highlight"><span class="highlight-head">${citation(report, unit, known)}${worth}</span><p>${prose(text)}</p></li>`;
  });
  return panel("Highlights", "", `<ul class="rows">${rows.join("")}</ul>`);
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

export function renderReport(model, id) {
  const report = model.reports.find((each) => each.id === id);
  if (!report) {
    return `<div class="screen">${pageHead("Report")}`
      + `${emptyPanel('No saved report has this address. <a class="panel-link" href="#/reports">All reports</a>')}</div>`;
  }
  const known = new Set(model.units.map((unit) => unit.key));
  const judge = report.judge?.model ?? report.judge?.backend;
  const written = [`Written ${localTime(report.at)} in ${report.language}`, judge, report.costUsd ? formatUsd(report.costUsd) : ""]
    .filter(Boolean).join(" · ");
  return `<div class="screen">${pageHead(report.label, written)}`
    + '<p><a class="panel-link" href="#/reports">All reports</a></p>'
    + notices(report)
    + reportFigures(report)
    + panel("Overview", "", `<p class="panel-body">${prose(report.report.overview)}</p>`)
    + highlightsPanel(report, known)
    + '<div class="review-columns">'
    + pointsPanel("Strengths", report, report.report.strengths, known)
    + pointsPanel("Improvements", report, report.report.improvements, known)
    + "</div>"
    + validatorPanel(report.issues)
    + "</div>";
}
