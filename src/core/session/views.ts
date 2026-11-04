import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isFrontPageAt } from "../brain/brain.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { acquireLock } from "../fs/lock.ts";
import { gitQuiet } from "../git.ts";
import { viewsPath } from "../state.ts";
import { sessionReads, type SessionReads } from "./session-reads.ts";
import { readJson } from "../util.ts";

/**
 * What each session on this machine saw of each shared brain: the commit on disk at its start, and the one the session
 * before saw. "What is new since your last session" (§4.1) is what lies between the two.
 */
export interface View {
  current: string;
  previous?: string;
  /** The session that recorded this view did not show its news (cut, or the summary off): the next keeps `previous`. */
  held?: true;
}

export function readViews(home: string): Record<string, View> {
  const raw = readJson(viewsPath(home));
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, View>) : {};
}

/**
 * Record this session's view of each brain: the commit on disk becomes `current`, and what was `current` becomes
 * `previous`, unless the view is held, whose `previous` stays. A brain seen for the first time has no `previous`, so
 * nothing is new in it yet. Returns the views.
 */
export async function recordViews(
  home: string,
  brains: { key: string; root: string }[],
): Promise<Record<string, View>> {
  const heads = brains.flatMap((b) => {
    const head = gitQuiet(b.root, ["rev-parse", "HEAD"]);
    return head === undefined ? [] : [{ key: b.key, head }];
  });
  return withViews(home, (views) => {
    for (const { key, head } of heads) {
      const old = views[key];
      const previous = old?.held ? old.previous : old?.current;
      views[key] = previous === undefined ? { current: head } : { previous, current: head };
    }
  });
}

/** Hold the views of brains whose news this session did not show, so that the next session shows it (§4.1, item 7). */
export async function holdViews(home: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await withViews(home, (views) => {
    for (const k of keys) if (views[k]?.previous !== undefined) views[k] = { ...views[k]!, held: true };
  });
}

/** Change the views under the machine's lock and write them back. */
async function withViews(home: string, change: (views: Record<string, View>) => void): Promise<Record<string, View>> {
  mkdirSync(join(home, ".kioku"), { recursive: true });
  // Two sessions starting at once must not each keep one brain's view and lose the other's: what is new since the
  // last session is read from it (§4.1).
  const lock = await acquireLock(join(home, ".kioku", "lock"));
  try {
    const views = readViews(home);
    change(views);
    writeAtomic(viewsPath(home), `${JSON.stringify(views, null, 2)}\n`);
    return views;
  } finally {
    lock.release();
  }
}

export interface NewPage {
  change: "added" | "changed";
  path: string;
  title: string;
}

/**
 * The pages added or changed in a brain between two commits by someone other than this machine's git identity, one
 * entry per page, in the order they were last touched, newest first. Pages since removed are left out.
 */
export function newSince(
  root: string,
  view: View | undefined,
  brainFile: SessionReads["brainFile"] = sessionReads().brainFile,
): NewPage[] {
  if (view?.previous === undefined || view.previous === view.current) return [];
  // Who this machine commits as, as git resolves it (configuration or environment).
  const me = /<([^>]*)>/.exec(gitQuiet(root, ["var", "GIT_AUTHOR_IDENT"]) ?? "")?.[1];
  // One `git log` for the whole span, each commit's files with it: a session's start does not spawn git per commit.
  const log = gitQuiet(root, [
    "log",
    "--no-merges",
    "--no-renames",
    "--relative",
    "--name-status",
    "--format=%x1e%ae",
    `${view.previous}..${view.current}`,
    "--",
    ".",
  ]);
  if (log === undefined) return [];
  const seen = new Map<string, NewPage>();
  for (const record of log.split("\x1e").slice(1)) {
    const [email, ...changes] = record.trim().split("\n");
    if (me !== undefined && email === me) continue;
    for (const entry of changes) {
      const [status, path] = entry.split("\t");
      if (!path || !path.endsWith(".md") || isFrontPageAt(path) || seen.has(path)) continue;
      if (status !== "A" && status !== "M") continue;
      const file = join(root, path);
      if (!existsSync(file)) continue;
      const parsed = brainFile(file);
      seen.set(path, {
        change: status === "A" ? "added" : "changed",
        path,
        title: (parsed.ok && parsed.file.front.getString("title")) || path,
      });
    }
  }
  return [...seen.values()];
}
