// The dashboard's router and frame (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6). The
// address lives in the hash, so Back, Forward and a bookmark of one unit all work from a file:// page. In a browser
// this module reads the model from the page, draws the screen the hash names, and draws again when the hash changes;
// in Node (the tests) it only exports its functions.
import { renderAchievements } from "./achievements.mjs";
import { renderAnalytics } from "./analytics.mjs";
import { escape, formatXp, localDate } from "./html.mjs";
import { renderOverview } from "./overview.mjs";
import { renderReport, renderReports } from "./reports.mjs";
import { renderReviews, reviewsHash } from "./reviews.mjs";
import { rankClasses, startTheme, themeControl } from "./theme.mjs";
import { renderTimeline, timelineHash } from "./timeline.mjs";
import { renderUnit, UNIT_TABS } from "./unit.mjs";

const PERIOD_KINDS = ["week", "month", "quarter"];
const PERIOD_WHICH = ["current", "previous"];

// The params of each screen from the parts of its path after the screen's name, or null when they do not fit.
const ROUTES = {
  overview: (rest) => (rest.length === 0 ? {} : null),
  timeline: (rest) => (rest.length === 0 ? {} : null),
  achievements: (rest) => (rest.length === 0 ? {} : null),
  reviews: (rest) => (rest.length === 0 ? {} : null),
  reports: ([kind, day, ...extra]) => {
    if (kind === undefined) return {};
    return PERIOD_KINDS.includes(kind) && /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") && extra.length === 0 ? { id: `${kind}/${day}` } : null;
  },
  unit: ([owner, name, id, tab = "score", ...extra]) =>
    (id && extra.length === 0 && UNIT_TABS.includes(tab) ? { key: `${owner}/${name}/${id}`, tab } : null),
  analytics: ([kind = "week", which = "current", ...extra]) =>
    (extra.length === 0 && PERIOD_KINDS.includes(kind) && PERIOD_WHICH.includes(which) ? { kind, which } : null),
};

