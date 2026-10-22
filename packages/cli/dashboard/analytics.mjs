// The Analytics screen (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): what `evolo stats`
// prints for a week, a month or a quarter, this one or the one before, drawn as cards and charts. Every number is the
// model's computeStats; the only arithmetic is scaling bars and the change from the previous period, the subtraction
// views.mjs's formatStats does, under the same rule: a change is shown only against a previous period with units.
import { escape, formatUsd, formatXp, hashOf, pageHead, plural } from "./html.mjs";
import { barChart, hBars, strip } from "./charts.mjs";
import { emptyPanel, panel, RUBRIC_MAX, sentenceCase } from "./unit.mjs";

const PERIOD_NAMES = { week: "Week", month: "Month", quarter: "Quarter" };
// Repositories and directories shown, as many as `evolo stats` prints.
const TOP_ROWS = 5;
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_NAMES = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

// "+550", "-0.4": `now` against `before` with `digits` decimals, signed as formatStats signs it.
function delta(now, before, digits = 0) {
  const size = Number(Math.abs(now - before).toFixed(digits));
  const sign = now < before && size !== 0 ? "-" : "+";
  const tone = size === 0 ? "flat" : sign === "-" ? "down" : "up";
  return `<span class="delta delta-${tone}">${sign}${digits === 0 ? formatXp(size) : size.toFixed(digits)}</span>`;
}

// The two choices as links that keep the other one, so each period has its own address and Back returns to the last.
function periodSwitch(kind, which) {
  const segment = (href, label, open) => `<a class="segment" href="${escape(href)}"${open ? ' aria-current="page"' : ""}>${label}</a>`;
  const kinds = Object.entries(PERIOD_NAMES).map(([name, label]) => segment(hashOf("analytics", name, which), label, name === kind));
  const noun = PERIOD_NAMES[kind].toLowerCase();
  const whiches = [["current", `This ${noun}`], ["previous", `Previous ${noun}`]]
    .map(([name, label]) => segment(hashOf("analytics", kind, name), label, name === which));
  return '<nav class="period-switch" aria-label="Period">'
    + `<div class="segmented">${kinds.join("")}</div><div class="segmented">${whiches.join("")}</div></nav>`;
}

// One figure; `value`, `unit` and `detail` are markup the caller built from formatted numbers.
const figure = (label, value, unit = "", detail = "") =>
  `<div class="panel stat"><span class="stat-label">${label}</span>`
  + `<span class="stat-value">${value}${unit ? `<span class="stat-unit">${unit}</span>` : ""}</span>`
  + (detail ? `<span class="stat-detail">${detail}</span>` : "")
  + "</div>";

// XP, units, the level at the period's end, the judge's cost, test discipline and reverts. `before` is the previous
// period when it has units, else null; the tests share is compared only when the previous period had units to share.
function figures(stats, before, which, previous) {
  const versus = (now, then, unit = "") => (before ? `${delta(now, then)}${unit} vs ${escape(before.period.label)}` : "");
  const { tests, reverts } = stats;
  const share = (part, whole) => Math.round((part / whole) * 100);
  const testsBefore = previous?.tests.eligible > 0 ? previous.tests : null;
  const testsFigure = tests.eligible === 0
    ? figure("Tests", "0", "units", "with code in a repository with tests")
    : figure("Tests", formatXp(tests.touched), `of ${plural(tests.eligible, "unit")}`,
      `with code touched tests (${share(tests.touched, tests.eligible)}%)`
      + (testsBefore ? ` · ${delta(share(tests.touched, tests.eligible), share(testsBefore.touched, testsBefore.eligible))} pts` : ""));
  return '<div class="stat-grid analytics-figures">'
    + figure("XP", formatXp(stats.xp), "", versus(stats.xp, before?.xp))
    + figure("Units", formatXp(stats.units), "", versus(stats.units, before?.units))
    + figure("Level", formatXp(stats.level), "", which === "current" ? "as of today" : "at the end of the period")
    + figure("Judge cost", formatUsd(stats.costUsd))
    + testsFigure
    + figure("Reverted", formatXp(reverts.reverted), `of ${plural(reverts.total, "unit")}`)
    + "</div>";
}

function dayPanel(days) {
  const points = days.map(({ day, xp }) => ({ label: day, value: xp }));
  return panel("XP by day", plural(days.length, "day"), `<div class="panel-body">${barChart(points, { label: "XP by day" })}</div>`);
}

function typesPanel(types) {
  const most = Math.max(0, ...types.map((type) => type.xp));
  const rows = types.map(({ type, units, xp }) => ({ label: type, value: xp, max: most, note: `${plural(units, "unit")} · ${formatXp(xp)} XP` }));
  return panel("Types", "", `<div class="panel-body">${hBars(rows)}</div>`);
}

