import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

// The engine's test environment has the host's timers; the mod itself has none, and uses `$.clock`.
declare function setInterval(fn: () => void, ms: number): unknown;
declare function setTimeout(fn: (value: unknown) => void, ms: number): unknown;
import { linkedPath, linksOf } from "./page";

// The page viewer (§1.2), what opens it in the history and the pane it opens, run against the engine: `claude plugin test plugins/claude-code`.

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1];
type Entry = Record<string, unknown> & { what: string; arrow: "read" | "write" };

const OPENED: Entry = {
  what: "opened",
  arrow: "read",
  brain: "acme",
  label: "project",
  path: "knowledge/acme/context/pool.md",
  title: "Pool",
};
const FORGOT: Entry = {
  what: "forgot",
  arrow: "write",
  brain: "acme",
  label: "project",
  path: "memory/old.md",
  title: "Old",
};
const SEARCHED: Entry = {
  what: "searched",
  arrow: "read",
  brain: "acme, kioku",
  label: "project, team",
  words: "deploy",
  count: 2,
  hits: [
    { brain: "acme", path: "a.md", title: "Deploy checklist" },
    { brain: "kioku", path: "b.md", title: "Release a version" },
  ],
};
const OLD_SEARCH: Entry = { what: "searched", arrow: "read", brain: "acme", label: "project", words: "old", count: 3 };

/** The pages the tool answers for `page show`, by path. */
const PAGES: Record<string, { title: string; body: string; touched: string }> = {
  "knowledge/acme/context/pool.md": {
    title: "Pool",
    body: "# Pool\n\nSee [Other](../playbooks/other.md) and [site](https://example.com).\n",
    touched: "2026-10-01",
  },
  "knowledge/acme/playbooks/other.md": { title: "Other", body: "# Other\n", touched: "2026-10-20" },
  "a.md": { title: "Deploy checklist", body: "# Deploy\n", touched: "2026-09-01" },
};

