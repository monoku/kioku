import type { EngineInterface, Register } from "claude-code";
import type { JournalEntry, JournalWhat } from "../types";
import { chip, closeRow, HISTORY_MARK, themeNow } from "./chrome";
import { hoverOf, LAVENDER, ORANGE } from "./colors";
import { journalEntries } from "./journal";
import { openPage, showResults } from "./page";

// The memory history (§1.2): `/kioku-history` opens a pane with every entry of the session's
// journal (§4.6), newest first, or shows it again when open; the pane's own close closes it. The host places the pane:
// docked beside the conversation where it can, above the prompt otherwise, and the pane draws itself for the place.

/** The pane's id, for `$.ui.open` and its `ui.render` hook. */
export const HISTORY_PANE = "kioku-history";
/** The rows the pane's close takes at its top: the button and a line of air. */
const CLOSE_ROWS = 2;
/** The pane's title, which the host draws only while another pane is open too. */
export const HISTORY_TITLE = "Kioku history";
/** The history's command (§1.2). */
export const HISTORY_COMMAND = "kioku-history";
/** What the pane asks for above the prompt: as many rows as it shows, at least the first and at most the second. */
const PANE_MIN_ROWS = 5;
const PANE_MAX_ROWS = 24;

/** What an entry says for each thing the journal holds: its word. Every kind has one, so a new kind will not compile without. */
const WORDS: Record<JournalWhat, string> = {
  summary: "summary",
  skill: "loaded",
  opened: "opened",
  searched: "found",
  listed: "listed",
  log: "log",
  stats: "stats",
  lint: "lint",
  saved: "saved",
  instinct: "instinct",
  updated: "updated",
  "instinct again": "again",
  replaced: "replaced",
  forgot: "forgot",
  retired: "retired",
  confirmed: "confirmed",
  renamed: "renamed",
  moved: "moved",
  linked: "linked",
  promoted: "promoted",
  evolved: "evolved",
};
/** The words are padded to the longest. */
const WORD_WIDTH = Math.max(...Object.values(WORDS).map((w) => w.length));
/** The verb's column: the arrow, a space, the word padded, a space. */
const WORD_COLUMN = WORD_WIDTH + 3;

/** How a row is painted for a host's theme: a terminal's tint, if any, and a desktop card's border, each for a read and a write. */
interface Look {
  tint?: { read: string; write: string };
  border: { read: string; write: string };
}
const DARK_BORDER = { read: "#3D4270", write: "#6B4A24" };
const LOOKS: Record<"dark" | "light" | "ansi" | "themed", Look> = {
  dark: { tint: { read: "#23263A", write: "#2E2519" }, border: DARK_BORDER },
  light: { tint: { read: "#ECEEFB", write: "#FCF0E2" }, border: { read: "#B3B9ED", write: "#F9C997" } },
  // An ANSI theme's colours are the terminal's own: no tint, and no bar.
  ansi: { border: DARK_BORDER },
  // `auto`, or a custom theme, may be light or dark: the host's own backgrounds, which follow it, and a bar of the row's colour.
  themed: { tint: { read: "memoryBackgroundColor", write: "bashMessageBackgroundColor" }, border: DARK_BORDER },
};
const kindOf = (theme: string): keyof typeof LOOKS =>
  theme.endsWith("-ansi") ? "ansi" : theme.startsWith("dark") ? "dark" : theme.startsWith("light") ? "light" : "themed";

/** An entry as a line says it. */
export interface Shown {
  word: string;
  arrow: "↓" | "↑" | "−";
  read: boolean;
  title: string;
  path?: string;
  brain?: string;
  /** The brain's name, which the tool is asked for a page by, where `brain` is as Kioku names it. */
  brainName?: string;
  /** The pages a search found, each with its brain as the person is shown it, which the page viewer lists (§1.2). */
  hits?: { brain: string; label: string; path: string; title: string }[];
  /** What a search looked for. */
  words?: string;
  /** What the second row says when there is neither a path nor a brain. */
  note?: string;
  faded: boolean;
  turn: number;
  at: string;
}

const plural = (n: number | undefined, one: string): string => `${n ?? 0} ${one}${n === 1 ? "" : "s"}`;
const BECAME = { skill: "Skill", rule: "Rule", playbook: "playbook" } as const;

/** What a line says of an entry of the journal (§1.2). */
export function shownOf(x: JournalEntry): Shown {
  const known = shownOnce.get(x);
  if (known !== undefined) return known;
  const made = shownNow(x);
  shownOnce.set(x, made);
  return made;
}

const shownOnce = new WeakMap<JournalEntry, Shown>();

