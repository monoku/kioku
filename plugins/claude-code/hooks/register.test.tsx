import { expect, mock, test } from "claude-code/testing";
import { printed } from "./tool-double";
import type { Engine } from "claude-code/testing";

// The footer indicator of §1.2, run against the engine: `claude plugin test plugins/claude-code`.

const FOOTER = { plugin: "kioku", component: "SessionMode", props: { modes: [] as string[] } } as const;

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1];

/** An entry of the session's journal (§4.6), as the plugin's hooks write it. */
const entry = (what: string, arrow: "read" | "write"): string =>
  `${JSON.stringify({ at: "2026-10-23T00:00:00Z", turn: 1, what, arrow })}\n`;

/** The session's journal beneath the plugin, which the test fills as the hooks would, and no configuration. */
function journal(on: On): { text: string } {
  const kept = { text: "" };
  mock.env(on, { HOME: "/home/sam" });
  on("fs.read", (_, e) => {
    if (e.path.includes("/sessions/")) return { value: kept.text };
    throw new Error(`no ${e.path}`);
  });
  on("classic.PostToolUse", () => ({}) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  return kept;
}

/** A hook of the plugin ran after a command: the mod reads the journal again. */
const afterHook = async ($: Engine): Promise<void> => {
  await $.classic.PostToolUse({
    tool_name: "Bash",
    tool_input: { command: "kioku" },
    tool_response: {},
    tool_use_id: "t",
  } as never);
};

/** How long a drop takes: the count moves when it ends (§1.2). */
const DROP_MS = 440;

/** The text the footer draws, in order. */
async function footer($: Engine, surface: "terminal" | "desktop" = "terminal", columns?: number): Promise<string> {
  const ui = await $.ui.mount({
    ...FOOTER,
    surface,
    ...(columns !== undefined && { viewport: { columns, rows: 40 } }),
  } as never);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join(" ");
}

test("the footer draws the mark and both counts on each surface that has one", async ($, on) => {
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>auto mode on</Text>;
  });
  for (const surface of ["terminal", "desktop"] as const) {
    await $.session.start({ cwd: "/", surface, isInteractive: true });
    const drawn = await footer($, surface);
    expect(drawn).toMatch(/⬢/);
    expect(drawn).toMatch(/kioku/);
    expect(drawn).toMatch(/\.md/);
    expect(drawn).toMatch(/↓ 0/);
    expect(drawn).toMatch(/↑ 0/);
  }
});

test("every read and every write of the session's journal drips in its cell, then counts; each hook's new entries only", async ($, on) => {
  const clock = mock.clock(on);
  const kept = journal(on);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });

  kept.text += entry("opened", "read");
  await afterHook($);
  expect(await footer($)).toMatch(/⠁ 0/);
  await clock.advance(110);
  expect(await footer($)).toMatch(/⠂ 0/);
  await clock.advance(330);
  expect(await footer($)).toMatch(/↓ 1/);

  kept.text += entry("saved", "write");
  await afterHook($);
  expect(await footer($)).toMatch(/⡀ 0/);
  // Another write before the drop ends: the first is counted at once, and a new drop starts.
  await clock.advance(110);
  kept.text += entry("instinct again", "write");
  await afterHook($);
  expect(await footer($)).toMatch(/⡀ 1/);
  await clock.advance(440);
  expect(await footer($)).toMatch(/↑ 2/);

  // A search, a list and the summary are reads too; a hook that wrote nothing moves nothing.
  kept.text += entry("searched", "read") + entry("listed", "read") + entry("summary", "read");
  await afterHook($);
  await afterHook($);
  await clock.advance(440);
  const drawn = await footer($);
  expect(drawn).toMatch(/↓ 4/);
  expect(drawn).toMatch(/↑ 2/);
});

test("a session whose journal is already begun, resumed or reloaded, counts it at once", async ($, on) => {
  const kept = journal(on);
  kept.text = entry("summary", "read") + entry("opened", "read") + entry("saved", "write");
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await footer($)).toMatch(/↓ 2.*↑ 1/);
});

test("on a narrow terminal the icon goes first, then .md, then the name; the counts stay", async ($, on) => {
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await footer($, "terminal", 55)).not.toMatch(/⬢/);
  expect(await footer($, "terminal", 45)).not.toMatch(/\.md/);
  const narrow = await footer($, "terminal", 30);
  expect(narrow).not.toMatch(/kioku/);
  expect(narrow).toMatch(/↓ 0/);
});

test("KIOKU_HOME says where the session's journal is", async ($, on) => {
  mock.env(on, { HOME: "/home/sam", KIOKU_HOME: "/elsewhere" });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "s1" }) as never);
  on("fs.read", (_, e) => {
    if (e.path === "/elsewhere/.kioku/sessions/s1.jsonl") return { value: entry("saved", "write") };
    throw new Error(`no ${e.path}`);
  });
  on("process.run", () => printed());
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await footer($)).toMatch(/↑ 1/);
});

