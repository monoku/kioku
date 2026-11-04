import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import { printed } from "./tool-double";

// The memory history (§1.2), the pane `/kioku-history` opens, run against the engine: `claude plugin test plugins/claude-code`.

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1];
type Entry = Record<string, unknown> & { what: string; arrow: "read" | "write" };
type Props = { backgroundColor?: string; borderStyle?: string };

const OPENED: Entry = {
  what: "opened",
  arrow: "read",
  brain: "acme",
  path: "knowledge/acme/context/pool.md",
  title: "Pool",
};
const SEARCHED: Entry = { what: "searched", arrow: "read", brain: "acme, kioku", words: "deploy steps", count: 2 };
const SAVED: Entry = {
  what: "saved",
  arrow: "write",
  brain: "acme",
  path: "memory/use-pnpm.md",
  title: "Use pnpm, not npm",
};
const FORGOT: Entry = {
  what: "forgot",
  arrow: "write",
  brain: "acme",
  path: "knowledge/acme/context/pool.md",
  title: "Pool",
};
const SKILL: Entry = { what: "skill", arrow: "read" };

/**
 * The engine beneath the plugin: the machine configuration, the host's theme, and the session's journal (§4.6), which
 * `add` fills as the plugin's hooks would, each entry in the turn it is given, then has the mod read it again.
 */
function machine(on: On, startTheme = "dark", versions = { plugin: "4.0.0", tool: "4.0.0" }) {
  const host = { theme: startTheme };
  mock.env(on, { HOME: "/home/sam" });
  // The machine's clock: Oct 23, 2026, at 15:55.
  const clock = mock.clock(on, { now: new Date(2026, 9, 23, 15, 55).getTime() });
  let text = "";
  on("config.list", () => ({ value: [{ key: "theme", value: host.theme }] }) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("classic.PostToolUse", () => ({}) as never);
  on("fs.read", (_, e) => {
    if (e.path.endsWith("/.claude-plugin/plugin.json"))
      return { value: JSON.stringify({ name: "kioku", version: versions.plugin }) };
    if (e.path.endsWith("/.kioku/sessions/s1.jsonl")) return { value: text };
    throw new Error(`no ${e.path}`);
  });
  on("process.run", () => printed({ version: versions.tool, contract: 1 }));
  on("ui.render", ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box />;
  });
  /** Entries of one turn, made at the time given (today's 15:46 when none). */
  const add = async ($: Engine, entries: Entry[], turn = 1, at = new Date(2026, 9, 23, 15, 46)): Promise<void> => {
    text += entries.map((x) => `${JSON.stringify({ at: at.toISOString(), turn, ...x })}\n`).join("");
    await $.classic.PostToolUse({
      tool_name: "Bash",
      tool_input: { command: "kioku" },
      tool_response: {},
      tool_use_id: "t",
      session_id: "s1",
    } as never);
  };
  return { clock, add, host };
}

