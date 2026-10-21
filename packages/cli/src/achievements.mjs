// Achievements (docs/superpowers/specs/2026-10-20-evolo-achievements-design.md): tiers the user's ledger has reached,
// computed again on every call like level and stats, so a tier held only by a unit later reverted is lost.
// <home>/achievements.json only remembers which tiers were announced ({ notified: ["bug-hunter:2"] }), so a tier lost
// and held again is not announced twice; deleting it announces every tier held at the next scored unit.
import { join } from "node:path";
import { VISIBLE } from "./achievements/catalog.mjs";
import { SECRET } from "./achievements/secret.mjs";
import { landedAt } from "./ledger.mjs";
import { readJson, writeJson } from "./store.mjs";

export const ACHIEVEMENTS = [...VISIBLE, ...SECRET];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const tierName = (tier) => ROMAN[tier - 1] ?? String(tier);

const notifiedPath = (home) => join(home, "achievements.json");
const keyOf = (id, tier) => `${id}:${tier}`;
// "Bug Hunter II"; an achievement with one tier is just its name.
const labelOf = (achievement, tier) => (achievement.tiers.length > 1 ? `${achievement.name} ${tierName(tier)}` : achievement.name);

function byLanding(records) {
  return records
    .map((record) => ({ record, time: Date.parse(landedAt(record)) }))
    .sort((a, b) => a.time - b.time)
    .map(({ record }) => record);
}

// When `rule` reached `threshold` on the ledger `sorted` by landing: the landing of the record that took it there.
// A rule's value never goes down as records are added, so the first such record is found by halving.
function reachedAt(rule, sorted, threshold) {
  let low = 1;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rule.value(sorted.slice(0, middle)) >= threshold) high = middle;
    else low = middle + 1;
  }
  return landedAt(sorted[low - 1]);
}

// Every achievement as { id, name, description, hidden, tiers, value, tier, unlocked: [{ tier, at }] }: `tier` is how
// many tiers `records` reach (0 for none), `at` the ISO time each of them was reached.
export function achievementsOf(records) {
  const sorted = byLanding(records);
  return ACHIEVEMENTS.map((rule) => {
    const value = rule.value(sorted);
    const tier = rule.tiers.filter((threshold) => value >= threshold).length;
    const unlocked = rule.tiers.slice(0, tier).map((threshold, index) => ({ tier: index + 1, at: reachedAt(rule, sorted, threshold) }));
    const { id, name, description, tiers } = rule;
    return { id, name, description, hidden: Boolean(rule.hidden), tiers, value, tier, unlocked };
  });
}

// Every tier held, as { id, name, description, hidden, tier, label, at }, in catalog order.
const heldTiers = (achievements) => achievements.flatMap((achievement) => achievement.unlocked.map(({ tier, at }) => ({
  id: achievement.id, name: achievement.name, description: achievement.description, hidden: achievement.hidden,
  tier, label: labelOf(achievement, tier), at,
})));

// The tiers reached in `period` (stats.mjs's periodOf), oldest first.
export function unlockedIn(achievements, period) {
  return heldTiers(achievements)
    .filter(({ at }) => Date.parse(at) >= period.start.getTime() && Date.parse(at) < period.end.getTime())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// The tiers held that were never announced, which are remembered as announced from now on.
export function notifyUnlocks(home, achievements) {
  // A file in any other shape (edited by hand) counts as nothing announced, and is rewritten in the right one.
  const remembered = readJson(notifiedPath(home), { notified: [] })?.notified;
  const notified = new Set(Array.isArray(remembered) ? remembered : []);
  const fresh = heldTiers(achievements).filter(({ id, tier }) => !notified.has(keyOf(id, tier)));
  if (fresh.length > 0) writeJson(notifiedPath(home), { notified: [...notified, ...fresh.map(({ id, tier }) => keyOf(id, tier))].sort() });
  return fresh;
}