test("a plugin of another version than the tool, either way, still draws the footer and counts (§6.2)", async ($, on) => {
  const clock = mock.clock(on);
  const kept = { text: "" };
  mock.env(on, { HOME: "/home/sam" });
  on("classic.PostToolUse", () => ({}) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  let tool = "5.0.0";
  on("fs.read", (_, e) => {
    if (e.path.endsWith("/.claude-plugin/plugin.json")) return { value: JSON.stringify({ version: "4.2.0" }) };
    if (e.path.includes("/sessions/")) return { value: kept.text };
    throw new Error(`no ${e.path}`);
  });
  on("process.run", () => printed({ version: tool, contract: 2 }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  for (const v of ["5.0.0", "4.1.9"]) {
    tool = v;
    kept.text = "";
    await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
    expect(await footer($)).toMatch(/kioku.*↓ 0.*↑ 0/);
    kept.text += entry("saved", "write");
    await afterHook($);
    await clock.advance(DROP_MS);
    expect(await footer($)).toMatch(/kioku.*↓ 0.*↑ 1/);
  }
});

test("a tool with no answer leaves the footer drawn, and the session's start reads no configuration (§2.3)", async ($, on) => {
  mock.env(on, { HOME: "/home/sam" });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("fs.read", (_, e) => {
    throw new Error(`no ${e.path}`);
  });
  const ran: string[][] = [];
  on("process.run", (_, e) => {
    ran.push([...e.argv] as string[]);
    return printed();
  });
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await footer($)).toMatch(/kioku.*↓ 0.*↑ 0/);
  expect(ran.filter((argv) => argv.includes("config"))).toEqual([]);
});

test("after /clear the footer counts the new session's journal, from nothing, its summary first", async ($, on) => {
  const clock = mock.clock(on);
  const journals: Record<string, string> = {
    s1: entry("summary", "read") + entry("opened", "read") + entry("saved", "write"),
    s2: "",
  };
  mock.env(on, { HOME: "/home/sam" });
  on("fs.read", (_, e) => {
    const id = /\/sessions\/(\w+)\.jsonl$/.exec(e.path)?.[1];
    if (id !== undefined && journals[id] !== undefined) return { value: journals[id] };
    throw new Error(`no ${e.path}`);
  });
  on("classic.SessionStart", () => ({}) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await footer($)).toMatch(/↓ 2.*↑ 1/);
  // `/clear`: the session start hook writes the new session's summary under its own id.
  journals.s2 = entry("summary", "read");
  await $.classic.SessionStart({ source: "clear", session_id: "s2" } as never);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↓ 1.*↑ 0/);
});

test("after /clear, /resume or /branch the footer is as the session start found it, and counts its journal whole", async ($, on) => {
  const clock = mock.clock(on);
  const kept = journal(on);
  kept.text = entry("summary", "read") + entry("opened", "read") + entry("saved", "write");
  on("classic.SessionStart", () => ({}) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await footer($)).toMatch(/↓ 2.*↑ 1/);
  // `/resume` of the same session: its journal, read again whole, counted once.
  kept.text += entry("summary", "read");
  await $.classic.SessionStart({ source: "resume", session_id: "s1" } as never);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↓ 3.*↑ 1/);
});

test("after /clear the history's and the search's commands are there again (§1.2)", async ($, on) => {
  const registered: string[] = [];
  mock.clock(on);
  mock.env(on, { HOME: "/home/sam" });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "s1" }) as never);
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("classic.SessionStart", () => ({}) as never);
  on("command.register", (_, e) => {
    registered.push(e.name);
    return { value: undefined } as never;
  });
  on("fs.read", (_, e) => {
    throw new Error(`no ${e.path}`);
  });
  on("process.run", () => printed());
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  registered.length = 0;
  await $.classic.SessionStart({ source: "clear", session_id: "s2" } as never);
  expect(registered.sort()).toEqual(["kioku-evolve", "kioku-history", "kioku-search"]);
});

test("the journal is read as it grows: a line half written counts once it is whole, and only once", async ($, on) => {
  const clock = mock.clock(on);
  const kept = journal(on);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("process.run", () => printed());
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const saved = entry("saved", "write");
  kept.text = saved + saved.slice(0, 20);
  await afterHook($);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↑ 1/);
  kept.text = saved + saved;
  await afterHook($);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↑ 2/);
  kept.text += saved;
  await afterHook($);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↑ 3/);
  // No trailing newline yet, but whole: it counts, and its newline adds nothing.
  kept.text += saved.trimEnd();
  await afterHook($);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↑ 4/);
  kept.text += "\n";
  await afterHook($);
  await clock.advance(DROP_MS);
  expect(await footer($)).toMatch(/↑ 4/);
});

test("a drop under way when the counts are put back to nothing adds nothing to them (§1.2)", async ($, on) => {
  const clock = mock.clock(on);
  const journals: Record<string, string> = { s1: entry("summary", "read"), s2: "" };
  mock.env(on, { HOME: "/home/sam" });
  on("fs.read", (_, e) => {
    const id = /\/sessions\/(\w+)\.jsonl$/.exec(e.path)?.[1];
    if (id !== undefined && journals[id] !== undefined) return { value: journals[id] };
    throw new Error(`no ${e.path}`);
  });
  on("classic.SessionStart", () => ({}) as never);
  on("classic.PostToolUse", () => ({}) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  // A page opened: its drop starts, and `/clear` comes before it ends.
  journals.s1 += entry("opened", "read");
  await $.classic.PostToolUse({
    tool_name: "Bash",
    tool_input: { command: "kioku" },
    tool_response: {},
    tool_use_id: "t",
    session_id: "s1",
  } as never);
  await clock.advance(110);
  journals.s2 = entry("summary", "read");
  await $.classic.SessionStart({ source: "clear", session_id: "s2" } as never);
  await clock.advance(DROP_MS);
  // The new session's summary alone: what the old drop carried went with the old session.
  expect(await footer($)).toMatch(/↓ 1.*↑ 0/);
});
