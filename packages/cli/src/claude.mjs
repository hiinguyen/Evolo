// Evolo's place in Claude Code (docs/auto-scoring.md section 6): the /evolo skill, a SessionStart hook that syncs in the
// background, and the status line when the user has none of their own.
// Scores reach the user, never the coding agent's context: the hook prints nothing, the skill runs only when the user
// types /evolo, and the status line is drawn for the user only.
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJson } from "./store.mjs";

const SKILL_SOURCE = fileURLToPath(new URL("../claude/skills/evolo", import.meta.url));
// Claude Code gives a hook this long; `sync --background` only starts a worker, so it returns well within it.
const HOOK_TIMEOUT_S = 10;
const SYNC_ARGS = "sync --background";
const STATUS_ARGS = "statusline";

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
// Recognises Evolo's own entries whatever node or checkout path they were written with.
const isEvoloCommand = (command, args) => typeof command === "string" && /evolo\.mjs'? /.test(command) && command.endsWith(` ${args}`);

// settings.json is often a symlink into a dotfiles repository: the file it points at is rewritten, not the link.
function settingsPath() {
  const path = join(claudeDir(), "settings.json");
  return existsSync(path) ? realpathSync(path) : path;
}

const skillLink = () => join(claudeDir(), "skills", "evolo");

// What is at `path`, as { isOurs, isLink }, or null when nothing is. A link is Evolo's when it points at this checkout's
// skill, or at a skill of a checkout that has since moved or been removed.
function skillAt(path) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return { isLink: false, isOurs: false };
    const target = resolve(dirname(path), readlinkSync(path));
    return { isLink: true, isOurs: target === SKILL_SOURCE || (target.endsWith("/claude/skills/evolo") && !existsSync(target)) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function installSkill() {
  const link = skillLink();
  const current = skillAt(link);
  if (current?.isOurs && existsSync(link)) return `skill /evolo already at ${link}`;
  if (current && !current.isOurs) return `left ${link} alone: it is not Evolo's; remove it to install the /evolo skill`;
  rmSync(link, { force: true });
  mkdirSync(dirname(link), { recursive: true });
  // A link, not a copy, so the skill follows the checkout like the `evolo` command does.
  symlinkSync(SKILL_SOURCE, link);
  return `installed skill /evolo at ${link}`;
}

function uninstallSkill() {
  const link = skillLink();
  if (!skillAt(link)?.isOurs) return null;
  rmSync(link);
  return `removed skill /evolo from ${link}`;
}

// Settings without Evolo's SessionStart hook; groups and sections left empty are dropped.
function withoutSyncHook(settings) {
  const groups = (settings.hooks?.SessionStart ?? [])
    .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !isEvoloCommand(hook.command, SYNC_ARGS)) }))
    .filter((group) => group.hooks.length > 0);
  const { SessionStart, ...otherHooks } = settings.hooks ?? {};
  const hooks = groups.length > 0 ? { ...otherHooks, SessionStart: groups } : otherHooks;
  const { hooks: _, ...rest } = settings;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

// `command` is the argv that runs the Evolo CLI, e.g. [node, ".../bin/evolo.mjs"]. Returns the lines to print.
// Running it again updates Evolo's entries (for example after the checkout moved) without adding new ones.
export function installClaude(command) {
  const evolo = command.map(shellQuote).join(" ");
  const path = settingsPath();
  const settings = readJson(path, {});
  const notes = [installSkill()];

  const base = withoutSyncHook(settings);
  const syncHook = { hooks: [{ type: "command", command: `${evolo} ${SYNC_ARGS}`, timeout: HOOK_TIMEOUT_S }] };
  let next = { ...base, hooks: { ...base.hooks, SessionStart: [...(base.hooks?.SessionStart ?? []), syncHook] } };
  notes.push(`SessionStart hook in ${path}: each Claude Code session syncs Evolo in the background`);

  const statusLine = settings.statusLine;
  if (!statusLine || isEvoloCommand(statusLine.command, STATUS_ARGS)) {
    next = { ...next, statusLine: { type: "command", command: `${evolo} ${STATUS_ARGS}` } };
    notes.push(`status line: \`evolo ${STATUS_ARGS}\``);
  } else {
    notes.push(`kept your own status line; to show Evolo in it, have it print the output of \`evolo ${STATUS_ARGS}\``);
  }
  writeJson(path, next);
  return notes;
}

export function uninstallClaude() {
  const path = settingsPath();
  const settings = readJson(path, null);
  const notes = [uninstallSkill()].filter(Boolean);
  if (settings) {
    let next = withoutSyncHook(settings);
    if (JSON.stringify(next) !== JSON.stringify(settings)) notes.push(`removed Evolo's SessionStart hook from ${path}`);
    if (isEvoloCommand(settings.statusLine?.command, STATUS_ARGS)) {
      const { statusLine, ...rest } = next;
      next = rest;
      notes.push("removed the Evolo status line");
    }
    if (JSON.stringify(next) !== JSON.stringify(settings)) writeJson(path, next);
  }
  return notes.length > 0 ? notes : ["Evolo was not installed in Claude Code"];
}
