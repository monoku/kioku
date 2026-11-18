import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./fs/atomic.ts";
import { readsStatePath } from "./state.ts";
import { readJson } from "./util.ts";

/**
 * What this machine counts of the pages it opens (§4.5): per page, by the brain and the page's `id`, how many times
 * it was opened with `page show` and how many times it was only offered (a line of the summary, or a recall), and the
 * day of the last of each; and, of the offers, how many were a recall's and how many of those the session then opened.
 * Machine state, never in a brain; it holds no text and no prompt, and losing it costs a count.
 */
export interface ReadEntry {
  opened: number;
  last_opened: string | null;
  surfaced: number;
  last_surfaced: string | null;
  /** Times a recall named the page, at a prompt or at a file (§4.7); absent in an entry from before it was counted. */
  recalled?: number;
  /** Of those, the times the session that was given the page then opened it. */
  followed?: number;
}

export interface ReadsState {
  /** The day this machine began to count: a page is not asked about before it could have been seen. */
  counting_since: string;
  /** By the brain's key, then the page's `id`. */
  brains: Record<string, Record<string, ReadEntry>>;
}

const day = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The count, or undefined when the machine has not begun one (or it is unreadable: a count is only a count). */
export function readReads(home: string): ReadsState | undefined {
  const raw = readJson<ReadsState>(readsStatePath(home));
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.counting_since !== "string" ||
    typeof raw.brains !== "object" ||
    raw.brains === null
  )
    return undefined;
  return raw;
}

function change(home: string, now: Date, fn: (state: ReadsState) => void): void {
  const state = readReads(home) ?? { counting_since: day(now), brains: {} };
  fn(state);
  mkdirSync(join(home, ".kioku"), { recursive: true });
  writeAtomic(readsStatePath(home), `${JSON.stringify(state)}\n`);
}

const entryOf = (state: ReadsState, brain: string, id: string): ReadEntry =>
  ((state.brains[brain] ??= {})[id] ??= { opened: 0, last_opened: null, surfaced: 0, last_surfaced: null });

/** A page was opened with `page show`. A page with no `id` has nothing to be counted by. */
export function recordOpened(home: string, now: Date, brain: string, id: string | null | undefined): void {
  if (!id) return;
  change(home, now, (s) => {
    const e = entryOf(s, brain, id);
    e.opened += 1;
    e.last_opened = day(now);
  });
}

/** These pages were offered, once each: in a session's summary, or, with `recalled`, by a recall (§4.7). */
export function recordSurfaced(
  home: string,
  now: Date,
  pages: { brain: string; id: string | null | undefined }[],
  recalled = false,
): void {
  const seen = pages.filter((p): p is { brain: string; id: string } => Boolean(p.id));
  if (seen.length === 0) return;
  change(home, now, (s) => {
    for (const p of seen) {
      const e = entryOf(s, p.brain, p.id);
      e.surfaced += 1;
      e.last_surfaced = day(now);
      if (recalled) e.recalled = (e.recalled ?? 0) + 1;
    }
  });
}

/** A session opened these pages after a recall named them to it (§4.5): what tells a recall that helped from one that did not. */
export function recordFollowed(home: string, now: Date, pages: { brain: string; id: string }[]): void {
  if (pages.length === 0) return;
  change(home, now, (s) => {
    for (const p of pages) {
      const e = entryOf(s, p.brain, p.id);
      e.followed = (e.followed ?? 0) + 1;
    }
  });
}

/** Drop the entries of pages that a brain no longer holds; `live` is the ids of the brains it knows, and the rest are left alone. */
export function purgeReads(home: string, live: Record<string, Set<string>>): void {
  const state = readReads(home);
  if (state === undefined) return;
  let changed = false;
  for (const [brain, entries] of Object.entries(state.brains)) {
    const ids = live[brain];
    if (ids === undefined) continue;
    for (const id of Object.keys(entries)) {
      if (!ids.has(id)) {
        delete entries[id];
        changed = true;
      }
    }
  }
  if (changed) writeAtomic(readsStatePath(home), `${JSON.stringify(state)}\n`);
}
