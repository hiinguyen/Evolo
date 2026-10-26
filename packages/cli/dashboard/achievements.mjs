// The Achievements screen (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): every achievement of
// the catalog as a game badge with its framed icon, tier pips, progress and the day it was reached, in the catalog's
// order; then the secrets found; then one small "?" per secret still hidden. A secret not found yet is only a number in
// the model, so this screen has nothing to name it with. Every number is the model's; the only arithmetic is the width of
// a progress bar.
import { escape, formatXp, localDate, pageHead, plural } from "./html.mjs";
import { achievementEmblem, secretEmblem } from "./icons.mjs";
import { numeral } from "./overview.mjs";

// A comparison and its number stay on one line: "impact ≥ 3" never ends a line on "≥". The space becomes a no-break
// space before escaping, which leaves it as it is.
const keepTogether = (text) => String(text ?? "").replace(/([≥≤]) (?=\d)/g, "$1\u00a0");

const dayOf = (iso) => `<time datetime="${escape(iso)}">${escape(localDate(iso))}</time>`;

// The short label over the progress count, the way each rule is measured. Most rules show the generic "Progress"; the
// first ones get the label the number actually means.
const METRIC = {
  contributor: "Progress",
  "merge-master": "PR Count",
  hoarder: "Total XP",
  jackpot: "High XP Units",
  overdrive: "Record Peak",
  builder: "Shipped",
  "test-pilot": "Test Work",
  plumber: "Infra Work",
  explorer: "Repositories",
  polyglot: "Languages",
  streak: "Workday Streak",
  "full-week": "Full Weeks",
  "by-the-book": "Commits",
  "co-pilot": "Co-authored Units",
};
const metricOf = (id) => METRIC[id] ?? "Progress";

// A tier reached is unlocked; units below the first threshold are still in progress; no unit at all is locked.
const stateOf = ({ tier, value }) => (tier > 0 ? "unlocked" : value > 0 ? "in-progress" : "locked");

const STATUS_ART = {
  unlocked: '<rect x="2" y="5" width="6" height="5" rx="1"/><path d="M4 5V3.6a2 2 0 0 1 3.8-.7"/>',
  "in-progress": '<path d="M3 2.5h6M3 9.5h6M4 2.5v1.8L6 6 4 7.7v1.8M8 2.5v1.8L6 6l2 1.7v1.8"/>',
  locked: '<rect x="2.5" y="5" width="7" height="5" rx="1"/><path d="M4 5V3.5a2 2 0 0 1 4 0V5"/>',
};

const statusMark = (state) =>
  `<svg class="status-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATUS_ART[state]}</svg>`;

// The day the highest tier reached was reached.
function highestAt({ tier, unlocked }) {
  const highest = unlocked?.find((entry) => entry.tier === tier) ?? unlocked?.[unlocked.length - 1];
  return highest?.at ?? "";
}

function statusLine(achievement) {
  const state = stateOf(achievement);
  if (state === "unlocked") {
    const at = highestAt(achievement);
    return `<span class="card-status">${statusMark(state)}unlocked${at ? ` ${dayOf(at)}` : ""}</span>`;
  }
  const text = state === "in-progress" ? "in progress" : "Locked";
  return `<span class="card-status">${statusMark(state)}${text}</span>`;
}

function pips({ tiers, tier }) {
  const marks = tiers.map((_, index) => `<i class="pip${index < tier ? " on" : ""}"></i>`).join("");
  return `<span class="pips" role="img" aria-label="Tier ${escape(tier)} of ${escape(tiers.length)}">${marks}</span>`;
}

// The count toward the next tier, as `evolo achievements` counts it; a full bar and "max" once every tier is reached.
function progressOf({ tiers, value, tier }) {
  if (tier >= tiers.length) return { now: value, target: value, share: 100, maxed: true };
  const target = tiers[tier];
  const share = Math.min(100, Math.max(0, Math.round((value / target) * 100)));
  return { now: value, target, share, maxed: false };
}