/** The engine beneath the plugin: the journal, and the tool as `kioku.sh` runs it. */
function machine(on: On) {
  mock.env(on, { HOME: "/home/sam" });
  // The machine's clock: Oct 23, 2026, at 15:55.
  const clock = mock.clock(on, { now: new Date(2026, 9, 23, 15, 55).getTime() });
  // Time passes while a page is read, so that the bee's least wait ends.
  setInterval(() => {
    void clock.advance(250);
  }, 2);
  let text = "";
  const ran: string[][] = [];
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("session.id", () => ({ value: "s1" }) as never);
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("classic.PostToolUse", () => ({}) as never);
  on("fs.read", (_, e) => {
    if (e.path.endsWith("/.claude-plugin/plugin.json"))
      return { value: JSON.stringify({ name: "kioku", version: "4.0.0" }) };
    if (e.path.endsWith("/.kioku/sessions/s1.jsonl")) return { value: text };
    throw new Error(`no ${e.path}`);
  });
  on("process.run", (_, e) => {
    const args = [...e.argv] as string[];
    ran.push(args);
    const show = args.indexOf("show");
    const page = show === -1 ? undefined : PAGES[args[show + 1]!];
    const answer = args.includes("--version")
      ? { version: "4.0.0", contract: 1 }
      : page === undefined
        ? { error: { code: "not_found" } }
        : { brain: "acme", path: args[show + 1], kind: "knowledge", ...page };
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
  on("ui.render", ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box />;
  });
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
  return { add, ran };
}

const HISTORY = (placement: "dock" | "inline") => ({
  plugin: "kioku",
  component: "Pane",
  requestId: "kioku-history",
  surface: "terminal",
  props: {
    title: "Kioku history",
    isFocused: false,
    bodyColumns: 100,
    placement,
    scroll: { bodyRows: 20, top: 0 },
    view: {},
  },
});
const PAGE = {
  plugin: "kioku",
  component: "Pane",
  requestId: "kioku-page-1",
  surface: "terminal",
  props: {
    title: "Kioku page",
    isFocused: true,
    bodyColumns: 100,
    placement: "dock",
    scroll: { bodyRows: 20, top: 0 },
    view: {},
  },
};

/** The text of what is mounted, in order. */
async function drawn($: Engine, what: unknown): Promise<string> {
  const ui = await $.ui.mount(what as never);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join(" ");
}

/** The labels of the buttons of what is mounted. */
async function buttons($: Engine, what: unknown): Promise<string[]> {
  const ui = await $.ui.mount(what as never);
  const found = (await ui.findAll({ type: "Button" })).map((b) => String((b.props as { label?: unknown }).label));
  await ui.unmount();
  return found;
}

/** Presses the button of what is mounted with this label, and what is mounted after. */
async function press($: Engine, what: unknown, label: string): Promise<void> {
  const ui = await $.ui.mount(what as never);
  const found = (await ui.findAll({ type: "Button" })).find((b) => (b.props as { label?: unknown }).label === label);
  if (found === undefined) throw new Error(`no button ${label}`);
  await ui.press({ key: (found.props as { key?: string }).key } as never);
  await ui.unmount();
  // What the press started, a page read with the bee's least wait, ends.
  await new Promise((done) => setTimeout(done, 80));
}

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

test("an entry that names a page ends in open, a forgotten page has none, and a search that kept what it found has results (§1.2)", async ($, on) => {
  const registered = commands(on);
  const { add } = machine(on);
  await start($);
  await add($, [OPENED, FORGOT, SEARCHED, OLD_SEARCH]);
  expect(await buttons($, HISTORY("dock"))).toEqual(["✕ close", "↗ results", "↗ open"]);
  expect(await buttons($, HISTORY("inline"))).toEqual(["✕ close", "↗ results", "↗ open"]);
  const text = await drawn($, HISTORY("dock"));
  expect(text).toContain("↗ open");
  expect(text).toContain("↗ results");
  // The viewer has no command of its own.
  expect(registered.map((c) => c.name)).not.toContain("kioku-page");
});

test("open shows the page in the pane, with its brain as Kioku names it, when it changed and its way out (§1.2)", async ($, on) => {
  const seen = panes(on);
  const { add, ran } = machine(on);
  await start($);
  await add($, [OPENED]);
  await press($, HISTORY("dock"), "↗ open");
  expect(ran.find((a) => a.includes("show"))).toEqual(
    expect.arrayContaining(["page", "show", "knowledge/acme/context/pool.md", "--brain", "acme"]),
  );
  expect(seen.opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "↗ Pool", focus: true, closeOnEscape: true });
  const page = await drawn($, PAGE);
  expect(page).toContain("Pool");
  expect(page).toContain("project · ");
  expect(page).toContain("knowledge/acme/context/pool.md");
  expect(page).toContain("changed 22 days ago");
  // No way back, since it came from nowhere: only to close.
  expect(await buttons($, PAGE)).toEqual(["✕ close"]);
  await press($, PAGE, "✕ close");
  expect(seen.closed).toContain("kioku-page-1");
});

test("results lists the pages a search found, in the brains' names as Kioku says them, and one opens with a way back to the list (§1.2)", async ($, on) => {
  const seen = panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [SEARCHED]);
  await press($, HISTORY("dock"), "↗ results");
  expect(seen.opens.at(-1)).toMatchObject({ id: "kioku-page-1", focus: true });
  const list = await drawn($, PAGE);
  expect(list).toContain("2 pages for “deploy”");
  expect(list).toContain("Deploy checklist");
  expect(list).toContain("› ");
  expect(list).toContain("a.md (project)");
  expect(list).toContain("b.md (team)");
  // Each page has two lines, its title and its path, and either opens it.
  expect(await buttons($, PAGE)).toEqual(["✕ close", "↗ open", "↗ open"]);
  // Only each result's `↗ open` opens it, the first here being the first result's.
  await press($, PAGE, "↗ open");
  expect(await drawn($, PAGE)).toContain("Deploy checklist");
  expect(await buttons($, PAGE)).toEqual(["← 2 pages for “deploy”", "✕ close"]);
  expect(await drawn($, PAGE)).toContain("← 2 pages for “deploy”");
  await press($, PAGE, "← 2 pages for “deploy”");
  expect(await drawn($, PAGE)).toContain("2 pages for “deploy”");
});