function shownNow(x: JournalEntry): Shown {
  const faded = x.what === "forgot" || x.what === "retired";
  const brain = x.label ?? x.brain;
  const base = {
    word: WORDS[x.what] ?? x.what,
    arrow: x.arrow === "read" ? "↓" : faded ? "−" : "↑",
    read: x.arrow === "read",
    faded,
    turn: x.turn,
    at: x.at,
    ...(brain !== undefined && { brain }),
    ...(x.brain !== undefined && { brainName: x.brain }),
  } as const;
  switch (x.what) {
    case "summary": {
      // Why it was loaded: a session resumed or compacted loads it again (§4.6).
      const why = x.source === "resume" ? "resumed" : x.source === "compact" ? "after /compact" : "session summary";
      return { ...base, title: `${why} · ${plural(x.count, "page")}` };
    }
    case "skill":
      return { ...base, title: "Kioku skill", note: "how to use Kioku" };
    case "searched": {
      // Each page's brain is named as Kioku names it (§1.2).
      const hits = (x.hits ?? []).map((h) => ({ ...h, label: labelOf(x, h.brain) }));
      return {
        ...base,
        title: `“${x.words ?? ""}” · ${plural(x.count, "result")}`,
        words: x.words ?? "",
        ...(hits.length > 0 && { hits }),
      };
    }
    case "listed":
      return { ...base, title: plural(x.count, "page") };
    case "log":
    case "stats":
    case "lint":
      return { ...base, title: `brain ${x.what}` };
    default: {
      const title = x.title ?? (x.path ?? "").split("/").pop()?.replace(/\.md$/, "") ?? "";
      const more =
        x.what === "evolved" ? ` → ${BECAME[x.became ?? "skill"]}` : x.candidate === true ? " · ready for a Skill" : "";
      return { ...base, title: `${title}${more}`, ...(x.path !== undefined && { path: x.path }) };
    }
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number): string => String(n).padStart(2, "0");
/** The day an entry was made, on this machine's clock, as a key. */
const dayOf = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
/** A day as its separator says it: `Today`, `Yesterday`, else `Oct 22`. */
function dayLabel(d: Date, now: Date): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayOf(d) === dayOf(now)) return "Today";
  if (dayOf(d) === dayOf(yesterday)) return "Yesterday";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

interface Turn {
  turn: number;
  at: Date;
  entries: Shown[];
}
interface Day {
  day: Date;
  turns: Turn[];
}

/** The entries as days of turns, newest first at every level; a turn is at the time of its first entry. */
function grouped(oldestFirst: Shown[]): Day[] {
  const days: Day[] = [];
  for (const x of oldestFirst) {
    const at = new Date(x.at);
    const lastDay = days.at(-1);
    const lastTurn = lastDay?.turns.at(-1);
    if (
      lastDay !== undefined &&
      lastTurn !== undefined &&
      lastTurn.turn === x.turn &&
      dayOf(lastDay.day) === dayOf(at)
    ) {
      lastTurn.entries.push(x);
      continue;
    }
    if (lastDay === undefined || dayOf(lastDay.day) !== dayOf(at)) days.push({ day: at, turns: [] });
    days.at(-1)!.turns.push({ turn: x.turn, at, entries: [x] });
  }
  return days
    .reverse()
    .map((d) => ({ ...d, turns: d.turns.reverse().map((t) => ({ ...t, entries: t.entries.reverse() })) }));
}

/** The rows the pane's content takes above the prompt, where an entry is one: a separator for each day, a time for each turn. */
function heightOf(days: Day[]): number {
  let rows = 0;
  days.forEach((d, di) => {
    rows += 1 + (di > 0 ? 1 : 0);
    d.turns.forEach((t, ti) => {
      rows += 1 + (ti > 0 ? 1 : 0) + t.entries.length;
    });
  });
  return rows;
}

/** A brain as Kioku names it, from an entry that lists its brains and their names in the same order (§1.2); its own name when the entry does not say. */
export function labelOf(x: JournalEntry, brain: string): string {
  const at = (x.brain ?? "").split(", ").indexOf(brain);
  return (at === -1 ? undefined : (x.label ?? "").split(", ")[at]) || brain;
}

/** `/kioku-history`, which every session has. Immediate: it opens while the agent works, which is when what it reads and writes is worth watching. */
async function registerCommand($: EngineInterface): Promise<void> {
  await $.command
    .register({
      name: HISTORY_COMMAND,
      description: "Kioku: show what this session read and wrote of the memory",
      immediate: true,
    })
    .catch(() => undefined);
}

/** When a session starts: `/kioku-history`. */
export async function historyStart($: EngineInterface): Promise<void> {
  await themeNow($);
  await registerCommand($);
}

/** After a reset of the session's state: the command is registered again. */
export async function historyRestore($: EngineInterface): Promise<void> {
  await registerCommand($);
}

