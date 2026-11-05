import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/run.ts";
import { readJournal } from "../../src/core/session/journal.ts";
import { ctx } from "../fixtures.ts";

/** A `PostToolUse` input as the host sends it after a Bash call (§1.2, §6.2). */
const input = (command: string, stdout: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: "abc123",
    transcript_path: "/Users/sam/.claude/projects/acme-api/00893aaf.jsonl",
    cwd: "/Users/sam/work/acme-api",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "Save the decision" },
    tool_response: { stdout, stderr: "", interrupted: false, isImage: false },
    tool_use_id: "toolu_01ABC123",
    duration_ms: 812,
    ...extra,
  });

const SAVE =
  "kioku page save --brain northwind/brain-acme --kind knowledge --sub decision --title 'Run migrations before the deploy' --source 'Session 2026-10-07 in acme-api' <<'EOF'\n## Decision\n\nBefore.\nEOF";
const result = (o: Record<string, unknown>) =>
  `${JSON.stringify({ status: "done", brain: "northwind/brain-acme", path: "knowledge/acme/decisions/run-migrations-before-the-deploy.md", commit: "3f2a9c1", publication: "pushed", id: "01J9QZ3M7X8K2V5B6N4P0R1S2T", ...o })}\n`;

/** The hook's answer, and what it wrote into the session's journal. */
async function hook(stdin: string): Promise<{ code: number; out: string; entries: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "kioku-post-tool-use-"));
  try {
    let out = "";
    const code = await run(
      ["hook", "post-tool-use"],
      { stdout: (t) => (out += t), isTty: false },
      ctx({ home, stdin: async () => stdin }),
    );
    return { code, out, entries: readJournal(home, "abc123").map((e) => e.what) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("a write's hook answers nothing and keeps it in the journal, pushed, local or pending: its row says it (§1.2, §4.6)", async () => {
  for (const r of [result({}), result({ publication: "local" }), result({ publication: "pending" })])
    assert.deepEqual(await hook(input(SAVE, r)), { code: 0, out: "", entries: ["saved"] }, r);
  assert.deepEqual(
    await hook(
      input(
        "kioku page evolve memory/instincts/x.md --brain northwind/brain-acme",
        result({ path: "skills/x.md", instinct: "memory/instincts/x.md" }),
      ),
    ),
    { code: 0, out: "", entries: ["evolved"] },
  );
});

test("similar, error, empty output and output that is not JSON keep nothing and say nothing", async () => {
  const similar = `${JSON.stringify({ status: "similar", brain: "northwind/brain-acme", path: null, commit: null, publication: null, similar: [] })}\n`;
  const error = `${JSON.stringify({ status: "error", brain: "northwind/brain-acme", path: null, commit: null, publication: null, error: { code: "invalid_page", message: "x" } })}\n`;
  const list = `${JSON.stringify({ candidates: [] })}\n`;
  for (const stdout of [
    similar,
    error,
    "",
    "Saved knowledge/acme/decisions/x.md in acme (commit 3f2a9c1, published).\n",
    "{not json\n",
    list,
  ]) {
    assert.deepEqual(await hook(input(SAVE, stdout)), { code: 0, out: "", entries: [] }, stdout);
  }
});

test("input the hook cannot read gives no message and never fails", async () => {
  for (const stdin of [
    "",
    "not json",
    "null",
    JSON.stringify({ tool_name: "Bash" }),
    JSON.stringify({ tool_response: { stdout: 42 } }),
  ]) {
    assert.deepEqual((await hook(stdin)).code, 0, stdin);
    assert.deepEqual((await hook(stdin)).out, "", stdin);
  }
});

test("the result is found among other output, each write is one entry, and a response may be a string", async () => {
  const chained = `On branch main\n${result({})}done\n`;
  assert.deepEqual(
    (await hook(input(`cd ~/work/acme-api && ${SAVE} && git status | head -1; echo done`, chained))).entries,
    ["saved"],
  );
  assert.deepEqual((await hook(input(SAVE, `${result({})}${result({ publication: "pending" })}`))).entries, [
    "saved",
    "saved",
  ]);
  assert.deepEqual((await hook(input(SAVE, "", { tool_response: result({}) }))).entries, ["saved"]);
});
