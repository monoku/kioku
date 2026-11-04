import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import { printed } from "./tool-double";

// Kioku rows (§1.2), the way a call to `kioku` is drawn in the conversation, run against the engine: `claude plugin test plugins/claude-code`.

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1];
type Entry = Record<string, unknown> & { what: string; arrow: "read" | "write" };

const SHOW = "kioku page show knowledge/acme/context/pool.md --brain acme";
const OPENED: Entry = {
  what: "opened",
  arrow: "read",
  brain: "acme",
  label: "project",
  path: "knowledge/acme/context/pool.md",
  title: "Pool",
  call: "toolu_1",
};
const PAGE = {
  brain: "acme",
  path: "knowledge/acme/context/pool.md",
  title: "Pool",
  body: "# Pool\n\nTwo lines.\n",
  touched: "2026-10-01",
};

/** The engine beneath the plugin: the machine configuration and the session's journal, which `add` fills as the hooks would. */
function machine(on: On) {
  mock.env(on, { HOME: "/home/sam" });
  // The machine's clock: Oct 23, 2026, at 15:55.
  mock.clock(on, { now: new Date(2026, 9, 23, 15, 55).getTime() });
  let text = "";
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
  on("process.run", () => printed({ version: "4.0.0", contract: 1 }));
  // What the host draws of a call when the plugin does not: a word, and whether its group is unfolded.
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{`host ${String((e.props as { isExpanded?: unknown }).isExpanded)}`}</Text>;
  });
  const add = async ($: Engine, entries: Entry[]): Promise<void> => {
    text += entries
      .map((x) => `${JSON.stringify({ at: new Date(2026, 9, 23, 15, 46).toISOString(), turn: 1, ...x })}\n`)
      .join("");
    await $.classic.PostToolUse({
      tool_name: "Bash",
      tool_input: { command: "kioku" },
      tool_response: {},
      tool_use_id: "t",
      session_id: "s1",
    } as never);
  };
  return { add };
}

const start = async ($: Engine): Promise<void> => {
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
};

const USE = (command: string, output: unknown, extra: Record<string, unknown> = {}, id = "toolu_1") =>
  ({
    plugin: "kioku",
    component: "ToolUse",
    requestId: id,
    surface: "terminal",
    props: {
      tool_use_id: id,
      tool: "Bash",
      input: { command },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output,
      ...extra,
    },
  }) as never;
const RESULT = (id = "toolu_1") =>
  ({
    plugin: "kioku",
    component: "ToolResult",
    requestId: id,
    surface: "terminal",
    props: { tool_use_id: id, tool: "Bash", output: { stdout: "" }, isErrored: false },
  }) as never;
const GROUP = (calls: Record<string, unknown>[], isCallsOnly = true, isActive = true) =>
  ({
    plugin: "kioku",
    component: "ToolGroup",
    surface: "terminal",
    props: { calls, isActive, isExpanded: false, isCallsOnly },
  }) as never;
const CALL = (command: string, extra: Record<string, unknown> = {}) => ({
  tool: "Bash",
  input: { command },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout: "" },
  ...extra,
});
const out = (...answers: unknown[]) => ({ stdout: answers.map((a) => `${JSON.stringify(a)}\n`).join(""), stderr: "" });

/** Presses the buttons of what is mounted, by their keys: each opens its row, which stays open for the session. */
async function open($: Engine, what: unknown, ...keys: string[]): Promise<void> {
  const ui = await $.ui.mount(what as never);
  for (const key of keys) await ui.press({ key } as never);
  await ui.unmount();
}

/** The labels of the buttons of what is mounted. */
async function buttons($: Engine, what: unknown): Promise<string[]> {
  const ui = await $.ui.mount(what as never);
  const found = (await ui.findAll({ type: "Button" })).map((b) => String((b.props as { label?: unknown }).label));
  await ui.unmount();
  return found;
}

