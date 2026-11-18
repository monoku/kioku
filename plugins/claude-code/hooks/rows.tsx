import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";
import type { JournalEntry } from "../types";
import { ago, chip } from "./chrome";
import { ORANGE } from "./colors";
import { labelOf, oneRow, shownOf, type Shown } from "./history";
import { journalEntries } from "./journal";
import { openPage } from "./page";
import { alsoRan, kiokuWords, runsKioku, shortened } from "./plain";
import { type Answer, jsonObjects, text } from "./tool";

// Kioku rows (§1.2): a call to `kioku` through the shell is drawn in the conversation as a row of
// its own for each entry the call made in the session's journal (§4.6), in place of the shell's `Bash(…)` and its result,
// whatever else its line runs. A run of such calls that the host folds into `Ran N shell commands` is drawn as their rows. A
// call that failed, or made no entry, is drawn by the host as ever.

/** The calls whose row was drawn, whose result the host then leaves out. */
const state = { drawn: new Set<string>() };

/** The rows whose details the person opened: rows begin folded, and keep this for the session. */
const opened = atom({ plugin: "kioku", key: "rowsOpened" } as const, [] as string[]);

/** When a session starts: no row drawn and none opened. */
export async function rowsStart($: EngineInterface): Promise<void> {
  state.drawn.clear();
  await update($, opened, () => []);
}

/** The command a shell call ran, when its line runs the tool at all. */
const plainOf = (input: unknown): string | undefined => {
  const command = (input as { command?: unknown } | null)?.command;
  return typeof command === "string" && runsKioku(command) ? command : undefined;
};

/** The text a call's output holds: the output itself when it is text, else the text of its `stdout`, `content`, `text` or `output`. */
function textOf(output: unknown, depth = 0): string {
  if (typeof output === "string") return output;
  if (output === null || typeof output !== "object" || depth > 3) return "";
  if (Array.isArray(output)) return output.map((o) => textOf(o, depth + 1)).join("\n");
  const o = output as Record<string, unknown>;
  return ["stdout", "content", "text", "output", "result"]
    .map((k) => textOf(o[k], depth + 1))
    .filter((t) => t !== "")
    .join("\n");
}

/** A finished call's output does not change, so what a redraw asks again of the same one is parsed once. */
const parsed = new Map<string, Answer[]>();
const PARSED_MAX = 200;

/** Each line of a call's output that is a JSON object: the tool's answers. */
function answersOf(output: unknown): Answer[] {
  const lines = textOf(output);
  const known = parsed.get(lines);
  if (known !== undefined) return known;
  if (parsed.size >= PARSED_MAX) parsed.clear();
  const answers = jsonObjects(lines);
  parsed.set(lines, answers);
  return answers;
}

/** The names Kioku's skill is loaded by: its own, and the plugin's. */
const KIOKU_SKILLS = ["kioku", "kioku:kioku"];

/** What the tool's answers that make no entry say, because they ask something before it writes. */
const ASKS: Record<string, string> = {
  similar: "similar pages found, nothing saved",
  namespace: "asks for a namespace, nothing saved",
};

/** A write that was done: `done`, or an `error` met after the commit was made, which carries it (§1.6). */
const wrote = (a: Record<string, unknown>): boolean =>
  a.status === "done" || (a.status === "error" && typeof a.commit === "string");

/** Whether an answer is one that makes an entry: a page, a search, a list, a report or a write that was done. */
const makesEntry = (a: Record<string, unknown>): boolean =>
  wrote(a) ||
  Array.isArray(a.hits) ||
  Array.isArray(a.pages) ||
  typeof a.count === "number" ||
  (typeof a.brain === "string" && typeof a.path === "string") ||
  Array.isArray(a.brains);

/** Whether a call's entries are yet to come: it runs, or it ended with an answer that makes some. */
function waiting(props: { isRunning: boolean; output?: unknown }): boolean {
  if (props.isRunning) return true;
  const answers = answersOf(props.output);
  return !answers.some((a) => "error" in a && !wrote(a)) && answers.some(makesEntry);
}

/** An entry as a row's line says it: the history's, without its path, which the row's details have. */
function line(x: JournalEntry): Shown {
  const { path: _path, ...shown } = shownOf(x);
  return shown;
}

