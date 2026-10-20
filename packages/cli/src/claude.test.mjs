import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { installClaude, uninstallClaude } from "./claude.mjs";

const SKILL = fileURLToPath(new URL("../claude/skills/evolo", import.meta.url));
const COMMAND = ["/usr/bin/node", "/opt/evolo/bin/evolo.mjs"];
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// A Claude config directory, the way CLAUDE_CONFIG_DIR points at one, with `settings` in settings.json.
function configDir(settings) {
  const dir = mkdtempSync(join(tmpdir(), "evolo-claude-"));
  dirs.push(dir);
  if (settings) writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  process.env.CLAUDE_CONFIG_DIR = dir;
  return dir;
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const theirs = {
  model: "opus",
  statusLine: { type: "command", command: "~/bin/my-statusline" },
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
    Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
  },
};

test("install adds the skill and a sync hook, keeps the user's own status line, and uninstall puts everything back", () => {
  const dir = configDir(theirs);
  const notes = installClaude(COMMAND);
  assert.match(notes.join("\n"), /kept your own status line/);
  assert.equal(readlinkSync(join(dir, "skills/evolo")), SKILL);
  const settings = read(join(dir, "settings.json"));
  assert.deepEqual(settings.statusLine, theirs.statusLine);
  assert.deepEqual(settings.hooks.Stop, theirs.hooks.Stop);
  assert.deepEqual(settings.hooks.SessionStart, [
    ...theirs.hooks.SessionStart,
    { hooks: [{ type: "command", command: "'/usr/bin/node' '/opt/evolo/bin/evolo.mjs' sync --background", timeout: 10 }] },
  ]);

  installClaude(["/other/node", "/moved/bin/evolo.mjs"]);
  const again = read(join(dir, "settings.json")).hooks.SessionStart;
  assert.equal(again.length, 2, "installing again replaces Evolo's hook instead of adding one");
  assert.match(again[1].hooks[0].command, /^'\/other\/node' '\/moved\/bin\/evolo.mjs' sync/);

  uninstallClaude();
  assert.deepEqual(read(join(dir, "settings.json")), theirs);
  assert.equal(existsSync(join(dir, "skills/evolo")), false);
  assert.deepEqual(uninstallClaude(), ["Evolo was not installed in Claude Code"]);
});

test("without a status line or settings, install sets Evolo's status line, and uninstall removes it", () => {
  const dir = configDir(null);
  installClaude(COMMAND);
  const settings = read(join(dir, "settings.json"));
  assert.deepEqual(settings.statusLine, { type: "command", command: "'/usr/bin/node' '/opt/evolo/bin/evolo.mjs' statusline" });
  uninstallClaude();
  assert.deepEqual(read(join(dir, "settings.json")), {});
});

test("a settings.json linked from elsewhere is edited where it lives, and a skill that is not Evolo's is left alone", () => {
  const dir = configDir(null);
  const dotfiles = join(dir, "dotfiles-settings.json");
  writeFileSync(dotfiles, JSON.stringify({ model: "opus" }));
  symlinkSync(dotfiles, join(dir, "settings.json"));
  mkdirSync(join(dir, "skills/evolo"), { recursive: true });

  assert.match(installClaude(COMMAND).join("\n"), /left .*skills\/evolo alone/);
  assert.equal(readlinkSync(join(dir, "settings.json")), dotfiles);
  assert.equal(read(dotfiles).model, "opus");
  assert.ok(read(dotfiles).hooks.SessionStart);
  uninstallClaude();
  assert.ok(existsSync(join(dir, "skills/evolo")), "the user's own skill stays");
});

test("settings.json keeps its permissions, since it may hold tokens", () => {
  const dir = configDir({ env: { TOKEN: "secret" } });
  chmodSync(join(dir, "settings.json"), 0o600);
  installClaude(COMMAND);
  assert.equal(statSync(join(dir, "settings.json")).mode & 0o777, 0o600);
});

test("a skill link of the user's own is left alone, and a link left by a moved checkout of Evolo is replaced", () => {
  const dir = configDir(null);
  const own = join(dir, "my-skill");
  mkdirSync(own);
  mkdirSync(join(dir, "skills"));
  symlinkSync(own, join(dir, "skills/evolo"));
  assert.match(installClaude(COMMAND).join("\n"), /left .*skills\/evolo alone/);
  uninstallClaude();
  assert.equal(readlinkSync(join(dir, "skills/evolo")), own);

  rmSync(join(dir, "skills/evolo"));
  symlinkSync("/old/checkout/packages/cli/claude/skills/evolo", join(dir, "skills/evolo"));
  assert.match(installClaude(COMMAND).join("\n"), /installed skill/);
  assert.equal(readlinkSync(join(dir, "skills/evolo")), SKILL);
  rmSync(join(dir, "skills/evolo"));
  symlinkSync("/old/checkout/packages/cli/claude/skills/evolo", join(dir, "skills/evolo"));
  uninstallClaude();
  assert.equal(lstatSync(join(dir, "skills/evolo"), { throwIfNoEntry: false }), undefined, "a dangling link of Evolo's is removed");
});

test("a settings.json that is not valid JSON is never overwritten", () => {
  const dir = configDir(null);
  writeFileSync(join(dir, "settings.json"), "{ not json");
  assert.throws(() => installClaude(COMMAND), /cannot read .*settings\.json/);
  assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), "{ not json");
});
