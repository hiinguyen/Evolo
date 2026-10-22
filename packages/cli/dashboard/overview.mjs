// The Overview screen: level, recent XP, streak, the judge's spending, the queue, the achievements unlocked this week
// and the latest units. `badge` and `unitRow` are shared: the Achievements screen draws its tiles with `badge`, the
// Timeline its list with `unitRow`, and a unit's details its head with `unitWorth` and `unitType`. Every number is the
// model's; the only arithmetic is the width of the level bar.
import { escape, formatUsd, formatXp, hashOf, localDate, localTime, pageHead, plural } from "./html.mjs";

const LATEST_UNITS = 5;
// The strip of this week's achievements stops here; the Achievements screen has the rest.
const STRIP_BADGES = 10;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const numeral = (tier) => ROMAN[tier - 1] ?? String(tier);

// What a unit that is not worth XP shows in place of its XP. A failure is the user's to act on, so it stands out.
const STATUS_TEXT = { failed: "failed", push_failed: "push failed", reverted: "reverted", superseded: "superseded", needs_review: "needs review" };
const STATUS_BAD = new Set(["failed", "push_failed"]);

// An achievement's emblem: the numeral of `tier` (a star for a secret, a dash before the first tier), its name and one
// pip per tier, lit up to `tier`. `achievement` needs { name, description, tiers, hidden }. `details` is markup the
// caller built, put under the pips: the Achievements screen adds the description, the progress and the day.
export function badge(achievement, tier, details = "") {
  const tiers = achievement.tiers ?? [];
  const mark = achievement.hidden ? "★" : tier > 0 ? numeral(tier) : "–";
  const pips = tiers.map((_, index) => `<i class="pip${index < tier ? " on" : ""}"></i>`).join("");
  const progress = achievement.hidden ? "Secret" : `Tier ${tier} of ${tiers.length}`;
  return `<div class="badge${tier > 0 ? "" : " locked"}" title="${escape(achievement.description)}">`
    + `<span class="emblem" aria-hidden="true">${escape(mark)}</span>`
    + `<span class="badge-name">${escape(achievement.name)}</span>`
    + (tiers.length > 0 ? `<span class="pips" role="img" aria-label="${escape(progress)}">${pips}</span>` : "")
    + details
    + "</div>";
}

export const statusText = (status) => STATUS_TEXT[status] ?? status;

// The judge's contribution type, or for a unit never judged its kind (push or pr).
export const unitType = (unit) => unit.result?.evaluation?.contribution_type ?? unit.kind;

// A unit's XP, or its status when it is not worth any. A revert or a force push takes the XP of a scored unit away; the
// XP it was scored at stays in its result and is shown struck through, so the loss reads at a glance.
export function unitWorth(unit) {
  if (unit.status === "scored") return `<span class="unit-xp">+${formatXp(unit.xp)} XP</span>`;
  const pill = `<span class="pill${STATUS_BAD.has(unit.status) ? " pill-bad" : ""}">${escape(statusText(unit.status))}</span>`;
  if (unit.previousStatus !== "scored" || !(unit.result?.xp > 0)) return pill;
  return `<span class="unit-worth"><s class="unit-lost" title="No longer counted">+${formatXp(unit.result.xp)} XP</s>${pill}</span>`;
}

// One unit as a link to its details: label and summary, then repo, type and the local day it landed; XP on the right.
export function unitRow(unit) {
  return `<a class="unit-row" href="${escape(hashOf("unit", ...unit.key.split("/")))}">`
    + '<span class="unit-main">'
    + `<span class="unit-title"><span class="unit-label">${escape(unit.label)}</span>`
    + `<span class="unit-summary">${escape(unit.summary || unit.reason)}</span></span>`
    + `<span class="unit-meta">${escape(unit.repo)} · ${escape(unitType(unit))} · `
    + `<time datetime="${escape(unit.landedAt)}">${escape(localDate(unit.landedAt))}</time></span>`
    + "</span>"
    + unitWorth(unit)
    + "</a>";
}