/** The text of what is mounted, in order. */
async function drawn($: Engine, what: unknown): Promise<string> {
  const ui = await $.ui.mount(what as never);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join(" ");
}

test("a call to kioku is a row: its entry, and under it what the answer holds (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const call = USE(SHOW, out(PAGE));
  const row = await drawn($, call);
  expect(row).toMatch(/⬢ .*kioku .*\.md .*↓ .*opened .*Pool .*\(project\) ▸ expand$/);
  // Folded it is that one line, with its brain and no path; open, the path and, under the line, the lines the page has and
  // how long since it was touched: Oct 1 to Oct 23.
  expect(row).not.toContain("⎿");
  expect(row).not.toContain("knowledge/acme/context/pool.md");
  await open($, call, "toolu_1:0");
  const opened = await drawn($, call);
  expect(opened).toMatch(/lines +3/);
  expect(opened).toMatch(/touched +22 days ago/);
  expect(opened).not.toContain("⎿");
  expect(opened).toContain("knowledge/acme/context/pool.md");
  // The host's own row is gone.
  expect(row).not.toContain("host");
});

test("a search says the titles it found, and a write its kind and commit; a list has one line (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [
    { what: "searched", arrow: "read", brain: "acme", label: "project", words: "deploy", count: 2, call: "toolu_2" },
    {
      what: "saved",
      arrow: "write",
      brain: "acme",
      label: "project",
      path: "memory/use-pnpm.md",
      title: "Use pnpm",
      call: "toolu_3",
    },
    { what: "listed", arrow: "read", brain: "acme", label: "project", count: 4, call: "toolu_4" },
  ]);
  const find = USE(
    "kioku page search deploy",
    out({
      hits: [
        { title: "Deploy checklist", path: "a.md", brain: "acme" },
        { title: "Run migrations first", path: "b.md", brain: "acme" },
      ],
    }),
    {},
    "toolu_2",
  );
  expect(await drawn($, find)).toMatch(/↓ .*found .*“deploy” · 2 results/);
  expect(await drawn($, find)).not.toContain("⎿");
  await open($, find, "toolu_2:0");
  const search = await drawn($, find);
  // The titles are in the details, with their paths: a line of them after `⎿` would say them twice.
  expect(search).not.toContain("⎿");
  // Each page's brain as Kioku names it: the entry lists its brains and their names in the same order.
  expect(search).toContain("Deploy checklist");
  expect(search).toContain("a.md (project)");
  const save = USE(
    "kioku page save --title x",
    out({ status: "done", kind: "memory", subkind: null, commit: "abc1234def", publication: "local" }),
    {},
    "toolu_3",
  );
  await open($, save, "toolu_3:0");
  const saved = await drawn($, save);
  expect(saved).toMatch(/↑ .*saved .*Use pnpm .*\(project\)/);
  expect(saved).toMatch(/type +memory/);
  expect(saved).toMatch(/commit +abc1234/);
  expect(saved).not.toContain("⎿");
  expect(saved).toContain("committed on this machine, not published");
  // A write that failed after its commit was made carries the commit, and is drawn as the write it is (§1.6).
  await add($, [
    {
      what: "promoted",
      arrow: "write",
      brain: "northwind",
      label: "team",
      path: "memory/use-pnpm.md",
      title: "Use pnpm",
      call: "toolu_5",
    },
  ]);
  const failed = USE(
    "kioku page promote memory/use-pnpm.md --to team",
    out({
      status: "error",
      brain: "northwind",
      path: "memory/use-pnpm.md",
      kind: "memory",
      commit: "beef1234cafe",
      publication: "pushed",
      error: { code: "invalid", message: "the page is in northwind, but the original could not be retired" },
    }),
    {},
    "toolu_5",
  );
  await open($, failed, "toolu_5:0");
  const promoted = await drawn($, failed);
  expect(promoted).toMatch(/↑ .*promoted .*Use pnpm/);
  expect(promoted).toMatch(/commit +beef123/);
  expect(promoted).toContain("published");
  // A list has a line and nothing to open.
  const list = USE("kioku page list", out({ pages: [] }), {}, "toolu_4");
  expect(await drawn($, list)).toMatch(/↓ .*listed .*4 pages/);
  expect(await buttons($, list)).toEqual([]);
});