/** What the host's elements of a call are drawn with: the engine's `Box` and `Text`. */
type Ui = ReturnType<EngineInterface["ui"]["resolve"]>;

/** A call as a row or a line needs to know it: what the host says of it. */
interface Call {
  id: string | undefined;
  input: unknown;
  isRunning: boolean;
  output?: unknown;
}

/** The brand, as the rows, the messages and the footer draw it: the ⬢ in orange, `kioku` in bold and `.md` in orange. */
function brandOf(ui: Ui) {
  const { Box, Text } = ui;
  return (
    <Box flexShrink={0} flexDirection="row">
      <Text color={ORANGE}>⬢</Text>
      <Text> </Text>
      <Text bold>kioku</Text>
      <Text color={ORANGE}>.md</Text>
      <Text> </Text>
    </Box>
  );
}

/** The dim line that stands for a call whose rows are not here: its first words, and what the tool's answer says when it asks. */
function lineOf(ui: Ui, call: Call): ReturnType<typeof oneRow> {
  const { Box, Text } = ui;
  const command = (call.input as { command?: unknown } | null)?.command;
  // A call whose command the model is still writing has none yet: only the brand.
  const first = typeof command === "string" ? kiokuWords(command).slice(0, 3).join(" ") : "";
  const asks =
    ASKS[
      answersOf(call.output)
        .map((a) => text(a.status))
        .find((st) => st !== undefined && st in ASKS) ?? ""
    ];
  return (
    <Box flexDirection="row" minWidth={0}>
      {brandOf(ui)}
      <Text dimColor wrap="truncate-end">
        {asks === undefined ? `${first} …`.trim() : `${first} · ${asks}`}
      </Text>
    </Box>
  );
}

/** The pages a search found, as its answer lists them, each with its brain as Kioku names it: what a press on one opens. */
function hitsOf(
  x: JournalEntry,
  answers: Record<string, unknown>[],
): { brain: string; label: string; path: string; title: string }[] {
  const hits = (answers.find((a) => Array.isArray(a.hits))?.hits ?? []) as Record<string, unknown>[];
  return hits.flatMap((h) => {
    const brain = text(h.brain);
    const path = text(h.path);
    return brain === undefined || path === undefined
      ? []
      : [{ brain, label: labelOf(x, brain), path, title: text(h.title) ?? path }];
  });
}

/** The page the `n`th line `d` of a row's details stands for, when it names one: a page a search found, or the `file` an entry names. */
function pageOf(
  x: JournalEntry,
  answers: Record<string, unknown>[],
  n: number,
  d: { label?: string; value: string },
):
  | {
      brain: string;
      path: string;
      label?: string;
      back?: { words: string; pages: { brain: string; label?: string; path: string; title: string }[] };
    }
  | undefined {
  if (x.what === "searched") {
    // The line that counts the pages left out is not a page.
    const h = /^\+\d+ more$/.test(d.value) ? undefined : hitsOf(x, answers)[n];
    return h === undefined
      ? undefined
      : { brain: h.brain, label: h.label, path: h.path, back: { words: x.words ?? "", pages: hitsOf(x, answers) } };
  }
  // A page that was forgotten is not there to open.
  return x.what !== "forgot" && d.label === "file" && x.path !== undefined && x.brain !== undefined
    ? { brain: x.brain, path: x.path, ...(x.label !== undefined && { label: x.label }) }
    : undefined;
}

/** A line of an open row's details: what it is, when it has a name, and what it says. */
interface Detail {
  label?: string;
  value: string /** What opens the line in the colour of the text, before `value`, which is dim: a page's title. */;
  lead?: string;
}

/** The width of the column the labels of an open row's details take, the longest, `namespace`, and two spaces. */
const LABEL_WIDTH = 11;
/** The cells the `↗ open` of a line takes beyond the terminal, where it comes first (its width and the air after it). */
const OPEN_COLUMN = 9;

/**
 * The lines an entry's details add to its row, from the call's answers, each with its name (§1.2).
 */
