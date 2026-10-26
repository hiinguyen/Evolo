// The Reviews screen (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): every code review, newest
// first as the model holds them, one card each, linking to the Review tab of its unit. Severity, search and order live in
// the address (#/reviews?severity=high&q=time&sort=findings), so Back undoes them; the severity links keep the search
// and order they were used with. Counting findings and joining a review to the unit it read are display work: the
// reviews themselves are the model's.
import { emptyPanel, escape, formatDuration, formatUsd, formatXp, hashOf, localDate, pageHead, periodChip, plural, syncStatus } from "./html.mjs";
import { isBadStatus, statusText } from "./overview.mjs";
import { FINDING_ORDER, severityOf } from "./unit.mjs";

const SEVERITY_NAMES = { high: "High", medium: "Medium", low: "Low" };
const SORT_NAMES = { new: "Newest first", old: "Oldest first", findings: "Most findings", xp: "Highest XP" };

// The ways a review list can be ordered, the first when the address says nothing or something unknown.
const orderOf = (query) => (Object.hasOwn(SORT_NAMES, query.sort) ? query.sort : "new");

// The severity `query` filters by, or "" for none: a value that is not a severity is no filter, like a missing one.
const severityFilter = (query) => (FINDING_ORDER.includes(query.severity) ? query.severity : "");

// "#/reviews?severity=high&q=time&sort=findings": only the values that differ from the screen's defaults.
export function reviewsHash(values = {}) {
  const set = [
    ["severity", severityFilter(values)],
    ["sort", orderOf(values) === "new" ? "" : orderOf(values)],
    ["q", typeof values.q === "string" ? values.q : ""],
  ].filter(([, value]) => value !== "");
  return set.length === 0 ? "#/reviews" : `#/reviews?${new URLSearchParams(set)}`;
}

// How many findings of each severity a review has, keyed by severity.
function severityCounts(stored) {
  const severities = (stored.review.findings ?? []).map(severityOf);
  return Object.fromEntries(FINDING_ORDER.map((severity) => [severity, severities.filter((each) => each === severity).length]));
}

const findingsOf = (stored) => stored.review.findings ?? [];
const findingsTotal = (stored) => findingsOf(stored).length;

// Every word of the search must appear in what a card shows or the review behind it: the unit, the repository, the
// writer's overview, strengths and improvements, and each finding's title, category, location and detail.
function matchesSearch(stored, text) {
  const words = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const { review } = stored;
  const haystack = [
    stored.label, stored.repo, stored.unitId, stored.language,
    review.overview,
    ...(review.strengths ?? []),
    ...(review.improvements ?? []),
    ...findingsOf(stored).flatMap((finding) => [finding.severity, finding.category, finding.location, finding.title, finding.detail, finding.suggestion]),
  ].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// The reviews that pass every filter, in the order the address asks for. A new array; the reviews are not changed.
export function filterReviews(reviews, query = {}) {
  const severity = severityFilter(query);
  const shown = reviews.filter((stored) =>
    (!severity || severityCounts(stored)[severity] > 0) && matchesSearch(stored, query.q));
  const newest = (a, b) => Date.parse(b.at) - Date.parse(a.at);
  const order = orderOf(query);
  if (order === "old") return shown.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (order === "findings") return shown.sort((a, b) => findingsTotal(b) - findingsTotal(a) || newest(a, b));
  if (order === "xp") return shown.sort((a, b) => (b.xp ?? -1) - (a.xp ?? -1) || newest(a, b));
  // The model is already newest first; keeping its order also keeps the fixtures and the page in agreement.
  return shown;
}

// How many reviews carry at least one finding of each severity, with the total under "All": the counts on the
// segmented filter. A review with two mediums counts once, because the filter looks at the review, not the finding.
function filterCounts(reviews) {
  const counts = { "": reviews.length };
  for (const severity of FINDING_ORDER) {
    counts[severity] = reviews.filter((stored) => severityCounts(stored)[severity] > 0).length;
  }
  return counts;
}

function severitySwitch(open, query, reviews) {
  const counts = filterCounts(reviews);
  const segment = (severity, label) => {
    const count = counts[severity] ?? 0;
    return `<a class="segment" href="${escape(reviewsHash({ ...query, severity }))}"${severity === open ? ' aria-current="page"' : ""}>`
      + `${label}<span class="segment-count">${formatXp(count)}</span></a>`;
  };
  const segments = [segment("", "All"), ...FINDING_ORDER.map((severity) => segment(severity, SEVERITY_NAMES[severity]))];
  return `<nav class="severity-switch" aria-label="Severity"><div class="segmented">${segments.join("")}</div></nav>`;
}

const reviewSearchIcon = '<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

// The search and order that a change of the form writes to the address; app.mjs reads `data-screen` to pick the hash.
function reviewFilters(query) {
  const option = (value, text) => `<option value="${value}"${value === orderOf(query) ? " selected" : ""}>${text}</option>`;
  const severity = severityFilter(query);
  return '<form class="filters reviews-filters" data-screen="reviews" aria-label="Filter reviews">'
    + (severity ? `<input type="hidden" name="severity" data-filter value="${escape(severity)}">` : "")
    + '<label class="search-field"><span class="filter-label">Search</span>' + reviewSearchIcon
    + `<input type="search" name="q" data-filter value="${escape(query.q ?? "")}" placeholder="Search reviews, findings, repos..." aria-label="Search reviews"></label>`
    + '<label class="filter"><span class="filter-label">Order</span>'
    + `<select name="sort" data-filter aria-label="Order reviews">${Object.entries(SORT_NAMES).map(([value, text]) => option(value, text)).join("")}</select></label>`
    + "</form>";
}

// The tone of the unit's kind, as the Timeline draws it.
const kindTone = (stored) => (stored.kind === "pr" ? "violet" : stored.kind === "push" ? "cyan" : "slate");

// One pill per severity found, the most severe first; a review with none says so.
function findingPills(stored) {
  const counts = severityCounts(stored);
  const pills = FINDING_ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => `<span class="pill sev-${severity}">${formatXp(counts[severity])} ${severity}</span>`);
  return `<span class="review-counts">${pills.length > 0 ? pills.join("") : '<span class="pill">No findings</span>'}</span>`;
}