test("a call that made two entries is two rows", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED, { ...OPENED, path: "knowledge/acme/context/other.md", title: "Other" }]);
  const call = USE("kioku page show a.md b.md", out(PAGE, { ...PAGE, title: "Other", body: "one\n" }));
  expect(await drawn($, call)).toMatch(/Pool .*Other/);
  await open($, call, "toolu_1:0", "toolu_1:1");
  const row = await drawn($, call);
  expect(row).toMatch(/lines +3/);
  expect(row).toMatch(/lines +1 /);
});

test("what is not a call that is one kioku command is the host's, and so is a call that failed or has no entry yet (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  // Another line, another command and a call that errored or was cut short.
  expect(await drawn($, USE("cat p.md", out(PAGE)))).toBe("host undefined");
  expect(await drawn($, USE(SHOW, out(PAGE), { isErrored: true }))).toBe("host undefined");
  expect(await drawn($, USE(SHOW, out(PAGE), { isInterrupted: true }))).toBe("host undefined");
  // The call made none: an error the tool answered.
  expect(await drawn($, USE(SHOW, out({ error: { code: "not_a_page", message: "no" } }), {}, "toolu_9"))).toBe(
    "host undefined",
  );
});

test("a call the host draws has its here-document cut short, and one that asks Claude something is a line (§1.2)", async ($, on) => {
  machine(on);
  await start($);
  const save = "kioku page save --brain sam --title \"A\" <<'EOF'\nbody that is long\nEOF";
  // The host's own row of a call that failed, with the command as it will draw it.
  // The tool asked something first: a line says what, and its answer is left out.
  expect(await drawn($, USE(save, out({ status: "similar", similar: [] }), {}, "toolu_7"))).toMatch(
    /⬢ +kioku +\.md +kioku page save · similar pages found, nothing saved$/,
  );
  expect(await drawn($, USE(save, out({ status: "namespace", namespaces: [] }), {}, "toolu_6"))).toMatch(
    /kioku page save · asks for a namespace, nothing saved$/,
  );
  expect(await drawn($, RESULT("toolu_7"))).toBe("");
});

test("while a call waits for its entry a line of its first words stands in for the whole command (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  const save = "kioku page save --brain sam --title \"A\" <<'EOF'\nbody that is long\nEOF";
  // It runs, or it ended with an answer that makes an entry the hook has not written yet.
  for (const props of [{ isRunning: true }, { isRunning: false }]) {
    const line = await drawn(
      $,
      USE(
        save,
        props.isRunning ? undefined : out({ status: "done", kind: "memory", commit: "abc1234" }),
        props,
        "toolu_8",
      ),
    );
    expect(line).toMatch(/⬢ +kioku +\.md +kioku page save …$/);
  }
  // Its result is left out too, so that no JSON shows under the line.
  expect(await drawn($, RESULT("toolu_8"))).toBe("");
  // Once the entry is in, the row.
  await add($, [
    {
      what: "saved",
      arrow: "write",
      brain: "sam",
      label: "personal",
      path: "memory/a.md",
      title: "A",
      call: "toolu_8",
    },
  ]);
  expect(await drawn($, USE(save, out({ status: "done", kind: "memory", commit: "abc1234" }), {}, "toolu_8"))).toMatch(
    /↑ .*saved .*A .*\(personal\)/,
  );
});

