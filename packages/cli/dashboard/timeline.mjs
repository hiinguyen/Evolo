// The Timeline screen: every unit, newest first, in day groups, with a search box and three filters. The filters live
// in the address (#/timeline?q=...&repo=...&type=...&status=...), so a filtered list can be bookmarked and Back undoes a
// filter; app.mjs turns a change of a field into a new address. Filtering only reads values the model holds.
import { emptyPanel, escape, formatXp, localDate, plural } from "./html.mjs";
import { activityCard, statusText, unitType } from "./overview.mjs";

// Each filter: the query key, the label over its select, the option for no filter, and the value of a unit it compares.
const FILTERS = [
  { name: "repo", label: "Repository", all: "All repositories", of: (unit) => unit.repo, text: (value) => value },
  { name: "type", label: "Type", all: "All types", of: unitType, text: (value) => value },
  { name: "status", label: "Status", all: "All statuses", of: (unit) => unit.status, text: statusText },
];

// The day of a unit in the reader's zone, and that day written out for its marker: "2026-10-21" and "October 21, 2026".
function localDayOf(iso) {
  const day = localDate(iso);
  const [year, month, date] = day.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(date)) return { day, text: day };
  const text = new Date(year, month - 1, date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return { day, text };
}

// The units the search text of `query` matches: all of the words in it, in any order, across what a card shows and the
// commits and PR title behind it. A search with no words matches every unit.
function searchMatches(unit, query) {
  const words = String(query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const facts = unit.result?.facts;
  const text = [
    unit.label, unit.repo, unit.id, unit.summary, unit.reason, unitType(unit), unit.status,
    ...(facts?.pr ? [facts.pr.title] : []),
    ...(facts?.commits ?? []).map((commit) => commit.subject),
  ].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

// The units equal to every filter `query` sets and matching its search, in their order. A new array; the units are not
// changed.
export function filterUnits(units, query) {
  const active = activeFilters(query);
  return units.filter((unit) => active.every((filter) => filter.of(unit) === query[filter.name]) && searchMatches(unit, query));
}

// The filters `query` sets: a missing or empty value is no filter, and a key that is not a filter is ignored.
const activeFilters = (query) => FILTERS.filter((filter) => typeof query[filter.name] === "string" && query[filter.name] !== "");

const hasSearch = (query) => typeof query.q === "string" && query.q.trim() !== "";

// "#/timeline?q=fix&repo=me%2Fa&status=scored": the address of the filters in `values`, without the ones left empty.
export function timelineHash(values) {
  const set = [...FILTERS.map((filter) => [filter.name, values[filter.name]]), ["q", values.q]]
    .filter(([, value]) => typeof value === "string" && value !== "");
  return set.length === 0 ? "#/timeline" : `#/timeline?${new URLSearchParams(set)}`;
}

// The select of one filter: its values found in the units, sorted, and the chosen one even when no unit has it any more
// (an old bookmark), so the select always shows what filters the list.
function filterSelect(filter, units, chosen = "") {
  const found = new Set(units.map(filter.of).filter((value) => typeof value === "string" && value !== ""));
  if (chosen !== "") found.add(chosen);
  const option = (value, text) => `<option value="${escape(value)}"${value === chosen ? " selected" : ""}>${escape(text)}</option>`;
  const options = [...found].sort().map((value) => option(value, filter.text(value))).join("");
  return `<label class="filter"><span class="filter-label">${filter.label}</span>`
    + `<select name="${filter.name}" data-filter aria-label="${filter.label}">${option("", filter.all)}${options}</select></label>`;
}

const searchIcon = '<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

// The search field remembers the text of the address, so Back after a search shows what was searched for.
const searchField = (query) =>
  `<label class="search-field"><span class="filter-label">Search</span>${searchIcon}`
  + `<input type="search" name="q" data-filter value="${escape(query.q ?? "")}" placeholder="Search commits, PRs, tags..." aria-label="Search units"></label>`;

// Submitting is never needed, a change of a field is enough, so the form has no button.
const filterForm = (units, query) =>
  `<form class="filters" aria-label="Filter units">${searchField(query)}${FILTERS.map((filter) => filterSelect(filter, units, query[filter.name] ?? "")).join("")}</form>`;

// The count beside the title, and the filters, in the page's sticky head.
function timelineHead(units, shown, query) {
  const filtered = activeFilters(query).length > 0 || hasSearch(query);
  const count = filtered ? `${formatXp(shown.length)} of ${plural(units.length, "recorded unit")}` : plural(units.length, "recorded unit");
  return `<header class="page-head timeline-head"><div class="head-title"><h1>Timeline</h1>`
    + `<span class="head-count">${count}</span></div>${filterForm(units, query)}</header>`;
}

// The units split into runs of one local day, in their order: [{ day, text, units }].
function dayGroups(units) {
  const groups = [];
  for (const unit of units) {
    const day = localDayOf(unit.landedAt);
    const last = groups.at(-1);
    if (last?.day === day.day) last.units.push(unit);
    else groups.push({ ...day, units: [unit] });
  }
  return groups;
}

function timelineGroup(group) {
  const heading = group.day === "" ? "Unknown day" : group.text;
  const updates = group.units.length > 1 ? `<span class="day-count">(${formatXp(group.units.length)} updates)</span>` : "";
  return '<section class="timeline-group" aria-label="' + escape(heading) + '">'
    + '<div class="timeline-day"><span class="day-marker">' + escape(group.day.slice(8)) + "</span>"
    + `<h2>${escape(heading)}</h2>${updates}<span class="day-rule" aria-hidden="true"></span></div>`
    + `<div class="timeline-cards">${group.units.map(activityCard).join("")}</div>`
    + "</section>";
}

function unitList(shown) {
  if (shown.length === 0) {
    return emptyPanel("No units match these filters.", '<a class="panel-link" href="#/timeline">Clear filters</a>');
  }
  return dayGroups(shown).map(timelineGroup).join("");
}

export function renderTimeline(model, query) {
  const { units } = model;
  if (units.length === 0) {
    return '<div class="screen">'
      + '<header class="page-head"><div class="head-title"><h1>Timeline</h1></div></header>'
      + `${emptyPanel("No units yet: push to the default branch or merge a PR in a repository set up with <code>evolo init</code>.")}</div>`;
  }
  const shown = filterUnits(units, query);
  return `<div class="screen timeline-screen">${timelineHead(units, shown, query)}${unitList(shown)}</div>`;
}
