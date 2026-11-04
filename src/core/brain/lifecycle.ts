import { isMap, isSeq, type Document } from "yaml";
import type { Frontmatter } from "./front-matter.ts";

/**
 * Where a page is in its life, as two optional front matter fields (§3.3): `status: deprecated` says it
 * is no longer current, and `verified` says who last confirmed it was still true, and when.
 */

/** The only status a page carries: absent is current. */
export const DEPRECATED = "deprecated";
export const STATUSES = ["stable", DEPRECATED] as const;

export interface Verification {
  /** Who confirmed it: `human:<user>`. */
  by: string;
  /** When: an ISO 8601 moment in UTC. */
  at: string;
}

/** Whether the page was retired: it is history, kept so that links to it still arrive somewhere. */
export const isRetired = (front: Frontmatter): boolean => front.getString("status") === DEPRECATED;

/** The latest confirmation on the page, from a single mapping or a list of them; undefined when there is none. */
export function verifiedOf(front: Frontmatter): Verification | undefined {
  const node = (front.doc as Document).get("verified", true);
  const json =
    node !== null && typeof node === "object" && "toJSON" in node
      ? (node as { toJSON(): unknown }).toJSON()
      : undefined;
  const entries = Array.isArray(json) ? json : json !== undefined && json !== null ? [json] : [];
  const found = entries
    .filter((e): e is { by: unknown; at: unknown } => e !== null && typeof e === "object" && "at" in e)
    .map((e) => ({
      by: typeof e.by === "string" ? e.by : "",
      at: typeof e.at === "string" ? e.at : e.at instanceof Date ? e.at.toISOString() : String(e.at),
    }))
    .filter((e) => e.at !== "")
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return found.at(-1);
}

/** Replace the page's confirmations with this one; git keeps the earlier ones. */
export function setVerified(front: Frontmatter, v: Verification): void {
  const doc = front.doc as Document;
  doc.set("verified", doc.createNode([{ by: v.by, at: v.at }]));
}

/** Whether `verified` has the shape the format gives it, for the validator: a mapping or a list of mappings with an `at`. */
export function verifiedShapeProblem(front: Frontmatter): string | undefined {
  const node = (front.doc as Document).get("verified", true);
  if (node === undefined || node === null) return undefined;
  const items = isSeq(node) ? node.items : [node];
  for (const item of items) {
    if (!isMap(item)) return "`verified` is a list of `by` and `at` entries";
    const at = item.get("at");
    if (at === undefined || at === null || String(at) === "") return "a `verified` entry has no `at`";
  }
  return undefined;
}