// The first two findings as a short list, so the card says what the review is about before it is opened.
function findingPreview(stored) {
  const sorted = [...findingsOf(stored)].sort((a, b) => FINDING_ORDER.indexOf(severityOf(a)) - FINDING_ORDER.indexOf(severityOf(b)));
  const shown = sorted.slice(0, 2);
  if (shown.length === 0) return "";
  const more = sorted.length > shown.length ? `<span class="finding-more">+${formatXp(sorted.length - shown.length)} more</span>` : "";
  return '<div class="review-findings">'
    + shown.map((finding) =>
      `<div class="preview-finding"><span class="sev-dot sev-${severityOf(finding)}" aria-hidden="true"></span>`
      + `<span class="preview-category">${escape(finding.category)}</span>`
      + `<span class="preview-title">${escape(finding.title)}</span></div>`).join("")
    + more + "</div>";
}

const xpOf = (stored) => {
  if (stored.status && stored.status !== "scored") {
    return `<span class="pill review-state${isBadStatus(stored.status) ? " pill-bad" : ""}">${escape(statusText(stored.status))}</span>`;
  }
  return stored.xp === null || stored.xp === undefined ? "" : `<span class="review-xp">+${formatXp(stored.xp)} XP</span>`;
};

function reviewCard(stored) {
  const judge = stored.judge?.model ?? stored.judge?.backend;
  const meta = [
    stored.language ? `<span class="review-lang">${escape(stored.language)}</span>` : "",
    judge ? `<span class="review-judge">${escape(judge)}${stored.costUsd ? ` · ${formatUsd(stored.costUsd)}` : ""}</span>` : "",
    stored.durationMs ? `<span class="review-duration">${escape(formatDuration(stored.durationMs))}</span>` : "",
  ].filter(Boolean).join('<span class="review-sep" aria-hidden="true">•</span>');
  return `<li><a class="review-card" href="${escape(hashOf("unit", ...stored.key.split("/"), "review"))}">`
    + '<div class="review-head">'
    + '<div class="review-meta-line">'
    + `<span class="review-label tone-${kindTone(stored)}">${escape(stored.label)}</span>`
    + `<span class="review-repo">${escape(stored.repo)}</span>`
    + '<span class="review-sep" aria-hidden="true">•</span>'
    + `<time datetime="${escape(stored.at)}">${escape(localDate(stored.at))}</time>`
    + (meta ? `<span class="review-sep" aria-hidden="true">•</span>${meta}` : "")
    + "</div>"
    + xpOf(stored)
    + "</div>"
    + `<p class="review-overview">${escape(stored.review.overview)}</p>`
    + findingPreview(stored)
    + '<div class="review-foot">' + findingPills(stored)
    + (stored.status === "scored" ? '<span class="review-state-note"><span class="status-dot good" aria-hidden="true"></span>Reviewed &amp; scored</span>' : "")
    + '<span class="review-open">View diff details <span aria-hidden="true">→</span></span></div>'
    + "</a></li>";
}

function reviewList(shown, query) {
  const severity = severityFilter(query);
  if (shown.length === 0) {
    if (severity) return emptyPanel(`No review has a ${escape(severity)} finding.`, '<a class="panel-link" href="#/reviews">Show all reviews</a>');
    return emptyPanel("No review matches this search.", '<a class="panel-link" href="#/reviews">Clear filters</a>');
  }
  return `<ul class="review-feed">${shown.map(reviewCard).join("")}</ul>`;
}

