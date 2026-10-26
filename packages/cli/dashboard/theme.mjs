// The dashboard's theme and rank classes (docs/superpowers/plans/2026-10-25-evolo-dashboard-redesign.md sections 2 and
// 4.3). The preference is dashboard.theme until the user picks one here: the pick lives in localStorage and wins from
// then on. The boot script runs in <head> before the stylesheet, so the first paint already has the right theme; the
// setting popover and its system-theme listener are part of the page's one module script.
import { escape } from "./html.mjs";

export const THEME_KEY = "evolo.theme";
export const THEMES = ["light", "dark", "system"];
const THEME_LABELS = { light: "Light", dark: "Dark", system: "System" };

const knownTheme = (preference) => (THEMES.includes(preference) ? preference : "system");

// The theme to paint: an explicit light or dark wins, and system follows the desktop.
export function resolveTheme(preference, prefersDark) {
  return preference === "light" || preference === "dark" ? preference : prefersDark ? "dark" : "light";
}

// The script in <head>. It carries the configured preference because the model block is at the end of the body, where
// the boot script cannot read it. It never fails the page: a browser that blocks localStorage still gets the configured
// theme, and a browser without matchMedia paints light.
export function bootScript(configured) {
  return `(() => {
  const key = "evolo.theme";
  const configured = ${JSON.stringify(knownTheme(configured))};
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const resolve = (preference) => (
    preference === "light" || preference === "dark" ? preference : media && media.matches ? "dark" : "light"
  );
  const saved = () => {
    try {
      const value = localStorage.getItem(key);
      if (value === "light" || value === "dark" || value === "system") return value;
    } catch {}
    return configured;
  };
  const apply = () => { document.documentElement.dataset.theme = resolve(saved()); };
  apply();
  if (media && media.addEventListener) {
    // Read the choice again on every change: a pick made after this script ran must survive the desktop switching.
    media.addEventListener("change", () => { if (saved() === "system") apply(); });
  }
})();`;
}

// The preference in effect: the saved one when it is a value this page wrote, else the configured one.
export function currentThemePreference(configured) {
  // `localStorage` exists in Node 22 as an experimental global that warns when touched; the page only runs in a window.
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (THEMES.includes(saved)) return saved;
    } catch {}
  }
  return knownTheme(configured);
}

// The gear at the foot of the sidebar and its popover with the three choices.
export function themeControl(configured) {
  const preference = currentThemePreference(configured);
  const segments = THEMES.map((theme) =>
    `<button type="button" class="segment" data-theme-choice="${theme}" aria-pressed="${theme === preference}">${THEME_LABELS[theme]}</button>`).join("");
  return '<div class="theme-control">'
    + '<button type="button" class="theme-toggle" data-theme-toggle aria-haspopup="true" aria-expanded="false" aria-label="Theme settings" title="Theme">'
    + '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1"/>'
    + "</svg></button>"
    + `<div class="theme-popover" data-theme-popover hidden><p class="theme-title">Theme</p>`
    + `<div class="segmented" role="group" aria-label="Theme">${segments}</div></div>`
    + "</div>";
}

// Wires the control once per page: the shell is drawn again on navigation, so the listeners stay on `root` and read
// the popover of the current drawing. Choosing a theme saves it and repaints; System follows the desktop from now on.
export function startTheme(root, configured) {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

  const paint = (preference, save) => {
    document.documentElement.dataset.theme = resolveTheme(preference, Boolean(media?.matches));
    if (save) {
      try {
        localStorage.setItem(THEME_KEY, preference);
      } catch {}
    }
    for (const button of root.querySelectorAll("[data-theme-choice]")) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference));
    }
  };

  const popover = () => root.querySelector("[data-theme-popover]");
  const toggle = () => root.querySelector("[data-theme-toggle]");

  const close = ({ focus = false } = {}) => {
    const panel = popover();
    const button = toggle();
    if (!panel || !button) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (focus) button.focus();
  };

  paint(currentThemePreference(configured), false);

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-toggle]");
    if (button) {
      const panel = popover();
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) panel.querySelector("[data-theme-choice]")?.focus();
      return;
    }
    const choice = event.target.closest("[data-theme-choice]");
    if (choice) {
      paint(choice.dataset.themeChoice, true);
      close({ focus: true });
      return;
    }
    if (!event.target.closest(".theme-control")) close();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Only an open popover closes: Escape elsewhere belongs to whatever the user is doing.
    if (!popover()?.hidden) close({ focus: true });
  });

  if (media?.addEventListener) {
    media.addEventListener("change", () => {
      if (currentThemePreference(configured) === "system") paint("system", false);
    });
  }
}

// The rank classes shared by the sidebar chip and the overview's rank title. `escape` keeps a hand-written model
// value from leaving the class attribute.
export function rankClasses(rank) {
  const effect = typeof rank?.effect === "string" ? rank.effect : "muted";
  return `rank-${escape(effect)}${rank?.deep ? " rank-deep" : ""}`;
}
