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

// The heading every screen starts with, and an optional line under it.
export function pageHead(title, detail = "") {
  const line = detail === "" ? "" : `<p>${escape(detail)}</p>`;
  return `<header class="page-head"><h1>${escape(title)}</h1>${line}</header>`;
}
