import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_MD, agentsMd } from "../src/core/brains/agents-md.ts";
import { claudeMd, INGEST_COMMAND, ingestCommand } from "../src/harness/claude-code-files.ts";
import { pluginHooks, READ_FILTERS, WRITE_FILTERS } from "../src/harness/claude-code-integration.ts";
import { SKILL_CANDIDATE_OCCASIONS } from "../src/core/lint.ts";
import { WRITING_VERBS } from "../src/core/log.ts";

// The skill is the plugin's file: the one place they are written (§6.2).
const plugin = (rel: string): string =>
  readFileSync(join(import.meta.dirname, "..", "plugins/claude-code", rel), "utf8");
const skillText = (): string => plugin("skills/kioku/SKILL.md");

/** A Markdown file cut into its front matter lines and its body. */
function parts(text: string): { front: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, "front matter");
  const front = Object.fromEntries(
    m[1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
  );
  return { front, body: m[2]! };
}

const NUMBERS = ["zero", "one", "two", "three", "four", "five"];

test("the skill: one-line description, a body under 1,500 words, the tool's threshold, no paths and no ids (§3.6, §6.2)", () => {
  const { front, body } = parts(skillText());
  assert.equal(front.name, "kioku");
  assert.equal(front["allowed-tools"], "Bash(kioku *)");
  assert.equal(front["user-invocable"], "false", "the agent loads it; the person's menu does not list it");
  assert.ok(front.description && !front.description.includes("\n"));
  const words = body.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 1500, `${words} words`);
  assert.match(body, new RegExp(`with ${NUMBERS[SKILL_CANDIDATE_OCCASIONS]} occasions is a candidate`));
  assert.match(body, /`\/kioku-evolve`/, "the command by the name the mod gives it");
  assert.match(body, /`kioku page evolve --json`/);
  assert.match(body, /for those only/);
  assert.doesNotMatch(body, /\bids?\b|\.md\b|~\/|\.kioku\//i);
});

test("the skill's call form is the one the journal hook's filters match: `kioku <verb>` first, body by heredoc", () => {
  const { body } = parts(skillText());
  assert.deepEqual(
    WRITE_FILTERS,
    [...WRITING_VERBS, "promote"].map((v) => `Bash(kioku page ${v} *)`),
    "one filter per writing verb, in the tool's order; `promote` is two commits in two brains, each named by its own verb",
  );
  for (const block of body.matchAll(/```bash\n([\s\S]*?)```/g))
    assert.match(block[1]!, /^kioku page (save|update|supersede|forget|evolve|link) .*<<'EOF'\n/);
  assert.doesNotMatch(body, /\|\s*kioku\b/, "nothing is piped into the tool");
});

