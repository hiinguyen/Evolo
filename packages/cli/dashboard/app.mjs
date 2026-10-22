// The dashboard's router and frame (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 6). The
// address lives in the hash, so Back, Forward and a bookmark of one unit all work from a file:// page. In a browser
// this module reads the model from the page, draws the screen the hash names, and draws again when the hash changes;
// in Node (the tests) it only exports its functions.
import { renderAchievements } from "./achievements.mjs";
import { renderAnalytics } from "./analytics.mjs";
import { escape, formatXp } from "./html.mjs";
import { renderOverview } from "./overview.mjs";
import { renderReviews } from "./reviews.mjs";
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
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const NAV = [
  { screen: "overview", href: "#/", label: "Overview",
    icon: icon('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>') },
  { screen: "timeline", href: "#/timeline", label: "Timeline",
    icon: icon('<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.75" cy="4" r=".75"/><circle cx="2.75" cy="8" r=".75"/><circle cx="2.75" cy="12" r=".75"/>') },
  { screen: "analytics", href: "#/analytics", label: "Analytics", icon: icon('<path d="M2.5 13.5h11M4.5 11V8M8 11V3.5M11.5 11V6"/>') },
  { screen: "achievements", href: "#/achievements", label: "Achievements",
    icon: icon('<circle cx="8" cy="6" r="3.75"/><path d="M5.75 9 5 14l3-1.5 3 1.5-.75-5"/>') },
  { screen: "reviews", href: "#/reviews", label: "Reviews", icon: icon('<path d="M2.5 3.5h11v7.5H8l-3 2.5V11H2.5z"/>') },
];

// The screen whose entry in the sidebar is lit: a unit's details belong to the Timeline, an unknown address shows the
// Overview.
const NAV_OF = { unit: "timeline", notFound: "overview" };

// The page around a screen: the sidebar with the open screen marked, and `content` in the main area.
export function renderShell(model, route, content) {
  const open = NAV_OF[route.screen] ?? route.screen;
  const items = NAV.map((item) =>
    `<li><a href="${item.href}"${item.screen === open ? ' aria-current="page"' : ""}>${item.icon}<span>${item.label}</span></a></li>`).join("");
  const { level, total } = model.level;
  return '<div class="frame"><nav class="sidebar" aria-label="Dashboard">'
    + '<a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span>Evolo</a>'
    + `<ul class="nav">${items}</ul>`
    + `<p class="sidebar-foot">Level ${formatXp(level)} · ${formatXp(total)} XP</p>`
    + `</nav><main class="content" id="main" tabindex="-1">${content}</main></div>`;
}

// Every screen; an address for one that is not here shows the Overview with a notice.
const SCREENS = {
  overview: (model) => renderOverview(model),
  timeline: (model, route) => renderTimeline(model, route.query),
  unit: (model, route) => renderUnit(model, route.params.key, route.params.tab),
  analytics: (model, route) => renderAnalytics(model, route.params.kind, route.params.which),
  achievements: (model) => renderAchievements(model),
  reviews: (model, route) => renderReviews(model, route.query),
};

export function renderRoute(model, route) {
  const screen = SCREENS[route.screen];
  if (screen) return screen(model, route);
  return `<p class="notice" role="status">Nothing at this address. Here is the overview.</p>${renderOverview(model)}`;
}

const TITLES = { overview: "Overview", timeline: "Timeline", unit: "Unit", analytics: "Analytics", achievements: "Achievements", reviews: "Reviews" };

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
// The pending reset of each Copy button, so a second click restarts the wait instead of being cut short by the first.
const copyResets = new WeakMap();

// Copies the command of a Copy button, and says on the button whether it worked.
function copyCommand(button) {
  const show = (text) => {
    button.textContent = text;
    clearTimeout(copyResets.get(button));
    copyResets.set(button, setTimeout(() => { button.textContent = "Copy"; }, COPY_FEEDBACK_MS));
  };
  navigator.clipboard.writeText(button.dataset.copy).then(() => show("Copied"), () => show("Copy failed"));
}

// The values of the Timeline's selects, keyed by filter.
const filterValues = (form) => Object.fromEntries([...form.querySelectorAll("select[data-filter]")].map((select) => [select.name, select.value]));

// On a narrow screen the nav scrolls sideways and may hide the open screen's link; scrolling the nav itself, not the
// page, brings it into view.
function showActiveNav(root) {
  const bar = root.querySelector(".sidebar");
  const current = bar?.querySelector('a[aria-current="page"]');
  if (!bar || !current || bar.scrollWidth <= bar.clientWidth) return;
  const barBox = bar.getBoundingClientRect();
  const box = current.getBoundingClientRect();
  if (box.left < barBox.left) bar.scrollLeft += box.left - barBox.left;
  else if (box.right > barBox.right) bar.scrollLeft += box.right - barBox.right;
}

function startDashboard() {
  const root = document.getElementById("app");
  const model = readModel(root, document.getElementById("model").textContent);
  if (model === null) return;
  // A Copy button stays hidden where the page cannot write to the clipboard.
  const canCopy = typeof navigator.clipboard?.writeText === "function";
  // The select that changed the address, to give it focus back once the list is drawn again.
  let changedFilter = null;
  const draw = () => {
    const route = parseHash(window.location.hash);
    drawScreen(root, model, route);
    document.title = `${TITLES[route.screen] ?? "Overview"} · Evolo`;
    showActiveNav(root);
    if (canCopy) for (const button of root.querySelectorAll("button[data-copy]")) button.hidden = false;
  };
  window.addEventListener("hashchange", () => {
    draw();
    const select = changedFilter && root.querySelector(`select[name="${changedFilter}"]`);
    changedFilter = null;
    if (select) {
      select.focus();
      return;
    }
    // A new screen starts at its top, and keyboard focus moves to it rather than staying on a link that is gone.
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  });
  // A filter is part of the address: a change becomes a new hash, which draws the list and can be undone with Back.
  root.addEventListener("change", (event) => {
    const form = event.target.closest("form.filters");
    if (!form) return;
    const next = timelineHash(filterValues(form));
    // An address that does not change fires no hashchange, and would leave `changedFilter` set for a later one.
    if (next === window.location.hash) return;
    changedFilter = event.target.name;
    window.location.hash = next;
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-copy]");
    if (button) copyCommand(button);
  });
  draw();
}

if (typeof document !== "undefined") startDashboard();