/** The pane, as the host draws it: docked, or above the prompt, on the terminal or the desktop. */
const PANE = (placement: "dock" | "inline", surface: "terminal" | "desktop" = "terminal") =>
  ({
    plugin: "kioku",
    component: "Pane",
    requestId: "kioku-history",
    surface,
    props: {
      title: "Kioku history",
      isFocused: false,
      bodyColumns: placement === "dock" ? 50 : 200,
      placement,
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as never;
const BAND = {
  plugin: "kioku",
  component: "AbovePrompt",
  surface: "terminal",
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 200,
    scroll: { bodyRows: 19, top: 0 },
    view: {},
  },
} as never;

/** The text of what is mounted, in order. */
async function drawn($: Engine, what: unknown): Promise<string> {
  const ui = await $.ui.mount(what as never);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join(" ");
}

/** The props of every box of what is mounted. */
async function boxes($: Engine, what: unknown): Promise<Props[]> {
  const ui = await $.ui.mount(what as never);
  const found = (await ui.findAll({ type: "Box" })).map((b) => b.props as Props);
  await ui.unmount();
  return found;
}

const tints = (found: Props[]): (string | undefined)[] =>
  found.map((b) => b.backgroundColor).filter((c) => c !== undefined);

/** The engine beneath, with the panes it opened. */
function panes(on: On): { open: Set<string>; opens: Record<string, unknown>[]; closed: string[] } {
  const seen = { open: new Set<string>(), opens: [] as Record<string, unknown>[], closed: [] as string[] };
  on("ui.open", (_, e) => {
    seen.open.add(e.id);
    seen.opens.push(e as never);
    return { value: { isPlaced: true } } as never;
  });
  on("ui.close", (_, e) => {
    seen.open.delete(e.id);
    seen.closed.push(e.id);
    return { value: undefined } as never;
  });
  return seen;
}

/** The commands the plugin registered. */
function commands(on: On): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  on("command.register", (_, e) => {
    seen.push(e as never);
    return { value: undefined } as never;
  });
  return seen;
}

const start = async ($: Engine): Promise<void> => {
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
};
const run = async ($: Engine): Promise<unknown> => $.command.run({ command: "kioku-history", args: "" } as never);

test("/kioku-history is the session's while Kioku is on, runs mid-turn, and opens the pane, never closing it", async ($, on) => {
  const seen = panes(on);
  const registered = commands(on);
  const { add } = machine(on);
  await start($);
  expect(registered.map((c) => c.name)).toContain("kioku-history");
  expect(registered.find((c) => c.name === "kioku-history")).toMatchObject({ immediate: true });
  await run($);
  expect(seen.open.has("kioku-history")).toBe(true);
  // It asks for the keyboard, so the arrows scroll it, and Esc closes it; its title is the pane's.
  expect(seen.opens[0]).toMatchObject({ title: "⬢ Kioku history", focus: true, closeOnEscape: true });
  // However little it holds, above the prompt it opens five rows tall.
  expect(seen.opens[0]).toMatchObject({ rows: 5 });
  // Run again while it is open, it shows it again and never closes it: the pane's own close does.
  await run($);
  expect(seen.open.has("kioku-history")).toBe(true);
  expect(seen.closed).toEqual([]);
  // Nothing of it is drawn above the prompt.
  await add($, [SAVED]);
  expect(await drawn($, BAND)).not.toMatch(/saved/);
});

test("with the plugin and the tool of different versions /kioku-history is there all the same (§6.2)", async ($, on) => {
  const registered = commands(on);
  machine(on, "dark", { plugin: "4.0.0", tool: "5.0.0" });
  await start($);
  expect(registered.map((c) => c.name)).toContain("kioku-history");
});

test("the pane says it is empty in one dim line", async ($, on) => {
  machine(on);
  await start($);
  expect(await drawn($, PANE("inline"))).toBe("✕ close nothing read or written yet");
});

test("the pane lists every entry newest first, by day and by turn, each at HH:MM and in its arrow", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add(
    $,
    [{ what: "summary", arrow: "read", brain: "acme, sam", count: 12 }, SKILL],
    1,
    new Date(2026, 9, 22, 18, 2),
  );
  await add($, [OPENED, SEARCHED, SAVED], 2, new Date(2026, 9, 23, 15, 46));
  await add(
    $,
    [
      {
        what: "instinct again",
        arrow: "write",
        brain: "sam",
        path: "memory/instincts/ask.md",
        title: "Ask before committing",
        candidate: true,
      },
      {
        what: "evolved",
        arrow: "write",
        brain: "sam",
        path: "skills/ask/SKILL.md",
        title: "Ask before committing",
        became: "skill",
      },
      FORGOT,
    ],
    3,
    new Date(2026, 9, 23, 15, 50),
  );
  const inline = await drawn($, PANE("inline"));
  expect(inline).toMatch(
    /── Today ── .*15:50 .*− forgot .*Pool.*↑ evolved .*Ask before committing → Skill.*↑ again .*Ask before committing · ready for a Skill.*15:46 .*↑ saved .*Use pnpm, not npm.*memory\/use-pnpm\.md.*↓ found .*“deploy steps” · 2 results.*\(acme, kioku\).*↓ opened .*Pool.*knowledge\/acme\/context\/pool\.md.*\(acme\).*── Yesterday ── .*18:02 .*↓ loaded .*Kioku skill.*↓ summary .*session summary · 12 pages.*\(acme, sam\)/,
  );
  // The time is hours and minutes, never seconds; no row says when on its own, and there is no turn number or header.
  expect(inline).not.toMatch(/\d\d:\d\d:\d\d/);
  expect(inline).not.toMatch(/turn \d|· now|kioku\.md|this session/);
  // A separator for each day and a time for each turn, nothing else: three turns, two days.
  expect(inline.match(/── /g)?.length).toBe(4);
});