// The numbers a rail can tell from the whole set, not just the filtered list: severity totals, review time, spend, and
// how much of the ledger has been reviewed.
function reviewStats(reviews, units) {
  const findings = reviews.flatMap(findingsOf);
  const severities = Object.fromEntries(FINDING_ORDER.map((severity) => [severity, findings.filter((finding) => severityOf(finding) === severity).length]));
  const withFindings = reviews.filter((stored) => findingsTotal(stored) > 0).length;
  const durations = reviews.map((stored) => stored.durationMs).filter((value) => Number.isFinite(value) && value > 0);
  const cost = reviews.reduce((sum, stored) => sum + (stored.costUsd ?? 0), 0);
  const averageDuration = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
  const reviewed = new Set(reviews.map((stored) => stored.key));
  return {
    findings, severities, withFindings, averageDuration, cost,
    reviews: reviews.length,
    reviewed: units.filter((unit) => reviewed.has(unit.key)).length,
  };
}

const mini = (label, value) => `<div class="mini"><span class="mini-label">${label}</span><strong class="mini-value">${value}</strong></div>`;

function healthCard(stats) {
  const severityRows = FINDING_ORDER.map((severity) => {
    const count = stats.severities[severity];
    const share = stats.findings.length > 0 ? (count / stats.findings.length) * 100 : 0;
    return `<div class="sev-row"><span class="sev-dot sev-${severity}" aria-hidden="true"></span><span class="sev-name">${SEVERITY_NAMES[severity]}</span>`
      + `<span class="sev-track"><span class="sev-fill sev-${severity}" style="width:${share}%"></span></span>`
      + `<span class="sev-count">${formatXp(count)}</span></div>`;
  }).join("");
  const clean = stats.reviews - stats.withFindings;
  const cleanShare = stats.reviews > 0 ? Math.round((clean / stats.reviews) * 100) : 0;
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Review insights &amp; health</h2>'
    + `<span class="rail-aside">${plural(stats.findings.length, "finding")}</span></div>`
    + '<div class="rail-body">'
    + '<div class="health-hero">'
    + `<div class="health-ring" style="--share:${cleanShare}" role="img" aria-label="${cleanShare}% of reviews have no findings"><span>${cleanShare}%</span></div>`
    + `<div class="health-copy"><span class="health-label">Clean reviews</span><strong>${formatXp(clean)} of ${formatXp(stats.reviews)}</strong>`
    + '<span class="health-note">reviews written without a finding</span></div>'
    + "</div>"
    + '<div class="mini-grid">'
    + mini("Reviews", formatXp(stats.reviews))
    + mini("With findings", `${formatXp(stats.withFindings)} / ${formatXp(stats.reviews)}`)
    + mini("Avg review", stats.averageDuration === null ? "—" : escape(formatDuration(stats.averageDuration)))
    + mini("Judge spend", formatUsd(stats.cost))
    + "</div>"
    + (stats.findings.length > 0 ? `<div class="sev-list">${severityRows}</div>` : '<p class="rail-empty">No findings yet.</p>')
    + "</div></section>";
}

