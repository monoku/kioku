import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { userError } from "./errors.ts";
import { writeAtomic } from "./fs/atomic.ts";
import { gitQuiet } from "./git.ts";
import type { JournalEntry } from "./session/journal.ts";
import { handoffsPath } from "./state.ts";
import { readJson } from "./util.ts";
import { findSecrets } from "./validate/secrets.ts";

/**
 * A handoff (§4.8): what the agent leaves when the person stops with work unfinished, for the next session in the same
 * place on this machine, so that it can go on from there. It is the short memory of a place, what holds until the
 * work is done; the brains are the long one, and the progress of a task is never a page (§1.1). Nor is it a document
 * to hand to someone else. Machine state, one a place, replaced by the next, never in a brain or in git, never
 * searched, and dropped when nobody has written it for `HANDOFF_DAYS`.
 */
export interface Handoff {
  /** When it was left, as an ISO date and time. */
  at: string;
  text: string;
  /** The pages of the memory the session that left it wrote and opened (§4.8), from its journal: names, never text. */
  pages?: HandoffPage[];
}

/** A page a session wrote or opened, as its handoff names it. */
export interface HandoffPage {
  brain: string;
  path: string;
  title: string;
  did: "wrote" | "opened";
}

/**
 * Where a handoff belongs (§4.8): a folder and, in a repository, the branch checked out there. The folder is the
 * nearest of the project folder, the one whose `kioku.yaml` a session there reads, and the top of the repository or of
 * the worktree; with neither, the folder itself. So a worktree has its own, a folder that is no repository has one
 * with no branch, and one checkout that moves between branches has one a branch.
 */
export interface Place {
  folder: string;
  /** Absent outside a repository, and with no branch checked out. */
  branch?: string;
}

/** A handoff is what it takes to go on, not a transcript: past this it is refused. */
export const HANDOFF_MAX = 4000;
/** A handoff this many days old says nothing true of the place any more, and is neither shown nor kept. */
export const HANDOFF_DAYS = 30;
/** The most pages a handoff names. */
export const HANDOFF_PAGES_MAX = 8;

/** The handoffs of one folder, by branch, `""` where there is none: what one file holds. */
type Branches = Record<string, Handoff>;

const real = (folder: string): string => {
  try {
    return realpathSync(folder);
  } catch {
    return resolve(folder);
  }
};

/**
 * A folder's file: one a folder, named by a hash of its path, under `~/.kioku/handoffs/`. One a folder and not one for
 * the machine, so that sessions in two folders, two worktrees say, that leave a handoff at the same moment never
 * write the same file.
 */
const fileOf = (home: string, folder: string): string =>
  join(handoffsPath(home), `${createHash("sha1").update(folder).digest("hex").slice(0, 16)}.json`);

/** Whether this machine holds any handoff at all: what lets a session's start ask git nothing when it holds none. */
export const anyHandoff = (home: string): boolean => existsSync(handoffsPath(home));

/** The place of a session or a call in `cwd`, whose project folder is `root` when it has one (§4.8). */
export function placeOf(cwd: string, root: string | undefined): Place {
  const top = gitQuiet(cwd, ["rev-parse", "--show-toplevel"])?.trim() || undefined;
  const branch = top === undefined ? undefined : gitQuiet(cwd, ["branch", "--show-current"])?.trim() || undefined;
  // The nearest of the two: both hold `cwd`, so the longer path is the one inside the other.
  const folders = [root, top].filter((f): f is string => f !== undefined).map(real);
  const folder = folders.sort((a, b) => b.length - a.length)[0] ?? real(cwd);
  return { folder, ...(branch !== undefined && { branch }) };
}

const fresh = (h: Handoff, now: Date): boolean => now.getTime() - Date.parse(h.at) < HANDOFF_DAYS * 86_400_000;

/** A folder's handoffs young enough to show, by branch. */
function readFolder(home: string, folder: string, now: Date): Branches {
  const raw = readJson<{ branches?: Branches }>(fileOf(home, folder))?.branches;
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([, h]) => typeof h?.at === "string" && typeof h?.text === "string" && fresh(h, now)),
  );
}

/**
 * Write a folder's handoffs, with the folder's path beside them for whoever opens the file. With none left the file
 * goes, and the folder of them with the last: it is what tells a session's start, and the hook's wrapper, that the
 * machine holds one (§4.8).
 */
function writeFolder(home: string, folder: string, branches: Branches): void {
  const file = fileOf(home, folder);
  if (Object.keys(branches).length > 0) {
    mkdirSync(handoffsPath(home), { recursive: true });
    writeAtomic(file, `${JSON.stringify({ folder, branches }, null, 2)}\n`);
    return;
  }
  rmSync(file, { force: true });
  try {
    rmdirSync(handoffsPath(home));
  } catch {
    /* another folder still has one */
  }
}