function detailOf(x: JournalEntry, at: number, answers: Record<string, unknown>[], now: Date): Detail[] {
  const kindOf = (a: Record<string, unknown> | undefined): string =>
    [text(a?.kind), text(a?.subkind)].filter((k): k is string => k !== undefined).join(" · ");
  const named = (label: string, value: string | undefined): Detail[] =>
    value === undefined || value === "" ? [] : [{ label, value }];
  const brain = x.label ?? x.brain;
  if (x.what === "searched") {
    const hits = (answers.find((a) => Array.isArray(a.hits))?.hits ?? []) as Record<string, unknown>[];
    // Every page the answer holds: the whole of what the agent saw.
    return hits.map((h) => ({
      lead: text(h.title) ?? "",
      value: `  ${text(h.path) ?? ""} (${labelOf(x, text(h.brain) ?? "")})`,
    }));
  }
  if (x.what === "opened") {
    const page = answers.filter((a) => !("error" in a) && typeof a.brain === "string" && typeof a.path === "string")[
      at
    ];
    const last = (page?.history as { commit?: unknown; message?: unknown }[] | undefined)?.[0];
    const commit = text(last?.commit);
    const body = text(page?.body);
    const lines = body === undefined ? undefined : body.replace(/\n$/, "").split("\n").length;
    const touched = text(page?.touched);
    return [
      ...named("file", x.path),
      ...named("brain", brain),
      ...named("type", kindOf(page)),
      ...named("namespace", text(page?.namespace)),
      ...named("summary", text(page?.summary)),
      ...named("lines", lines === undefined ? undefined : String(lines)),
      ...named("touched", touched === undefined ? undefined : ago(touched, now)),
      ...named(
        "commit",
        commit === undefined
          ? undefined
          : `${commit.slice(0, 7)}${text(last?.message) !== undefined ? ` · ${text(last?.message)}` : ""}`,
      ),
    ];
  }
  if (x.arrow === "write") {
    const done = answers.filter(wrote)[at];
    const publication = text(done?.publication);
    const commit = text(done?.commit);
    return [
      ...named("file", x.path),
      ...named("brain", brain),
      ...named("type", kindOf(done)),
      ...named("commit", commit?.slice(0, 7)),
      ...named(
        "published",
        publication === undefined
          ? undefined
          : publication === "pushed"
            ? "published"
            : publication === "pending"
              ? "committed, not published yet, to be retried"
              : "committed on this machine, not published",
      ),
    ];
  }
  return [];
}

/**
 * A call as Kioku draws it: a row for each entry it made in the journal, or, until they are in, or when the tool answered that
 * it needs something first, a dim line. Undefined for a call the host draws: one that failed, or that made nothing.
 */
