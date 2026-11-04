import { test } from "node:test";
import assert from "node:assert/strict";
import { readJournal } from "../../src/core/session/journal.ts";
import { labelsFor } from "../../src/core/session/labels.ts";
import { loadedRow } from "../../src/core/session/start.ts";
import { render } from "../../src/core/session/message.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const hook = (w: Parameters<Parameters<typeof world>[0]>[0], name: string, input: object) =>
  w.kioku(["hook", name], { stdin: JSON.stringify({ session_id: "s1", cwd: w.repo, ...input }) });

test("a brain is named by its tier in the session's chain, with its name too when it is not one of the session's (§1.2)", () =>
  world(async (w) => {
    const inRepo = labelsFor(w.home, w.repo);
    assert.equal(inRepo.label("github.com/northwind/brain-acme"), "project");
    assert.equal(inRepo.label("github.com/sam/brain"), "personal");
    assert.equal(inRepo.label("nobody"), "nobody", "a brain whose tier cannot be read is named by its name");
    // Outside the repository the chain is the personal brain alone: acme is named by tier and name.
    const elsewhere = labelsFor(w.home, w.home);
    assert.equal(elsewhere.label("github.com/northwind/brain-acme"), "project · northwind/brain-acme");
    assert.equal(elsewhere.label("github.com/sam/brain"), "personal");
    assert.equal(
      labelsFor(w.home, undefined).label("github.com/northwind/brain-acme"),
      "project · northwind/brain-acme",
    );
  }));

test("the start's line counts each brain under its tier, and the journal names the page's brain by it (§1.2, §4.6)", () =>
  world(async (w) => {
    assert.equal(
      render(
        loadedRow({ brains: ["sam", "acme"], pages: 5, counts: [2, 3] }, (b) => (b === "sam" ? "personal" : "project")),
        { color: false },
      ),
      "⬢ kioku.md · ↓ summary  session summary · 5 pages  (personal 2 · project 3)",
      "one line, with nothing under it",
    );
    const started = await hook(w, "session-start", { source: "startup" });
    assert.match(started.out.systemMessage, /personal \d+ · project \d+/);
    assert.doesNotMatch(started.out.systemMessage, /\bacme \d/);
    // The cwd of the session names the chain; from another folder the brain is named by tier and name.
    const shown = (cwd: string) =>
      hook(w, "post-tool-use", {
        cwd,
        tool_input: { command: "kioku page show p.md --brain northwind/brain-acme" },
        tool_response: { stdout: line({ brain: "github.com/northwind/brain-acme", path: "p.md", title: "Pool" }) },
      });
    assert.equal((await shown(w.repo)).raw.trim(), "", "a call's hook answers nothing: its row says it");
    await shown(w.home);
    assert.deepEqual(
      readJournal(w.home, "s1")
        .filter((e) => e.what === "opened")
        .map((e) => e.label),
      ["project", "project · northwind/brain-acme"],
    );
  }));
