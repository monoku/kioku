import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JOURNAL_WRITES } from "./journal-verbs.ts";
import { kiokuCall, SEARCH_OPTIONS } from "../shell-words.ts";
import { sessionsPath } from "../state.ts";
import { labelList, type Labels } from "./labels.ts";
import { commas, isDoneWrite, jsonLines } from "../util.ts";

/**
 * The session's journal (§4.6): every time a session reaches the memory, one entry, in order, each a read or a write.
 * The footer counts it (§1.2). The plugin's hooks write it, since they know the
 * session's id; it is machine state under `~/.kioku/sessions/`, one JSON line per entry, never in a brain.
 */

/** What an entry is (§4.6). */
export type JournalWhat =
  | "summary"
  | "recalled"
  | "skill"
  | "opened"
  | "searched"
  | "listed"
  | "log"
  | "stats"
  | "lint"
  | "saved"
  | "instinct"
  | "updated"
  | "instinct again"
  | "replaced"
  | "forgot"
  | "retired"
  | "confirmed"
  | "renamed"
  | "moved"
  | "linked"
  | "promoted"
  | "evolved";

export interface JournalEntry {
  /** When, as an ISO date and time. */
  at: string;
  /** The turn it was in: each prompt the person sends moves it on. */
  turn: number;
  what: JournalWhat;
  /** Every entry falls in one arrow of the footer (§1.2). */
  arrow: "read" | "write";
  /** The brain, or the brains a search, a list or the summary reached, comma-separated. */
  brain?: string;
  /** The brain as the person is shown it (§1.2), one for each name in `brain`, in its order, comma-separated. Entries from before it have none. */
  label?: string;
  path?: string;
  title?: string;
  kind?: string;
  subkind?: string | null;
  /** The words a search looked for. */
  words?: string;
  /** How many results a search gave, or how many pages a list or the summary hold. */
  count?: number;
  /** The pages a search's answer or a prompt's recall (§4.7) brought, in its order (§4.6): never a page's text. */
  hits?: { brain: string; path: string; title: string; id?: string }[];
  /** How a recall found its pages when not by meaning (§4.7): by a prompt's words, where meaning could not run, or by the path of a file the agent read or changed. */
  by?: "words" | "path";
  /** How many pages a list has in all, when it answered a window of them (§4.6). */
  total?: number;
  /** An instinct seen again that is now a candidate for a Skill (§3.6). */
  candidate?: true;
  /** What an evolved instinct became. */
  became?: "skill" | "rule" | "playbook";
  /** Why a summary was loaded: the session started, was resumed or was compacted (or cleared, a new session). */
  source?: string;
  /** The id the host gave the shell call that made the entry, so that a mod can tell which call it was (§4.6). */
  call?: string;
}

/** An entry as a hook gives it: the journal adds when and the turn. */
export type NewEntry = Omit<JournalEntry, "at" | "turn">;

/** A session's journal is dropped this long after its last entry (§4.6). */
const KEEP_MS = 2 * 86_400_000;

/** What each writing verb's result is as an entry: one for each of `JOURNAL_WRITES`, the verbs the hooks watch, so a verb added there is named here or the build fails. */
const WRITES: Record<(typeof JOURNAL_WRITES)[number], JournalWhat> = {
  save: "saved",
  update: "updated",
  supersede: "replaced",
  forget: "forgot",
  retire: "retired",
  confirm: "confirmed",
  rename: "renamed",
  move: "moved",
  link: "linked",
  promote: "promoted",
  evolve: "evolved",
};

/** The flags of `page search` that take no value, `--json` among them: the words come after the rest and their values. */
const SEARCH_SWITCHES: readonly string[] = [
  "--json",
  ...Object.entries(SEARCH_OPTIONS)
    .filter(([, o]) => o.type === "boolean")
    .map(([k]) => `--${k}`),
];