async function drawCall(
  $: EngineInterface,
  ui: Ui,
  call: Call,
  entries: JournalEntry[],
  now: Date,
  surface: string,
): Promise<ReturnType<typeof oneRow> | undefined> {
  const { Box, Text } = ui;
  const mine = entries.filter((x) => call.id !== undefined && x.call === call.id);
  if (mine.length === 0) {
    const asks = answersOf(call.output).some((a) => text(a.status) !== undefined && text(a.status)! in ASKS);
    return waiting(call) || asks ? lineOf(ui, call) : undefined;
  }
  const answers = answersOf(call.output);
  const shown = await read($, opened);
  const seen = new Map<string, number>();
  const command = (call.input as { command?: unknown } | null)?.command;
  // What else the line ran, that is not the tool's: it is not hidden because the rows stand for the rest.
  const rest = typeof command === "string" ? alsoRan(command) : "";
  // Entries that read alike, one after another, are one row and how many: a loop over the brains is not a wall of the same line.
  const same = (a: JournalEntry, b: JournalEntry): boolean => {
    const l = line(a);
    const m = line(b);
    return l.word === m.word && l.title === m.title && l.brain === m.brain && l.path === m.path;
  };
  const runs = new Map<number, number>();
  const joined = new Set<number>();
  let head = 0;
  mine.forEach((x, i) => {
    if (i > 0 && same(mine[head]!, x)) {
      runs.set(head, (runs.get(head) ?? 1) + 1);
      joined.add(i);
    } else head = i;
  });
  return (
    <Box flexDirection="column">
      {/* No Box here has a `key`: one makes a hover scope, and the host would then light the whole row under the pointer. */}
      {mine.map((x, i) => {
        // The entry's place among the call's of its kind: the answer it came from.
        const at = seen.get(x.what) ?? 0;
        seen.set(x.what, at + 1);
        if (joined.has(i)) return null;
        const details = detailOf(x, at, answers, now);
        const times = runs.get(i);
        // What else the line ran is said under the call's first row, once it is open.
        const also = i === 0 && rest !== "" ? `also ran: ${rest}` : undefined;
        const key = `${call.id ?? ""}:${i}`;
        // A row is one line while folded; the person opens one by pressing its button, at the end of that line.
        const open = shown.includes(key);
        const more = details.length > 0 || also !== undefined;
        const toggle = (
          <Box flexShrink={0} paddingLeft={2}>
            {chip(ui, surface, {
              key,
              label: open ? "▾ collapse" : "▸ expand",
              onPress: () => {
                void update($, opened, (o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]));
              },
            })}
          </Box>
        );
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" minWidth={0}>
              {brandOf(ui)}
              {/* Folded, a row says which brains and no path: the path is one of the details. The button follows the text. */}
              <Box flexShrink={1} minWidth={0}>
                {oneRow(ui, line(x), false)}
              </Box>
              {times !== undefined ? (
                <Box flexShrink={0} paddingLeft={1}>
                  <Text dimColor>{`× ${times}`}</Text>
                </Box>
              ) : null}
              {more && surface === "terminal" ? toggle : null}
            </Box>
            {/* Beyond the terminal a cell is not the width of a letter, and a button at the end of the line would meet its text. */}
            {more && surface !== "terminal" ? <Box paddingLeft={2}>{toggle}</Box> : null}
            {open
              ? details.map((d, n) => {
                  // The line that names a page ends in `open`, in yellow, which opens it in the page viewer (§1.2).
                  const page = pageOf(x, answers, n, d);
                  // Beyond the terminal a cell is not the width of a letter, so a button after a line that gives way is pushed out of the row
                  // and lost: there it comes first, in a column of its own, where every line has it in the same place and none loses it.
                  const press =
                    page === undefined ? null : (
                      <Box
                        flexShrink={0}
                        paddingLeft={surface === "terminal" ? 2 : 0}
                        paddingRight={surface === "terminal" ? 0 : 2}
                      >
                        {chip(ui, surface, {
                          key: `${key}:open:${n}`,
                          label: "↗ open",
                          onPress: () => {
                            void openPage($, page);
                          },
                        })}
                      </Box>
                    );
                  return (
                    <Box paddingLeft={4} minWidth={0} flexDirection="row">
                      {surface !== "terminal" ? (
                        <Box flexShrink={0} width={OPEN_COLUMN}>
                          {press}
                        </Box>
                      ) : null}
                      {/* A name in dim in a column of its own, and what it says after it; a line with no name is dim whole. */}
                      {d.label !== undefined ? (
                        <Box flexShrink={0} width={LABEL_WIDTH}>
                          <Text dimColor>{d.label}</Text>
                        </Box>
                      ) : null}
                      {/* A page's title in the colour of the text, and what follows it, its path and brain, dim; the path gives way first. */}
                      {d.lead !== undefined ? (
                        <Box flexShrink={0}>
                          <Text dimColor>{"› "}</Text>
                        </Box>
                      ) : null}
                      {d.lead !== undefined ? (
                        <Box flexShrink={0.05} minWidth={0}>
                          <Text wrap="truncate-end">{d.lead}</Text>
                        </Box>
                      ) : null}
                      <Box flexShrink={1} minWidth={0}>
                        <Text dimColor={d.label === undefined} wrap="truncate-end">
                          {d.value}
                        </Text>
                      </Box>
                      {surface === "terminal" ? press : null}
                    </Box>
                  );
                })
              : null}
            {open && also !== undefined ? (
              <Box paddingLeft={2} minWidth={0}>
                <Text dimColor wrap="truncate-end">
                  {also}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function registerRows(on: Parameters<Register>[0]): void {
  // A run of calls that run the tool. With none failed it is drawn whole, in the host's place, since the live line the host
  // draws while it runs, with the call's description and command, would show a here-document; with one failed the run is
  // unfolded, each call then a `ToolUse` row, drawn below.
  on("ui.render", { component: "ToolGroup" }, async ($, e, next) => {
    const { calls } = e.props;
    // A call the model is still writing has no command yet: it belongs to the run if another call of it is one `kioku` command,
    // or the host's live line, with the command half written, would show for as long as it takes.
    const writing = (c: (typeof calls)[number]): boolean =>
      c.tool === "Bash" && c.isRunning && typeof (c.input as { command?: unknown } | null)?.command !== "string";
    const mine = (c: (typeof calls)[number]): boolean => c.tool === "Bash" && plainOf(c.input) !== undefined;
    if (!(calls.some(mine) && calls.every((c) => mine(c) || writing(c)))) return next(e);
    // A run with a call that failed is the host's to draw, unfolded; any other is drawn here, whatever else the host shows
    // in it (its hook timing, say, which says `isCallsOnly` is false and which the rows have no place for).
    const failed = calls.some((c) => c.isErrored || c.isInterrupted || answersOf(c.output).some((a) => "error" in a));
    if (failed) return next({ ...e, props: { ...e.props, isExpanded: true } });
    const ui = $.ui.resolve(e);
    const { Box } = ui;
    const entries = await journalEntries($);
    const now = new Date(await $.clock.now());
    const rows = await Promise.all(
      calls.map((c) =>
        drawCall(
          $,
          ui,
          { id: c.tool_use_id, input: c.input, isRunning: c.isRunning, output: c.output },
          entries,
          now,
          e.surface,
        ),
      ),
    );
    // A call that ended with something to show and no row to say it, a verb that makes no entry or an answer another
    // command of the line rewrote, is the host's: a line of its first words would hide what it answered, with no way
    // to open it. So is the run it is in.
    if (calls.some((c, i) => !c.isRunning && rows[i] === undefined && textOf(c.output).trim() !== "")) return next(e);
    return (
      <Box flexDirection="column" marginTop={1}>
        {calls.map((c, i) => {
          const call = { id: c.tool_use_id, input: c.input, isRunning: c.isRunning, output: c.output };
          if (c.tool_use_id !== undefined) state.drawn.add(c.tool_use_id);
          // A call with nothing to show yet, its command half written or its answer not in, is still a line: the
          // run is drawn whole.
          return <Box flexDirection="column">{rows[i] ?? lineOf(ui, call)}</Box>;
        })}
      </Box>
    );
  }).catch(($, e, next) => next(e));

  // One call: its row, once its entries are in the journal; until then, and for any call that made none, the host's.
  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    // Kioku's own skill loaded is a row too, the history's `loaded`, in place of `Skill(kioku:kioku)` and its result.
    if (
      e.props.tool === "Skill" &&
      !e.props.isErrored &&
      KIOKU_SKILLS.includes(String((e.props.input as { skill?: unknown } | null)?.skill))
    ) {
      state.drawn.add(e.props.tool_use_id);
      const ui = $.ui.resolve(e);
      const { Box } = ui;
      const skill: JournalEntry = { at: "", turn: 0, what: "skill", arrow: "read" };
      return (
        <Box flexDirection="row" minWidth={0} marginTop={1}>
          {brandOf(ui)}
          <Box flexShrink={1} minWidth={0}>
            {oneRow(ui, shownOf(skill), false)}
          </Box>
        </Box>
      );
    }
    if (e.props.tool !== "Bash" || e.props.isErrored || e.props.isInterrupted || plainOf(e.props.input) === undefined)
      return next(e);
    const ui = $.ui.resolve(e);
    const { Box } = ui;
    const call = {
      id: e.props.tool_use_id,
      input: e.props.input,
      isRunning: e.props.isRunning,
      output: e.props.output,
    };
    const drawn = await drawCall($, ui, call, await journalEntries($), new Date(await $.clock.now()), e.surface);
    if (drawn === undefined) {
      // A call that failed is the host's, its here-documents cut short.
      const command = (e.props.input as { command: string }).command;
      const cut = shortened(command);
      return next(
        cut === command ? e : { ...e, props: { ...e.props, input: { ...(e.props.input as object), command: cut } } },
      );
    }
    state.drawn.add(e.props.tool_use_id);
    // A blank line above, as the host leaves above its own row of a call.
    return <Box marginTop={1}>{drawn}</Box>;
  }).catch(($, e, next) => next(e));

  // The host's result of a call whose row was drawn says what the row says: left out.
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    if ((e.props.tool !== "Bash" && e.props.tool !== "Skill") || !state.drawn.has(e.props.tool_use_id)) return next(e);
    const { Box } = $.ui.resolve(e);
    return <Box />;
  }).catch(($, e, next) => next(e));
}
