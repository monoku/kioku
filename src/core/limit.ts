import { type Field, namedError } from "./errors.ts";

/**
 * How many entries an answer that grows with a brain gives when `--limit` is not (§6.1, bounded answers): one number
 * for `page list`, `page search`, `brain log` and each category of `brain lint`; `namespace list` is not bounded.
 */
export const DEFAULT_LIMIT = 20;

/** A whole number, `min` or more, given as a field's text. */
export function count(name: Field, text: string | undefined, min: number): number | undefined {
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text) || Number(text) < min)
    throw namedError((n) => `${n.field(name)} takes a whole number, ${min} or more`);
  return Number(text);
}

/** The window of a list an answer gives: `--limit` from `--offset`, `DEFAULT_LIMIT` long when no limit is given. */
export function windowOf(
  limitText: string | undefined,
  offsetText: string | undefined,
): { limit: number; offset: number } {
  return { limit: count("limit", limitText, 1) ?? DEFAULT_LIMIT, offset: count("offset", offsetText, 0) ?? 0 };
}

/** The `--offset` that reads on after a window of `shown` entries from `offset` in a list of `total`, or null at its end. */
export const nextOf = (total: number, offset: number, shown: number): number | null =>
  offset + shown < total ? offset + shown : null;

/** A window of a list with what the answer says about it: `total`, `offset`, `limit` and `next` (§6.1). */
export function windowing<T>(
  items: T[],
  offset: number,
  limit: number,
): { part: T[]; total: number; offset: number; limit: number; next: number | null } {
  const part = items.slice(offset, offset + limit);
  return { part, total: items.length, offset, limit, next: nextOf(items.length, offset, part.length) };
}
