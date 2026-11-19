import { gitQuiet } from "./git.ts";

/** A commit that raises a brain's format, or puts pages where the format keeps them (§3.2): it moves pages and says nothing new of them. */
const movesOnly = (subject: string): boolean => /^format: \d/.test(subject);

/**
 * When each page of a brain was last touched (§3.3): the day of the last commit that changed it, read
 * from the brain's history and never written into the file. One `git log` per brain, the newest commit first, so the
 * first time a path appears is its last touch. A page keeps its history across a move (§3.2): a commit that changed it
 * at an earlier path counts, and one that only moved pages to where a format keeps them is no touch. A page with no
 * commit yet, or a brain whose history cannot be read, has none.
 */
export function lastTouched(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const log = gitQuiet(root, [
    "log",
    "--no-merges",
    "-M",
    "--relative",
    "--name-status",
    "--format=%x1e%aI%x1f%s",
    "--",
    ".",
  ]);
  if (log === undefined) return out;
  // The path each earlier path is known by now.
  const now = new Map<string, string>();
  for (const record of log.split("\x1e").slice(1)) {
    const [head, ...files] = record.trim().split("\n");
    const [date, subject] = head!.split("\x1f");
    const day = date!.trim().slice(0, 10);
    const touches = !movesOnly(subject ?? "");
    for (const f of files) {
      const [status, first, second] = f.trim().split("\t");
      if (status === undefined || first === undefined) continue;
      const path = second ?? first;
      const known = now.get(path) ?? path;
      if (second !== undefined) now.set(first, known);
      if (touches && !out.has(known)) out.set(known, day);
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

/**
 * The commits that changed one page, newest first, read from the brain's history, across its moves (§3.2): the ones
 * that changed it at an earlier path are its too. None when git cannot be read.
 */
export function historyOf(root: string, rel: string): HistoryEntry[] {
  const log = gitQuiet(root, ["log", "--no-merges", "--follow", "-M", "--format=%H%x1f%aI%x1f%aN%x1f%s", "--", rel]);
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
