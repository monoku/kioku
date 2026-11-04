import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, Timer } from "claude-code";
import { LAVENDER, ORANGE } from "./colors";
import { follow, readJournal, rereadJournal } from "./journal";
import { panesRegister, panesRestore, panesStart } from "./panes";
import { toolStart } from "./tool";

// The footer indicator of §1.2: `⬢ kioku.md ↓3 ↑2`, how many times this session read the memory and wrote to it: the
// entries of the session's journal (§4.6), which the plugin's hooks write and the mod reads after each of them. The rows,
// the memory history, the page viewer and the search come from `panes.ts`.

const reads = atom({ plugin: "kioku", key: "reads" } as const, 0);
const writes = atom({ plugin: "kioku", key: "writes" } as const, 0);
// Which frame of the drop each arrow's cell shows; -1 is the arrow itself.
const readFrame = atom({ plugin: "kioku", key: "readFrame" } as const, -1);
const writeFrame = atom({ plugin: "kioku", key: "writeFrame" } as const, -1);
// A read's drop falls in the ↓ cell; a write's rises in the ↑ cell: the same four frames, the other way round.
const DOWN = ["⠁", "⠂", "⠄", "⡀"];
const UP = ["⡀", "⠄", "⠂", "⠁"];
/** How long each frame of a drop shows: four of them take less than half a second (§1.2). */
const FRAME_MS = 110;
const MAX_SHOWN = 99;

/** What the footer counted last: a journal read that finds more starts a drop in each arrow that grew. */
const counted = { reads: 0, writes: 0 };

const shown = (n: number): string => (n > MAX_SHOWN ? `${MAX_SHOWN}+` : String(n));

/** What fits: on a narrow terminal the icon goes first, then `.md`, then the name; the counts stay. */
function partsFor(columns: number | undefined): { icon: boolean; md: boolean; name: boolean } {
  const room = columns ?? Infinity;
  return { icon: room >= 60, md: room >= 50, name: room >= 40 };
}

/** Each arrow's drop under way, and how many it is to add when the arrow comes back. */
const drops = {
  read: { timer: undefined as Timer | undefined, adding: 0 },
  write: { timer: undefined as Timer | undefined, adding: 0 },
};

// The engine lists what a module reads and writes by scanning each `update` for an atom named there, so the two
// below branch on the kind instead of indexing a table of atoms.

/** Shows a frame of the drop in the arrow's cell, or the arrow (-1). */
async function show($: EngineInterface, kind: "read" | "write", at: number): Promise<void> {
  if (kind === "read") await update($, readFrame, () => at);
  else await update($, writeFrame, () => at);
}

/** Moves the arrow's count on. */
async function add($: EngineInterface, kind: "read" | "write", n: number): Promise<void> {
  if (kind === "read") await update($, reads, (c) => c + n);
  else await update($, writes, (c) => c + n);
}

/** The counts from nothing: what the footer counted, and what it shows. */
async function reset($: EngineInterface): Promise<void> {
  counted.reads = 0;
  counted.writes = 0;
  await update($, reads, () => 0);
  await update($, writes, () => 0);
}

/** A drop in the arrow's cell, then the count moves on as the arrow comes back; a drop under way finishes first. */
async function drop($: EngineInterface, kind: "read" | "write", n: number, animates: boolean): Promise<void> {
  const d = drops[kind];
  if (d.timer !== undefined) {
    d.timer.cancel();
    d.timer = undefined;
    const added = d.adding;
    d.adding = 0;
    await show($, kind, -1);
    await add($, kind, added);
  }
  if (!animates) {
    await add($, kind, n);
    return;
  }
  d.adding = n;
  let i = 0;
  await show($, kind, 0);
  d.timer = $.clock.every(FRAME_MS, () => {
    i++;
    if (i < DOWN.length) {
      void show($, kind, i);
      return;
    }
    d.timer?.cancel();
    d.timer = undefined;
    const added = d.adding;
    d.adding = 0;
    void show($, kind, -1);
    void add($, kind, added);
  });
}

