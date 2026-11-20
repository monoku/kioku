import { globMatches, globProblem } from "./brain/applies.ts";
import { gitQuiet } from "./git.ts";
import { lintReportPath } from "./state.ts";
import { readJson } from "./util.ts";

/**
 * The code a page is about changed after the page (§4.4): the files its `applies_to` names, in the project folder,
 * have commits of a later day than the one the page was last changed or confirmed. Read from the folder's git, with
 * no model; what is not committed is the session's own work and says nothing.
 */

/** What the code did after a page's day: how many commits touched its files, and the day of the last. */
export interface Outpaced {
  /** The page's day the commits are counted from. */
  since: string;
  commits: number;
  last: string;
}

/**
 * The commits of `folder` that touched these paths on a later day than `day`, by the author's day, as a page's last
 * touch is counted (§3.3). Undefined when there are none, and where the folder is no repository or git cannot be read.
 */
export function commitsAfter(
  folder: string,
  day: string,
  paths: string[],
): { commits: number; last: string } | undefined {
  if (paths.length === 0) return undefined;
  // The floor only spares git the older history; the author's day decides.
  const log = gitQuiet(folder, ["log", "--no-merges", `--since=${day}T00:00:00`, "--format=%as", "--", ...paths]);
  const days = (log ?? "")
    .split("\n")
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d > day)
    .sort();
  return days.length === 0 ? undefined : { commits: days.length, last: days.at(-1)! };
}

/**
 * What the code did after each of these pages (§4.4), by path: one question to git for them all, the folder's commits
 * since the oldest page's day with the files each touched, which the pages' globs are then held against as §3.3 reads
 * them. One question a page took a brain of two hundred such pages eight seconds; this takes one. None where the
 * folder is no repository, git cannot be read, or the history since is more than the tool reads at once.
 */
export function outpacedPages(
  folder: string,
  pages: { path: string; day: string; globs: string[] }[],
): Map<string, Outpaced> {
  const out = new Map<string, Outpaced>();
  const asked = pages.filter((p) => p.globs.some((g) => globProblem(g) === undefined));
  if (asked.length === 0) return out;
  const floor = asked.map((p) => p.day).sort()[0]!;
  let log: string | undefined;
  try {
    log = gitQuiet(folder, [
      "log",
      "--no-merges",
      "--relative",
      "--name-only",
      `--since=${floor}T00:00:00`,
      "--format=%x1e%as",
      "--",
      ".",
    ]);
  } catch {
    log = undefined;
  }
  const commits = (log ?? "")
    .split("\x1e")
    .slice(1)
    .map((record) => {
      const [day, ...files] = record.split("\n").map((l) => l.trim());
      return { day: day ?? "", files: files.filter((f) => f !== "") };
    })
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.day));
  for (const p of asked) {
    const days = commits
      .filter((c) => c.day > p.day && c.files.some((f) => p.globs.some((g) => globMatches(g, f))))
      .map((c) => c.day)
      .sort();
    if (days.length > 0) out.set(p.path, { since: p.day, commits: days.length, last: days.at(-1)! });
  }
  return out;
}

/** What one file of the project folder, relative to it, did after `day`. */
export function fileOutpaced(folder: string, day: string, file: string): Outpaced | undefined {
  const found = commitsAfter(folder, day, [`:(literal)${file}`]);
  return found === undefined ? undefined : { since: day, ...found };
}

/** The list a report recorded, and when it was worked out. */
export interface RecordedOutpaced {
  as_of: string | null;
  pages: Map<string, Outpaced>;
}

/** The pages of a brain the code had outpaced when its report was last recorded (§4.4), by path; none on a machine with no report. */
export function recordedOutpaced(home: string, brain: string): RecordedOutpaced {
  type Kept = { report?: { outpaced?: ({ path: string } & Outpaced)[]; outpaced_as_of?: string | null } };
  let report: Kept["report"];
  try {
    report = readJson<Record<string, Kept>>(lintReportPath(home))?.[brain]?.report;
  } catch {
    report = undefined;
  }
  return {
    as_of: report?.outpaced_as_of ?? null,
    pages: new Map((report?.outpaced ?? []).map(({ path, ...o }) => [path, o])),
  };
}
