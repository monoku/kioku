import { cleanGlob, globProblem } from "./brain/applies.ts";
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

/** A glob of `applies_to` as git reads it: without a wildcard a file, or a folder and what is under it, as §3.3 has it. */
const pathspecOf = (glob: string): string => `${/[*?]/.test(glob) ? ":(glob)" : ":(literal)"}${cleanGlob(glob)}`;

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

/** What the files a page's globs match did after `day`, in the project folder. */
export function outpacedBy(folder: string, day: string, globs: string[]): Outpaced | undefined {
  const found = commitsAfter(folder, day, globs.filter((g) => globProblem(g) === undefined).map(pathspecOf));
  return found === undefined ? undefined : { since: day, ...found };
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