function categoryCard(reviews) {
  const counts = new Map();
  const findings = reviews.flatMap(findingsOf);
  for (const finding of findings) {
    const category = String(finding.category || "uncategorized");
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const ranked = [...counts].sort(([, a], [, b]) => b - a).slice(0, 6);
  const max = Math.max(1, ...ranked.map(([, count]) => count));
  const rows = ranked.map(([category, count]) =>
    `<div class="cat-row"><span class="cat-name">${escape(category)}</span>`
    + `<span class="cat-track"><span class="cat-fill" style="width:${Math.round((count / max) * 100)}%"></span></span>`
    + `<span class="cat-count">${formatXp(count)}</span></div>`).join("");
  const severities = Object.fromEntries(FINDING_ORDER.map((severity) => [severity, findings.filter((finding) => severityOf(finding) === severity).length]));
  const total = findings.length;
  const stack = total === 0 ? "" : FINDING_ORDER.map((severity) => {
    const share = (severities[severity] / total) * 100;
    return `<span class="mix-seg sev-fill sev-${severity}" style="width:${share}%"></span>`;
  }).join("");
  const legend = FINDING_ORDER.map((severity) =>
    `<span class="sev-legend"><span class="sev-dot sev-${severity}" aria-hidden="true"></span>${SEVERITY_NAMES[severity]} <strong>${formatXp(severities[severity])}</strong></span>`).join("");
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Finding breakdown</h2>'
    + `<span class="rail-aside">${plural(total, "flag")}</span></div>`
    + '<div class="rail-body">'
    + (total > 0 ? `<div class="mix-bar" aria-hidden="true">${stack}</div><div class="sev-legend-row">${legend}</div>` : "")
    + `${rows ? `<div class="cat-list">${rows}</div>` : '<p class="rail-empty">No findings yet.</p>'}</div></section>`;
}

// The findings worth opening first, the most severe and then the newest, each a link to the review that explains it.
// This is the Reviews screen's version of the mock's "actionable tasks": Evolo does not invent XP rewards for them.
function actionableCard(reviews) {
  const rows = reviews
    .flatMap((stored) => findingsOf(stored).map((finding) => ({ stored, finding })))
    .sort((a, b) => severityRank(severityOf(a.finding)) - severityRank(severityOf(b.finding))
      || Date.parse(b.stored.at) - Date.parse(a.stored.at))
    .slice(0, 4);
  if (rows.length === 0) return "";
  const items = rows.map(({ stored, finding }) => {
    const severity = severityOf(finding);
    return `<li><a class="action-item" href="${escape(hashOf("unit", ...stored.key.split("/"), "review"))}">`
      + `<span class="action-head"><span class="pill sev-${severity}">${escape(finding.severity)}</span>`
      + `<span class="action-unit">${escape(stored.label)}</span></span>`
      + `<span class="action-title">${escape(finding.title)}</span>`
      + `<span class="action-meta">${escape(finding.category)}${finding.location ? ` · <code>${escape(finding.location)}</code>` : ""}</span>`
      + "</a></li>";
  }).join("");
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Actionable findings</h2>'
    + `<span class="rail-aside">${plural(rows.length, "task")}</span></div>`
    + `<div class="rail-body"><ul class="action-list">${items}</ul></div></section>`;
}

const severityRank = (value) => (FINDING_ORDER.includes(value) ? FINDING_ORDER.indexOf(value) : FINDING_ORDER.length);

function coverageCard(reviews, units, stats) {
  const total = units.length;
  const share = total > 0 ? Math.round((stats.reviewed / total) * 100) : 0;
  const judges = new Map();
  for (const stored of reviews) {
    const name = stored.judge?.model ?? stored.judge?.backend ?? "unknown judge";
    const entry = judges.get(name) ?? { count: 0, cost: 0 };
    judges.set(name, { count: entry.count + 1, cost: entry.cost + (stored.costUsd ?? 0) });
  }
  const rows = [...judges].sort(([, a], [, b]) => b.count - a.count).map(([name, entry]) =>
    `<div class="judge-row"><span class="judge-name">${escape(name)}</span><span class="judge-count">${plural(entry.count, "review")}</span>`
    + `<span class="judge-cost">${formatUsd(entry.cost)}</span></div>`).join("");
  return '<section class="panel rail-card"><div class="rail-head"><h2 class="rail-title">Coverage &amp; judges</h2>'
    + `<span class="rail-aside">${share}%</span></div>`
    + '<div class="rail-body">'
    + `<p class="coverage-line"><strong>${formatXp(stats.reviewed)}</strong> of ${plural(total, "unit")} reviewed</p>`
    + `<div class="coverage-bar" role="img" aria-label="${share}% of units reviewed"><span style="width:${share}%"></span></div>`
    + (rows ? `<div class="judge-list">${rows}</div>` : "")
    + "</div></section>";
}

function reviewRail(model) {
  const stats = reviewStats(model.reviews, model.units);
  return '<aside class="rail" aria-label="Review overview">'
    + healthCard(stats)
    + categoryCard(model.reviews)
    + actionableCard(model.reviews)
    + coverageCard(model.reviews, model.units, stats)
    + "</aside>";
}

export function renderReviews(model, query = {}) {
  const { reviews } = model;
  if (reviews.length === 0) {
    return `<div class="screen reviews-screen">${pageHead("Reviews")}`
      + `${emptyPanel("No reviews yet: <code>evolo review</code> writes one for the latest unit.")}</div>`;
  }
  const shown = filterReviews(reviews, query);
  const count = shown.length === reviews.length ? plural(reviews.length, "review") : `${formatXp(shown.length)} of ${plural(reviews.length, "review")}`;
  const week = model.periods?.week?.current?.period;
  return `<div class="screen reviews-screen">${pageHead("Reviews", count, {
    status: syncStatus(model.generatedAt),
    meta: week ? periodChip(week.start, week.end) : "",
  })}`
    + `<div class="reviews-toolbar">${reviewFilters(query)}${severitySwitch(severityFilter(query), query, reviews)}</div>`
    + `<div class="reviews-grid"><div class="review-main">${reviewList(shown, query)}</div>${reviewRail(model)}</div>`
    + "</div>";
}
