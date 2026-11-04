import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";
import type { JournalEntry } from "../types";
import { jsonObjects } from "./tool";

// The session's journal (§4.6), as the mod reads it: the plugin's hooks write one line per read or write the session
// made of the memory, under `.kioku/sessions/<session>.jsonl`, and the footer counts it (§1.2). The mod writes nothing
// to it and imports nothing of the tool's. The entries are kept for the session: the rows and the memory history show them (§1.2).

/**
 * The session's entries, in order. The engine's scan reads an atom only in the file that declares it: others call
 * `journalEntries`.
 */
const journal = atom({ plugin: "kioku", key: "journal" } as const, [] as JournalEntry[]);

/** What the journal holds so far, for a drawing: reading it here redraws the drawing when it moves. */
export async function journalEntries($: EngineInterface): Promise<JournalEntry[]> {
  return read($, journal);
}

/** The folder that holds the machine's state, `.kioku/` under `KIOKU_HOME`, else under the home folder, as the tool finds it. */
async function kiokuDir($: EngineInterface, cwd: string): Promise<string | undefined> {
  try {
    const given = (await $.env.get("KIOKU_HOME"))?.trim();
    const home = given ? (given.startsWith("/") ? given : `${cwd}/${given}`) : await $.env.get("HOME");
    return home ? `${home}/.kioku` : undefined;
  } catch {
    return undefined;
  }
}

const where = {
  dir: undefined as string | undefined,
  id: undefined as string | undefined,
  file: undefined as string | undefined,
  /** The file's length at the last read, and how far of it is parsed: a journal only grows, so only what is new is. */
  size: -1,
  parsed: 0,
  reads: 0,
  writes: 0,
  shown: [] as JournalEntry[],
};

/** Nothing of the journal is read yet. */
function fromTheStart(): void {
  where.size = -1;
  where.parsed = 0;
  where.reads = 0;
  where.writes = 0;
  where.shown = [];
}

const validId = (id: string | undefined): id is string => id !== undefined && /^[A-Za-z0-9_-]{1,128}$/.test(id);

/** When a session starts: which file is its journal, and nothing read of it yet. */
export async function journalStart($: EngineInterface, cwd: string): Promise<void> {
  where.dir = await kiokuDir($, cwd);
  // A session started, a mod reloaded: its journal is read again whole, whatever was read before.
  where.id = undefined;
  fromTheStart();
  await follow($, await $.session.id().catch(() => undefined));
}

/** The journal is to be read again from its first line, whichever session the next hook names: its state was reset. */
export function rereadJournal(): void {
  where.id = undefined;
  fromTheStart();
}

/**
 * The journal of the session a hook ran in, by the `session_id` the hook was given, which is the one it wrote under:
 * `/clear` starts a session with another id, and its journal is a new one. True when it is another than the last.
 */
export async function follow($: EngineInterface, id: string | undefined): Promise<boolean> {
  if (!validId(id) || id === where.id) return false;
  where.id = id;
  where.file = where.dir === undefined ? undefined : `${where.dir}/sessions/${id}.jsonl`;
  fromTheStart();
  await update($, journal, () => []);
  return true;
}

/** Whether a line holds what a row of the pane needs: when it was made, in which turn. */
const shown = (e: JournalEntry): boolean =>
  typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) && typeof e.turn === "number";

/**
 * Reads the journal again after a hook may have written to it: how many reads and how many writes it holds, which the
 * footer counts, and its entries, which the rows and the memory history show. Undefined when there is no
 * journal or it did not change since the last read.
 */
export async function readJournal($: EngineInterface): Promise<{ reads: number; writes: number } | undefined> {
  if (where.file === undefined) return undefined;
  let text: string;
  try {
    text = String(await $.fs.read(where.file));
  } catch {
    return undefined;
  }
  if (text.length === where.size) return undefined;
  // Shorter than what was parsed is not the file that was: it is read whole.
  if (text.length < where.parsed) fromTheStart();
  where.size = text.length;
  // A last line with no end yet is parsed once it can be read: it may still be being written.
  const lines = text.lastIndexOf("\n") + 1;
  const tail = jsonObjects(text.slice(Math.max(lines, where.parsed)));
  const end = tail.length > 0 ? text.length : Math.max(lines, where.parsed);
  const fresh = jsonObjects(text.slice(where.parsed, end)) as { what?: unknown; arrow?: unknown }[];
  where.parsed = end;
  const entries = fresh.filter(
    (e) => typeof e.what === "string" && (e.arrow === "read" || e.arrow === "write"),
  ) as unknown as JournalEntry[];
  where.reads += entries.filter((e) => e.arrow === "read").length;
  where.writes += entries.filter((e) => e.arrow === "write").length;
  // A line the footer counted but the pane cannot place in time is not shown.
  where.shown = [...where.shown, ...entries.filter(shown)];
  const all = where.shown;
  await update($, journal, () => all);
  return { reads: where.reads, writes: where.writes };
}
