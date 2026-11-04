import { closeSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { refusedError } from "../errors.ts";

/**
 * A writer lock: exclusive and advisory, a file next to what it protects. The file is created with
 * `O_EXCL`, which the kernel makes atomic, and holds who owns it. A waiter polls until the owner
 * releases it or the wait runs out, five seconds unless the caller has its own deadline. A lock whose
 * owner is gone is broken: the file is renamed away before it is removed, so two waiters that find
 * the same dead lock cannot both believe they broke it and then both create one.
 *
 * `flock` would do this in one call, but Node exposes no file locking, so this is the portable form:
 * exclusive create plus a liveness check on the owner's pid. The host is recorded for the message
 * only: the check is local, and a folder shared between machines is out of Kioku's scope.
 */

export const LOCK_WAIT_MS = 5000;
/** A lock file with nothing readable in it is the owner killed between creating and writing it; after this long, it is stale. */
const EMPTY_LOCK_GRACE_MS = 2000;

export interface LockOwner {
  pid: number;
  host: string;
  since: string;
}

export interface Lock {
  path: string;
  /** The dead owner whose lock was broken to take this one, when that happened. */
  broke?: LockOwner;
  release(): void;
}

export interface LockOptions {
  /** How long to wait before giving up. */
  timeoutMs?: number;
  /** Called once the lock is held, like the write's hook: a test passes one that kills the process. */
  fault?: (step: "after-lock") => void;
}

export async function acquireLock(path: string, options: LockOptions = {}): Promise<Lock> {
  const timeout = options.timeoutMs ?? LOCK_WAIT_MS;
  const started = performance.now();
  const deadline = started + timeout;
  let delay = 5;
  /** The dead owner this process broke, reported only if the create that follows is ours and not another waiter's. */
  let justBroke: LockOwner | undefined;
  let lastOwner: LockOwner | undefined;

  for (;;) {
    if (tryCreate(path)) {
      sweepStale(path);
      options.fault?.("after-lock");
      return { path, ...(justBroke ? { broke: justBroke } : {}), release: () => release(path) };
    }
    justBroke = undefined;
    const owner = readOwner(path);
    lastOwner = owner ?? lastOwner;
    if (isStale(path, owner)) {
      if (breakLock(path)) justBroke = owner ?? { pid: 0, host: hostname(), since: "unknown" };
      continue;
    }
    if (performance.now() >= deadline)
      throw refusedError(lockedMessage(path, lastOwner, performance.now() - started), "locked");
    await sleep(delay);
    delay = Math.min(delay * 2, 200);
  }
}

function tryCreate(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  try {
    const owner: LockOwner = { pid: process.pid, host: hostname(), since: new Date().toISOString() };
    writeSync(fd, JSON.stringify(owner) + "\n");
  } catch (e) {
    // A lock that could not be filled would keep every other writer waiting until it goes stale.
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch {
      /* already gone */
    }
    throw e;
  }
  closeSync(fd);
  return true;
}

export function readOwner(path: string): LockOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed?.pid === "number" && typeof parsed?.host === "string") {
      return { pid: parsed.pid, host: parsed.host, since: typeof parsed.since === "string" ? parsed.since : "unknown" };
    }
  } catch {
    /* missing, empty or not ours */
  }
  return undefined;
}

/** The owner's pid is not alive here, or the file is unreadable for longer than a live process takes to write it. */
export function isStale(path: string, owner: LockOwner | undefined): boolean {
  if (!owner) {
    try {
      return Date.now() - statSync(path).mtimeMs > EMPTY_LOCK_GRACE_MS;
    } catch {
      return false; // released between our look and now; the next create will tell
    }
  }
  return !processAlive(owner.pid);
}

/** Signal 0 checks existence: `ESRCH` is dead, `EPERM` is alive and someone else's. */
export function processAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Rename then unlink. Only one of several waiters wins the rename; the others see `ENOENT` and simply retry the create. */
function breakLock(path: string): boolean {
  const aside = `${path}.stale.${process.pid}`;
  try {
    renameSync(path, aside);
  } catch {
    return false;
  }
  try {
    unlinkSync(aside);
  } catch {
    /* nothing to do */
  }
  return true;
}

/** A `lock.stale.<pid>` is a broken lock whose breaker died before unlinking it; nothing reads one, so the holder removes them. */
function sweepStale(path: string): void {
  const dir = dirname(path);
  const prefix = `${basename(path)}.stale.`;
  try {
    for (const name of readdirSync(dir)) if (name.startsWith(prefix)) unlinkSync(join(dir, name));
  } catch {
    /* best effort */
  }
}

function release(path: string): void {
  // Only the owner removes the file: if the lock was broken under us by mistake, we must not take the next writer's.
  if (readOwner(path)?.pid !== process.pid) return;
  try {
    unlinkSync(path);
  } catch {
    /* already gone */
  }
}

function lockedMessage(path: string, owner: LockOwner | undefined, waitedMs: number): string {
  const waited = `waited ${(waitedMs / 1000).toFixed(1)} s`;
  if (!owner)
    return `the brain is locked (${path} exists but names no owner); ${waited}. If no kioku is running, delete it.`;
  const where = owner.host === hostname() ? "" : ` on ${owner.host}`;
  return `the brain is locked by another kioku (pid ${owner.pid}${where}) since ${owner.since}; ${waited}.`;
}