// Each part of a hash path decoded, or null when one is not valid percent-encoding.
function decodeParts(path) {
  try {
    return path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

// "#/unit/me/a/pr-1/review?x=1" -> { screen: "unit", params: { key: "me/a/pr-1", tab: "review" }, query: { x: "1" } }.
// An address no screen has is { screen: "notFound" }, so an old bookmark still lands somewhere.
export function parseHash(hash) {
  const text = hash.replace(/^#/, "");
  const mark = text.indexOf("?");
  const path = mark === -1 ? text : text.slice(0, mark);
  const query = Object.fromEntries(new URLSearchParams(mark === -1 ? "" : text.slice(mark + 1)));
  const parts = decodeParts(path);
  const [screen = "overview", ...rest] = parts ?? ["notFound"];
  const params = Object.hasOwn(ROUTES, screen) ? ROUTES[screen](rest) : null;
  return params ? { screen, params, query } : { screen: "notFound", params: {}, query };
}

// 16 px line icons drawn in the text colour, so they follow the theme.
const icon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const NAV = [
  { screen: "overview", href: "#/", label: "Overview",
    icon: icon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>') },
  { screen: "timeline", href: "#/timeline", label: "Timeline",
    icon: icon('<path d="M4 6h16M4 12h16M4 18h16"/>') },
  { screen: "analytics", href: "#/analytics", label: "Analytics",
    icon: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>') },
  { screen: "achievements", href: "#/achievements", label: "Achievements",
    icon: icon('<path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/><path d="M19 3v4M21 5h-4"/>') },
  { screen: "reviews", href: "#/reviews", label: "Reviews",
    icon: icon('<path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-5a8 8 0 1 1 17-5z"/>') },
  { screen: "reports", href: "#/reports", label: "Reports",
    icon: icon('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>') },
];

// The screen whose entry in the sidebar is lit: a unit's details belong to the Timeline, an unknown address shows the
// Overview.
const NAV_OF = { unit: "timeline", notFound: "overview" };

// The initials in the profile square: the first letter of the first and last word of a name, or "Evolo" when there is
// no name, so the block never reads as an empty avatar.
function initialsOf(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "EV";
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words.at(-1)[0]}`;
  return letters.toUpperCase();
}

// The bar at the foot of the sidebar: how far the level is from the next one, with the level in the badge above it.
function levelProgress({ level, from, next, total }) {
  const share = Math.min(100, Math.max(0, Math.round(((total - from) / (next - from)) * 100)));
  return `<div class="level-meter" role="progressbar" aria-label="Level ${escape(formatXp(level))}, ${share}% to level ${escape(formatXp(level + 1))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}"><span style="width:${share}%"></span></div>`
    + `<div class="level-legend"><span>Lvl ${escape(formatXp(level))}</span><span>${escape(formatXp(next - total))} XP to Lvl ${escape(formatXp(level + 1))}</span></div>`;
}

// The page around a screen: the sidebar with the open screen marked, the profile block and theme control at its foot,
// and `content` in the main area.
export function renderShell(model, route, content) {
  const open = NAV_OF[route.screen] ?? route.screen;
  const items = NAV.map((item) => {
    // The Timeline link counts the units; Achievements wears a dot when the week opened something new.
    const badge = item.screen === "timeline" ? `<span class="nav-badge">${escape(formatXp(model.units.length))}</span>` : "";
    const dot = item.screen === "achievements" && model.achievements?.recent?.length > 0
      ? '<span class="nav-dot" title="Unlocked this week" aria-hidden="true"></span>' : "";
    return `<li><a href="${item.href}" title="${escape(item.label)}"${item.screen === open ? ' aria-current="page"' : ""}>${item.icon}<span>${item.label}</span>${dot}${badge}</a></li>`;
  }).join("");
  const { level, total } = model.level;
  const name = model.name ? `<span class="identity-name">${escape(model.name)}</span>` : "";
  const rank = model.rank ?? { name: "", effect: "muted" };
  const initials = initialsOf(model.name || rank.name);
  const version = model.appVersion ? `<span class="brand-version">v${escape(model.appVersion)}</span>` : "";
  return '<div class="frame"><nav class="sidebar" aria-label="Dashboard">'
    + `<a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Evolo</span>${version}</a>`
    + `<div class="nav-scroll"><ul class="nav">${items}</ul></div>`
    + '<div class="sidebar-foot"><div class="profile-head">'
    + `<span class="profile-avatar" aria-hidden="true">${escape(initials)}</span>`
    + `<div class="identity">${name}<span class="rank-chip ${rankClasses(rank)}">${escape(rank.name)}</span>`
    + `<span class="identity-meta">${formatXp(total)} XP</span></div>`
    + `<span class="level-badge" title="Level ${escape(formatXp(level))}">${escape(formatXp(level))}</span>`
    + themeControl(model.theme ?? "system")
    + "</div>"
    + levelProgress(model.level)
    + "</div>"
    + `</nav><main class="content" id="main" tabindex="-1">${content}</main></div>`;
}

// Every screen; an address for one that is not here shows the Overview with a notice.
const SCREENS = {
  overview: (model) => renderOverview(model),
  timeline: (model, route) => renderTimeline(model, route.query),
  unit: (model, route) => renderUnit(model, route.params.key, route.params.tab, route.query),
  analytics: (model, route) => renderAnalytics(model, route.params.kind, route.params.which),
  achievements: (model) => renderAchievements(model),
  reviews: (model, route) => renderReviews(model, route.query),
  reports: (model, route) => (route.params.id ? renderReport(model, route.params.id) : renderReports(model)),
};

export function renderRoute(model, route) {
  const screen = SCREENS[route.screen];
  if (screen) return screen(model, route);
  return `<p class="notice" role="status">Nothing at this address. Here is the overview.</p>${renderOverview(model)}`;
}

const TITLES = { overview: "Overview", timeline: "Timeline", unit: "Unit", analytics: "Analytics", achievements: "Achievements", reviews: "Reviews", reports: "Reports" };

// What `root` shows when the page cannot be drawn: a plain message built from nothing but the error, so it appears even
// when the model is unreadable or the frame itself fails, with a way back to the overview.
export function showFailure(root, error) {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<div class="failure" role="alert"><p>The dashboard could not draw this page: ${escape(message)}</p>`
    + '<p><a href="#/">Back to the overview</a></p></div>';
  console.error(error);
}

// The model the page carries in `#model`, or null after showing why it could not be read.
export function readModel(root, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    showFailure(root, error);
    return null;
  }
}

// Draws the screen of `route` into `root`; a screen or a frame that throws leaves the failure message, not a blank page.
export function drawScreen(root, model, route) {
  try {
    root.innerHTML = renderShell(model, route, renderRoute(model, route));
  } catch (error) {
    showFailure(root, error);
  }
}

const COPY_FEEDBACK_MS = 2000;
// A search is typed letter by letter; one address per pause keeps Back from stepping through every keystroke.
const SEARCH_DELAY_MS = 220;
// The level at the last opening, so the level card shines only when this page is one level higher than that.
const LEVEL_KEY = "evolo.lastLevel";
const LEVEL_SHINE_MS = 1800;
// The pending reset of each Copy button, so a second click restarts the wait instead of being cut short by the first.
const copyResets = new WeakMap();

function storedLevel() {
  if (typeof localStorage === "undefined") return null;
  try {
    const saved = localStorage.getItem(LEVEL_KEY);
    if (saved === null) return null;
    const value = Number(saved);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberLevel(level) {
  try {
    localStorage.setItem(LEVEL_KEY, String(level));
  } catch {}
}

// Copies the command of a Copy button, and says on the button whether it worked.
function copyCommand(button) {
  const show = (text) => {
    button.textContent = text;
    clearTimeout(copyResets.get(button));
    copyResets.set(button, setTimeout(() => { button.textContent = "Copy"; }, COPY_FEEDBACK_MS));
  };
  navigator.clipboard.writeText(button.dataset.copy).then(() => show("Copied"), () => show("Copy failed"));
}

// The values of the Timeline's search box and selects, keyed by filter.
const filterValues = (form) =>
  Object.fromEntries([...form.querySelectorAll("input[data-filter], select[data-filter]")].map((field) => [field.name, field.value]));

// "just now", "4 min ago", "3 h ago" or the day, from the moment the page was written. The page is static, so this is
// the one clock it needs: it says how old the data is rather than claiming a live sync that never happened.
export function syncText(iso, now = new Date()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "Synced";
  const minutes = Math.floor(Math.max(0, now.getTime() - then) / 60000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${localDate(iso)}`;
}

// Every sync mark on the screen, in the reader's own time: the page can sit on disk for a day before it is opened.
function updateSyncMarks(root, now = new Date()) {
  for (const mark of root.querySelectorAll("[data-synced]")) mark.textContent = syncText(mark.dataset.synced, now);
}

// The latest-units feed of the Overview: the page carries a short list, and these buttons show the part of it asked
// for. The extra cards stay in the page so switching back is instant, and a reader without JavaScript still sees the
// five newest ones.
const FEED_SIZE = 5;

// The cards a feed tab shows, as the `order` values of the page's cards. "All units" keeps the newest five, "PRs only"
// and "Pushes" take the newest five of that kind, and "Top XP" the five worth the most in the short list.
export function feedSelection(cards, mode, size = FEED_SIZE) {
  const byOrder = (a, b) => a.order - b.order;
  const eligible = mode === "pr" || mode === "push"
    ? cards.filter((card) => card.kind === mode).sort(byOrder)
    : mode === "top"
      ? [...cards].sort((a, b) => b.xp - a.xp || byOrder(a, b))
      : [...cards].sort(byOrder);
  return eligible.slice(0, size).map((card) => card.order);
}

function drawFeed(feed, mode) {
  const cards = [...feed.querySelectorAll(".activity-card")];
  const data = cards.map((card) => ({
    node: card,
    kind: card.dataset.kind,
    xp: Number(card.dataset.xp),
    order: Number(card.dataset.order),
  }));
  const shown = new Set(feedSelection(data, mode));
  for (const card of data) card.node.hidden = !shown.has(card.order);
  const sorted = [...data].sort((a, b) => a.order - b.order);
  for (const card of sorted) feed.append(card.node);
  if (mode === "top") {
    const top = [...data].sort((a, b) => b.xp - a.xp || a.order - b.order).slice(0, FEED_SIZE);
    for (const card of top) feed.append(card.node);
  }
}

function showFeedMode(button) {
  const group = button.closest(".feed-tabs");
  const feed = button.closest(".feed").querySelector("[data-feed]");
  if (!group || !feed) return;
  for (const other of group.querySelectorAll("[data-feed-filter]")) other.setAttribute("aria-pressed", String(other === button));
  drawFeed(feed, button.dataset.feedFilter);
}

// On a narrow screen the nav scrolls sideways and may hide the open screen's link; scrolling the nav itself, not the
// page, brings it into view.
function showActiveNav(root) {
  const bar = root.querySelector(".nav-scroll");
  const current = bar?.querySelector('a[aria-current="page"]');
  if (!bar || !current || bar.scrollWidth <= bar.clientWidth) return;
  const barBox = bar.getBoundingClientRect();
  const box = current.getBoundingClientRect();
  // Put the open screen at the start of the bar rather than scrolling its predecessor half out of view.
  if (box.left < barBox.left || box.right > barBox.right) bar.scrollLeft += box.left - barBox.left - 8;
}

function startDashboard() {
  const root = document.getElementById("app");
  const model = readModel(root, document.getElementById("model").textContent);
  if (model === null) return;
  startTheme(root, model.theme ?? "system");
  // Only a real step up shines: the first opening, or a level that went down after a formula change, does not.
  const before = storedLevel();
  const leveled = before !== null && model.level.level > before;
  // A Copy button stays hidden where the page cannot write to the clipboard.
  const canCopy = typeof navigator.clipboard?.writeText === "function";
  // The field that changed the address, to give it focus back once the list is drawn again.
  let changedFilter = null;
  let searchTimer = null;
  const draw = () => {
    const route = parseHash(window.location.hash);
    drawScreen(root, model, route);
    updateSyncMarks(root);
    document.title = `${TITLES[route.screen] ?? "Overview"} · Evolo`;
    showActiveNav(root);
    if (canCopy) for (const button of root.querySelectorAll("button[data-copy]")) button.hidden = false;
  };
  const applyFilters = (form, name) => {
    const values = filterValues(form);
    const next = form.dataset.screen === "reviews" ? reviewsHash(values) : timelineHash(values);
    // An address that does not change fires no hashchange, and would leave `changedFilter` set for a later one.
    if (next === window.location.hash) return;
    changedFilter = name;
    window.location.hash = next;
  };
  window.addEventListener("hashchange", () => {
    draw();
    const field = changedFilter && root.querySelector(`[name="${changedFilter}"]`);
    changedFilter = null;
    if (field) {
      field.focus();
      if (field.type === "search") field.setSelectionRange(field.value.length, field.value.length);
      return;
    }
    // A new screen starts at its top, and keyboard focus moves to it rather than staying on a link that is gone.
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  });
  // A filter is part of the address: a change becomes a new hash, which draws the list and can be undone with Back. The
  // search box waits for a pause while typing, then writes one address for the whole word.
  root.addEventListener("change", (event) => {
    const form = event.target.closest("form.filters");
    if (!form) return;
    applyFilters(form, event.target.name);
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches('input[type="search"][data-filter]')) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const form = root.querySelector("form.filters");
      if (form) applyFilters(form, "q");
    }, SEARCH_DELAY_MS);
  });
  // The filters never need a submit: a change already made the new address.
  root.addEventListener("submit", (event) => {
    if (event.target.closest("form.filters")) event.preventDefault();
  });
  root.addEventListener("click", (event) => {
    const feedButton = event.target.closest("button[data-feed-filter]");
    if (feedButton) {
      showFeedMode(feedButton);
      return;
    }
    const button = event.target.closest("button[data-copy]");
    if (button) copyCommand(button);
  });
  draw();
  rememberLevel(model.level.level);
  if (leveled) {
    root.classList.add("leveled");
    setTimeout(() => root.classList.remove("leveled"), LEVEL_SHINE_MS);
  }
}

if (typeof document !== "undefined") startDashboard();
