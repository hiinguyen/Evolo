// Evolo's state on this machine: one JSON file per record, under ~/.evolo (or $EVOLO_HOME).
// Every write goes to a temporary file that is then renamed, so a reader never sees a half-written file.
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export function evoloHome() {
  return process.env.EVOLO_HOME || join(homedir(), ".evolo");
}

// The JSON at `path`, or `fallback` when the file does not exist.
export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`cannot read ${path}: ${error.message}`);
  }
}

// Writes `text` to `path` atomically. A file that already exists keeps its permissions: Claude Code's settings.json, for
// one, may hold tokens and be 0600. A new file gets `mode` when given, for text that should not be world-readable.
export function writeText(path, text, { mode } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(temporary, text, mode === undefined ? undefined : { mode });
  try {
    try {
      chmodSync(temporary, statSync(path).mode & 0o7777);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    renameSync(temporary, path);
  } catch (error) {
    // A failed write must not leave its temporary file behind: a refresh that keeps failing would fill the folder.
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function removeFile(path) {
  rmSync(path, { force: true });
}

// Names of the JSON records in `dir`, sorted; temporary files are skipped.
export function jsonFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Every JSON record anywhere under `root`, in no particular order; temporary files are skipped, and so is a file that
// vanished while being listed. Nothing under `root` yet is no records.
export function readJsonTree(root) {
  let paths;
  try {
    paths = readdirSync(root, { recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return paths
    .filter((path) => path.endsWith(".json") && !basename(path).startsWith("."))
    .map((path) => readJson(join(root, path), null))
    .filter(Boolean);
}

// One log for every background part of Evolo: the hook writes nothing to the terminal, so this is where it reports.
export function logLine(home, message) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "evolo.log"), `${new Date().toISOString()} [${process.pid}] ${message}\n`, { flag: "a" });
}