type Ui = ReturnType<EngineInterface["ui"]["resolve"]>;

/** The arrow's colour, as the footer's: lavender for a read, orange for a write, dim for what went away. */
const arrowLook = (x: Shown): { color?: string; dimColor?: boolean } =>
  x.read ? { color: LAVENDER } : x.faded ? { dimColor: true } : { color: ORANGE };
const rowColor = (x: Shown): string => (x.read ? LAVENDER : ORANGE);

/** The arrow and the word, in the verb's column. */
function verbOf({ Box, Text }: Ui, x: Shown) {
  return (
    <Box flexShrink={0} width={WORD_COLUMN}>
      <Text>
        <Text {...arrowLook(x)}>{x.arrow}</Text>
        <Text dimColor>{` ${x.word.padEnd(WORD_WIDTH)}`}</Text>
      </Text>
    </Box>
  );
}

/** What a press on an entry does: an entry that names a page opens it in the page viewer, and one that is a search lists what it found (§1.2). */
interface Press {
  open: (x: Shown) => void;
  results: (x: Shown) => void;
  terminal: boolean;
}

/**
 * Where the page viewer is on, a button at the end of an entry's row, in yellow as the rows' buttons are: `↗ open` for an entry
 * that names a page, which a page that was forgotten is not, and `↗ results` for a search that kept what it found.
 */
function openOf(ui: Ui, x: Shown, key: string, press?: Press) {
  const { Box } = ui;
  if (press === undefined) return null;
  const page = x.path !== undefined && x.brainName !== undefined && x.word !== "forgot";
  const results = x.hits !== undefined && x.hits.length > 0;
  if (!page && !results) return null;
  const label = page ? "open" : "results";
  return (
    <Box key="open" flexShrink={0} flexGrow={1} justifyContent="flex-end" paddingLeft={2}>
      {chip(ui, press.terminal ? "terminal" : "desktop", {
        key: `${label}:${key}`,
        label: `↗ ${label}`,
        onPress: () => {
          if (page) press.open(x);
          else press.results(x);
        },
      })}
    </Box>
  );
}

/** Above the prompt an entry is one row: `arrow word title  path (brain)`; the path gives way first, then the title. `fill` is false where something follows it on the line. */
export function oneRow(ui: Ui, x: Shown, fill = true, press?: Press, key = "") {
  const { Box, Text } = ui;
  return (
    <Box flexDirection="row" flexGrow={fill ? 1 : 0} minWidth={0}>
      {verbOf(ui, x)}
      {/* With a path it gives way first and the title a little; with none the title is what gives way. */}
      <Box flexShrink={x.path === undefined ? 1 : 0.05} minWidth={0}>
        <Text wrap="truncate-end" dimColor={x.faded}>
          {x.title}
        </Text>
      </Box>
      {x.path !== undefined
        ? [
            <Box key="gap" flexShrink={0}>
              <Text>{"  "}</Text>
            </Box>,
            <Box key="path" flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-start">
                {x.path}
              </Text>
            </Box>,
          ]
        : null}
      {x.brain !== undefined ? (
        <Box flexShrink={0}>
          <Text dimColor>{`${x.path !== undefined ? " " : "  "}(${x.brain})`}</Text>
        </Box>
      ) : null}
      {openOf(ui, x, key, press)}
    </Box>
  );
}

/** Docked an entry is always two rows: what, then under the title where, or the note, or a space that keeps the row. */
function twoRows(ui: Ui, x: Shown, press?: Press, key = "") {
  const { Box, Text } = ui;
  const first = (
    <Box flexDirection="row" flexGrow={1} minWidth={0}>
      {verbOf(ui, x)}
      <Box flexShrink={1} flexGrow={1} minWidth={0}>
        <Text wrap="truncate-end" dimColor={x.faded}>
          {x.title}
        </Text>
      </Box>
    </Box>
  );
  const second = (
    <Box flexDirection="row" flexGrow={1} minWidth={0} paddingLeft={WORD_COLUMN}>
      {x.path === undefined && x.brain === undefined ? (
        <Text dimColor wrap="truncate-end">
          {x.note ?? " "}
        </Text>
      ) : null}
      {x.path !== undefined ? (
        <Box flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-start">
            {x.path}
          </Text>
        </Box>
      ) : null}
      {x.brain !== undefined ? (
        <Box flexShrink={x.path !== undefined ? 0 : 1} minWidth={0}>
          <Text dimColor wrap="truncate-end">{`${x.path !== undefined ? " " : ""}(${x.brain})`}</Text>
        </Box>
      ) : null}
      {openOf(ui, x, key, press)}
    </Box>
  );
  return [first, second];
}

