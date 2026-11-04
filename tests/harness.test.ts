import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli/run.ts";
import { entriesFor } from "../src/core/session/journal.ts";
import { claudeCode } from "../src/harness/claude-code.ts";
import { allHarnesses, harnessFor } from "../src/harness/index.ts";
import { installDirs } from "../src/core/setup/install.ts";
import { ctx, scratch as scratchIn } from "./fixtures.ts";

const scratch = scratchIn("harness");

test("claude code: session start input keeps cwd, source and the session, and anything unreadable counts as nothing", () => {
  const h = claudeCode("/h", {});
  assert.deepEqual(
    h.parseSessionStart(
      JSON.stringify({ session_id: "x", cwd: "/w", source: "resume", hook_event_name: "SessionStart" }),
    ),
    { cwd: "/w", source: "resume", sessionId: "x" },
  );
  assert.equal(h.parseSessionId?.(JSON.stringify({ session_id: "x", tool_name: "Skill" })), "x");
  assert.equal(h.parseSessionId?.("{not json"), undefined);
  assert.deepEqual(h.parseSessionStart(JSON.stringify({ cwd: 3 })), {});
  for (const raw of ["", "{not json", "null", "[]"]) assert.deepEqual(h.parseSessionStart(raw), {}, raw);
});

test("claude code: session start answer is additional context plus a system message, and nothing when both are empty", () => {
  const h = claudeCode("/h", {});
  assert.equal(h.sessionStartAnswer(undefined, []), undefined);
  assert.deepEqual(h.sessionStartAnswer("S", ["a.", "b."]), {
    data: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "S" }, systemMessage: "a.\nb." },
    text: "a.\nb.\n\nS",
  });
  assert.deepEqual(h.sessionStartAnswer("S", []), {
    data: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "S" } },
    text: "S",
  });
  assert.deepEqual(h.sessionStartAnswer(undefined, ["m"]), { data: { systemMessage: "m" }, text: "m" });
});

test("claude code: tool result carries the command and the output; a string response is the output", () => {
  const h = claudeCode("/h", {});
  assert.deepEqual(
    h.parseToolResult(
      JSON.stringify({ tool_input: { command: "kioku page save x" }, tool_response: { stdout: "out" } }),
    ),
    { command: "kioku page save x", output: "out" },
  );
  assert.deepEqual(h.parseToolResult(JSON.stringify({ tool_response: "plain" })), { output: "plain" });
  assert.deepEqual(h.parseToolResult(JSON.stringify({})), { output: "" });
  assert.equal(h.parseToolResult("{not json"), undefined);
});

test("claude code: PATH goes to CLAUDE_ENV_FILE once, and not when kioku is already on the PATH", () =>
  scratch((dir) => {
    const file = join(dir, "env.sh");
    const h = claudeCode(dir, { CLAUDE_ENV_FILE: file, PATH: "/usr/bin" });
    h.persistPath(dir, { CLAUDE_ENV_FILE: file, PATH: "/usr/bin" });
    h.persistPath(dir, { CLAUDE_ENV_FILE: file, PATH: "/usr/bin" });
    const text = readFileSync(file, "utf8");
    assert.equal(text.split(installDirs(dir, {}).bin).length - 1, 1);
    const other = join(dir, "other.sh");
    writeFileSync(other, "");
    h.persistPath(dir, { CLAUDE_ENV_FILE: other, PATH: `${installDirs(dir, {}).bin}:/usr/bin` });
    assert.equal(readFileSync(other, "utf8"), "");
  }));