/**
 * Drop the files of the folders nobody left a handoff in for `HANDOFF_DAYS` (§4.8): a file's last write is its newest
 * handoff, so one older than that holds none to show. With the last file the folder of them goes, and the machine
 * holds no handoff again. What a session's start does before it looks for its own.
 */
export function pruneHandoffs(home: string, now: Date): void {
  const dir = handoffsPath(home);
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      if (now.getTime() - statSync(file).mtimeMs > HANDOFF_DAYS * 86_400_000) rmSync(file, { force: true });
    }
    rmdirSync(dir);
  } catch {
    /* not empty, not there, or another session got there first */
  }
}

/** The handoff of this place, when it has one young enough to show. */
export const readHandoff = (home: string, place: Place, now: Date): Handoff | undefined =>
  readFolder(home, place.folder, now)[place.branch ?? ""];

/** The handoffs the folder has on other branches than this place's, the latest first: where each is, and when it was left. */
export function handoffsElsewhere(home: string, place: Place, now: Date): { branch: string | null; at: string }[] {
  return Object.entries(readFolder(home, place.folder, now))
    .filter(([branch]) => branch !== (place.branch ?? ""))
    .map(([branch, h]) => ({ branch: branch === "" ? null : branch, at: h.at }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * Leave this place's handoff, in place of the one it had. Refused when empty, longer than `HANDOFF_MAX`, or holding
 * what is never written down (§1.5, layer 1): it is kept on the machine, and a secret is kept nowhere.
 */
export function setHandoff(home: string, place: Place, text: string, now: Date): Handoff {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (clean === "")
    throw userError("the handoff comes on stdin: where the work stands, what comes next", "handoff_empty");
  if (clean.length > HANDOFF_MAX)
    throw userError(
      `a handoff is ${HANDOFF_MAX} characters at most, and this is ${clean.length}: say what it takes to go on, not all that was done`,
      "handoff_too_long",
    );
  const secret = findSecrets(clean)[0];
  if (secret !== undefined)
    throw userError(`line ${secret.line} looks like ${secret.what}; it is never written down`, "handoff_secret");
  const handoff: Handoff = { at: now.toISOString(), text: clean };
  // Reading drops the ones too old to be shown, so each write leaves in the file only what a session could be given.
  writeFolder(home, place.folder, { ...readFolder(home, place.folder, now), [place.branch ?? ""]: handoff });
  return handoff;
}

/**
 * The pages a session reached, for its handoff (§4.8): the ones it wrote, then the ones it only opened, the latest
 * first in each, each once, `HANDOFF_PAGES_MAX` at most; not one it forgot. What the journal holds of them, no more.
 */
export function pagesOfJournal(journal: JournalEntry[]): HandoffPage[] {
  const forgotten = new Set(journal.filter((e) => e.what === "forgot").map((e) => `${e.brain}\n${e.path}`));
  const seen = new Set<string>();
  const pick = (did: HandoffPage["did"], wanted: (e: JournalEntry) => boolean): HandoffPage[] =>
    [...journal].reverse().flatMap((e) => {
      if (!wanted(e) || e.brain === undefined || e.path === undefined) return [];
      const key = `${e.brain}\n${e.path}`;
      if (seen.has(key) || forgotten.has(key)) return [];
      seen.add(key);
      return [{ brain: e.brain, path: e.path, title: (e.title ?? e.path).replace(/\s+/g, " ").trim(), did }];
    });
  return [
    ...pick("wrote", (e) => e.arrow === "write" && e.what !== "forgot"),
    ...pick("opened", (e) => e.what === "opened"),
  ].slice(0, HANDOFF_PAGES_MAX);
}

/**
 * Name, on the handoff this place was just left, the pages its session reached (§4.8). Only on the one left at `at`:
 * a later one is another session's. Whether it was there to take them.
 */
export function attachPages(home: string, place: Place, at: string, pages: HandoffPage[], now: Date): boolean {
  const branches = readFolder(home, place.folder, now);
  const found = branches[place.branch ?? ""];
  if (found === undefined || found.at !== at) return false;
  if (pages.length === 0) return true;
  writeFolder(home, place.folder, { ...branches, [place.branch ?? ""]: { ...found, pages } });
  return true;
}

/** Drop this place's handoff; whether it had one. */
export function clearHandoff(home: string, place: Place, now: Date): boolean {
  const branches = readFolder(home, place.folder, now);
  if (branches[place.branch ?? ""] === undefined) return false;
  delete branches[place.branch ?? ""];
  writeFolder(home, place.folder, branches);
  return true;
}
