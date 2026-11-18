import { WRITING_VERBS, type Write, type WritingVerb } from "./log.ts";
import type { ReadsState } from "./reads.ts";

/** What the writes of one brain over a span add up to (§6.1): a signal to look at, not a verdict. */
export interface BrainStats {
  /** Every write, and each verb's share of them; every verb is there, with 0 when it did not write. */
  writes: number;
  by_verb: Record<WritingVerb, number>;
  /** Pages made in the span. */
  saved: number;
  /** Of those, the ones forgotten within the span and not restored since, matched by path. */
  reverted: number;
  /** `reverted` over `saved`, to two decimals; null when nothing was saved. */
  revert_rate: number | null;
  confirmed: number;
  /** The same counts by how the writes arrived (`Kioku-Via`, §1.6), for each way seen; `unknown` for a commit that has no trailer. Never by person. */
  by_via: Record<string, ViaStats>;
}

/** What the writes that arrived one way add up to. */
export interface ViaStats {
  writes: number;
  saved: number;
  reverted: number;
  revert_rate: number | null;
}

/** The way a commit with no trailer is counted under. */
export const UNKNOWN_VIA = "unknown";

/**
 * Add up a brain's writes (§6.1). A page saved before the span and forgotten in it is a forget and nothing more:
 * only what the span saw of both ends is a reverted save. No author is kept.
 */
export function statsOf(writes: Write[]): BrainStats {
  const by_verb = Object.fromEntries(WRITING_VERBS.map((v) => [v, 0])) as Record<WritingVerb, number>;
  for (const w of writes) by_verb[w.verb] += 1;
  const saved = new Set(writes.filter((w) => w.verb === "save").map((w) => w.path));
  // A page forgotten and then restored was not rejected: what counts is the last of the two, and the writes come newest first.
  const last = new Map<string, WritingVerb>();
  for (const w of writes)
    if ((w.verb === "forget" || w.verb === "restore") && !last.has(w.path)) last.set(w.path, w.verb);
  const forgotten = new Set([...last].filter(([, verb]) => verb === "forget").map(([path]) => path));
  const reverted = [...saved].filter((p) => forgotten.has(p)).length;
  const by_via: Record<string, ViaStats> = {};
  for (const via of new Set(writes.map((w) => w.via ?? UNKNOWN_VIA))) {
    const mine = writes.filter((w) => (w.via ?? UNKNOWN_VIA) === via);
    const mineSaved = new Set(mine.filter((w) => w.verb === "save").map((w) => w.path));
    const mineReverted = [...mineSaved].filter((p) => forgotten.has(p)).length;
    by_via[via] = {
      writes: mine.length,
      saved: mineSaved.size,
      reverted: mineReverted,
      revert_rate: mineSaved.size === 0 ? null : Math.round((mineReverted / mineSaved.size) * 100) / 100,
    };
  }
  return {
    writes: writes.length,
    by_verb,
    saved: saved.size,
    reverted,
    revert_rate: saved.size === 0 ? null : Math.round((reverted / saved.size) * 100) / 100,
    confirmed: by_verb.confirm,
    by_via,
  };
}

/** What this machine counted of a brain's pages (§4.5); every field null when it does not count. */
export interface ReadStats {
  /** Pages opened since the machine began to count. */
  opened: number | null;
  /** Pages `brain lint` lists as unopened. */
  unopened: number | null;
  /** Times a recall named a page of the brain, at a prompt or at a file (§4.7). */
  recalled: number | null;
  /** Of those, the times the session that was given the page then opened it. */
  followed: number | null;
  /** `followed` over `recalled`, to two decimals; null when no recall named a page. */
  follow_rate: number | null;
  /** The day the machine began to count; null when it does not, or has not yet. */
  counting_since: string | null;
}

/** The count of one brain: `reads` is undefined while nothing is counted, and `unopened` is its lint's list. */
export function readStatsOf(reads: ReadsState | undefined, brainKey: string, unopened: number): ReadStats {
  const entries = Object.values(reads?.brains[brainKey] ?? {});
  const recalled = entries.reduce((n, e) => n + (e.recalled ?? 0), 0);
  const followed = entries.reduce((n, e) => n + (e.followed ?? 0), 0);
  return {
    opened: entries.filter((e) => e.opened > 0).length,
    unopened,
    recalled,
    followed,
    follow_rate: recalled === 0 ? null : Math.round((followed / recalled) * 100) / 100,
    counting_since: reads?.counting_since ?? null,
  };
}
