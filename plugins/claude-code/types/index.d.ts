// What the mod keeps for the session: the footer's counts and each arrow's frame (-1 for the arrow itself) (§1.2), and
// the session's journal as the hooks wrote it (§4.6), which the rows and the memory history show (§1.2).
export type Frame = number;

/** What an entry of the session's journal is (§4.6). */
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

/** A line of the session's journal (§4.6), as the mod reads it. Entries from before `label` have none: read `brain`. */
export interface JournalEntry {
  at: string;
  turn: number;
  what: JournalWhat;
  arrow: "read" | "write";
  /** The brains' names, comma-separated. */
  brain?: string;
  /** The same brains as Kioku names them (§1.2), comma-separated in the order of `brain`. */
  label?: string;
  path?: string;
  title?: string;
  kind?: string;
  subkind?: string | null;
  words?: string;
  count?: number;
  candidate?: true;
  became?: "skill" | "rule" | "playbook";
  source?: string;
  /** The id the host gave the shell call that made the entry (§4.6). */
  call?: string;
  /** The pages a search found, in the answer's order (§4.6). */
  hits?: PageRef[];
  /** How a recall found its pages when not by meaning (§4.7). */
  by?: "words" | "path";
}

/** A page as the viewer names it (§1.2): one a search found, or one it was on before, which a link was followed from. */
export interface PageRef {
  brain: string;
  /** The brain as Kioku names it, when it is known. */
  label?: string;
  path: string;
  title: string;
}
/** The pages a search found, which a page opened from them goes back to. */
export interface PageResults {
  words: string;
  pages: PageRef[];
  /** A dim row above the list (search's mode), and one below it (search's more). */
  top?: string;
  bottom?: string;
}
/** What the page viewer shows (§1.2): a page, the pages a search found to choose from, or why a page could not be opened. */
export type PageView =
  | {
      kind: "page";
      title: string;
      brain: string;
      brainName: string;
      path: string;
      touched?: string;
      body: string;
      cut: boolean;
      back?: PageResults;
      trail?: PageRef[];
    }
  | ({ kind: "choose" } & PageResults)
  /** Search's (§1.2) field for the words, and its text: why there are no pages. */
  | { kind: "ask" }
  /** A search under way: the words, and the frame of the bee's wings that waits for it. */
  | { kind: "searching"; words: string; frame: number; word: string }
  /** A page being read: its title, or its file's name, and the frame of the bee's wings. */
  | { kind: "opening"; title: string; frame: number; word: string }
  /** Why a search shows no page: what the tool said, with the mode it searched in (`top`) when it says one. */
  | { kind: "text"; words: string; line: string; top?: string }
  | { kind: "missing"; what: string; back?: PageResults; trail?: PageRef[] };

declare module "claude-code" {
  interface PluginState {
    kioku: {
      reads: number;
      writes: number;
      readFrame: Frame;
      writeFrame: Frame;
      off: boolean;
      journal: JournalEntry[];
      rowsOpened: string[];
      pageViews: Record<string, PageView>;
    };
  }
}
