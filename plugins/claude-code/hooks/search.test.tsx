import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

// The engine's test environment has the host's timers; the mod itself has none, and uses `$.clock`.
declare function setInterval(fn: () => void, ms: number): unknown;

// Search (§1.2), `/kioku-search` and the tabs it fills, run against the engine: `claude plugin test plugins/claude-code`.

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1];

const tab = (n: number) => ({
  plugin: "kioku",
  component: "Pane",
  requestId: `kioku-page-${n}`,
  surface: "terminal",
  props: {
    title: "Kioku",
    isFocused: true,
    bodyColumns: 100,
    placement: "dock",
    scroll: { bodyRows: 20, top: 0, total: 20 },
  },
});

const HITS = {
  deploy: [
    { brain: "acme", path: "a.md", title: "Deploy checklist" },
    { brain: "kioku", path: "b.md", title: "Release a version" },
  ],
  pool: [{ brain: "acme", path: "c.md", title: "Pool" }],
} as Record<string, { brain: string; path: string; title: string }[]>;

async function drawn($: Engine, what: unknown): Promise<string> {
  const ui = await $.ui.mount(what as never);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join(" ");
}

async function buttons($: Engine, what: unknown): Promise<string[]> {
  const ui = await $.ui.mount(what as never);
  const found = (await ui.findAll({ type: "Button" })).map((b) => String((b.props as { label?: unknown }).label));
  await ui.unmount();
  return found;
}

async function press($: Engine, what: unknown, label: string, at = 0): Promise<void> {
  const ui = await $.ui.mount(what as never);
  const found = (await ui.findAll({ type: "Button" })).filter((b) => (b.props as { label?: unknown }).label === label)[
    at
  ];
  if (found === undefined) throw new Error(`no button ${label}`);
  await ui.press({ key: (found.props as { key?: string }).key } as never);
  await ui.unmount();
}

/** The engine beneath: the configuration, and the tool, which answers a search with the pages `HITS` holds for its words. */
function machine(on: On, mode: "hybrid" | "full-text" = "hybrid") {
  mock.env(on, { HOME: "/home/sam" });
  const clock = mock.clock(on, { now: new Date(2026, 9, 23, 15, 55).getTime() });
  setInterval(() => {
    void clock.advance(250);
  }, 2);
  const ran: string[][] = [];
  const opens: Record<string, unknown>[] = [];
  const closed: string[] = [];
  const registered: Record<string, unknown>[] = [];
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("fs.read", (_, e) => {
    if (e.path.endsWith("/.claude-plugin/plugin.json"))
      return { value: JSON.stringify({ name: "kioku", version: "4.0.0" }) };
    throw new Error(`no ${e.path}`);
  });
  on("process.run", (_, e) => {
    const args = [...e.argv] as string[];
    ran.push(args);
    const at = args.indexOf("search");
    const hits = at === -1 ? undefined : (HITS[args[at + 1]!] ?? []);
    const answer = args.includes("--version")
      ? { version: "4.0.0", contract: 2 }
      : { mode, ...(mode === "full-text" && { reason: "no model yet" }), hits, more: false };
    return {
      value: {
        exitCode: 0,
        stdout: `${JSON.stringify(answer)}\n`,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    } as never;
  });
  on("command.register", (_, e) => {
    registered.push(e as never);
    return { value: undefined } as never;
  });
  on("ui.open", (_, e) => {
    opens.push(e as never);
    return { value: { isPlaced: true } } as never;
  });
  on("ui.close", (_, e) => {
    closed.push(e.id);
    return { value: undefined } as never;
  });
  on("ui.render", ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box />;
  });
  return { ran, opens, registered, closed, clock };
}

const start = async ($: Engine): Promise<void> => {
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
};
const search = async ($: Engine, args: string): Promise<unknown> =>
  $.command.run({ command: "kioku-search", args } as never);

test("there is /kioku-search, and with words it lists what the tool found in a tab of the page viewer (§1.2)", async ($, on) => {
  const { ran, opens, registered } = machine(on);
  await start($);
  expect(registered.map((c) => c.name)).toContain("kioku-search");
  await search($, "deploy");
  expect(ran.some((a) => a.includes("search") && a.includes("deploy"))).toBe(true);
  expect(opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "↗ Kioku page · deploy", focus: true });
  expect(await buttons($, tab(1))).toEqual(["✕ close", "↗ open", "↗ open"]);
  expect(await drawn($, tab(1))).toContain("2 pages for “deploy”");
});

