// The Overview screen: the rank and level, the day's numbers, the latest units, and a rail of what the week looks
// like. `badge` is shared with the Achievements screen; the Timeline draws its cards with `activityCard`, which lives
// here beside the unit facts they both show. Every number is the model's; the only arithmetic is a bar's width, a
// percentage of a total, and the seven days of XP a sparkline draws.
import { emptyPanel, escape, formatUsd, formatXp, hashOf, localDate, pageHead, periodChip, plural, syncStatus } from "./html.mjs";
import { achievementEmblem, secretEmblem } from "./icons.mjs";
import { rankClasses } from "./theme.mjs";

const LATEST_UNITS = 12;
// The feed shows five at a time; the rest of the page's short list waits behind the tabs.
const FEED_UNITS = 5;
// The rail has room for four badges; the Achievements screen has the rest.
const RAIL_BADGES = 4;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const numeral = (tier) => ROMAN[tier - 1] ?? String(tier);

// What a unit that is not worth XP shows in place of its XP. A failure is the user's to act on, so it stands out.
const STATUS_TEXT = { failed: "failed", push_failed: "push failed", reverted: "reverted", superseded: "superseded", needs_review: "needs review" };
const BAD_STATUS = new Set(["failed", "push_failed"]);

// A failure is the user's to act on, so its status stands out wherever a unit is drawn.
export const isBadStatus = (status) => BAD_STATUS.has(status);

// An achievement's emblem: the framed drawing it wears on the Achievements screen, with the numeral of `tier` in a small
// corner chip once a tier is reached (a found secret brings its own unframed drawing; an achievement without a
// drawing keeps its numeral), its name and one pip per tier, lit up to `tier`. `achievement` needs
// { id, name, description, tiers, hidden } and, for a secret, `icon`. `details` is markup the caller built, put under
// the pips: the Achievements screen adds the description, the progress and the day.
export function badge(achievement, tier, details = "") {
  const tiers = achievement.tiers ?? [];
  const mark = achievement.hidden ? "★" : tier > 0 ? numeral(tier) : "–";
  const art = achievement.hidden ? secretEmblem(achievement.icon) : achievementEmblem(achievement.id);
  const emblem = art
    ? `${art}${!achievement.hidden && tier > 0 ? `<span class="emblem-tier">${escape(mark)}</span>` : ""}`
    : escape(mark);
  const pips = tiers.map((_, index) => `<i class="pip${index < tier ? " on" : ""}"></i>`).join("");
  const progress = achievement.hidden ? "Secret" : `Tier ${tier} of ${tiers.length}`;
  return `<div class="badge${tier > 0 ? "" : " locked"}" title="${escape(achievement.description)}">`
    + `<span class="emblem" aria-hidden="true">${emblem}</span>`
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
  const pill = `<span class="pill${isBadStatus(unit.status) ? " pill-bad" : ""}">${escape(statusText(unit.status))}</span>`;
  if (unit.previousStatus !== "scored" || !(unit.result?.xp > 0)) return pill;
  return `<span class="unit-worth"><s class="unit-lost" title="No longer counted">+${formatXp(unit.result.xp)} XP</s>${pill}</span>`;
}

// The tone of a type chip, by the judge's contribution type. Anything else reads in the neutral slate. Shared with the
// Timeline, whose cards use the same vocabulary.
const TYPE_TONES = {
  feature: "emerald",
  bugfix: "amber",
  docs: "blue",
  chore: "slate",
  infra: "sky",
  refactor: "violet",
  perf: "orange",
  test: "teal",
};

// The tone class of a contribution type, shared with the unit hero.
export const typeTone = (type) => TYPE_TONES[type] ?? "slate";

const TYPE_FILLS = {
  feature: "feature",
  bugfix: "bugfix",
  docs: "docs",
  chore: "chore",
  infra: "infra",
  refactor: "refactor",
  perf: "perf",
  test: "test",
};

// The fill class of a contribution type, shared with the Reports screen's mix bars.
export const typeFill = (type) => TYPE_FILLS[type] ?? "chore";

// A conventional-commit prefix ("feat(ui): ", "fix!: ") is noise once the subject is the card's title.
const TITLE_PREFIX = /^[a-z]+(?:\([^)]*\))?!?:\s*/i;

const titleOf = (unit) => {
  const facts = unit.result?.facts;
  const subject = facts?.pr?.title || facts?.commits?.at(-1)?.subject || "";
  const cleaned = String(subject).replace(TITLE_PREFIX, "").trim();
  if (cleaned !== "") return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return unit.summary || unit.reason || unit.label;
};

