// The Achievements screen (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6): every achievement of
// the catalog as a tile with its badge, description, progress and the day it was reached, in the catalog's order; then
// the secrets found; then one small "?" per secret still hidden. A secret not found yet is only a number in the model, so this
// screen has nothing to name it with. Every number is the model's; the only arithmetic is the width of a progress bar.
import { escape, formatXp, localDate, pageHead, plural } from "./html.mjs";
import { badge } from "./overview.mjs";

// A comparison and its number stay on one line: "impact ≥ 3" never ends a line on "≥". The space becomes a no-break
// space before escaping, which leaves it as it is.
const keepTogether = (text) => String(text ?? "").replace(/([≥≤]) (?=\d)/g, "$1\u00a0");
const descriptionOf = (achievement) => `<span class="badge-desc">${escape(keepTogether(achievement.description))}</span>`;

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
  const details = descriptionOf(achievement)
    + `<span class="badge-foot">${tierProgress(achievement)}${tierDay(achievement)}</span>`;
  return `<li class="achievement">${badge(achievement, achievement.tier, details)}</li>`;
}

// A secret found has one tier and no progress, drawn as the Overview's strip draws it.
function secretTile(secret) {
  const details = `${descriptionOf(secret)}<span class="badge-foot">${reachedOn(secret.at)}</span>`;
  return `<li class="achievement">${badge({ ...secret, hidden: true, tiers: [1] }, 1, details)}</li>`;
}

// One small "?" per secret still hidden, read out once as their number: they have nothing to tell apart.
function hiddenSecrets(count) {
  if (count === 0) return "";
  return `<div class="secret-slots" role="img" aria-label="${escape(plural(count, "hidden secret"))}">`
    + '<span class="secret-slot" aria-hidden="true">?</span>'.repeat(count)
    + "</div>";
}

function secretsSection({ secretsFound, secretsHidden }) {
  const total = secretsFound.length + secretsHidden;
  if (total === 0) return "";
  const found = secretsFound.length > 0 ? `<ul class="achievement-grid">${secretsFound.map(secretTile).join("")}</ul>` : "";
  return '<section class="achievement-section" aria-labelledby="secrets-head">'
    + `<div class="section-head"><h2 id="secrets-head">Secrets</h2><span class="muted">${formatXp(secretsFound.length)} of ${formatXp(total)} found</span></div>`
    + `${found}${hiddenSecrets(secretsHidden)}</section>`;
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
