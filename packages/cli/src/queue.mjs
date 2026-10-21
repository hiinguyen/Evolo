// The queue of units waiting to be scored, and the lock that keeps one worker per machine.
// A job is one file in <home>/queue, named so that sorting the names gives the order jobs were added.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, statSync, utimesSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localDay } from "./ledger.mjs";
import { jsonFiles, readJson, removeFile, writeJson } from "./store.mjs";

const BIN = fileURLToPath(new URL("../bin/evolo.mjs", import.meta.url));
// A worker touches its lock this often; a lock left untouched for LOCK_STALE_MS belongs to a dead worker,
// even when its PID now names another process (PIDs are reused after a reboot).
const LOCK_HEARTBEAT_MS = 30 * 1000;
const LOCK_STALE_MS = 5 * 60 * 1000;

const queueDir = (home) => join(home, "queue");
const lockPath = (home) => join(home, "worker.lock");

// job: { type: "push" | "pr", repo: "owner/name", ... }. Returns the stored job.
export function addJob(home, job) {
  const now = Date.now();
  const id = `${String(now).padStart(15, "0")}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = { id, ...job, enqueuedAt: new Date(now).toISOString(), notBefore: now, attempts: 0 };
  writeJson(join(queueDir(home), `${id}.json`), stored);
  return stored;
}

export function listJobs(home) {
  return jsonFiles(queueDir(home))
    .map((name) => readJson(join(queueDir(home), name), null))
    .filter(Boolean);
}

// Returns false when the job is no longer queued: another process (`evolo retry`) must not bring back a job the worker
// has just finished.
export function updateJob(home, job) {
  const path = join(queueDir(home), `${job.id}.json`);
  if (!existsSync(path)) return false;
  writeJson(path, job);
  return true;
}

// A request for the running worker to sync once it is idle, left by `evolo sync --background`: a worker that holds the
// lock while it waits to retry a job would otherwise not sync, and the new worker gives up on the lock.
const syncRequestPath = (home) => join(home, "sync-requested");

export function requestSync(home) {
  writeJson(syncRequestPath(home), { at: new Date().toISOString() });
}

export const hasSyncRequest = (home) => existsSync(syncRequestPath(home));

// True, once, when a sync was requested since the last call.
export function takeSyncRequest(home) {
  if (!existsSync(syncRequestPath(home))) return false;
  removeFile(syncRequestPath(home));
  return true;
}

// A job waiting for the next local day because the day's judge budget is spent. It is not in flight, so it does not
// hold the sync back, and no worker stays up for it: the first worker of the next day scores it.
export const isParked = (job, now = new Date()) => job.budgetDay === localDay(now);

export function removeJob(home, job) {
  removeFile(join(queueDir(home), `${job.id}.json`));
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const lockOwner = (path) => readFileSync(path, "utf8").trim();

function isStale(path, owner) {
  return !isAlive(Number(owner)) || Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS;
}

// Runs `action` on the lock only while `owner` still holds it; a lock that is gone or taken over is left alone.
function whileOwnedBy(path, owner, action) {
  try {
    if (lockOwner(path) === owner) action();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// Takes the worker lock, or returns null when a live worker holds it.
// The returned function releases it.
export function acquireLock(home) {
  const path = lockPath(home);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      const self = String(process.pid);
      const heartbeat = setInterval(() => whileOwnedBy(path, self, () => utimesSync(path, new Date(), new Date())), LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      const release = () => {
        clearInterval(heartbeat);
        process.removeListener("exit", release);
        whileOwnedBy(path, self, () => removeFile(path));
      };
      process.on("exit", release);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = lockOwner(path);
        if (!isStale(path, owner)) return null;
      } catch (readError) {
        if (readError.code !== "ENOENT") throw readError;
        continue; // released in the meantime
      }
      // Another process may have taken the stale lock over since it was read; only the stale owner's lock is removed.
      whileOwnedBy(path, owner, () => removeFile(path));
    }
  }
  return null;
}

// The worker runs detached from the hook that starts it, so a push never waits for scoring.
// Variables git sets for a hook would point the worker's git calls, which run in other repositories, at this one,
// so the variables git itself scopes to one repository are not passed on.
export function spawnWorker(home) {
  const local = new Set(execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).split("\n"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !local.has(name)));
  const log = openSync(join(home, "evolo.log"), "a");
  const child = spawn(process.execPath, [BIN, "worker"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...env, EVOLO_HOME: home, GIT_TERMINAL_PROMPT: "0" },
  });
  child.unref();
  closeSync(log);
}
