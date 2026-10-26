// Helpers every screen of the dashboard draws with. `escape` is the one way text from the model enters the HTML, and
// `safeUrl` the one way a link does (docs/superpowers/specs/2026-10-21-evolo-dashboard-design.md section 7).
// Times are formatted in the browser's zone, which is the user's local time, as the CLI prints them.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Any value as text safe inside an element or a quoted attribute; null and undefined are nothing.
export function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

// `url` when it is an https link, else null: a link taken from the ledger can never run script or leave TLS.
export const safeUrl = (url) => (typeof url === "string" && url.startsWith("https://") ? url : null);

// "1,040". Number() also turns anything that is not a number into "NaN" rather than into markup.
export const formatXp = (xp) => Number(xp).toLocaleString("en-US");

// "$9,999.99": cents always shown, thousands separated like XP.
export const formatUsd = (usd) => `$${Number(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const plural = (count, word) => `${formatXp(count)} ${count === 1 ? word : `${word}s`}`;

// How long a judge took: "41s", "2m 05s", "1h 12m". An unreadable duration is nothing, so the caller can leave it out.
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const pad = (number) => String(number).padStart(2, "0");

// "2026-10-21" of the ISO time `iso` in the local zone; "" for a time that cannot be read.
export function localDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "2026-10-21 06:33" of the ISO time `iso` in the local zone; "" for a time that cannot be read.
export function localTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDate(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "#/unit/me/a/pr-1": the address of a screen, each part encoded so a name cannot add a part of its own.
export const hashOf = (...parts) => `#/${parts.map((part) => encodeURIComponent(part)).join("/")}`;

// The heading every screen starts with, and an optional line under it. A screen that knows when the page was written
// adds a sync mark, a chip on the right (a period) and a sentence under the title.
export function pageHead(title, detail = "", { status = "", meta = "", note = "" } = {}) {
  const line = detail === "" ? "" : `<p>${escape(detail)}</p>`;
  const noteLine = note === "" ? "" : `<p class="head-note">${escape(note)}</p>`;
  const tools = meta === "" ? "" : `<div class="head-tools">${meta}</div>`;
  return `<header class="page-head"><div class="head-main"><div class="head-title"><h1>${escape(title)}</h1>${line}</div>${status}${noteLine}</div>${tools}</header>`;
}

// "Synced just now · updates after each scored unit": the page is written when scoring finishes, so the mark is
// updated in the browser from `data-synced` as the page gets older.
export function syncStatus(generatedAt) {
  return '<span class="head-status"><span class="status-dot good" aria-hidden="true"></span>'
    + `<span data-synced="${escape(generatedAt)}">Synced just now</span> · updates after each scored unit</span>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return { month: MONTHS[date.getMonth()], day: date.getDate(), year: date.getFullYear() };
};

// "Oct 19 - Oct 25, 2026": a period as the chip on a screen's head writes it.
export function periodLabel(start, end) {
  const from = shortDay(start);
  const to = shortDay(end);
  if (!from || !to) return "";
  if (from.year !== to.year) return `${from.month} ${from.day}, ${from.year} - ${to.month} ${to.day}, ${to.year}`;
  return `${from.month} ${from.day} - ${to.month} ${to.day}, ${to.year}`;
}

export function periodChip(start, end) {
  const label = periodLabel(start, end);
  if (label === "") return "";
  return '<span class="head-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>'
    + `${escape(label)}</span>`;
}

// An empty list or panel: one muted icon, one sentence, and an optional link the caller built.
export const emptyPanel = (text, action = "") =>
  '<section class="panel empty">'
  + '<svg class="empty-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M4 4.5h16v11H4z"/><path d="M4 12h4l1.5 2.5h5L16 12h4"/><path d="M8 8h8"/></svg>'
  + `<p>${text}</p>${action ? `<p>${action}</p>` : ""}</section>`;