test("a run of kioku calls is drawn whole, or unfolded when one failed, and any other run is folded as before (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const SAVE = "kioku page save --title \"A\" <<'EOF'\nbody that is long\nEOF";
  // Whole: the rows of the calls that made entries, a dim line for those that run or asked, and never the text of a here-document.
  const run = await drawn(
    $,
    GROUP([
      { ...CALL(SHOW), tool_use_id: "toolu_1", output: out(PAGE) },
      { ...CALL(SAVE), tool_use_id: "toolu_2", isRunning: true, output: undefined },
      { ...CALL(SAVE), tool_use_id: "toolu_3", output: out({ status: "similar", similar: [] }) },
    ]),
  );
  expect(run).toMatch(/↓ .*opened .*Pool/);
  expect(run).not.toContain("⎿");
  expect(run).toMatch(/kioku page save … /);
  expect(run).toContain("kioku page save · similar pages found, nothing saved");
  expect(run).not.toContain("body that is long");
  expect(run).not.toContain("host");
  // A call the model is still writing, with no command yet, goes with the run: the host's live line would show its half.
  expect(
    await drawn(
      $,
      GROUP([
        { ...CALL(SAVE), isRunning: true, output: undefined },
        { tool: "Bash", input: {}, isRunning: true, isErrored: false, isInterrupted: false },
      ]),
    ),
  ).toMatch(/kioku page save … .*⬢ +kioku +\.md +…$/);
  expect(
    await drawn($, GROUP([{ tool: "Bash", input: {}, isRunning: true, isErrored: false, isInterrupted: false }])),
  ).toBe("host false");
  // Whole too when the host shows more in the run than its calls (its hook timing), which it says with `isCallsOnly` false.
  expect(await drawn($, GROUP([{ ...CALL(SAVE), isRunning: true, output: undefined }], false))).toMatch(
    /kioku page save …$/,
  );
  // A run that is over is drawn here too, as the rows of its calls.
  expect(await drawn($, GROUP([CALL(SHOW), CALL("kioku page list")], true, false))).toMatch(
    /kioku page show …|kioku page list …/,
  );
  // Unfolded, so that each call's row is drawn on its own: a run that holds a call that failed.
  expect(await drawn($, GROUP([CALL(SHOW), CALL(SHOW, { isErrored: true })]))).toBe("host true");
  expect(await drawn($, GROUP([CALL(SHOW, { output: out({ error: { code: "not_a_page", message: "no" } }) })]))).toBe(
    "host true",
  );
  // Folded as before: a call that is not kioku's, or that is inside a longer line, or a call that is not the shell's.
  expect(await drawn($, GROUP([CALL(SHOW), CALL("ls")]))).toBe("host false");
  expect(
    await drawn(
      $,
      GROUP([{ tool: "Skill", input: { skill: "kioku" }, isRunning: false, isErrored: false, isInterrupted: false }]),
    ),
  ).toBe("host false");
});

test("the host's result of a call whose row is drawn is left out, and any other stays", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  // Before its row is drawn, or for a call whose row never is, the result is the host's.
  expect(await drawn($, RESULT())).toBe("host undefined");
  await drawn($, USE(SHOW, out(PAGE)));
  expect(await drawn($, RESULT())).toBe("");
  expect(await drawn($, RESULT("toolu_2"))).toBe("host undefined");
});

test("a call that runs other commands too is rows for its entries, and what else it ran is said once its first row is open (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const call = USE(`cd x && ${SHOW} | head -3`, out(PAGE));
  const folded = await drawn($, call);
  expect(folded).toMatch(/↓ .*opened .*Pool/);
  expect(folded).not.toContain("also ran");
  expect(folded).not.toContain("host");
  expect(await buttons($, call)).toEqual(["▸ expand"]);
  await open($, call, "toolu_1:0");
  expect(await drawn($, call)).toContain("also ran: cd x · head -3");
});

test("an open search lists every page its answer holds (§1.2)", async ($, on) => {
  const hits = Array.from({ length: 12 }, (_, i) => ({ title: `Page ${i + 1}`, path: `p${i + 1}.md`, brain: "acme" }));
  const entry = [
    {
      what: "searched" as const,
      arrow: "read" as const,
      brain: "acme",
      label: "project",
      words: "deploy",
      count: 12,
      call: "toolu_2",
    },
  ];
  const find = USE("kioku page search deploy", out({ hits }), {}, "toolu_2");
  {
    const { add } = machine(on);
    await start($);
    await add($, entry);
    await open($, find, "toolu_2:0");
    const all = await drawn($, find);
    expect(all).toMatch(/Page 12 +p12\.md \(project\)/);
    expect(all).not.toContain("more");
  }
});

