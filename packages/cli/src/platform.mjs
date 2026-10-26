// The few things that differ between Linux, macOS and Windows: how a page is opened in the browser, how a desktop
// notification is sent, how a judge CLI is found on PATH, and how a command line is quoted for the shells that run
// Evolo's hooks. Everything else is plain Node, the same on every platform.
import { execFileSync, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";

export const isWindows = process.platform === "win32";

const NOTIFY_TIMEOUT_MS = 5_000;

// A command line for the shells that run git hooks (`sh` from Git for Windows) and Claude Code hooks (`sh` or cmd.exe):
// POSIX single quotes elsewhere, double-quoted paths with forward slashes on Windows, which both sh and cmd.exe read.
export function quoteCommand(argv, platform = process.platform) {
  if (platform !== "win32") return argv.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ");
  return argv.map((arg) => `"${arg.replaceAll("\\", "/")}"`).join(" ");
}

// The program and arguments that open `path` in the user's browser, one per desktop.
export function browserCommand(path, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: [path] };
  if (platform === "win32") return { command: "explorer.exe", args: [path] };
  return { command: "xdg-open", args: [path] };
}

// Starts the browser detached so the command returns at once; a desktop without an opener is no error, since the
// caller has already printed the path to open by hand.
export function openInBrowser(path, platform = process.platform) {
  const { command, args } = browserCommand(path, platform);
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

// A desktop notification command per platform: the freedesktop.org one on Linux, osascript on macOS, and a PowerShell
// balloon on Windows. The text never enters the command itself, only the environment, so neither a title nor a judge's
// summary can be read as script.
export function notificationCommand(title, body, platform = process.platform) {
  if (platform === "darwin") {
    const script = 'display notification (system attribute "EVOLO_NOTIFY_BODY") with title (system attribute "EVOLO_NOTIFY_TITLE")';
    return { command: "osascript", args: ["-e", script], env: { EVOLO_NOTIFY_TITLE: title, EVOLO_NOTIFY_BODY: body } };
  }
  if (platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$n = New-Object System.Windows.Forms.NotifyIcon",
      "$n.Icon = [System.Drawing.SystemIcons]::Information",
      "$n.Visible = $true",
      "$n.ShowBalloonTip(4000, $env:EVOLO_NOTIFY_TITLE, $env:EVOLO_NOTIFY_BODY, 'Info')",
      "Start-Sleep -Milliseconds 4000",
      "$n.Dispose()",
    ].join("; ");
    const args = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script];
    return { command: "powershell.exe", args, env: { EVOLO_NOTIFY_TITLE: title, EVOLO_NOTIFY_BODY: body } };
  }
  return { command: "notify-send", args: ["--app-name=Evolo", "--", title, body], env: {} };
}

// Throws when the desktop has no notification tool; the caller decides whether that is worth a line in the log.
export function sendNotification(title, body, platform = process.platform) {
  const { command, args, env } = notificationCommand(title, body, platform);
  execFileSync(command, args, { stdio: "ignore", timeout: NOTIFY_TIMEOUT_MS, env: { ...process.env, ...env }, windowsHide: true });
}

// Whether the desktop's notification server reads the body as markup (freedesktop.org "body-markup"). Only Linux
// servers have it: osascript and the Windows balloon show text as written.
export function markupSupported(platform = process.platform) {
  if (platform !== "linux") return false;
  try {
    const capabilities = execFileSync(
      "gdbus",
      ["call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications",
        "--method", "org.freedesktop.Notifications.GetCapabilities"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: NOTIFY_TIMEOUT_MS },
    );
    return capabilities.includes("'body-markup'");
  } catch {
    return false;
  }
}

// The file a command name runs, or null. Off Windows the name is enough: the OS resolves it from PATH.
export function findExecutable(name, { platform = process.platform, env = process.env } = {}) {
  if (platform !== "win32") return name;
  if (isAbsolute(name) || name.includes("\\") || name.includes("/")) {
    try {
      return statSync(name).isFile() ? name : null;
    } catch {
      return null;
    }
  }
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const names = extname(name) ? [name] : exts.map((ext) => `${name}${ext.toLowerCase()}`);
  for (const dir of (env.PATH ?? env.Path ?? "").split(";").filter(Boolean)) {
    for (const candidate of names) {
      const file = join(dir, candidate);
      try {
        if (statSync(file).isFile()) return file;
      } catch {
        // Not in this directory; keep looking.
      }
    }
  }
  return null;
}

// The executable a judge backend runs. On Windows a `.cmd`/`.bat` shim cannot carry Evolo's multi-line prompt: cmd.exe
// re-parses the arguments and splits them at every newline, so the native build is required there.
export function judgeExecutable(name, options = {}) {
  const file = findExecutable(name, options);
  if (!file) throw new Error(`the \`${name}\` CLI is not installed or not on PATH`);
  if (/\.(cmd|bat)$/i.test(file)) {
    throw new Error(
      `\`${name}\` is installed as the batch shim ${file}, which cannot carry Evolo's multi-line judge prompt; `
      + `install the native Windows build of \`${name}\` so the CLI is a real executable`,
    );
  }
  return file;
}
