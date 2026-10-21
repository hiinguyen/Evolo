// The Achievements screen (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): every achievement of
// the catalog as a tile with its badge, description, progress and the day it was reached, in the catalog's order; then
// the secrets found; then one "?" per secret still hidden. A secret not found yet is only a number in the model, so this
// screen has nothing to name it with. Every number is the model's; the only arithmetic is the width of a progress bar.
import { escape, formatXp, localDate, pageHead, plural } from "./html.mjs";
import { badge } from "./overview.mjs";

const dayOf = (iso) => `<time datetime="${escape(iso)}">${escape(localDate(iso))}</time>`;
const reachedOn = (iso) => `<span class="badge-when">unlocked ${dayOf(iso)}</span>`;

// The bar toward the next tier with its count, as `evolo achievements` counts it; a full bar and "max" once every tier
// is reached. Past the next tier's threshold the bar stops full.
function tierProgress({ tiers, value, tier }) {
  if (tier >= tiers.length) {
    return '<span class="badge-progress"><span class="meter" aria-hidden="true"><span style="width:100%"></span></span>'
      + '<span class="badge-count">max</span></span>';
  }
  const target = tiers[tier];
  const share = Math.min(100, Math.max(0, Math.round((value / target) * 100)));
  return '<span class="badge-progress">'
    + `<span class="meter" role="progressbar" aria-label="Progress to the next tier" aria-valuemin="0" aria-valuenow="${escape(value)}" aria-valuemax="${escape(target)}">`
    + `<span style="width:${share}%"></span></span>`
    + `<span class="badge-count">${formatXp(value)} / ${formatXp(target)}</span></span>`;
}

// The day the highest tier reached was reached; "locked" before the first.
function tierDay({ tier, unlocked }) {
  if (tier === 0) return '<span class="badge-when">locked</span>';
  const highest = unlocked.find((entry) => entry.tier === tier) ?? unlocked[unlocked.length - 1];
  return highest ? reachedOn(highest.at) : "";
}

function achievementTile(achievement) {
  const details = `<span class="badge-desc">${escape(achievement.description)}</span>`
    + `<span class="badge-foot">${tierProgress(achievement)}${tierDay(achievement)}</span>`;
  return `<li class="achievement">${badge(achievement, achievement.tier, details)}</li>`;
}

// A secret found has one tier and no progress, drawn as the Overview's strip draws it.
function secretTile(secret) {
  const details = `<span class="badge-desc">${escape(secret.description)}</span><span class="badge-foot">${reachedOn(secret.at)}</span>`;
  return `<li class="achievement">${badge({ ...secret, hidden: true, tiers: [1] }, 1, details)}</li>`;
}

const hiddenTile = '<li class="secret-slot"><span class="emblem" aria-hidden="true">?</span><span class="sr-only">A secret not found yet</span></li>';

function secretsSection({ secretsFound, secretsHidden }) {
  const total = secretsFound.length + secretsHidden;
  if (total === 0) return "";
  const tiles = secretsFound.map(secretTile).join("") + hiddenTile.repeat(secretsHidden);
  return '<section class="achievement-section" aria-labelledby="secrets-head">'
    + `<div class="section-head"><h2 id="secrets-head">Secrets</h2><span class="muted">${formatXp(secretsFound.length)} of ${formatXp(total)} found</span></div>`
    + `<ul class="achievement-grid">${tiles}</ul></section>`;
}

export function renderAchievements(model) {
  const { visible, secretsFound, secretsHidden } = model.achievements;
  const reached = visible.filter((achievement) => achievement.tier > 0).length;
  const head = pageHead("Achievements",
    `${formatXp(reached)} / ${formatXp(visible.length)} · ★ ${plural(secretsFound.length, "secret")} · ? ${formatXp(secretsHidden)} hidden`);
  return `<div class="screen">${head}`
    + `<section aria-label="All achievements"><ul class="achievement-grid">${visible.map(achievementTile).join("")}</ul></section>`
    + secretsSection(model.achievements)
    + "</div>";
}