test("a row begins folded, its button says to expand it, and a press opens its details and then folds them again (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const call = USE(
    SHOW,
    out({
      ...PAGE,
      kind: "knowledge",
      subkind: "context",
      summary: "The connection pool.",
      history: [{ commit: "abcdef123456", message: "save: Pool" }],
    }),
  );
  const folded = await drawn($, call);
  expect(folded).not.toContain("The connection pool.");
  expect(await buttons($, call)).toEqual(["▸ expand"]);
  // A press on the row's button opens it (§1.2).
  const press = async (): Promise<void> => {
    const ui = await $.ui.mount(call);
    await ui.press({ key: "toolu_1:0" } as never);
    await ui.unmount();
  };
  await press();
  const open = await drawn($, call);
  // Each line has its name, in a column of its own, and there is no line after `⎿`.
  expect(open).toMatch(/file +knowledge\/acme\/context\/pool\.md/);
  expect(open).toMatch(/type +knowledge · context/);
  expect(open).toMatch(/summary +The connection pool\./);
  expect(open).toMatch(/commit +abcdef1 · save: Pool/);
  expect(open).not.toContain("⎿");
  // The line that names the page opens it in the page viewer.
  expect(await buttons($, call)).toEqual(["▾ collapse", "↗ open"]);
  await press();
  expect(await drawn($, call)).not.toContain("The connection pool.");
});

test("Kioku's own skill loaded is a row, and its host result is left out; another skill is the host's (§1.2)", async ($, on) => {
  machine(on);
  await start($);
  const skill = (name: string, id = "toolu_s") =>
    ({
      plugin: "kioku",
      component: "ToolUse",
      requestId: id,
      surface: "terminal",
      props: {
        tool_use_id: id,
        tool: "Skill",
        input: { skill: name },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      },
    }) as never;
  const row = await drawn($, skill("kioku:kioku"));
  expect(row).toMatch(/⬢ +kioku +\.md +↓ +loaded +.*Kioku skill/);
  expect(await drawn($, skill("kioku", "toolu_t"))).toMatch(/loaded +.*Kioku skill/);
  expect(await drawn($, skill("commit", "toolu_u"))).toBe("host undefined");
  const result = (id: string) =>
    ({
      plugin: "kioku",
      component: "ToolResult",
      requestId: id,
      surface: "terminal",
      props: { tool_use_id: id, tool: "Skill", output: {}, isErrored: false },
    }) as never;
  expect(await drawn($, result("toolu_s"))).toBe("");
  expect(await drawn($, result("toolu_u"))).toBe("host undefined");
});

test("a surface that hands over a call's output as text, or as blocks of text, is read as well (§1.2)", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const stdout = out(PAGE).stdout;
  for (const output of [stdout, { content: stdout }, [{ type: "text", text: stdout }]]) {
    const call = USE(SHOW, output);
    await open($, call, "toolu_1:0");
    expect(await drawn($, call)).toMatch(/lines +3 .*touched +22 days ago/);
    await open($, call, "toolu_1:0");
  }
});

test("beyond the terminal the button stands on a line of its own, and works the same", async ($, on) => {
  const { add } = machine(on);
  await start($);
  await add($, [OPENED]);
  const call = { ...(USE(SHOW, out(PAGE)) as Record<string, unknown>), surface: "desktop" } as never;
  expect(await buttons($, call)).toEqual(["▸ expand"]);
  await open($, call, "toolu_1:0");
  expect(await buttons($, call)).toEqual(["▾ collapse", "↗ open"]);
  expect(await drawn($, call)).toMatch(/lines +3/);
});