// A unit's title is its PR title or last commit subject, without the conventional-commit prefix; a unit with neither
// falls back to the judge's summary, then to its label. The unit's details use the same words as its card.
export const unitTitle = titleOf;

// The judge's summary under the title, unless it only repeats the title.
const descriptionOf = (unit, title) => {
  const summary = unit.summary || unit.reason || "";
  return summary.toLowerCase() === title.toLowerCase() ? "" : summary;
};

// The glyph on the kind chip: a branch for a PR, an alert for a bugfix PR, an arrow for a push.
function kindIcon(unit, type) {
  if (unit.kind === "pr" && type === "bugfix") {
    return '<svg class="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  }
  if (unit.kind === "pr") {
    return '<svg class="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11M14 3l4 4-4 4M17 17H6M10 21l-4-4 4-4"/></svg>';
  }
  return '<svg class="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
}

const stateChip = (unit) =>
  unit.status === "scored" ? "" : `<span class="pill activity-state${isBadStatus(unit.status) ? " pill-bad" : ""}">${escape(statusText(unit.status))}</span>`;

// What the card shows in place of XP: the XP it lost, struck through, or the zero a unit never scored at.
function worthOf(unit) {
  if (unit.status === "scored") return `<span class="activity-xp">+${formatXp(unit.xp)} XP</span>`;
  const lost = unit.previousStatus === "scored" && unit.result?.xp > 0;
  return lost
    ? `<s class="unit-lost activity-lost" title="No longer counted">+${formatXp(unit.result.xp)} XP</s>`
    : '<span class="activity-lost">0 XP</span>';
}

// One unit as an activity card: what it is and where, its title and the judge's summary, then XP and the day it landed.
// The Timeline groups these cards by day; the Overview puts the newest dozen in a feed, five visible at a time, and
// `order` lets the browser put them back after sorting by XP.
export function activityCard(unit, order = null) {
  const type = unitType(unit);
  const tone = typeTone(type);
  const kindTone = unit.kind === "pr" ? (type === "bugfix" ? "amber" : "violet") : "cyan";
  const title = titleOf(unit);
  const description = descriptionOf(unit, title);
  const feedData = ` data-kind="${escape(unit.kind)}" data-xp="${escape(unit.xp ?? 0)}"`
    + (order === null ? "" : ` data-order="${order}"`);
  return `<a class="activity-card" data-status="${escape(unit.status)}"${feedData} href="${escape(hashOf("unit", ...unit.key.split("/")))}">`
    + '<div class="activity-main">'
    + '<div class="activity-meta">'
    + `<span class="activity-kind tone-${kindTone}">${kindIcon(unit, type)}${escape(unit.label)}</span>`
    + `<span class="activity-repo">${escape(unit.repo)}</span>`
    + '<span class="activity-dot" aria-hidden="true">•</span>'
    + `<span class="activity-type type-${tone}">${escape(type)}</span>`
    + stateChip(unit)
    + "</div>"
    + `<h3 class="activity-title">${escape(title)}</h3>`
    + (description ? `<p class="activity-desc">${escape(description)}</p>` : "")
    + "</div>"
    + `<div class="activity-side">${worthOf(unit)}<time class="activity-date" datetime="${escape(unit.landedAt)}">${escape(localDate(unit.landedAt))}</time></div>`
    + "</a>";
}

// A local calendar day as "2026-10-21", so a unit and a run of days compare as text.
const padDay = (value) => String(value).padStart(2, "0");
const localDay = (date) => `${date.getFullYear()}-${padDay(date.getMonth() + 1)}-${padDay(date.getDate())}`;

// The last `count` local days with the XP that landed on each, oldest first; the day's short name for the sparkline.
function lastDays(units, now, count) {
  const end = new Date(now);
  const days = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - back);
    const day = localDay(date);
    const xp = units.filter((unit) => localDate(unit.landedAt) === day).reduce((sum, unit) => sum + Number(unit.xp || 0), 0);
    days.push({ day, xp, name: date.toLocaleDateString("en-US", { weekday: "short" }) });
  }
  return days;
}

