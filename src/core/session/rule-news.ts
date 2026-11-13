import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBrainFile } from "../brain/file.ts";
import { isRetired } from "../brain/lifecycle.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { acquireLock } from "../fs/lock.ts";
import { gitQuiet } from "../git.ts";
import { rulesSeenPath } from "../state.ts";
import { readJson } from "../util.ts";

/**
 * The Rules of a shared brain that changed since this machine was last told (§1.2, §4.1): a Rule goes whole into every
 * session, and any teammate who can push writes one, so the person is told of each change, once. The machine keeps,
 * per brain, the commit it has told up to; it is not the view the summary's news is read from, which a cut summary
 * holds and a resumed session leaves alone.
 */

export interface RuleChange {
  change: "added" | "changed" | "retired" | "removed";
  path: string;
  title: string;
  /** Who made the last change, as its commit names them: a label, not a proof. */
  author: string;
}

/** The folder of the Rules (§3.1). */
const RULES = "rules";
/** Verbs whose commit leaves what a Rule says as it was (§3.5). */
const SAYS_THE_SAME = /^(confirm|link): /;

/** What a Rule's page says of itself, from its text. */
function read(text: string | undefined): { id?: string; title?: string; retired: boolean } | undefined {
  if (text === undefined) return undefined;
  const parsed = parseBrainFile(text);
  if (!parsed.ok) return { retired: false };
  const id = parsed.file.front.getString("id");
  const title = parsed.file.front.getString("title");
  return {
    ...(id !== undefined && { id }),
    ...(title !== undefined && { title }),
    retired: isRetired(parsed.file.front),
  };
}

/**
 * The Rules that others changed in a brain between two commits, one entry a Rule, the last touched first: added,
 * changed, retired, or removed, whatever verb or plain commit did it. A commit of this machine's git identity is not
 * told, nor one that only confirms or links. A Rule renamed is one change, not a removal and an addition.
 */
export function rulesChanged(root: string, from: string, to: string): RuleChange[] {
  const me = /<([^>]*)>/.exec(gitQuiet(root, ["var", "GIT_AUTHOR_IDENT"]) ?? "")?.[1];
  const log = gitQuiet(root, [
    "log",
    "--no-merges",
    "--no-renames",
    "--relative",
    "--name-only",
    "--format=%x1e%ae%x1f%an%x1f%s",
    `${from}..${to}`,
    "--",
    RULES,
  ]);
  if (log === undefined) return [];
  const authors = new Map<string, string>();
  for (const record of log.split("\x1e").slice(1)) {
    const [head, ...paths] = record.trim().split("\n");
    const [email, name, subject] = head!.split("\x1f") as [string, string, string | undefined];
    if ((me !== undefined && email === me) || SAYS_THE_SAME.test(subject ?? "")) continue;
    for (const path of paths)
      if (path.startsWith(`${RULES}/`) && path.endsWith(".md") && !authors.has(path)) authors.set(path, name);
  }
  const changes: (RuleChange & { id?: string })[] = [];
  for (const [path, author] of authors) {
    const before = read(gitQuiet(root, ["show", `${from}:./${path}`]));
    const file = join(root, path);
    const now = existsSync(file) ? read(readFileSync(file, "utf8")) : undefined;
    // Added and gone again inside the span: the person's sessions never had it.
    if (before === undefined && now === undefined) continue;
    const change =
      now === undefined
        ? "removed"
        : before === undefined
          ? "added"
          : now.retired && !before.retired
            ? "retired"
            : "changed";
    const id = (now ?? before)!.id;
    changes.push({ change, path, title: (now ?? before)!.title ?? path, author, ...(id !== undefined && { id }) });
  }
  // A rename deletes one path and adds another with the same `id`: said once, as a change, at the path it has now.
  const removed = new Set(changes.filter((c) => c.change === "removed" && c.id !== undefined).map((c) => c.id));
  return changes
    .filter((c) => !(c.change === "removed" && changes.some((o) => o !== c && o.id !== undefined && o.id === c.id)))
    .map(({ id, ...c }) => (c.change === "added" && removed.has(id) ? { ...c, change: "changed" as const } : c));
}

/**
 * The Rule changes to tell at this session's start, per brain, and never again: each brain's commit on disk becomes
 * the one told up to. A brain this machine sees for the first time tells nothing: there is no session before it.
 * Under the machine's lock, so two sessions starting at once do not both tell a change, or lose a brain's mark.
 */
export async function takeRuleNews(
  home: string,
  brains: { key: string; root: string }[],
): Promise<{ key: string; changes: RuleChange[] }[]> {
  const heads = brains.flatMap((b) => {
    const head = gitQuiet(b.root, ["rev-parse", "HEAD"]);
    return head === undefined ? [] : [{ ...b, head }];
  });
  const marks = (): Record<string, string> => {
    const raw = readJson(rulesSeenPath(home));
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  };
  // Nearly every session finds each brain where the last one left it: no lock is taken to learn that.
  const before = marks();
  if (heads.every((b) => before[b.key] === b.head)) return [];
  mkdirSync(join(home, ".kioku"), { recursive: true });
  const lock = await acquireLock(join(home, ".kioku", "lock"));
  try {
    const seen = marks();
    const moved = heads.filter((b) => seen[b.key] !== b.head);
    if (moved.length === 0) return [];
    const news = moved.flatMap((b) => {
      const from = seen[b.key];
      const changes = typeof from === "string" ? rulesChanged(b.root, from, b.head) : [];
      return changes.length === 0 ? [] : [{ key: b.key, changes }];
    });
    for (const b of moved) seen[b.key] = b.head;
    writeAtomic(rulesSeenPath(home), `${JSON.stringify(seen, null, 2)}\n`);
    return news;
  } finally {
    lock.release();
  }
}