/** A session's id as a file name: what a host sends is an id, but nothing outside the folder is ever named. */
const fileOf = (home: string, sessionId: string): string | undefined =>
  /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? join(sessionsPath(home), `${sessionId}.jsonl`) : undefined;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const brainsOf = (items: Record<string, unknown>[]): string | undefined => {
  const names = [...new Set(items.map((i) => str(i.brain)).filter((b): b is string => b !== undefined))];
  return names.length === 0 ? undefined : commas(names);
};
/** What an answer names of its page, for an entry. */
const pageOf = (a: Record<string, unknown>): Partial<NewEntry> => ({
  ...(str(a.brain) !== undefined && { brain: str(a.brain) }),
  ...(str(a.path) !== undefined && { path: str(a.path) }),
  ...(str(a.title) !== undefined && { title: str(a.title) }),
  ...(str(a.kind) !== undefined && { kind: str(a.kind) }),
  ...((typeof a.subkind === "string" || a.subkind === null) && { subkind: a.subkind as string | null }),
});

/** The words of a search: the arguments that are not flags or their values. */
function wordsOf(args: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (!a.includes("=") && !SEARCH_SWITCHES.includes(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out.join(" ");
}

/**
 * The entries of a shell command's result (§4.6): one per page opened or written, one per search, list, log, stats or
 * lint; nothing for a refusal, a `similar` answer, one that asks for a namespace, or a command that is not the tool's.
 */
export function entriesFor(command: string | undefined, output: string, labels?: Labels): NewEntry[] {
  return entriesOf(command, output).map((e) => labelled(e, labels));
}

/** An entry with its brain also as the person is shown it (§4.6). */
export function labelled(e: NewEntry, labels: Labels | undefined): NewEntry {
  return e.brain === undefined || labels === undefined ? e : { ...e, label: labelList(e.brain, labels) };
}

function entriesOf(command: string | undefined, output: string): NewEntry[] {
  if (command === undefined) return [];
  const answers = jsonLines(output);
  const write = kiokuCall(command, "page", Object.keys(WRITES));
  if (write !== undefined) {
    const verb = JOURNAL_WRITES.find((v) => kiokuCall(command, "page", [v]) !== undefined)!;
    const evidence = write.some((w) => w === "--evidence" || w.startsWith("--evidence="));
    return answers
      .filter((a) => isDoneWrite(a))
      .map((a) => {
        const page = pageOf(a);
        const instinct = page.subkind === "instinct";
        if (verb === "save" && instinct) return { what: "instinct", arrow: "write", ...page };
        if (verb === "update" && instinct && evidence)
          return {
            what: "instinct again",
            arrow: "write",
            ...page,
            ...(a.candidate === true && { candidate: true as const }),
          };
        if (verb === "evolve") {
          const became = a.evolvedAs === "rule" || a.evolvedAs === "playbook" ? a.evolvedAs : "skill";
          return { what: "evolved", arrow: "write", ...page, became };
        }
        return { what: WRITES[verb], arrow: "write", ...page };
      });
  }
  if (kiokuCall(command, "page", ["show"]) !== undefined) {
    return answers
      .filter((a) => !("error" in a) && typeof a.brain === "string" && typeof a.path === "string")
      .map((a) => ({ what: "opened", arrow: "read", ...pageOf(a) }));
  }
  const search = kiokuCall(command, "page", ["search"]);
  if (search !== undefined) {
    const answer = answers.find((a) => Array.isArray(a.hits));
    if (answer === undefined) return [];
    const hits = answer.hits as Record<string, unknown>[];
    const brain = brainsOf(hits);
    const found = hits.flatMap((h) =>
      str(h.brain) !== undefined && str(h.path) !== undefined
        ? [{ brain: str(h.brain)!, path: str(h.path)!, title: str(h.title) ?? "" }]
        : [],
    );
    return [
      {
        what: "searched",
        arrow: "read",
        words: wordsOf(search),
        count: hits.length,
        ...(brain !== undefined && { brain }),
        ...(found.length > 0 && { hits: found }),
      },
    ];
  }
  if (kiokuCall(command, "page", ["list"]) !== undefined) {
    const answer = answers.find((a) => Array.isArray(a.pages) || typeof a.total === "number");
    if (answer === undefined) return [];
    const pages = Array.isArray(answer.pages) ? (answer.pages as Record<string, unknown>[]) : [];
    const brain = brainsOf(pages);
    // `--count` answers only `total`; a window of the list answers the pages and the `total` they are part of (§4.6).
    const total = typeof answer.total === "number" ? answer.total : pages.length;
    const count = Array.isArray(answer.pages) ? pages.length : total;
    return [
      { what: "listed", arrow: "read", count, ...(total > count && { total }), ...(brain !== undefined && { brain }) },
    ];
  }
  for (const verb of ["log", "stats", "lint"] as const) {
    if (kiokuCall(command, "brain", [verb]) !== undefined) {
      return answers.some((a) => !("error" in a)) ? [{ what: verb, arrow: "read" }] : [];
    }
  }
  return [];
}

/** A journal's lines, read past any that cannot be. */
function linesOf(file: string): Record<string, unknown>[] {
  try {
    return jsonLines(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** The turn a journal is at: its last turn line or entry, 1 when it has none. */
function turnOf(lines: Record<string, unknown>[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.turn;
    if (typeof t === "number") return t;
  }
  return 1;
}

/** Where the sessions folder keeps when its journals were last looked through: the look costs a `stat` per journal. */
const PRUNED_STAMP = ".pruned";
const PRUNE_EVERY_MS = 86_400_000;

/** Whether a day has passed since the last look. A stamp that cannot be read, or from the future, does not hold it back. */
function dueForPrune(stamp: string, now: Date): boolean {
  try {
    const since = now.getTime() - Date.parse(readFileSync(stamp, "utf8"));
    return !(since >= 0 && since < PRUNE_EVERY_MS);
  } catch {
    return true;
  }
}

/** Drops the journals whose last entry is older than two days (§4.6), looking once a day. */
function prune(dir: string, now: Date): void {
  const stamp = join(dir, PRUNED_STAMP);
  if (!dueForPrune(stamp, now)) return;
  writeFileSync(stamp, now.toISOString());
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(dir, name);
    try {
      if (now.getTime() - statSync(file).mtimeMs > KEEP_MS) unlinkSync(file);
    } catch {
      /* another session's hook got there first */
    }
  }
}

/** Adds entries to a session's journal, in the turn it is at. A journal never fails a hook. */
export function record(home: string, sessionId: string | undefined, entries: NewEntry[], now: Date): void {
  if (sessionId === undefined || entries.length === 0) return;
  const file = fileOf(home, sessionId);
  if (file === undefined) return;
  try {
    mkdirSync(sessionsPath(home), { recursive: true });
    const turn = turnOf(linesOf(file));
    const at = now.toISOString();
    appendFileSync(file, entries.map((e) => `${JSON.stringify({ at, turn, ...e })}\n`).join(""));
  } catch {
    /* a journal is only a journal */
  }
}

/**
 * A prompt the person sent: the session's next turn. The journal keeps it as a line that is no entry, so a turn
 * with no read or write still counts; it is also when old journals are dropped.
 */
export function nextTurn(home: string, sessionId: string | undefined, now: Date): void {
  if (sessionId === undefined) return;
  const file = fileOf(home, sessionId);
  if (file === undefined) return;
  try {
    mkdirSync(sessionsPath(home), { recursive: true });
    const lines = linesOf(file);
    // The first prompt is the first turn, with what came before it, the summary; each one after moves it on.
    const prompted = lines.some((l) => !("what" in l) && typeof l.turn === "number");
    const turn = prompted ? turnOf(lines) + 1 : 1;
    appendFileSync(file, `${JSON.stringify({ turn, at: now.toISOString() })}\n`);
    prune(sessionsPath(home), now);
  } catch {
    /* a journal is only a journal */
  }
}

/**
 * A session resumed or compacted: the summary it loads again is a turn of its own, after whatever came before. A journal with nothing yet keeps its first turn.
 */
export function ownTurn(home: string, sessionId: string | undefined, now: Date): void {
  if (sessionId === undefined) return;
  const file = fileOf(home, sessionId);
  if (file === undefined) return;
  try {
    const lines = linesOf(file);
    if (lines.length === 0) return;
    appendFileSync(file, `${JSON.stringify({ turn: turnOf(lines) + 1, at: now.toISOString() })}\n`);
  } catch {
    /* a journal is only a journal */
  }
}

/** A session's entries, in order; turn lines are not entries. */
export function readJournal(home: string, sessionId: string): JournalEntry[] {
  const file = fileOf(home, sessionId);
  return file === undefined
    ? []
    : (linesOf(file).filter((l) => typeof l.what === "string") as unknown as JournalEntry[]);
}
