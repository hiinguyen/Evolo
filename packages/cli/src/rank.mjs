// The dashboard's ranks (docs/superpowers/plans/2026-10-25-evolo-dashboard-redesign.md section 4.2): one every five
// levels, from the engineer career ladder to the game tiers. `effect` names the CSS ladder the page draws the title
// with; `deep` marks the harder step inside an effect (Principal over Staff, Distinguished over Architect).
// Rank is a pure function of the level, so it is recomputed from the ledger like everything else.
const RANKS = [
  { min: 0, name: "Intern", effect: "muted" },
  { min: 5, name: "Junior Dev", effect: "muted" },
  { min: 10, name: "Mid-level Dev", effect: "tint" },
  { min: 15, name: "Senior Dev", effect: "gradient" },
  { min: 20, name: "Staff Engineer", effect: "glow" },
  { min: 25, name: "Principal Engineer", effect: "glow", deep: true },
  { min: 30, name: "Architect", effect: "shimmer" },
  { min: 35, name: "Distinguished Engineer", effect: "shimmer", deep: true },
  { min: 40, name: "Master", effect: "blaze" },
  { min: 45, name: "Grandmaster", effect: "blaze", deep: true },
  { min: 50, name: "Legend", effect: "legend" },
];

// The rank reached at `level`, clamped at both ends: a negative or unreadable level is the first rank, and the last
// rank has no ceiling. The walk goes from the top so the first match is the highest one reached.
export function rankFor(level) {
  const reached = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
  return RANKS.findLast((rank) => reached >= rank.min) ?? RANKS[0];
}

// The rung after the one at `level`, or null once the ladder has no ceiling left. It lets the dashboard show the next
// milestone without knowing the ladder itself.
export function nextRankFor(level) {
  const reached = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
  return RANKS.find((rank) => rank.min > reached) ?? null;
}
