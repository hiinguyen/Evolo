// The Timeline screen: every unit, newest first, including the ones not worth XP, with three filters. The filters live
// in the address (#/timeline?repo=...&type=...&status=...), so a filtered list can be bookmarked and Back undoes a
// filter; app.mjs turns a change of a select into a new address. Filtering only compares values the model holds.
import { escape, formatXp, pageHead, plural } from "./html.mjs";
import { statusText, unitRow, unitType } from "./overview.mjs";

// Each filter: the query key, the label over its select, the option for no filter, and the value of a unit it compares.
const FILTERS = [
  { name: "repo", label: "Repository", all: "All repositories", of: (unit) => unit.repo, text: (value) => value },
  { name: "type", label: "Type", all: "All types", of: unitType, text: (value) => value },
  { name: "status", label: "Status", all: "All statuses", of: (unit) => unit.status, text: statusText },
];

// The filters `query` sets: a missing or empty value is no filter, and a key that is not a filter is ignored.
const activeFilters = (query) => FILTERS.filter((filter) => typeof query[filter.name] === "string" && query[filter.name] !== "");

// The units equal to every filter `query` sets, in their order. A new array; the units are not changed.
export function filterUnits(units, query) {
  const active = activeFilters(query);
  return units.filter((unit) => active.every((filter) => filter.of(unit) === query[filter.name]));
}

// "#/timeline?repo=me%2Fa&status=scored": the address of the filters in `values`, without the ones left empty.
export function timelineHash(values) {
  const set = FILTERS.map((filter) => [filter.name, values[filter.name]]).filter(([, value]) => typeof value === "string" && value !== "");
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
    + `<select name="${filter.name}" data-filter>${option("", filter.all)}${options}</select></label>`;
}

// Submitting is never needed, a change of a select is enough, so the form has no button.
const filterForm = (units, query) =>
  `<form class="filters" aria-label="Filter units">${FILTERS.map((filter) => filterSelect(filter, units, query[filter.name] ?? "")).join("")}</form>`;

function unitList(shown) {
  if (shown.length === 0) {
    return '<section class="panel empty"><p>No units match these filters.</p>'
      + '<p><a class="panel-link" href="#/timeline">Clear filters</a></p></section>';
  }
  return `<section class="panel list-panel"><ul class="unit-list">${shown.map((unit) => `<li>${unitRow(unit)}</li>`).join("")}</ul></section>`;
}

export function renderTimeline(model, query) {
  const { units } = model;
  if (units.length === 0) {
    return `<div class="screen">${pageHead("Timeline")}<section class="panel empty"><p>No units yet: push to the default `
      + "branch or merge a PR in a repository set up with <code>evolo init</code>.</p></section></div>";
  }
  const shown = filterUnits(units, query);
  const count = activeFilters(query).length === 0 ? plural(units.length, "unit") : `${formatXp(shown.length)} of ${plural(units.length, "unit")}`;
  return `<div class="screen">${pageHead("Timeline", count)}${filterForm(units, query)}${unitList(shown)}</div>`;
}
