// The dashboard's charts (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 8): columns of XP by day,
// horizontal bars, and a strip of cells for the hours of the day or the days of the week. They only draw: every value
// comes from the model, and the one arithmetic here is scaling a value to the chart. Colours are CSS variables set on
// the classes, so the charts follow the light or dark theme.
import { escape, formatXp, plural } from "./html.mjs";

// The columns' drawing box. The SVG keeps this shape and scales with the width of its panel, so the axis labels are
// HTML beside it and stay at the size of the page's text.
const CHART_WIDTH = 720;
const CHART_HEIGHT = 200;
// A column takes this share of its slot, but stays thin when a short period leaves each slot wide.
const BAR_SHARE = 0.6;
const BAR_MAX = 24;
const BAR_RADIUS = 3;
// A strip cell's shade: 0 for none, then four steps up to the busiest.
const STRIP_LEVELS = 4;
// A strip with more cells than this labels every sixth cell only.
const STRIP_ALL_LABELS = 12;

const round2 = (value) => Math.round(value * 100) / 100;

// "XP by day: 21 days from 2026-10-01 to 2026-10-21, most 300 XP on 2026-10-08".
function chartSummary(points, label, unit, most) {
  if (points.length === 0) return `${label}: no days`;
  const first = points[0].label;
  const last = points.at(-1).label;
  const range = points.length === 1 ? `1 day, ${first}` : `${plural(points.length, "day")} from ${first} to ${last}`;
  const peak = most > 0 ? `most ${formatXp(most)} ${unit} on ${points.find((point) => point.value === most).label}` : `no ${unit}`;
  return `${label}: ${range}, ${peak}`;
}

// One column per point, the largest value up to the top. A column is rounded at the top only: it runs `radius` past
// the bottom of the drawing, where the SVG cuts it off. Each column's slot is a hover target that carries its title,
// the browser's own tooltip, so a thin column is easy to point at.
export function barChart(points, { label, unit = "XP" }) {
  const most = Math.max(0, ...points.map((point) => point.value));
  const slot = CHART_WIDTH / Math.max(points.length, 1);
  const width = Math.min(slot * BAR_SHARE, BAR_MAX);
  const radius = Math.min(BAR_RADIUS, width / 2);
  const columns = points.map((point, index) => {
    const height = most > 0 ? (point.value / most) * CHART_HEIGHT : 0;
    const drawn = height > 0 ? height + radius : 0;
    return `<g class="column"><title>${escape(point.label)}: ${formatXp(point.value)} ${escape(unit)}</title>`
      + `<rect class="column-hit" x="${round2(index * slot)}" y="0" width="${round2(slot)}" height="${CHART_HEIGHT}"/>`
      + `<rect class="bar" x="${round2(index * slot + (slot - width) / 2)}" y="${round2(CHART_HEIGHT - height)}" `
      + `width="${round2(width)}" height="${round2(drawn)}" rx="${round2(radius)}"/></g>`;
  }).join("");
  const scale = most > 0 ? `<span>${formatXp(most)}</span><span>0</span>` : "<span></span><span>0</span>";
  const ends = points.length === 0 ? "" : [points[0], ...(points.length > 1 ? [points.at(-1)] : [])]
    .map((point) => `<span>${escape(point.label)}</span>`).join("");
  return '<div class="chart">'
    + `<div class="chart-scale" aria-hidden="true">${scale}</div>`
    + `<svg class="chart-plot" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escape(chartSummary(points, label, unit, most))}">`
    + `<line class="chart-grid" x1="0" y1="${CHART_HEIGHT / 2}" x2="${CHART_WIDTH}" y2="${CHART_HEIGHT / 2}"/>${columns}</svg>`
    + `<div class="chart-ends" aria-hidden="true">${ends}</div>`
    + "</div>";
}

// Rows of a label and a note over a bar; `value` of `max` sets the bar's length. `rows: [{ label, value, max, note }]`.
// A label too long for its line is cut with an ellipsis and kept whole in its tooltip.
export function hBars(rows) {
  const items = rows.map(({ label, value, max, note }) => {
    const share = max > 0 ? round2(Math.min(100, Math.max(0, (value / max) * 100))) : 0;
    return '<li class="hbar">'
      + `<span class="hbar-label" title="${escape(label)}">${escape(label)}</span><span class="hbar-note">${escape(note)}</span>`
      + `<span class="hbar-track"><span style="width:${share}%"></span></span></li>`;
  }).join("");
  return `<ul class="hbars">${items}</ul>`;
}

// One cell per value, shaded by its share of the busiest, its label and count in its tooltip; the labels run under the
// cells. `label` names the strip for a screen reader, which hears every label and count.
export function strip(values, labels, { label, unit = "commit" }) {
  const most = Math.max(0, ...values);
  const level = (value) => (value > 0 && most > 0 ? Math.max(1, Math.ceil((value / most) * STRIP_LEVELS)) : 0);
  const cells = values.map((value, index) =>
    `<span class="cell level-${level(value)}" title="${escape(labels[index])}: ${escape(plural(value, unit))}"></span>`).join("");
  const marks = labels.map((mark) => `<span>${escape(mark)}</span>`).join("");
  const summary = values.map((value, index) => `${labels[index]} ${value}`).join(", ");
  return `<div class="strip${values.length > STRIP_ALL_LABELS ? " strip-dense" : ""}" role="img" aria-label="${escape(`${label}: ${summary}`)}">`
    + `<div class="strip-cells">${cells}</div><div class="strip-labels">${marks}</div></div>`;
}
