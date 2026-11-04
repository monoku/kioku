import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJournal } from "../../src/core/session/journal.ts";
import { backupStatePath } from "../../src/core/state.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const POSTGRES = "knowledge/acme/decisions/postgres-over-mysql.md";
const ASK = "Why did we pick Postgres over MySQL for the database?";

const display = (w: World, o: { color?: "always"; mute?: string[]; detailed?: boolean }) => {
  const path = join(w.home, ".kioku/config.yaml");
  const lines = [
    ...(o.detailed === undefined ? [] : [`  detailed: ${o.detailed}`]),
    ...(o.color === undefined ? [] : [`  color: ${o.color}`]),
    ...(o.mute === undefined ? [] : [`  mute: [${o.mute.join(", ")}]`]),
  ];
  writeFileSync(path, `${readFileSync(path, "utf8")}display:\n${lines.join("\n")}\n`);
};
const start = (w: World) =>
  w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }) });
const prompt = (w: World, session = "s1") =>
  w.kioku(["hook", "user-prompt-submit"], { stdin: JSON.stringify({ prompt: ASK, cwd: w.repo, session_id: session }) });
const after = (w: World, command: string, stdout: string) =>
  w.kioku(["hook", "post-tool-use"], {
    stdin: JSON.stringify({ session_id: "s1", tool_input: { command }, tool_response: { stdout } }),
  });

test("the start says the summary in one line, and a call's hook answers nothing: the journal keeps it for its row (§1.2, §4.6)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["sync"])).code, 0);
    const s = await start(w);
    assert.match(s.out.systemMessage, /⬢ kioku\.md · ↓ summary {2}session summary · \d+ pages {2}\([a-z]+ \d+ · /);
    assert.ok(s.out.hookSpecificOutput.additionalContext.length > 0, "the summary is still the agent's");
    const p = await prompt(w);
    assert.equal(p.raw.trim(), "", "a prompt gets nothing, and the person is told nothing");

    const shown = await w.kioku(["page", "show", POSTGRES, "--brain", "northwind/brain-acme"]);
    const read = await after(w, `kioku page show ${POSTGRES} --brain northwind/brain-acme`, shown.raw);
    assert.equal(read.raw.trim(), "", "a read gets no message: its row says it");
    const done = `${JSON.stringify({ status: "done", brain: "github.com/northwind/brain-acme", path: POSTGRES, publication: "local" })}\n`;
    assert.equal(
      (await after(w, "kioku page save --brain northwind/brain-acme", done)).raw.trim(),
      "",
      "nor does a write",
    );
    assert.deepEqual(
      readJournal(w.home, "s1").map((e) => e.what),
      ["opened", "saved"],
      "both are in the journal, which the mod draws the rows from",
    );
  }));

test("a display.detailed in the configuration is refused naming it: a notice is always its headline and its details (§1.2, §2.5)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["sync"])).code, 0);
    const s = await start(w);
    assert.match(s.out.systemMessage, /⬢ kioku\.md · ⚠ your personal brain is only on this machine\n {2}⎿ /);
    assert.match(
      s.out.systemMessage,
      /⬢ kioku\.md · ↓ summary {2}session summary · \d+ pages {2}\([^)]*\)$/m,
      "the summary alone",
    );
    display(w, { detailed: false });
    assert.match((await w.kioku(["doctor"])).raw, /unknown key `display\.detailed`/);
  }));

test("a muted notice is not said, while the summary and the agent's context are the same; a notice names the command that mutes it (§1.2)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["sync"])).code, 0);
    const NUDGE = /your personal brain is only on this machine/;
    const said = await start(w);
    assert.match(said.out.systemMessage, NUDGE);
    assert.match(said.out.systemMessage, /⎿ to stop this notice: kioku config set display\.mute \+unpublished/);
    rmSync(backupStatePath(w.home), { force: true });
    display(w, { mute: ["unpublished"] });
    const s = await start(w);
    assert.doesNotMatch(s.out.systemMessage, NUDGE);
    assert.match(s.out.systemMessage, /⬢ kioku\.md · ↓ summary/, "the summary is never muted");
    assert.ok(s.out.hookSpecificOutput.additionalContext.length > 0);
  }));

test("a message has colour unless NO_COLOR or `display.color: never` says not, and the same words without it (§1.2)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["sync"])).code, 0);
    const started = (env: NodeJS.ProcessEnv) =>
      w.kioku(["hook", "session-start"], {
        stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }),
        context: { env },
      });
    const said: string = (await started({})).out.systemMessage;
    assert.match(said, /\x1b\[38;2;245;162;75m⬢\x1b\[39m \x1b\[1mkioku\x1b\[22m\x1b\[38;2;245;162;75m\.md\x1b\[39m/);
    assert.match(said.replace(/\x1b\[[\d;]*m/g, ""), /^⬢ kioku\.md · /m);
    assert.doesNotMatch((await started({ TERM: "dumb" })).out.systemMessage, /\x1b/);
    display(w, { color: "always" });
    assert.match((await start(w)).out.systemMessage, /\x1b\[/, "always colours even with NO_COLOR");
  }));

test("a long answer Claude Code cut short is read whole from the file it kept, and only from its projects folder (§1.2)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["sync"])).code, 0);
    const listed = await w.kioku(["page", "list"]);
    assert.equal(listed.code, 0, listed.raw);
    const kept = join(w.home, ".claude/projects/-acme-api/s1/tool-results/abc.txt");
    mkdirSync(join(kept, ".."), { recursive: true });
    writeFileSync(kept, listed.raw);
    const elsewhere = join(w.home, "elsewhere.txt");
    writeFileSync(elsewhere, listed.raw);
    const cut = (path: string, session: string) =>
      w.kioku(["hook", "post-tool-use"], {
        stdin: JSON.stringify({
          session_id: session,
          tool_input: { command: "kioku page list" },
          tool_response: {
            stdout: listed.raw.slice(0, 40),
            persistedOutputPath: path,
            persistedOutputSize: listed.raw.length,
          },
        }),
      });
    await cut(kept, "long");
    assert.deepEqual(
      readJournal(w.home, "long").map((e) => e.what),
      ["listed"],
      "the whole answer is read, and the journal keeps the list",
    );
    await cut(elsewhere, "outside");
    assert.deepEqual(readJournal(w.home, "outside"), [], "a file outside Claude Code's projects folder is not read");
  }));