function levelCard({ level, from, next, total }) {
  const share = Math.min(100, Math.max(0, Math.round(((total - from) / (next - from)) * 100)));
  return '<section class="panel level-card" aria-label="Level">'
    + `<div class="level-number"><span class="caption">Level</span><strong>${formatXp(level)}</strong></div>`
    + '<div class="level-progress">'
    + `<div class="level-line"><span class="level-total"><strong>${formatXp(total)}</strong> XP</span>`
    + `<span class="muted">${formatXp(next - total)} XP to level ${formatXp(level + 1)}</span></div>`
    + `<div class="meter" role="progressbar" aria-label="Progress to level ${formatXp(level + 1)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}">`
    + `<span style="width:${share}%"></span></div>`
    + `<div class="level-scale"><span>${formatXp(from)}</span><span>${formatXp(next)}</span></div>`
    + "</div></section>";
}

// One small card; `value` and `detail` are markup the caller built from formatted numbers.
const statCard = (label, value, unit, detail = "") =>
  `<div class="panel stat"><span class="stat-label">${label}</span>`
  + `<span class="stat-value">${value}${unit ? `<span class="stat-unit">${unit}</span>` : ""}</span>`
  + (detail ? `<span class="stat-detail">${detail}</span>` : "")
  + "</div>";

function statGrid({ recent, streak, budget, queue }) {
  const parked = queue.parked > 0 ? `${plural(queue.parked, "job")} waiting for tomorrow's budget` : "";
  return '<div class="stat-grid">'
    + statCard("Today", `+${formatXp(recent.today)}`, "XP")
    + statCard("Last 7 days", `+${formatXp(recent.week)}`, "XP")
    + statCard("Streak", formatXp(streak.current), streak.current === 1 ? "workday" : "workdays", `longest ${formatXp(streak.longest)}`)
    + statCard("Judge today", formatUsd(budget.spent), "", `of ${formatUsd(budget.limit)} daily limit`)
    + statCard("Queue", formatXp(queue.waiting), "waiting", parked)
    + "</div>";
}

// One entry per achievement, at the highest tier reached this week, where the achievement first comes in the model's
// order: two tiers of one achievement in a week are one step forward, not two badges.
function highestTiers(recent) {
  const highest = new Map();
  for (const entry of recent) {
    if (entry.tier > (highest.get(entry.id)?.tier ?? 0)) highest.set(entry.id, entry);
  }
  return [...highest.values()];
}

// The achievements that moved this week; a badge's pips come from its achievement in the catalog, a secret has one tier.
function unlockedStrip({ visible, recent }) {
  const shown = highestTiers(recent);
  if (shown.length === 0) return "";
  const tiersOf = (id) => visible.find((achievement) => achievement.id === id)?.tiers ?? [1];
  const badges = shown.slice(0, STRIP_BADGES).map((entry) => badge({ ...entry, tiers: tiersOf(entry.id) }, entry.tier)).join("");
  const more = shown.length > STRIP_BADGES ? `<a class="badges-more" href="#/achievements">+${formatXp(shown.length - STRIP_BADGES)} more</a>` : "";
  return '<section class="panel"><div class="panel-head"><h2>Unlocked this week</h2>'
    + `<span class="muted">${plural(shown.length, "achievement")}</span></div>`
    + `<div class="panel-body badges">${badges}</div>${more}</section>`;
}

function latestUnits(units) {
  const rows = units.slice(0, LATEST_UNITS).map((unit) => `<li>${unitRow(unit)}</li>`).join("");
  return '<section class="panel list-panel"><div class="panel-head"><h2>Latest units</h2>'
    + '<a class="panel-link" href="#/timeline">All units</a></div>'
    + `<ul class="unit-list">${rows}</ul></section>`;
}

const overviewFoot = (generatedAt) =>
  `<p class="page-foot">Generated <time datetime="${escape(generatedAt)}">${escape(localTime(generatedAt))}</time> · updates after each scored unit</p>`;

export function renderOverview(model) {
  const head = pageHead("Overview");
  if (model.units.length === 0) {
    return `<div class="screen">${head}<section class="panel empty"><p>No scored units yet: push to the default branch `
      + "or merge a PR in a repository set up with <code>evolo init</code>.</p></section>"
      + `${overviewFoot(model.generatedAt)}</div>`;
  }
  return `<div class="screen">${head}`
    + `<div class="overview-top">${levelCard(model.level)}${statGrid(model)}</div>`
    + unlockedStrip(model.achievements)
    + latestUnits(model.units)
    + `${overviewFoot(model.generatedAt)}</div>`;
}
