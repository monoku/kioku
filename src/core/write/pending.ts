import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../fs/atomic.ts";
import { acquireLock } from "../fs/lock.ts";
import { pendingPath } from "../state.ts";
import { readJson } from "../util.ts";

/**
 * Publications that did not complete (§1.6): a shared brain whose commit is made and whose push failed. Kept
 * under `~/.kioku/`, per machine; `sync` retries them at the next session start and the summary mentions them.
 */
export interface Pending {
  /** Where the brain is on this machine. */
  path: string;
  /** When the first push that is still pending failed. */
  since: string;
  /** Why the last attempt failed. */
  reason: string;
}

export { pendingPath };

export function readPending(home: string): Record<string, Pending> {
  const path = pendingPath(home);
  if (!existsSync(path)) return {};
  // Derived state: a broken file is rebuilt by the next failed push.
  const raw = readJson(path);
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, Pending>) : {};
}

async function change(home: string, apply: (all: Record<string, Pending>) => void): Promise<void> {
  mkdirSync(join(home, ".kioku"), { recursive: true });
  const lock = await acquireLock(join(home, ".kioku", "lock"));
  try {
    const all = readPending(home);
    apply(all);
    writeAtomic(pendingPath(home), `${JSON.stringify(all, null, 2)}\n`);
  } finally {
    lock.release();
  }
}

export const recordPending = (
  home: string,
  key: string,
  path: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> =>
  change(home, (all) => {
    all[key] = { path, since: all[key]?.since ?? now.toISOString(), reason };
  });

export async function clearPending(home: string, key: string): Promise<void> {
  if (readPending(home)[key] === undefined) return;
  await change(home, (all) => {
    delete all[key];
  });
}
