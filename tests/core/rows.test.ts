import { test } from "node:test";
import assert from "node:assert/strict";
import { readJournal } from "../../src/core/session/journal.ts";
import { plainKiokuCall, runsTool } from "../../src/core/shell-words.ts";
import {
  alsoRan,
  kiokuWords,
  plainKiokuCall as modPlainKiokuCall,
  runsKioku,
  shortened,
} from "../../plugins/claude-code/hooks/plain.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const PLAIN = [
  "kioku page show knowledge/acme/p.md --brain northwind/brain-acme",
  "kioku page search deploy steps",
  "/usr/local/bin/kioku page list --brain sam/brain",
  "kioku page show p.md 2>&1",
  "kioku page save --brain sam/brain --title \"A; B | C\" <<'EOF'\n## What happened\n\nit; then | that && more\nEOF",
  "kioku page save --title x <<-EOF\n\tbody; text\n\tEOF",
];
const OTHER = [
  "cat p.md",
  "cd x && kioku page show p.md",
  "kioku page show p.md | head -3",
  "kioku page show a.md; kioku page show b.md",
  "echo hi && kioku brain log",
  "mykioku page show a",
  "",
];

test("a call is one `kioku` command when nothing else stands on its line, here-documents and `2>&1` aside (§1.2)", () => {
  for (const c of PLAIN) assert.ok(plainKiokuCall(c) !== undefined, c);
  for (const c of OTHER) assert.equal(plainKiokuCall(c), undefined, c);
  assert.deepEqual(plainKiokuCall("kioku page search deploy steps"), ["kioku", "page", "search", "deploy", "steps"]);
});

test("the mod reads a call as the tool does: the same answer for every line (§1.2)", () => {
  for (const c of [...PLAIN, ...OTHER]) {
    assert.deepEqual(modPlainKiokuCall(c), plainKiokuCall(c), c);
    assert.equal(runsKioku(c), runsTool(c), c);
  }
  assert.equal(runsTool("cd x && kioku page show p.md | head"), true);
  assert.equal(runsTool("mykioku page show a"), false);
});

test("what else a line ran is the commands that are not the tool's, and the tool's first command gives its words (§1.2)", () => {
  assert.equal(alsoRan("cd x && kioku page show p.md | head -3"), "cd x · head -3");
  assert.equal(alsoRan("kioku page show a.md; echo ---; kioku page show b.md"), "echo ---");
  assert.equal(alsoRan("kioku page show a.md"), "");
  assert.deepEqual(kiokuWords("cd x && kioku page save --title x").slice(0, 3), ["kioku", "page", "save"]);
});

test("a call the host draws has its here-documents cut to an ellipsis, and a line with none is as it was (§1.2)", () => {
  assert.equal(
    shortened("kioku page save --title x <<'EOF'\n## What happened\n\nlong text\nEOF"),
    "kioku page save --title x <<'EOF' …",
  );
  assert.equal(shortened("kioku page show p.md"), "kioku page show p.md");
});

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const page = {
  brain: "github.com/sam/brain",
  path: "memory/a.md",
  title: "A",
  kind: "memory",
  subkind: null,
  body: "x\n",
  touched: "2026-10-01",
};
const after = (w: World, command: string, stdout: string, id: string | null = "toolu_1") =>
  w.kioku(["hook", "post-tool-use"], {
    stdin: JSON.stringify({
      session_id: "s1",
      cwd: w.repo,
      tool_input: { command },
      tool_response: { stdout },
      ...(id !== null && { tool_use_id: id }),
    }),
  });

test("the journal's entries hold the call that made them (§4.6)", () =>
  world(async (w) => {
    await after(w, "kioku page show memory/a.md", line(page));
    await after(w, "kioku page search x", line({ hits: [{ brain: "github.com/sam/brain", title: "A" }] }), null);
    const [opened, searched] = readJournal(w.home, "s1");
    assert.equal(opened!.call, "toolu_1");
    assert.equal("call" in searched!, false);
  }));

test("a call gets no message, whatever its line runs or whether it made entries: the journal keeps them for its rows (§1.2)", () =>
  world(async (w) => {
    const said = async (command: string, stdout: string, id: string | null = null) => {
      const r = await after(w, command, stdout, id);
      assert.equal(r.code, 0, r.raw);
      return r.raw.trim();
    };
    assert.equal(await said("kioku page show memory/a.md", line(page), "toolu_1"), "");
    assert.equal(
      await said("kioku page search x", line({ hits: [{ brain: "github.com/sam/brain", title: "A" }] }), "toolu_2"),
      "",
    );
    assert.equal(
      await said(
        "kioku page save --title A <<'EOF'\nbody; text\nEOF",
        line({
          status: "done",
          brain: "github.com/sam/brain",
          commit: "abc1234",
          publication: "local",
          path: "memory/a.md",
          title: "A",
          kind: "memory",
        }),
        "toolu_3",
      ),
      "",
    );
    assert.equal(await said("cd x && kioku page show memory/a.md | head -3", line(page), "toolu_4"), "");
    assert.equal(await said("kioku page show memory/a.md", line(page)), "", "a call with no id");
    assert.equal(
      await said("kioku page show nope.md", line({ error: { code: "not_a_page", message: "no" } }), "toolu_5"),
      "",
      "a refusal made no entry",
    );
    // The journal and so the footer's counts are as ever, each entry holding its call.
    assert.deepEqual(
      readJournal(w.home, "s1").map((e) => [e.what, e.call]),
      [
        ["opened", "toolu_1"],
        ["searched", "toolu_2"],
        ["saved", "toolu_3"],
        ["opened", "toolu_4"],
        ["opened", undefined],
      ],
    );
  }));

const plainText = (t: unknown): string => String(t ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const start = (w: World, source = "startup") =>
  w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, source, session_id: "s2" }) });

test("the session's start is told as the history's summary, in one line, and says why it loaded again (§1.2)", () =>
  world(async (w) => {
    const on = plainText((await start(w)).out.systemMessage);
    assert.match(on, /⬢ kioku\.md · ↓ summary {2}session summary · \d+ pages? {2}\(.* \d+\)/);
    assert.doesNotMatch(on, /loaded \d+ brains/);
    assert.doesNotMatch(on, /⎿ [a-z]+ \d+ · /);
    assert.match(plainText((await start(w, "resume")).out.systemMessage), /↓ summary {2}resumed · \d+ pages?/);
    assert.match(plainText((await start(w, "compact")).out.systemMessage), /↓ summary {2}after \/compact · \d+ pages?/);
  }));
