// The theme's resolver, boot script and control are pure strings outside the browser, so they are tested in Node.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { bootScript, rankClasses, resolveTheme, THEME_KEY, themeControl } from "./theme.mjs";

test("a fixed theme wins, and system follows the desktop", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("nonsense", true), "dark");
});

test("the boot script carries the configured theme and falls back to system", () => {
  const boot = bootScript("dark");
  assert.ok(boot.includes(`const key = "${THEME_KEY}";`));
  assert.ok(boot.includes('const configured = "dark";'));
  assert.ok(bootScript("nonsense").includes('const configured = "system";'));
  assert.ok(boot.includes("prefers-color-scheme: dark"));
  assert.ok(boot.includes("document.documentElement.dataset.theme"));
  assert.ok(!boot.includes("</script") && !boot.includes("<!--"));
});

test("the boot script follows the desktop only while System is the saved choice", () => {
  const listeners = [];
  let dark = false;
  const media = {
    get matches() { return dark; },
    addEventListener: (type, listener) => { if (type === "change") listeners.push(listener); },
  };
  const saved = new Map();
  const sandbox = {
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem: (key) => saved.get(key) ?? null },
    matchMedia: () => media,
  };
  const flipDesktop = () => { for (const listener of listeners) listener(); };
  runInNewContext(bootScript("system"), sandbox);
  assert.equal(sandbox.document.documentElement.dataset.theme, "light", "no choice yet, so the desktop decides");
  saved.set(THEME_KEY, "light");
  dark = true;
  flipDesktop();
  assert.equal(sandbox.document.documentElement.dataset.theme, "light", "a pick made after opening wins over the desktop");
  saved.set(THEME_KEY, "system");
  flipDesktop();
  assert.equal(sandbox.document.documentElement.dataset.theme, "dark");
  dark = false;
  flipDesktop();
  assert.equal(sandbox.document.documentElement.dataset.theme, "light");
});

test("the control is a gear with one segment per theme and the current one pressed", () => {
  const html = themeControl("dark");
  assert.match(html, /class="theme-toggle" data-theme-toggle aria-haspopup="true" aria-expanded="false"/);
  assert.match(html, /class="theme-popover" data-theme-popover hidden/);
  for (const theme of ["light", "dark", "system"]) assert.match(html, new RegExp(`data-theme-choice="${theme}" aria-pressed="${theme === "dark"}"`));
});

test("rankClasses names the effect, marks the deeper steps, and escapes the model's text", () => {
  assert.equal(rankClasses({ effect: "glow", deep: true }), "rank-glow rank-deep");
  assert.equal(rankClasses({ effect: "gradient" }), "rank-gradient");
  assert.equal(rankClasses(undefined), "rank-muted");
  assert.equal(rankClasses({ effect: 'x" onclick="y' }), "rank-x&quot; onclick=&quot;y");
});