/** After a reset of the session's state: the counts from nothing. */
async function restore($: EngineInterface): Promise<void> {
  await reset($);
  rereadJournal();
}

/** Reads the journal again and moves each arrow that grew, with its drop. */
async function recount($: EngineInterface, animates: boolean, sessionId?: string): Promise<void> {
  // A hook of another session than the last, after `/clear`: its journal, counted from nothing.
  if (await follow($, sessionId)) {
    await reset($);
  }
  const now = await readJournal($);
  if (now === undefined) return;
  const [r, w] = [now.reads - counted.reads, now.writes - counted.writes];
  counted.reads = now.reads;
  counted.writes = now.writes;
  if (w > 0) await drop($, "write", w, animates);
  if (r > 0) await drop($, "read", r, animates);
}

export const register: Register = (on) => {
  // The rows, the panes and their commands (§1.2).
  panesRegister(on);

  // The session's folder, the counts from nothing, and each pane from nothing: the mod reads no configuration.
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    toolStart(e.cwd);
    await reset($);
    await panesStart($, e.cwd);
    // A session resumed, or a mod reloaded, finds its journal already begun.
    await recount($, false);
    return started;
  });

  // The journal is read again once the plugin's hooks ran: after a session starts, a prompt, a command of the
  // tool's and Kioku's skill loaded. A drop in each arrow that grew (§1.2); never in the way of what it follows.
  on("classic.SessionStart", async ($, e, next) => {
    const ran = await next(e);
    // `/clear`, `/resume` and `/branch` (`fork`) reset the session's state, and `session.start` does not run again:
    // the counts are put back to nothing, and the journal read again from its first line.
    if (e.source === "clear" || e.source === "resume" || e.source === "fork") {
      await restore($);
      await panesRestore($);
    }
    await recount($, true, e.session_id);
    return ran;
  }).catch(($, e, next) => next(e));

  on("classic.UserPromptSubmit", async ($, e, next) => {
    const ran = await next(e);
    await recount($, true, e.session_id);
    return ran;
  }).catch(($, e, next) => next(e));

  on("classic.PostToolUse", async ($, e, next) => {
    const ran = await next(e);
    await recount($, true, e.session_id);
    return ran;
  }).catch(($, e, next) => next(e));

  // Kioku's skill loaded is an entry too, written by the hook before the tool runs.
  on("tool.call", { tool: "Skill" }, async ($, e, next) => {
    const ran = await next(e);
    await recount($, true);
    return ran;
  }).catch(($, e, next) => next(e));

  // The footer's right end: what the engine draws there, then the mark.
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    const beneath = await next(e);
    const [r, w, rf, wf] = [
      await read($, reads),
      await read($, writes),
      await read($, readFrame),
      await read($, writeFrame),
    ];
    const { Box, Text } = $.ui.resolve(e);
    // A cell is a space on the terminal and about half of one in the desktop's own font.
    const gap = e.surface === "terminal" ? 1 : 2;
    const fits = partsFor(e.surface === "terminal" ? e.viewport?.columns : undefined);
    const hasBeneath = e.props.modes.length > 0 || (beneath !== undefined && beneath !== null);

    return (
      <Box flexDirection="row" gap={gap}>
        {hasBeneath ? beneath : null}
        {fits.icon ? <Text color={ORANGE}>⬢</Text> : null}
        {fits.name ? (
          <Text>
            <Text bold>kioku</Text>
            {fits.md ? <Text color={ORANGE}>.md</Text> : null}
          </Text>
        ) : null}
        <Box flexDirection="row">
          <Box width={1}>
            <Text color={LAVENDER}>{rf < 0 ? "↓" : DOWN[rf]}</Text>
          </Box>
          <Text color={LAVENDER}>{shown(r)}</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={1}>
            <Text color={ORANGE}>{wf < 0 ? "↑" : UP[wf]}</Text>
          </Box>
          <Text color={ORANGE}>{shown(w)}</Text>
        </Box>
      </Box>
    );
  });
};
