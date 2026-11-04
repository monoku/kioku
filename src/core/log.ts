import { gitQuiet } from "./git.ts";

/** The verbs that write a page, as their commits begin (§3.5). */
export const WRITING_VERBS = [
  "save",
  "update",
  "supersede",
  "forget",
  "evolve",
  "link",
  "confirm",
  "retire",
  "rename",
  "move",
] as const;
export type WritingVerb = (typeof WRITING_VERBS)[number];

/** One write found in a brain's history. */
export interface Write {
  verb: WritingVerb;
  /** The page's title; for a supersede, the new decision's. */
  title: string;
  /** The decision a supersede replaced, by its title. */
  replaces?: string;
  /** The page the verb is about, relative to the brain: the one written, updated or forgotten; for `evolve`, the Skill; for `link`, the first page git lists of the two. */
  path: string;
  date: string;
  author: string;
  /** How the write arrived, from the commit's `Kioku-Via` trailer (§1.6); null for a commit that has none. */
  via: string | null;
  commit: string;
}

/** What each verb does to the page it is about, as git reports the file. */
const STATUS: Record<WritingVerb, string> = {
  save: "A",
  update: "M",
  supersede: "A",
  forget: "D",
  evolve: "A",
  link: "M",
  confirm: "M",
  retire: "M",
  rename: "A",
  move: "A",
};
const SUBJECT = new RegExp(`^(${WRITING_VERBS.join("|")}): (.*)$`);

/**
 * The writes of one brain since a moment (§6.1), newest first: the commits whose message is `<verb>: <title>`,
 * read from git, so that a write made on another machine and pulled shows too. Nothing when the brain's history
 * cannot be read.
 */
export function writesSince(root: string, since: Date): Write[] {
  const out = gitQuiet(root, [
    "log",
    `--since=${since.toISOString()}`,
    "--no-merges",
    "--no-renames",
    "--relative",
    "--name-status",
    "--format=%x1e%h%x1f%aI%x1f%an%x1f%s%x1f%(trailers:key=Kioku-Via,valueonly,unfold)",
    "--",
    ".",
  ]);
  if (out === undefined) return [];
  const writes: Write[] = [];
  for (const record of out.split("\x1e").slice(1)) {
    const [head, ...files] = record.trim().split("\n");
    const [commit, date, author, subject, trailer] = head!.split("\x1f") as [
      string,
      string,
      string,
      string,
      string | undefined,
    ];
    const m = SUBJECT.exec(subject);
    if (m === null) continue;
    const verb = m[1] as WritingVerb;
    const changed = files
      .filter(Boolean)
      .map((l) => l.split("\t") as [string, string])
      .filter(([, p]) => p.endsWith(".md"));
    const page = changed.find(([s]) => s === STATUS[verb]) ?? changed[0];
    if (page === undefined) continue;
    const replaced = verb === "supersede" ? /^(.*) \(replaces (.*)\)$/.exec(m[2]!) : null;
    writes.push({
      verb,
      title: replaced?.[1] ?? m[2]!,
      ...(replaced && { replaces: replaced[2]! }),
      path: page[1],
      date,
      author,
      via: trailer?.trim() || null,
      commit,
    });
  }
  return writes;
}

/**
 * The moment `--since` names, against `now`: `today` and `yesterday` from local midnight, a date `YYYY-MM-DD` from
 * its local midnight, or a span back from now (`12h`, `3d`, `2w`). Undefined when it is none of these.
 */
export function parseSince(text: string, now: Date): Date | undefined {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (text === "today") return midnight(now);
  if (text === "yesterday") return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) {
    const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return d.getMonth() === Number(day[2]) - 1 && d.getDate() === Number(day[3]) ? d : undefined;
  }
  const span = /^(\d+)([hdw])$/.exec(text);
  if (span)
    return new Date(
      now.getTime() - Number(span[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[span[2] as "h" | "d" | "w"],
    );
  return undefined;
}
