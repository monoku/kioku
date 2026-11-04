import { gitQuiet } from "./git.ts";

/**
 * When each page of a brain was last touched (§3.3): the day of the last commit that changed it, read
 * from the brain's history and never written into the file. One `git log` per brain, the newest commit first, so the
 * first time a path appears is its last touch. A page with no commit yet, or a brain whose history cannot be read,
 * has none.
 */
export function lastTouched(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const log = gitQuiet(root, [
    "log",
    "--no-merges",
    "--no-renames",
    "--relative",
    "--name-only",
    "--format=%x1e%aI",
    "--",
    ".",
  ]);
  if (log === undefined) return out;
  for (const record of log.split("\x1e").slice(1)) {
    const [head, ...files] = record.trim().split("\n");
    const day = head!.trim().slice(0, 10);
    for (const f of files) {
      const path = f.trim();
      if (path !== "" && !out.has(path)) out.set(path, day);
    }
  }
  return out;
}

/** One commit that changed a page (§3.3). */
export interface HistoryEntry {
  commit: string;
  /** The author date's day, YYYY-MM-DD. */
  date: string;
  author: string;
  message: string;
}

/** The commits that changed one page, newest first, read from the brain's history; none when git cannot be read. */
export function historyOf(root: string, rel: string): HistoryEntry[] {
  const log = gitQuiet(root, ["log", "--no-merges", "--no-renames", "--format=%H%x1f%aI%x1f%aN%x1f%s", "--", rel]);
  if (log === undefined) return [];
  return log.split("\n").flatMap((line) => {
    const [commit, date, author, message] = line.split("\x1f");
    return commit !== undefined && date !== undefined
      ? [{ commit, date: date.slice(0, 10), author: author ?? "", message: message ?? "" }]
      : [];
  });
}

/** The last touch of one page, or null for a page git has not seen. */
export const touchedOf = (touched: Map<string, string>, rel: string): string | null => touched.get(rel) ?? null;
