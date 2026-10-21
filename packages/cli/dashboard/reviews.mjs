// The Reviews screen (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): every code review, newest
// first as the model holds them, one card each, linking to the Review tab of its unit. The severity filter lives in the
// address (#/reviews?severity=high) as a row of links, so Back undoes it; it keeps the reviews with at least one
// finding of that severity. Counting findings by severity is display work: the reviews themselves are the model's.
import { escape, formatXp, hashOf, localDate, pageHead, plural } from "./html.mjs";
import { emptyPanel, FINDING_ORDER, severityOf } from "./unit.mjs";

const SEVERITY_NAMES = { high: "High", medium: "Medium", low: "Low" };

const reviewsHash = (severity) => (severity ? `#/reviews?${new URLSearchParams({ severity })}` : "#/reviews");

// The severity `query` filters by, or "" for none: a value that is not a severity is no filter, like a missing one.
const severityFilter = (query) => (FINDING_ORDER.includes(query.severity) ? query.severity : "");

// How many findings of each severity a review has, keyed by severity.
function severityCounts(stored) {
  const severities = (stored.review.findings ?? []).map(severityOf);
  return Object.fromEntries(FINDING_ORDER.map((severity) => [severity, severities.filter((each) => each === severity).length]));
}

// The reviews with at least one finding of `severity`, in their order; all of them for no severity. A new array.
const filterReviews = (reviews, severity) => (severity ? reviews.filter((stored) => severityCounts(stored)[severity] > 0) : reviews);

function severitySwitch(open) {
  const segment = (severity, label) =>
    `<a class="segment" href="${escape(reviewsHash(severity))}"${severity === open ? ' aria-current="page"' : ""}>${label}</a>`;
  const segments = [segment("", "All"), ...FINDING_ORDER.map((severity) => segment(severity, SEVERITY_NAMES[severity]))];
  return `<nav class="severity-switch" aria-label="Severity"><div class="segmented">${segments.join("")}</div></nav>`;
}

// One pill per severity found, the most severe first; a review with none says so.
function findingPills(stored) {
  const counts = severityCounts(stored);
  const pills = FINDING_ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => `<span class="pill sev-${severity}">${formatXp(counts[severity])} ${severity}</span>`);
  return `<span class="review-counts">${pills.length > 0 ? pills.join("") : '<span class="pill">No findings</span>'}</span>`;
}

function reviewCard(stored) {
  return `<li><a class="review-card" href="${escape(hashOf("unit", ...stored.key.split("/"), "review"))}">`
    + `<span class="review-head"><span class="review-title"><span class="review-label">${escape(stored.label)}</span>`
    + `<time datetime="${escape(stored.at)}">${escape(localDate(stored.at))}</time></span>`
    + `<span class="review-meta">${escape(stored.repo)} · ${escape(stored.language)}</span></span>`
    + `<p class="review-overview">${escape(stored.review.overview)}</p>`
    + findingPills(stored)
    + "</a></li>";
}

function reviewList(shown, severity) {
  if (shown.length === 0) {
    return `<section class="panel empty"><p>No review has a ${escape(severity)} finding.</p>`
      + '<p><a class="panel-link" href="#/reviews">Show all reviews</a></p></section>';
  }
  return `<ul class="review-grid">${shown.map(reviewCard).join("")}</ul>`;
}

export function renderReviews(model, query) {
  const { reviews } = model;
  if (reviews.length === 0) {
    return `<div class="screen">${pageHead("Reviews")}`
      + `${emptyPanel("No reviews yet: <code>evolo review</code> writes one for the latest unit.")}</div>`;
  }
  const severity = severityFilter(query);
  const shown = filterReviews(reviews, severity);
  const count = severity ? `${formatXp(shown.length)} of ${plural(reviews.length, "review")}` : plural(reviews.length, "review");
  return `<div class="screen">${pageHead("Reviews", count)}${severitySwitch(severity)}${reviewList(shown, severity)}</div>`;
}