test("a page that cannot be opened says so, and its pane has still a way out (§1.2)", async ($, on) => {
  panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [{ ...OPENED, path: "knowledge/acme/context/gone.md" }]);
  await press($, HISTORY("dock"), "↗ open");
  expect(await drawn($, PAGE)).toContain("could not open knowledge/acme/context/gone.md (project)");
  expect(await buttons($, PAGE)).toEqual(["✕ close"]);
});

test("while a page is read its tab shows the bee waiting, and the page takes its place (§1.2)", async ($, on) => {
  const seen = panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  await press($, HISTORY("dock"), "↗ open");
  // The first thing the tab drew was the waiting, named for the page's file, and what it holds now is the page.
  expect(seen.opens[0]).toMatchObject({ id: "kioku-page-1", title: "↗ pool" });
  expect(seen.opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "↗ Pool" });
  expect(await drawn($, PAGE)).toContain("Pool");
});

test("on the desktop, which opens a link to a file in its own explorer, the pages a page links to are buttons under it, and one opens in the tab (§1.2)", async ($, on) => {
  const seen = panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  await press($, HISTORY("dock"), "↗ open");
  const desktop = { ...PAGE, surface: "desktop" };
  const page = await drawn($, desktop);
  expect(page).toContain("linked pages");
  // The link is its words alone in the text, and a link out of the brain is the Markdown's own.
  expect(page).not.toContain("other.md");
  expect(await buttons($, desktop)).toEqual(["✕ close", "↗ Other"]);
  await press($, desktop, "↗ Other");
  expect(seen.opens.at(-1)).toMatchObject({ id: "kioku-page-1", title: "↗ Other" });
});

test("each search and each page opened from the history has a tab of its own, and one tab shows what it opened, not another's", async ($, on) => {
  const seen = panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [SEARCHED, OPENED]);
  await press($, HISTORY("dock"), "↗ results");
  await press($, HISTORY("dock"), "↗ open");
  expect([...new Set(seen.opens.map((o) => o.id))]).toEqual(["kioku-page-1", "kioku-page-2"]);
  const tab = (n: number) => ({ ...PAGE, requestId: `kioku-page-${n}` });
  expect(await drawn($, tab(1))).toContain("2 pages for “deploy”");
  expect(await drawn($, tab(2))).not.toContain("2 pages for “deploy”");
});

test("the same results opened again, and the same page, take the tab they had, wherever they are opened from", async ($, on) => {
  const seen = panes(on);
  const { add } = machine(on);
  await start($);
  await add($, [SEARCHED, OPENED]);
  await press($, HISTORY("dock"), "↗ results");
  await press($, HISTORY("dock"), "↗ open");
  await press($, HISTORY("dock"), "↗ results");
  await press($, HISTORY("dock"), "↗ open");
  expect([...new Set(seen.opens.map((o) => o.id))]).toEqual(["kioku-page-1", "kioku-page-2"]);
});

test("a link of a page names a page of its brain from the page's folder, and nothing else is the pane's to answer (§1.2)", () => {
  expect(linkedPath("knowledge/people/hiring/playbooks/a.md", "../decisions/b.md")).toBe(
    "knowledge/people/hiring/decisions/b.md",
  );
  expect(linkedPath("knowledge/people/hiring/playbooks/a.md", "./c.md")).toBe("knowledge/people/hiring/playbooks/c.md");
  expect(linkedPath("memory/instincts/a.md", "../../knowledge/sam/b.md#why")).toBe("knowledge/sam/b.md");
  // Out of the brain, an address, an anchor, or not a page.
  expect(linkedPath("memory/a.md", "../../../x.md")).toBeUndefined();
  expect(linkedPath("memory/a.md", "https://example.com/x.md")).toBeUndefined();
  expect(linkedPath("memory/a.md", "#top")).toBeUndefined();
  expect(linkedPath("memory/a.md", "../image.png")).toBeUndefined();
  expect(linksOf("See [A](./a.md) and [B](../b.md#x) and [site](https://x.com/y.md), [again](./a.md).")).toEqual([
    "./a.md",
    "../b.md#x",
  ]);
});