// The rank, the level and the two ends of the level in one banner: the page's one hero.
function rankHero(model) {
  const { level, from, next, total } = model.level;
  const share = Math.min(100, Math.max(0, Math.round(((total - from) / (next - from)) * 100)));
  const rank = model.rank ?? { name: "", effect: "muted" };
  const nextRank = model.nextRank;
  const milestone = nextRank
    ? `<span class="hero-next-label">Next rank milestone:</span> <strong>${escape(nextRank.name)}</strong>`
      + ` <span class="hero-next-meta">Level ${formatXp(nextRank.level)} · ${formatXp(Math.max(0, nextRank.xp - total))} XP away</span>`
    : '<span class="hero-next-label">Top rank reached:</span> <strong>Legend</strong> <span class="hero-next-meta">the ladder is open ended</span>';
  return '<section class="panel rank-hero level-card" aria-label="Level">'
    + '<div class="hero-orbit hero-orbit-a" aria-hidden="true"></div><div class="hero-orbit hero-orbit-b" aria-hidden="true"></div>'
    + '<div class="hero-top">'
    + '<div class="hero-rank"><span class="eyebrow">Current rank</span>'
    + `<div class="hero-rank-line"><h2 class="level-rank ${rankClasses(rank)}">${escape(rank.name)}</h2>`
    + `<span class="level-pill">Level ${formatXp(level)}</span></div></div>`
    + `<div class="hero-xp"><strong>${formatXp(total)}</strong><span class="hero-xp-unit">XP</span>`
    + `<span class="hero-xp-next">${formatXp(next - total)} XP to level ${formatXp(level + 1)}</span></div>`
    + "</div>"
    + '<div class="hero-progress">'
    + `<div class="meter hero-meter" role="progressbar" aria-label="Progress to level ${formatXp(level + 1)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}">`
    + `<span style="width:${share}%"></span></div>`
    + `<div class="hero-scale"><span>${formatXp(from)} XP <span class="muted">(Level ${formatXp(level)} start)</span></span>`
    + `<span class="hero-percent">${share}% Complete</span>`
    + `<span>${formatXp(next)} XP <span class="muted">(Level ${formatXp(level + 1)} target)</span></span></div>`
    + "</div>"
    + `<div class="hero-foot"><span class="hero-next"><span class="status-dot" aria-hidden="true"></span>${milestone}</span>`
    + '<a class="panel-link" href="#/achievements">Achievements</a></div>'
    + "</section>";
}

const sparkBars = (days, max) => {
  const top = Math.max(1, max);
  return days.map((day) => {
    const share = Math.max(6, Math.round((day.xp / top) * 100));
    return `<span class="spark-bar" style="height:${share}%" title="${escape(day.name)} ${formatXp(day.xp)} XP"></span>`;
  }).join("");
};

const flame = '<svg class="kpi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c.8 2.4 3.8 4.1 3.8 7.4A3.8 3.8 0 0 1 12 14.2a3.8 3.8 0 0 1-3.8-3.8c0-1.4.7-2.5 1.5-3.3C10.5 6 11.5 4.7 12 3Z"/><path d="M8.5 13.2c-1.1 1-1.8 2.3-1.8 3.7A5.3 5.3 0 0 0 12 22a5.3 5.3 0 0 0 5.3-5.1c0-1.9-1-3.5-2.4-4.6"/></svg>';

// A KPI card: one label and badge, one big value, and a footer the caller built.
function kpiCard({ label, badge: badgeText = "", tone = "", value, unit, foot, visual = "", icon = "" }) {
  return '<div class="panel kpi">'
    + `<div class="kpi-head"><span class="kpi-label">${label}</span>${badgeText ? `<span class="kpi-badge ${tone}">${badgeText}</span>` : ""}${icon}</div>`
    + `<div class="kpi-value">${value}${unit ? `<span class="kpi-unit">${unit}</span>` : ""}</div>`
    + (visual ? `<div class="kpi-visual">${visual}</div>` : "")
    + `<div class="kpi-foot">${foot}</div>`
    + "</div>";
}