test("with no words it opens a tab with the field, and each search has a tab of its own (§1.2)", async ($, on) => {
  const { opens } = machine(on);
  await start($);
  await search($, "");
  expect(opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "⌕ Kioku search" });
  await search($, "deploy");
  await search($, "pool");
  expect([...new Set(opens.map((o) => o.id))]).toEqual(["kioku-page-1", "kioku-page-2", "kioku-page-3"]);
  expect(await drawn($, tab(2))).toContain("2 pages for “deploy”");
  expect(await drawn($, tab(3))).toContain("1 pages for “pool”");
});

test("a surface that draws no field says how to search, and the others have the field (§1.2)", async ($, on) => {
  machine(on);
  await start($);
  await search($, "");
  for (const surface of ["terminal", "desktop", "vscode"]) {
    const ui = await $.ui.mount({ ...tab(1), surface } as never);
    expect(await ui.findAll({ type: "Input" })).toHaveLength(1);
    await ui.unmount();
  }
  const ui = await $.ui.mount({ ...tab(1), surface: "mobile" } as never);
  expect(await ui.findAll({ type: "Input" })).toHaveLength(0);
  await ui.unmount();
  expect(await drawn($, { ...tab(1), surface: "mobile" })).toContain("/kioku-search");
});

test("the command with no words brings forward the field that is already open, and a search from the command is a tab of its own (§1.2)", async ($, on) => {
  const { opens } = machine(on);
  await start($);
  await search($, "");
  await search($, "");
  expect([...new Set(opens.map((o) => o.id))]).toEqual(["kioku-page-1"]);
  // A search from the command does not take the field's tab: the field is still there for the next one.
  await search($, "deploy");
  await search($, "");
  expect([...new Set(opens.map((o) => o.id))]).toEqual(["kioku-page-1", "kioku-page-2"]);
  expect(opens.at(-1)).toMatchObject({ id: "kioku-page-1" });
});

test("the same words again take the tab they had (§1.2)", async ($, on) => {
  const { opens, closed } = machine(on);
  await start($);
  await search($, "deploy");
  await search($, "pool");
  await search($, "deploy");
  // It waited in a tab of its own, which went when the results turned out to be the first tab's.
  expect(opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "↗ Kioku page · deploy" });
  expect(closed).toContain("kioku-page-3");
});

test("while a search runs the tab shows the bee waiting, its wings beating, and the results take its place (§1.2)", async ($, on) => {
  const { opens, clock } = machine(on);
  await start($);
  const pending = search($, "deploy");
  await clock.advance(10);
  await pending;
  // The waiting view was the first thing the tab drew, and the results are what it holds now.
  expect(opens[0]).toMatchObject({ id: "kioku-page-1", title: "⌕ Kioku search · deploy" });
  expect(await drawn($, tab(1))).toContain("2 pages for “deploy”");
});

test("a search that is not full meaning says why, above the list (§1.2)", async ($, on) => {
  machine(on, "full-text");
  await start($);
  await search($, "deploy");
  expect(await drawn($, tab(1))).toContain("full-text only: no model yet");
});

test("nothing found says so (§1.2)", async ($, on) => {
  machine(on);
  await start($);
  await search($, "zzz");
  expect(await drawn($, tab(1))).toContain("nothing found for “zzz”");
});

test("the field offers the searches of the session again, with the results they found, and runs nothing (§1.2)", async ($, on) => {
  const { ran, opens } = machine(on);
  await start($);
  await search($, "deploy");
  await search($, "pool");
  await search($, "");
  const ask = opens.at(-1)!.id as string;
  const n = Number(ask.split("-").at(-1));
  const text = await drawn($, tab(n));
  expect(text).toContain("recent searches");
  // The latest first.
  expect(text.indexOf("“pool”")).toBeLessThan(text.indexOf("“deploy”"));
  expect(await buttons($, tab(n))).toEqual(["✕ close", "↗ results", "↗ results"]);
  const searches = ran.filter((a) => a.includes("search")).length;
  await press($, tab(n), "↗ results", 1);
  expect(ran.filter((a) => a.includes("search")).length).toBe(searches);
  expect(opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "↗ Kioku page · deploy" });
});