function achievementCard(achievement) {
  const { id, name, description, tier } = achievement;
  const state = stateOf(achievement);
  const progress = progressOf(achievement);
  const count = progress.maxed ? "max" : `${formatXp(progress.now)} / ${formatXp(progress.target)}`;
  const chip = tier > 0 ? `<span class="emblem-tier">${escape(numeral(tier))}</span>` : "";
  return `<li class="achievement-card" data-state="${state}">`
    + `<div class="card-emblem">${achievementEmblem(id)}${chip}</div>`
    + `<h3 class="card-name">${escape(name)}</h3>`
    + pips(achievement)
    + `<p class="card-desc">${escape(keepTogether(description))}</p>`
    + '<div class="card-foot">'
    + `<div class="card-metric"><span>${escape(metricOf(id))}</span><span class="metric-value">${count}</span></div>`
    + `<div class="card-meter meter" role="progressbar" aria-label="Progress to the next tier" aria-valuemin="0" aria-valuenow="${escape(progress.now)}" aria-valuemax="${escape(progress.target)}"><span style="width:${progress.share}%"></span></div>`
    + statusLine(achievement)
    + "</div></li>";
}

// A secret found has one tier and no progress; it wears the drawing it brought in the model, with no frame around it.
function secretCard(secret) {
  const at = secret.at ? ` ${dayOf(secret.at)}` : "";
  return `<li class="achievement-card secret" data-state="unlocked">`
    + `<div class="card-emblem">${secretEmblem(secret.icon)}</div>`
    + `<h3 class="card-name">${escape(secret.name)}</h3>`
    + '<span class="pips" role="img" aria-label="Secret"><i class="pip on"></i></span>'
    + `<p class="card-desc">${escape(keepTogether(secret.description))}</p>`
    + '<div class="card-foot"><div class="card-metric"><span>Secret</span><span class="metric-value">found</span></div>'
    + `<span class="card-status">${statusMark("unlocked")}unlocked${at}</span></div></li>`;
}

// One sealed badge per secret still hidden: a drawn question mark in a dashed ring, read out once as their number.
// They have nothing to tell apart, so they all wear the same mark.
const SECRET_SLOT_ART = '<svg class="secret-slot-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9.2a3.2 3.2 0 1 1 5.1 2.6c-1.1.8-1.8 1.4-1.8 2.7v.7"/><circle cx="12.3" cy="18.2" r="1.1" fill="currentColor" stroke="none"/></svg>';

function hiddenSecrets(count) {
  if (count === 0) return "";
  return `<div class="secret-slots" role="img" aria-label="${escape(plural(count, "hidden secret"))}">`
    + `<span class="secret-slot" aria-hidden="true">${SECRET_SLOT_ART}</span>`.repeat(count)
    + "</div>";
}

function secretsSection({ secretsFound, secretsHidden }) {
  const total = secretsFound.length + secretsHidden;
  if (total === 0) return "";
  const found = secretsFound.length > 0 ? `<ul class="achievement-grid">${secretsFound.map(secretCard).join("")}</ul>` : "";
  return '<section class="achievement-section" aria-labelledby="secrets-head">'
    + `<div class="section-head"><h2 id="secrets-head">Secrets</h2><span class="muted">${formatXp(secretsFound.length)} of ${formatXp(total)} found</span></div>`
    + `${found}${hiddenSecrets(secretsHidden)}</section>`;
}

export function renderAchievements(model) {
  const { visible, secretsFound, secretsHidden } = model.achievements;
  const reached = visible.filter((achievement) => achievement.tier > 0).length;
  const head = pageHead("Achievements",
    `${formatXp(reached)} / ${formatXp(visible.length)} · ★ ${plural(secretsFound.length, "secret")} · ? ${formatXp(secretsHidden)} hidden`);
  return `<div class="screen achievement-screen">${head}`
    + `<section aria-label="All achievements"><ul class="achievement-grid">${visible.map(achievementCard).join("")}</ul></section>`
    + secretsSection(model.achievements)
    + "</div>";
}