test("the skill says how to work inside a brain, how a created page links to its neighbours, and how to link later (§2.7, §3.3)", () => {
  const { body } = parts(skillText());
  assert.match(body, /## Inside a brain/);
  assert.match(body, /--see-also/);
  assert.match(body, /`link <path> <path>/);
  assert.match(body, /`list \[--brain/);
});

test("the plugin's hooks run its own wrapper, one handler per event, the journal's filters on the shell tool, and its skill let through (§6.2)", () => {
  const { hooks } = pluginHooks();
  const run = (verb: string): string => `bash "\${CLAUDE_PLUGIN_ROOT}/hooks/kioku.sh" hook ${verb}`;
  assert.deepEqual(Object.keys(hooks).sort(), [
    "PostToolUse",
    "PreCompact",
    "PreToolUse",
    "SessionStart",
    "SubagentStart",
    "UserPromptSubmit",
  ]);
  for (const [event, verbs] of [
    // The summary in two parts, a hook each, since the host caps what one hook injects (§4.1).
    ["SessionStart", ["session-start", "session-start-holds"]],
    ["UserPromptSubmit", ["user-prompt-submit"]],
    // Before a compaction, what was not saved is kept by its summary (§1.1).
    ["PreCompact", ["pre-compact"]],
    // A subagent runs no session start: the Rules reach it at its own (§4.1).
    ["SubagentStart", ["subagent-start"]],
  ] as const) {
    assert.equal(hooks[event]!.length, verbs.length);
    verbs.forEach((verb, i) => {
      assert.equal(hooks[event]![i]!.matcher, undefined, `${event} runs for every session or prompt`);
      assert.deepEqual(hooks[event]![i]!.hooks, [{ type: "command", command: run(verb) }]);
    });
  }
  assert.equal(hooks.PreToolUse![0]!.matcher, "Skill", "only the skill tool");
  assert.deepEqual(hooks.PreToolUse![0]!.hooks, [{ type: "command", command: run("pre-tool-use") }]);
  assert.equal(hooks.PreToolUse![1]!.matcher, "Bash");
  assert.deepEqual(
    hooks.PreToolUse![1]!.hooks,
    [{ type: "command", if: "Bash(kioku namespace add *)", command: run("pre-tool-use") }],
    "the person confirms each namespace (§3.2)",
  );
  assert.equal(hooks.PreToolUse!.length, 3);
  assert.equal(hooks.PreToolUse![2]!.matcher, "Read|Edit|Write|NotebookEdit", "the tools that read or change one file");
  assert.deepEqual(
    hooks.PreToolUse![2]!.hooks,
    [{ type: "command", command: run("pre-tool-path") }],
    "a page about a file is named when the agent reads or changes it (§4.7)",
  );
  assert.equal(hooks.PostToolUse!.length, 1);
  assert.equal(hooks.PostToolUse![0]!.matcher, "Bash");
  assert.deepEqual(
    hooks.PostToolUse![0]!.hooks.map((h) => h.if),
    [...WRITE_FILTERS, ...READ_FILTERS],
  );
  assert.deepEqual(
    READ_FILTERS,
    ["page show", "page search", "page list", "brain log", "brain stats", "brain lint"].map(
      (c) => `Bash(kioku ${c} *)`,
    ),
    "one filter per reading verb (§1.2)",
  );
  for (const h of hooks.PostToolUse![0]!.hooks) assert.equal(h.command, run("post-tool-use"));
});

test("the brain's ingest command: this brain only, distils through the ordinary verbs, on demand, with the source and a quote, and ends with an account (§1.7)", () => {
  const { front, body } = parts(ingestCommand("northwind/brain-acme"));
  assert.ok(front.description && !front.description.includes("\n"));
  assert.equal(front["allowed-tools"], "Bash(kioku *)", "the tool, through the skill's verbs; no reader of its own");
  assert.match(body, /exists only in sessions opened in its folder/);
  assert.match(body, /--brain northwind\/brain-acme/, "everything goes to this brain");
  assert.match(body, /kioku page save/);
  assert.match(body, /--source/);
  assert.match(body, /--evidence/);
  assert.match(body, /two tests|both tests/, "the gate of §1.1 applies to every page");
  assert.match(body, /never saved|Never saved/i, "the exclusions of §1.5 weigh more on mail and chat");
  assert.match(body, /end(s)? with/i, "the reply accounts for what was written");
  assert.match(body, /never watch a source/);
  assert.match(
    body,
    /Propose before writing[\s\S]*Wait for the person's answer[\s\S]*Write only what they approved/,
    "one question per batch, before anything is written",
  );
  assert.match(body, /Skip the proposal only when the person asked for it explicitly/);
  assert.doesNotMatch(body, /\bids?\b|~\//i);
  assert.equal(INGEST_COMMAND, ".claude/commands/ingest.md", "where Claude Code looks for a folder's own commands");
});

test("Claude Code's pointer in a brain imports the neutral AGENTS.md, so the text lives once; what only Claude Code needs is said there (§2.7)", () => {
  assert.ok(claudeMd().startsWith(`@${AGENTS_MD}\n`));
  assert.match(claudeMd(), /curl -fsSL https:\/\/raw\.githubusercontent\.com\/monoku\/kioku\/main\/install\.sh \| sh/);
  assert.match(claudeMd(), /kioku plugin claude-code install/);
});

test("AGENTS.md names no agent host and says what §2.7 asks: BRAIN.md first, which folder holds what, the verbs, no hand edits", () => {
  const text = agentsMd("northwind/brain-acme", "project", "1.2.3");
  assert.doesNotMatch(text, /Claude|Codex|Cursor|Copilot/);
  assert.match(text, /Start with `BRAIN\.md`/);
  for (const f of ["rules/", "skills/", "knowledge/<namespace>/", "memory/", "memory/instincts/"])
    assert.ok(text.includes(`\`${f}\``), f);
  for (const v of [
    "kioku page search",
    "kioku page list",
    "kioku page show",
    "kioku page save",
    "kioku page update",
    "kioku page supersede",
    "kioku page link",
    "kioku page forget",
    "kioku page evolve",
    "kioku brain lint",
  ])
    assert.ok(text.includes(v), v);
  assert.match(text, /never by editing pages by hand/);
});
