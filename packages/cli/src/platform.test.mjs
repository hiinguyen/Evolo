import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { browserCommand, findExecutable, judgeExecutable, markupSupported, notificationCommand, quoteCommand } from "./platform.mjs";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// A directory of files standing in for a Windows PATH, with the extensions cmd.exe would look through.
function binDir(names) {
  const dir = mkdtempSync(join(tmpdir(), "evolo-platform-"));
  dirs.push(dir);
  mkdirSync(join(dir, "nested"), { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), "");
  return dir;
}

test("a command line is quoted for the shell that will run it, and Windows paths are readable by both sh and cmd", () => {
  const command = ["/usr/bin/node", "/opt/my tools/evolo.mjs"];
  assert.equal(quoteCommand(command, "linux"), "'/usr/bin/node' '/opt/my tools/evolo.mjs'");
  assert.equal(quoteCommand(["/opt/it's here/evolo.mjs"], "linux"), "'/opt/it'\\''s here/evolo.mjs'");

  assert.equal(
    quoteCommand(["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\Hai\\Evolo\\bin\\evolo.mjs"], "win32"),
    '"C:/Program Files/nodejs/node.exe" "C:/Users/Hai/Evolo/bin/evolo.mjs"',
  );
});

test("every desktop gets the opener it ships with", () => {
  assert.deepEqual(browserCommand("/home/me/.evolo/dashboard.html", "linux"), {
    command: "xdg-open", args: ["/home/me/.evolo/dashboard.html"],
  });
  assert.deepEqual(browserCommand("/Users/me/.evolo/dashboard.html", "darwin"), {
    command: "open", args: ["/Users/me/.evolo/dashboard.html"],
  });
  assert.deepEqual(browserCommand("C:\\Users\\me\\.evolo\\dashboard.html", "win32"), {
    command: "explorer.exe", args: ["C:\\Users\\me\\.evolo\\dashboard.html"],
  });
});

test("a notification carries the judge's text in the environment, never in the command", () => {
  const title = "Evolo +120 XP";
  const body = 'He said "ship it"; rm -rf / $(whoami) `id`';

  const linux = notificationCommand(title, body, "linux");
  assert.deepEqual(linux, { command: "notify-send", args: ["--app-name=Evolo", "--", title, body], env: {} });

  for (const platform of ["darwin", "win32"]) {
    const { command, args, env } = notificationCommand(title, body, platform);
    assert.equal(env.EVOLO_NOTIFY_TITLE, title);
    assert.equal(env.EVOLO_NOTIFY_BODY, body);
    assert.ok(!args.join(" ").includes("rm -rf"), `${platform}'s command carries no text`);
  }
  assert.match(notificationCommand(title, body, "darwin").command, /^osascript$/);
  assert.equal(notificationCommand(title, body, "win32").command, "powershell.exe");
});

test("only a freedesktop notification server reads markup", () => {
  assert.equal(markupSupported("darwin"), false);
  assert.equal(markupSupported("win32"), false);
});

test("a command name is resolved through PATH and PATHEXT on Windows only", () => {
  const dir = binDir(["claude.exe", "gh.cmd"]);
  const env = { PATH: `C:\\missing;${dir}`, PATHEXT: ".EXE;.CMD;.BAT" };
  assert.equal(findExecutable("claude", { platform: "win32", env }), join(dir, "claude.exe"));
  assert.equal(findExecutable("gh", { platform: "win32", env }), join(dir, "gh.cmd"));
  assert.equal(findExecutable("opencode", { platform: "win32", env }), null);
  assert.equal(findExecutable("claude", { platform: "linux", env }), "claude", "off Windows the OS resolves the name");
});

test("the judge refuses a batch shim, which cannot carry a multi-line prompt", () => {
  const dir = binDir(["claude.cmd", "opencode.exe"]);
  const env = { PATH: dir, PATHEXT: ".EXE;.CMD" };
  assert.equal(judgeExecutable("opencode", { platform: "win32", env }), join(dir, "opencode.exe"));
  assert.throws(() => judgeExecutable("claude", { platform: "win32", env }), /batch shim .*native Windows build/);
  assert.throws(() => judgeExecutable("missing", { platform: "win32", env }), /not installed or not on PATH/);
  assert.equal(judgeExecutable("claude", { platform: "linux", env }), "claude");
});