/**
 * An entry as the surface draws it. A terminal tints each row of it, one under another, with no gap and no border, which
 * would take a row above and one below; every row starts with one column, a space or the bar. The desktop draws a card with a
 * faint rounded border in its colour.
 */
function entryOf(
  ui: Ui,
  x: Shown,
  key: string,
  how: { terminal: boolean; docked: boolean; theme: string; press?: Press },
) {
  const { Box, Text } = ui;
  const rows = how.docked ? twoRows(ui, x, how.press, key) : [oneRow(ui, x, true, how.press, key)];
  const kind = kindOf(how.theme);
  const look = LOOKS[kind];
  if (!how.terminal) {
    return (
      <Box
        key={key}
        borderStyle="round"
        borderColor={look.border[x.read ? "read" : "write"]}
        flexDirection="column"
        paddingX={1}
        hover={{ backgroundColor: hoverOf(how.theme) }}
      >
        {rows}
      </Box>
    );
  }
  const bg = look.tint?.[x.read ? "read" : "write"];
  return (
    <Box key={key} flexDirection="column">
      {rows.map((row, i) => (
        <Box key={`row-${i}`} flexDirection="row" {...(bg !== undefined && { backgroundColor: bg })}>
          <Box width={1} flexShrink={0}>
            <Text color={rowColor(x)}>{kind === "themed" ? "▎" : " "}</Text>
          </Box>
          {row}
        </Box>
      ))}
    </Box>
  );
}

/** The pane and `/kioku-history`. */
export function registerHistory(on: Parameters<Register>[0]): void {
  // The pane: every entry of the session's journal, newest first, with no header of its own (the footer below has the
  // counts), under a separator for each day and, within it, a group for each turn at the time it began.
  on("ui.render", { component: "Pane", requestId: HISTORY_PANE }, async ($, e, next) => {
    const ui = $.ui.resolve(e);
    const { Box, Text } = ui;
    const entries = (await journalEntries($)).map(shownOf);
    const press: Press = {
      open: (x) => {
        void openPage($, { brain: x.brainName!, path: x.path!, ...(x.brain !== undefined && { label: x.brain }) });
      },
      results: (x) => {
        void showResults($, { words: x.words ?? "", pages: x.hits ?? [] });
      },
      terminal: e.surface === "terminal",
    };
    const how = {
      terminal: e.surface === "terminal",
      docked: e.props.placement === "dock",
      theme: await themeNow($),
      press,
    };
    const now = new Date(await $.clock.now());
    // Smaller where the surface has sizes: the desktop, not a terminal.
    const small = how.terminal ? {} : { size: "footnote" as const };
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {closeRow(ui, e.surface, e.props.bodyColumns, () => {
          void $.ui.close({ id: HISTORY_PANE });
        })}
        {entries.length === 0 ? <Text dimColor>nothing read or written yet</Text> : null}
        {grouped(entries).map((day, di) => (
          <Box key={`day-${dayOf(day.day)}`} flexDirection="column">
            {/* The day, centred and fainter than the rest. */}
            <Box flexDirection="row" justifyContent="center" {...(di > 0 ? { marginTop: 1 } : {})}>
              <Text {...small} dimColor>{`── ${dayLabel(day.day, now)} ──`}</Text>
            </Box>
            {day.turns.map((t, ti) => (
              <Box
                key={`turn-${t.turn}-${t.at.getTime()}`}
                flexDirection="column"
                {...(ti > 0 ? { marginTop: 1 } : {})}
                {...(how.terminal ? {} : { gap: "xs" as const })}
              >
                {/* On a terminal the time starts in the column the rows' text does, after their space or bar. */}
                <Text
                  {...small}
                  dimColor
                >{`${how.terminal ? " " : ""}${two(t.at.getHours())}:${two(t.at.getMinutes())}`}</Text>
                {t.entries.map((x, i) => entryOf(ui, x, `entry-${t.turn}-${i}`, how))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    );
  }).catch(($, e, next) => next(e));

  // `/kioku-history`: the pane, which the person asked for, so the host places it at any width. Open already, it is shown
  // again, never closed: the pane's own close is how it goes.
  on("command.run", { command: HISTORY_COMMAND }, async ($) => {
    const rows = Math.min(
      PANE_MAX_ROWS,
      Math.max(PANE_MIN_ROWS, heightOf(grouped((await journalEntries($)).map(shownOf))) + CLOSE_ROWS),
    );
    // The keyboard, so that the arrows and Page Up and Down scroll it and Esc closes it; granted only over an empty prompt.
    await $.ui.open({
      id: HISTORY_PANE,
      title: `${HISTORY_MARK} ${HISTORY_TITLE}`,
      rows,
      focus: true,
      closeOnEscape: true,
    });
    return {};
  });
}