test("claude code: the plugin is read from the folder CLAUDE_CONFIG_DIR names, in the files Claude Code keeps", () =>
  scratch((dir) => {
    const cfg = join(dir, "cfg");
    const h = claudeCode(dir, { CLAUDE_CONFIG_DIR: cfg });
    assert.deepEqual([h.integration.plugin.installed(), h.integration.plugin.marketplace()], [false, undefined]);
    mkdirSync(join(cfg, "plugins"), { recursive: true });
    writeFileSync(
      join(cfg, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "kioku@kioku": [{ scope: "user" }], "other@kioku": [] } }),
    );
    writeFileSync(join(cfg, "plugins", "known_marketplaces.json"), JSON.stringify({ kioku: { source: {} } }));
    assert.deepEqual(
      [h.integration.plugin.installed(), h.integration.plugin.marketplace()],
      [true, { kind: "other", what: "unknown" }],
    );
    // The default folder is not the one that was read.
    assert.equal(claudeCode(dir, {}).integration.plugin.installed(), false);
    writeFileSync(join(cfg, "plugins", "installed_plugins.json"), "{not json");
    assert.equal(h.integration.plugin.installed(), false, "a file that cannot be read is no plugin");
  }));

test("claude code: a marketplace from a folder is read in place, so the plugin's version is the folder's; one from GitHub is the installed copy's (§6.2)", () =>
  scratch((dir) => {
    const cfg = join(dir, "cfg");
    const h = claudeCode(dir, { CLAUDE_CONFIG_DIR: cfg });
    mkdirSync(join(cfg, "plugins"), { recursive: true });
    writeFileSync(
      join(cfg, "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "kioku@kioku": [{ scope: "user", version: "0.1.0" }] } }),
    );
    const known = (source: unknown) =>
      writeFileSync(join(cfg, "plugins", "known_marketplaces.json"), JSON.stringify({ kioku: { source } }));
    known({ source: "github", repo: "monoku/kioku" });
    assert.deepEqual(h.integration.plugin.marketplace(), { kind: "github", repo: "monoku/kioku" });
    assert.equal(h.integration.plugin.version(), "0.1.0", "the copy Claude Code installed");

    // The folder beside the tool, as the release's archive lays it out: the plugin's manifest is what loads.
    const folder = join(dir, "current", "plugin");
    mkdirSync(join(folder, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(folder, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "kioku", plugins: [{ name: "kioku", source: "./" }] }),
    );
    writeFileSync(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.3.0" }));
    known({ source: "directory", path: folder });
    assert.deepEqual(h.integration.plugin.marketplace(), { kind: "directory", path: folder });
    assert.equal(h.integration.plugin.version(), "0.3.0", "the folder's, not the stale copy's");
    rmSync(join(folder, ".claude-plugin", "plugin.json"));
    assert.equal(h.integration.plugin.version(), "0.1.0", "a folder that cannot be read falls back to the copy");
  }));

test("claude code: only the skill tool loading Kioku's own skill is let through", () => {
  const h = claudeCode("/h", {});
  const load = (skill: unknown, tool = "Skill"): string =>
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { skill } });
  assert.equal(h.parseSkillUse!(load("kioku:kioku")), "kioku:kioku");
  assert.equal(h.parseSkillUse!(load("kioku:kioku", "Bash")), undefined, "another tool is not a skill load");
  assert.equal(h.parseSkillUse!(load(7)), undefined);
  for (const raw of ["", "{not json", "null"]) assert.equal(h.parseSkillUse!(raw), undefined, raw);
  const answer = h.allowSkillAnswer!();
  assert.deepEqual(
    (answer.data as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput.permissionDecision,
    "allow",
  );
});

test("claude code: a namespace add the shell is about to run is read with its path, description and brain, and answered with ask (§3.2)", () => {
  const h = claudeCode("/h", {});
  const bash = (command: unknown): string =>
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
  assert.deepEqual(
    h.parseNamespaceAdd!(
      bash('kioku namespace add payments --summary "How we bill: invoices, retries" --brain northwind/brain-acme'),
    ),
    { path: "payments", summary: "How we bill: invoices, retries", brain: "northwind/brain-acme" },
  );
  assert.deepEqual(h.parseNamespaceAdd!(bash("cd x && /u/bin/kioku namespace add a/b --summary='it is a' ")), {
    path: "a/b",
    summary: "it is a",
  });
  assert.deepEqual(h.parseNamespaceAdd!(bash("kioku namespace add 'q x' --summary It\\'s")), {
    path: "q x",
    summary: "It's",
  });
  for (const command of [
    "kioku page save --brain northwind/brain-acme",
    "echo kioku namespace add",
    "kioku namespace describe a --summary b",
    7,
  ])
    assert.equal(h.parseNamespaceAdd!(bash(command)), undefined, String(command));
  const answer = h.askAnswer!("⬢ kioku.md · ⚠ create the namespace payments?");
  assert.deepEqual((answer.data as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput, {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: "⬢ kioku.md · ⚠ create the namespace payments?",
  });
});

test("claude code: doctor is told whether its own memory is on, which is the default, and it is only information", () =>
  scratch((dir) => {
    const line = (env: NodeJS.ProcessEnv) => claudeCode(dir, env).checks!()[0]!;
    assert.deepEqual([line({}).name, line({}).ok], ["claude memory", true]);
    assert.match(line({}).detail, /own memory is on/, "on when nothing says otherwise");
    assert.match(line({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }).detail, /own memory is off/);
    assert.match(line({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" }).detail, /own memory is on/);
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ autoMemoryEnabled: false }));
    assert.match(line({}).detail, /own memory is off/, "autoMemoryEnabled: false in the person's settings");
    writeFileSync(join(dir, ".claude", "settings.json"), "{not json");
    assert.match(
      line({}).detail,
      /own memory is on/,
      "a settings file that cannot be read is not a reason to say it is off",
    );
    assert.equal(line({}).ok, true);
  }));

test("harnessFor knows claude-code and refuses anything else", () => {
  assert.equal(harnessFor("claude-code", "/h", {}).id, "claude-code");
  assert.throws(() => harnessFor("nope", "/h", {}), /unknown host "nope"/);
  assert.deepEqual(
    allHarnesses("/h", {}).map((h) => h.id),
    ["claude-code"],
  );
});

test("a write is an entry of the journal for the writing verbs only, however the command is spelled (§4.6)", () => {
  const done = `${JSON.stringify({ status: "done", publication: "pushed", brain: "github.com/northwind/brain-acme", path: "p.md" })}\n`;
  for (const c of [
    "kioku page save --brain a",
    "cd x && kioku page update p.md",
    "~/.kioku/bin/kioku page forget p.md",
    "kioku\tpage  supersede a b",
    "kioku page evolve",
    "echo hi; kioku page save",
    "cat a | kioku page save",
    "(kioku page save a)",
    "false || kioku page confirm a",
    "kioku page save --title 'a; b'",
  ])
    assert.equal(entriesFor(c, done).length, 1, c);
  // A command inside quotes is one word to the shell, so it is none to the journal: what `sh -c '…'` runs is its own.
  for (const c of [
    "kioku page search save",
    "kioku page list",
    "kioku brain log",
    "mykioku page save",
    "kioku page saved",
    "kioku save a",
    'echo "kioku page save"',
    "sh -c 'kioku page save a'",
  ])
    assert.equal(entriesFor(c, done).filter((e) => e.arrow === "write").length, 0, c);
});

test("hook --host picks the adapter, an unknown one is refused, --harness is not a flag, and an unknown hook answers nothing", () =>
  scratch(async (home) => {
    const input = JSON.stringify({
      tool_input: { command: "kioku page save a" },
      tool_response: { stdout: `${JSON.stringify({ status: "done", publication: "local" })}\n` },
    });
    let out = "";
    const io = { stdout: (t: string) => (out += t), isTty: false };
    assert.equal(
      await run(["hook", "post-tool-use", "--host", "claude-code"], io, ctx({ home, stdin: async () => input })),
      0,
    );
    assert.equal(out, "", "a write's hook answers nothing: its row says it");
    assert.notEqual(
      await run(["hook", "post-tool-use", "--host", "nope"], io, ctx({ home, stdin: async () => input })),
      0,
    );
    assert.notEqual(
      await run(["hook", "post-tool-use", "--harness", "claude-code"], io, ctx({ home, stdin: async () => input })),
      0,
      "the older name is gone",
    );
    out = "";
    assert.equal(
      await run(["hook", "permission-request"], io, ctx({ home, stdin: async () => input })),
      0,
      "a hook this version does not know ends with success (§6.2)",
    );
    assert.equal(out, "", "and answers nothing");
  }));