// Each criterion's average this period, its bar out of 4, and the previous period's average and the change when the
// previous period has judged units.
function averagesPanel(criteria, rubric, rubricBefore) {
  const aside = plural(rubric.n, "judged unit") + (rubricBefore ? ` vs ${formatXp(rubricBefore.n)}` : "");
  if (rubric.n === 0) return panel("Rubric", aside, '<p class="panel-body muted">No units scored by the judge.</p>');
  const previousHead = rubricBefore ? '<th scope="col" class="num">Previous</th><th scope="col" class="num">Change</th>' : "";
  const rows = criteria.map((criterion) => {
    const average = rubric.averages[criterion];
    const share = Math.min(100, Math.max(0, (average / RUBRIC_MAX) * 100));
    const before = rubricBefore ? rubricBefore.averages[criterion] : null;
    return `<tr><th scope="row">${escape(sentenceCase(criterion))}</th>`
      + `<td class="average-bar"><span class="score-bar" role="img" aria-label="${escape(average.toFixed(1))} of ${RUBRIC_MAX}">`
      + `<span style="width:${share}%"></span></span></td>`
      + `<td class="num average">${escape(average.toFixed(1))}</td>`
      + (before === null ? "" : `<td class="num muted">${escape(before.toFixed(1))}</td><td class="num">${delta(average, before, 1)}</td>`)
      + "</tr>";
  }).join("");
  return panel("Rubric", aside, '<table class="averages"><thead><tr><th scope="col">Criterion</th>'
    + `<th scope="col" colspan="2">Average</th>${previousHead}</tr></thead><tbody>${rows}</tbody></table>`);
}

// The first rows of a list `evolo stats` cuts at TOP_ROWS, and how many there are when some are left out.
const topAside = (rows) => (rows.length > TOP_ROWS ? `top ${TOP_ROWS} of ${formatXp(rows.length)}` : "");

function reposPanel(repos) {
  const shown = repos.slice(0, TOP_ROWS);
  const most = Math.max(0, ...shown.map((repo) => repo.xp));
  const rows = shown.map(({ repo, units, xp }) => ({ label: repo, value: xp, max: most, note: `${plural(units, "unit")} · ${formatXp(xp)} XP` }));
  return panel("Repositories", topAside(repos), `<div class="panel-body">${hBars(rows)}</div>`);
}

// A directory under its repository's name, as `evolo stats` names it; the root of a repository is the name alone.
const dirLabel = ({ repo, dir }) => {
  const name = String(repo).split("/").at(-1);
  return dir === "." ? name : `${name}/${dir}`;
};

function dirsPanel(dirs) {
  if (dirs.length === 0) return panel("Directories", "", '<p class="panel-body muted">No source or test lines changed.</p>');
  const shown = dirs.slice(0, TOP_ROWS);
  const most = Math.max(0, ...shown.map((dir) => dir.lines));
  const rows = shown.map((dir) => ({ label: dirLabel(dir), value: dir.lines, max: most, note: plural(dir.lines, "line") }));
  return panel("Directories", topAside(dirs), `<div class="panel-body">${hBars(rows)}</div>`);
}

function rhythmPanel(hours, weekdays) {
  const block = (title, body) => `<div class="rhythm-block"><h3>${title}</h3>${body}</div>`;
  return panel("Commits", "local time", '<div class="panel-body rhythm">'
    + block("By hour", strip(hours, HOUR_NAMES, { label: "Commits by hour" }))
    + block("By weekday", strip(weekdays, WEEKDAY_NAMES, { label: "Commits by weekday" }))
    + "</div>");
}

export function renderAnalytics(model, kind, which) {
  const { current, previous } = model.periods[kind];
  const stats = which === "previous" ? previous : current;
  // The model holds two periods: the current one is compared with the previous, the previous one with nothing.
  const compared = which === "current" ? previous : null;
  const head = pageHead("Analytics", stats.period.label) + periodSwitch(kind, which);
  if (stats.units === 0) return `<div class="screen">${head}${emptyPanel(`Nothing landed in ${escape(stats.period.label)}.`)}</div>`;
  const before = compared?.units > 0 ? compared : null;
  const rubricBefore = compared?.rubric.n > 0 ? compared.rubric : null;
  return `<div class="screen">${head}`
    + figures(stats, before, which, compared)
    + dayPanel(stats.days)
    + `<div class="analytics-pair">${typesPanel(stats.types)}${averagesPanel(model.criteria, stats.rubric, rubricBefore)}</div>`
    + `<div class="analytics-pair">${reposPanel(stats.repos)}${dirsPanel(stats.dirs)}</div>`
    + rhythmPanel(stats.hours, stats.weekdays)
    + "</div>";
}