function statGrid(model) {
  const { recent, streak, budget, queue } = model;
  const now = new Date(model.generatedAt);
  const days = lastDays(model.units, now, 7);
  const weekUnits = model.units.filter((unit) => {
    const landed = new Date(unit.landedAt);
    return landed.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  });
  const today = localDay(now);
  const todayUnits = model.units.filter((unit) => unit.status === "scored" && localDate(unit.landedAt) === today).length;
  const yesterday = days.at(-2)?.xp;
  const delta = yesterday === undefined ? null : recent.today - yesterday;
  const deltaBadge = delta === null ? "" : delta === 0 ? "±0 vs yest." : `${delta > 0 ? "+" : "−"}${formatXp(Math.abs(delta))} vs yest.`;
  const deltaTone = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const budgetShare = budget.limit > 0 ? Math.min(100, Math.max(0, Math.round((budget.spent / budget.limit) * 100))) : 0;
  const parked = queue.parked > 0 ? `${plural(queue.parked, "job")} waiting for tomorrow's budget` : "";
  const queueFoot = queue.waiting === 0
    ? '<span class="status-dot good" aria-hidden="true"></span>Queue clear · ready for the next push'
    : `<span class="status-dot warn" aria-hidden="true"></span>${plural(queue.waiting, "job")} waiting to be scored`;
  return '<section class="kpi-grid" aria-label="Today at a glance">'
    + kpiCard({
      label: "Today", badge: deltaBadge, tone: deltaTone,
      value: `+${formatXp(recent.today)}`, unit: "XP",
      foot: `<span class="status-dot good" aria-hidden="true"></span>${plural(todayUnits, "scored unit")} logged`,
      visual: `<div class="spark" aria-hidden="true">${sparkBars(days, Math.max(...days.map((day) => day.xp)))}</div>`,
    })
    + kpiCard({
      label: "Last 7 days", badge: plural(weekUnits.length, "unit"), tone: "accent",
      value: `+${formatXp(recent.week)}`, unit: "XP",
      foot: `<span class="status-dot" aria-hidden="true"></span>${plural(weekUnits.filter((unit) => unit.status === "scored").length, "scored unit")} across seven days`,
      visual: `<div class="spark" aria-hidden="true">${sparkBars(days, Math.max(...days.map((day) => day.xp)))}</div>`,
    })
    + kpiCard({
      label: "Streak", icon: `<span class="kpi-flame">${flame}</span>`,
      value: formatXp(streak.current), unit: streak.current === 1 ? "workday" : "workdays",
      foot: `longest streak: <strong>${formatXp(streak.longest)}</strong>`,
    })
    + kpiCard({
      label: "Judge today", badge: budget.limit > 0 ? `${budgetShare}%` : "",
      value: formatUsd(budget.spent), unit: "",
      foot: `of ${formatUsd(budget.limit)} daily limit`,
      visual: `<div class="kpi-meter" role="img" aria-label="${budgetShare}% of the daily judge budget"><span style="width:${budgetShare}%"></span></div>`,
    })
    + kpiCard({
      label: "Queue", badge: queue.waiting === 0 ? "idle" : "queued", tone: queue.waiting === 0 ? "up" : "warn",
      value: formatXp(queue.waiting), unit: "waiting",
      foot: queueFoot + (parked ? ` · ${parked}` : ""),
    })
    + "</section>";
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

// The achievements that moved this week, at their highest tier; a badge's pips come from its achievement in the
// catalog, a secret has one tier.
function railBadges({ visible, recent }) {
  const shown = highestTiers(recent);
  if (shown.length === 0) return '<p class="rail-empty">No achievement moved this week.</p>';
  const tiersOf = (id) => visible.find((achievement) => achievement.id === id)?.tiers ?? [1];
  const badges = shown.slice(0, RAIL_BADGES).map((entry) => badge({ ...entry, tiers: tiersOf(entry.id) }, entry.tier)).join("");
  const more = shown.length > RAIL_BADGES
    ? `<a class="rail-more" href="#/achievements">+${formatXp(shown.length - RAIL_BADGES)} more this week</a>` : "";
  return `<div class="badges rail-badges">${badges}</div>${more}`;
}

// The share of XP that each type earned this week, the largest first; the tail is folded into "Other". The stacked
// bar carries the shape and the chips name each part, as the mock's Overview does.
function typeMix(types) {
  const total = types.reduce((sum, type) => sum + type.xp, 0);
  if (total === 0) return '<p class="rail-empty">No scored units this week yet.</p>';
  const ranked = [...types].sort((a, b) => b.xp - a.xp);
  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  const others = rest.reduce((sum, type) => sum + type.xp, 0);
  const rows = [
    ...top.map((type) => ({ name: type.type, xp: type.xp, units: type.units })),
    ...(others > 0 ? [{ name: "other", xp: others, units: rest.reduce((sum, type) => sum + type.units, 0) }] : []),
  ];
  const stack = rows.map((row) => {
    const share = (row.xp / total) * 100;
    return `<span class="mix-seg fill-${typeFill(row.name)}" style="width:${share}%" title="${escape(row.name)} ${Math.round(share)}%"></span>`;
  }).join("");
  const chips = rows.map((row) => {
    const share = Math.round((row.xp / total) * 100);
    return `<div class="mix-chip" title="${plural(row.units, "unit")}">`
      + `<span class="mix-dot fill-${typeFill(row.name)}" aria-hidden="true"></span>`
      + `<span class="mix-name">${escape(row.name)}</span><span class="mix-value">${share}%</span>`
      + `<span class="mix-units">${plural(row.units, "unit")}</span></div>`;
  }).join("");
  return `<div class="mix-bar" aria-hidden="true">${stack}</div><div class="mix-chips">${chips}</div>`;
}

// The seven days of the last week as bars, with the total, the average workday and the best day under them.
function velocity(units, now, previousXp = 0) {
  const days = lastDays(units, now, 7);
  const max = Math.max(...days.map((day) => day.xp));
  const total = days.reduce((sum, day) => sum + day.xp, 0);
  if (max === 0) return '<p class="rail-empty">No scored units in the last seven days.</p>';
  const bars = days.map((day) => {
    const share = Math.max(4, Math.round((day.xp / max) * 100));
    return `<div class="velocity-col"><span class="velocity-value">${formatXp(day.xp)}</span>`
      + `<span class="velocity-bar${day.day === localDay(now) ? " today" : ""}" style="height:${share}%" title="${escape(day.name)} ${formatXp(day.xp)} XP"></span>`
      + `<span class="velocity-day">${escape(day.name.slice(0, 1))}</span></div>`;
  }).join("");
  const best = days.reduce((a, b) => (b.xp > a.xp ? b : a));
  const average = Math.round(total / 5);
  const change = previousXp > 0 ? Math.round(((total - previousXp) / previousXp) * 100) : null;
  const compared = change === null || change === 0
    ? ""
    : ` · <span class="${change > 0 ? "up" : "down"}">${change > 0 ? "+" : "−"}${formatXp(Math.abs(change))}% vs prev week</span>`;
  return `<div class="velocity" role="img" aria-label="${formatXp(total)} XP over the last seven days">${bars}</div>`
    + `<p class="rail-note">${formatXp(total)} XP in seven days · best ${escape(best.name)} ${formatXp(best.xp)} XP</p>`
    + `<p class="rail-note-sub">Avg ${formatXp(average)} XP/workday${compared}</p>`;
}

function railCard(title, aside, body, className = "") {
  return `<section class="panel rail-card ${className}"><div class="rail-head"><h2 class="rail-title">${title}</h2>`
    + (aside ? `<span class="rail-aside">${aside}</span>` : "") + "</div>"
    + `<div class="rail-body">${body}</div></section>`;
}

function overviewRail(model) {
  const week = model.periods.week.current;
  const weekTypes = week.types ?? [];
  const recent = highestTiers(model.achievements.recent);
  return '<aside class="rail" aria-label="Week at a glance">'
    + railCard("XP by type", "This week", typeMix(weekTypes))
    + railCard("Achievements", recent.length > 0 ? `${formatXp(recent.length)} moved` : "", railBadges(model.achievements), "rail-achievements")
    + railCard("Weekly velocity", "7 days", velocity(model.units, new Date(model.generatedAt), week.previous?.xp ?? 0))
    + "</aside>";
}

function feedTabs() {
  const tab = (mode, label, open = false) =>
    `<button type="button" class="feed-tab" data-feed-filter="${mode}" aria-pressed="${open}">${label}</button>`;
  return '<div class="feed-tabs" role="group" aria-label="Show latest units">'
    + tab("all", "All units", true) + tab("pr", "PRs only") + tab("push", "Pushes") + tab("top", "Top XP")
    + "</div>";
}

function latestUnits(units) {
  const list = units.slice(0, LATEST_UNITS);
  const cards = list.map((unit, index) => {
    const card = activityCard(unit, index);
    return index < FEED_UNITS ? card : card.replace('<a class="activity-card"', '<a class="activity-card" hidden');
  }).join("");
  const scored = units.filter((unit) => unit.status === "scored").length;
  return '<section class="feed" aria-label="Latest units">'
    + '<div class="section-heading"><div><h2>Latest scored units</h2>'
    + '<p>Directly synchronized from GitHub pull requests &amp; commits</p></div>'
    + feedTabs()
    + "</div>"
    + `<div class="activity-feed" data-feed>${cards}</div>`
    + `<p class="feed-more"><a class="panel-link" href="#/timeline">View full timeline (${plural(scored, "scored unit")})</a></p></section>`;
}

export function renderOverview(model) {
  const week = model.periods.week.current;
  const head = pageHead("Overview", plural(model.units.length, "unit"), {
    status: syncStatus(model.generatedAt),
    meta: periodChip(week.period.start, week.period.end),
  });
  if (model.units.length === 0) {
    return `<div class="screen overview-screen">${head}`
      + `${emptyPanel("No scored units yet: push to the default branch or merge a PR in a repository set up with <code>evolo init</code>.")}`
      + "</div>";
  }
  return `<div class="screen overview-screen">${head}`
    + rankHero(model)
    + statGrid(model)
    + `<div class="overview-grid">${latestUnits(model.units)}${overviewRail(model)}</div>`
    + "</div>";
}