test("a summary says why it was loaded, and each is its own group at its own time", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add(
    $,
    [{ what: "summary", arrow: "read", brain: "acme", count: 3, source: "startup" }],
    1,
    new Date(2026, 9, 22, 23, 50),
  );
  await add(
    $,
    [{ what: "summary", arrow: "read", brain: "acme", count: 3, source: "resume" }],
    2,
    new Date(2026, 9, 23, 0, 2),
  );
  await add(
    $,
    [{ what: "summary", arrow: "read", brain: "acme", count: 3, source: "compact" }],
    3,
    new Date(2026, 9, 23, 0, 30),
  );
  expect(await drawn($, PANE("inline"))).toMatch(
    /── Today ── .*00:30 .*after \/compact · 3 pages.*00:02 .*resumed · 3 pages.*── Yesterday ── .*23:50 .*session summary · 3 pages/,
  );
});

test("a brain is named as Kioku names it, and an older entry with no label by its brain", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [
    { ...SAVED, label: "project" },
    { what: "saved", arrow: "write", brain: "sam", label: "personal", path: "memory/a.md", title: "Mine" },
    { what: "opened", arrow: "read", brain: "kioku", label: "project · kioku", path: "p.md", title: "Elsewhere" },
    { ...OPENED, title: "Old" },
  ]);
  const pane = await drawn($, PANE("inline"));
  expect(pane).toMatch(
    /Old.*\(acme\).*Elsewhere.*\(project · kioku\).*Mine.*\(personal\).*Use pnpm, not npm.*\(project\)/,
  );
  expect(pane).not.toMatch(/\(sam\)/);
});

test("docked, an entry always takes two rows: a path and a brain, brains only, or a note", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  expect(tints(await boxes($, PANE("dock"))).filter((c) => c === "#23263A")).toHaveLength(2);
  await add($, [SEARCHED, SKILL, { what: "listed", arrow: "read", brain: "acme", count: 12 }]);
  const found = tints(await boxes($, PANE("dock")));
  // Four reads, two rows each, however little the second says.
  expect(found).toHaveLength(8);
  const pane = await drawn($, PANE("dock"));
  // The path and the brain on the second row; a search says only its brains; the skill has none.
  expect(pane).toMatch(/knowledge\/acme\/context\/pool\.md.*\(acme\)/);
  expect(pane).toMatch(/“deploy steps” · 2 results .*\(acme, kioku\)/);
  // The skill has neither, and its second row says what it is.
  expect(pane).toMatch(/Kioku skill .*how to use Kioku/);
});

test("above the prompt an entry takes one row, the path and the brain after the title", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED, SAVED, SKILL]);
  expect(tints(await boxes($, PANE("inline")))).toHaveLength(3);
  expect(await drawn($, PANE("inline"))).toMatch(/Pool\s+knowledge\/acme\/context\/pool\.md\s+\(acme\)/);
});

test("on the terminal each row is tinted in its colour for a dark theme and a light one", async ($, on) => {
  const { add, host } = machine(on, "dark");
  await start($);
  await add($, [OPENED, SAVED]);
  const dark = tints(await boxes($, PANE("inline")));
  expect(dark).toEqual(expect.arrayContaining(["#23263A", "#2E2519"]));
  host.theme = "light";
  const light = tints(await boxes($, PANE("inline")));
  expect(light).toEqual(expect.arrayContaining(["#ECEEFB", "#FCF0E2"]));
  expect(light).not.toContain("#23263A");
});

