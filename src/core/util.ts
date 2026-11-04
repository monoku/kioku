import { readFileSync } from "node:fs";

/** A file's JSON, or undefined when it is not there or does not parse: what a machine state file gives when it has none. */
export function readJson<T = unknown>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Each line of a text that is a JSON object: a command's output, a session's journal. */
export function jsonLines(text: string): Record<string, unknown>[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim().startsWith("{")) return [];
    try {
      const r = JSON.parse(line);
      return r !== null && typeof r === "object" && !Array.isArray(r) ? [r as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

/**
 * An answer of a writing verb that wrote: `done`, and published or on its way to be; or an `error` met after the
 * commit was made, which carries it (§1.6), so that the journal never misses a write that exists.
 */
export const isDoneWrite = (r: { status?: unknown; publication?: unknown; commit?: unknown }): boolean =>
  (r.status === "done" && (r.publication === "pushed" || r.publication === "pending" || r.publication === "local")) ||
  (r.status === "error" && typeof r.commit === "string");

/** A count with its noun: `1 page`, `3 pages`. */
export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Words as a sentence lists them: `a`, `a and b`, `a, b and c`. */
export const listWords = (words: readonly string[], last: "and" | "or" = "and"): string =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}`;

/** Each name once, in the order met, comma-separated. */
export const commas = (items: readonly string[]): string => [...new Set(items)].join(", ");
