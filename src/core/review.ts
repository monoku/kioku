import type { BrainFile } from "./brain/file.ts";
import { placementOf } from "./brain/kinds.ts";
import { isRetired, verifiedOf } from "./brain/lifecycle.ts";
import type { Outpaced } from "./outpaced.ts";
import { plural } from "./util.ts";

/**
 * Whether a page is due a second look (§4.4): past the date its writer set, or not changed or confirmed for longer
 * than its kind lasts. One judgement, which `brain lint` lists and every place a page is given says beside it.
 */

/**
 * How many days a kind of page lasts without being changed or confirmed before `lint` asks. What changes
 * under people (context: who, where, which client) is asked after nine months; a way of working, a Rule or a Skill, a
 * year. A decision is history and an instinct has its own staleness: neither is asked.
 */
export const CONFIRM_DAYS = { context: 270, playbook: 365, rule: 365, skill: 365, memory: 365 } as const;

/** Why a page is due a second look, and the day it counts from: its `stale_after`, or its last change or confirmation. */
export interface Review {
  reason: "outpaced" | "expired" | "unconfirmed";
  since: string;
  /** For `outpaced`: how many commits touched the page's files after that day, and the day of the last. */
  commits?: number;
  last?: string;
}

/** The day a page was last changed or confirmed (§4.4): the latest of its last touch, its last confirmation and the day it was created. */
export const pageDay = (file: BrainFile, touched: string | null): string | undefined =>
  [touched, verifiedOf(file.front)?.at, file.front.getString("created")]
    .filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x))
    .map((x) => x.slice(0, 10))
    .sort()
    .at(-1);

/** Whole days from `date` (YYYY-MM-DD, local) to `now`. */
export const daysSince = (date: string, now: Date): number => {
  const [y, m, d] = date.split("-").map(Number);
  const then = new Date(y!, m! - 1, d!);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
};

/** The `stale_after` of a page whose day has come (§3.3), the day itself included. */
export function expiredSince(file: BrainFile, now: Date): string | undefined {
  const due = file.front.getString("stale_after");
  return due !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(due) && due <= now.toISOString().slice(0, 10)
    ? due
    : undefined;
}

/**
 * Since when nobody has changed or confirmed a page that its kind asks about, when that is longer than the kind
 * lasts (§4.4): the latest of its last touch, its last confirmation and the day it was created.
 */
export function unconfirmedSince(
  rel: string,
  file: BrainFile,
  touched: string | null,
  now: Date,
): { since: string; days: number; window: number } | undefined {
  const place = placementOf(rel);
  const kind = place === undefined ? undefined : (place.sub ?? place.kind);
  const window =
    kind !== undefined && kind in CONFIRM_DAYS ? CONFIRM_DAYS[kind as keyof typeof CONFIRM_DAYS] : undefined;
  if (window === undefined) return undefined;
  const since = pageDay(file, touched);
  if (since === undefined) return undefined;
  const days = daysSince(since, now);
  return days > window ? { since, days, window } : undefined;
}

/**
 * The mark of a page (§4.4), none for a retired page or a superseded decision's code: that the code outpaced it first,
 * which is evidence, and holds only while the page's day is the one the commits were counted from; then the writer's
 * own date; then the calendar of its kind.
 */
export function reviewOf(
  rel: string,
  file: BrainFile,
  touched: string | null,
  now: Date,
  outpaced?: Outpaced,
): Review | undefined {
  if (isRetired(file.front)) return undefined;
  if (outpaced !== undefined && outpaced.since === pageDay(file, touched))
    return { reason: "outpaced", since: outpaced.since, commits: outpaced.commits, last: outpaced.last };
  const expired = expiredSince(file, now);
  if (expired !== undefined) return { reason: "expired", since: expired };
  const unconfirmed = unconfirmedSince(rel, file, touched, now);
  return unconfirmed === undefined ? undefined : { reason: "unconfirmed", since: unconfirmed.since };
}

/** The mark in words, short enough to end a line. */
export const reviewSaid = (r: Review, atFile = false): string =>
  r.reason === "outpaced"
    ? `${atFile ? "this file" : "its files"} changed after it: ${plural(r.commits ?? 0, "commit")} since ${r.since}, last ${r.last}`
    : r.reason === "expired"
      ? `past its date, ${r.since}`
      : `not changed or confirmed since ${r.since}`;

/** What to do about a marked page, said once wherever some are. */
export const REVIEW_ADVICE =
  "check a page marked as due a look before relying on it; `kioku page confirm <path> --brain <brain>` says it is still true, and an update says what changed";