test("with an ANSI theme the rows take no tint and no bar, the colours being the terminal's own", async ($, on) => {
  const { add } = machine(on, "dark-ansi");
  await start($);
  await add($, [OPENED, SAVED]);
  expect(tints(await boxes($, PANE("inline")))).toEqual([]);
  expect(await drawn($, PANE("inline"))).not.toMatch(/▎/);
});

test("with the auto theme, light or dark, each row takes the host's own background and a bar, on both rows docked", async ($, on) => {
  const { add } = machine(on, "auto");
  await start($);
  await add($, [OPENED, SAVED]);
  expect(tints(await boxes($, PANE("inline")))).toEqual(
    expect.arrayContaining(["memoryBackgroundColor", "bashMessageBackgroundColor"]),
  );
  expect((await drawn($, PANE("inline"))).match(/▎/g)).toHaveLength(2);
  expect((await drawn($, PANE("dock"))).match(/▎/g)).toHaveLength(4);
});

test("the tint follows the host's theme as it is when the pane draws, a /theme in the middle of a session included", async ($, on) => {
  const { add, host } = machine(on, "dark");
  await start($);
  await add($, [OPENED, SAVED]);
  expect(tints(await boxes($, PANE("inline")))).toContain("#23263A");
  host.theme = "auto";
  expect(tints(await boxes($, PANE("inline")))).toContain("memoryBackgroundColor");
});

test("the desktop draws each entry as a card with a faint rounded border, and tints nothing", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED, SAVED]);
  const found = await boxes($, PANE("dock", "desktop"));
  expect(found.filter((b) => b.borderStyle === "round")).toHaveLength(2);
  expect(tints(found)).toEqual([]);
});

test("above the prompt the pane asks for as many rows as it shows, five at least and twenty-four at most", async ($, on) => {
  const seen = panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [OPENED], 1);
  await run($);
  // A day, a turn and an entry: three rows, and five is the least.
  expect(seen.opens.at(-1)).toMatchObject({ rows: 5 });
  await add(
    $,
    Array.from({ length: 6 }, () => SAVED),
    2,
  );
  await run($);
  // Day separator, turn, entry; a blank and a turn and six entries: 3 + 1 + 1 + 6 = 11, and the close's two rows.
  expect(seen.opens.at(-1)).toMatchObject({ rows: 13 });
  await add(
    $,
    Array.from({ length: 40 }, () => SAVED),
    3,
  );
  await run($);
  expect(seen.opens.at(-1)).toMatchObject({ rows: 24 });
});

test("after /clear the command is registered again", async ($, on) => {
  const registered = commands(on);
  on("classic.SessionStart", () => ({}) as never);
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const before = registered.length;
  await $.classic.SessionStart({ source: "clear", session_id: "s1" } as never);
  expect(registered.slice(before).find((c) => c.name === "kioku-history")).toMatchObject({ immediate: true });
});

test("a line of the journal with no time or turn is counted by the footer and left out of the pane, which still draws", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  await add($, [{ what: "saved", arrow: "write", at: "not a time" }]);
  const pane = await drawn($, PANE("inline"));
  expect(pane).toMatch(/opened .*Pool/);
  expect(pane).not.toMatch(/saved/);
});

test("on a terminal the time starts in the column of the rows' text, and the separator and times are not smaller there", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const ui = await $.ui.mount(PANE("inline"));
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  expect(texts.map((t) => t.text)).toContain(" 15:46");
  expect(texts.filter((t) => (t.props as { size?: string }).size !== undefined)).toEqual([]);
  const app = await $.ui.mount(PANE("dock", "desktop"));
  const small = await app.findAll({ type: "Text" });
  await app.unmount();
  expect(small.map((t) => t.text)).toContain("15:46");
  expect(small.filter((t) => (t.props as { size?: string }).size === "footnote").length).toBe(2);
});
