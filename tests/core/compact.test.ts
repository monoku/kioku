import { test } from "node:test";
import assert from "node:assert/strict";
import { AFTER_COMPACT, UNSAVED_HEADING, compactInstructions, savedTitles } from "../../src/core/session/compact.ts";
import { record, type JournalEntry } from "../../src/core/session/journal.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

const entry = (e: Partial<JournalEntry>): JournalEntry => ({
  at: "2026-11-13T10:00:00Z",
  turn: 1,
  what: "saved",
  arrow: "write",
  ...e,
});

test("the titles a session saved are its writes', the newest first, each once, never a read's or a forgotten page's (§1.1)", () => {
  assert.deepEqual(
    savedTitles([
      entry({ title: "Run migrations\nbefore the deploy" }),
      entry({ what: "opened", arrow: "read", title: "A page only read" }),
      entry({ what: "updated", title: "Deploys wait for a green build" }),
      entry({ what: "forgot", title: "A page forgotten" }),
      entry({ what: "updated", title: "Run migrations before the deploy" }),
      entry({ what: "linked" }),
    ]),
    ["Run migrations before the deploy", "Deploys wait for a green build"],
  );
  assert.equal(savedTitles(Array.from({ length: 50 }, (_, i) => entry({ title: `Page ${i}` }))).length, 20);
});

test("the compaction is asked to keep what was said and not saved under one heading, naming what was saved (§1.1)", () => {
  const none = compactInstructions([]);
  assert.match(none, new RegExp(`under a heading "${UNSAVED_HEADING}"`));
  assert.match(none, /a correction and what they wanted instead/);
  assert.match(none, /Nothing was saved to Kioku in this session yet\./);
  assert.match(none, /Leave out secrets/);
  assert.ok(!none.includes("\n"), "one paragraph");
  assert.match(compactInstructions(["A", "B"]), /Leave out what the session already saved to Kioku: "A"; "B"\./);
});

test("before a compaction the hook prints the instructions as plain text, with what the session saved; nothing where Kioku is not set up (§1.1, §6.2)", () =>
  world(async (w) => {
    record(
      w.home,
      "s",
      [
        {
          what: "saved",
          arrow: "write",
          brain: "northwind/brain-acme",
          path: "memory/a.md",
          title: "Tabs, not spaces",
        },
      ],
      new Date(),
    );
    const stdin = JSON.stringify({ cwd: w.repo, session_id: "s", trigger: "auto", hook_event_name: "PreCompact" });
    const r = await w.kioku(["hook", "pre-compact"], { stdin });
    assert.equal(r.code, 0);
    // What the host reads is the text itself: it takes a PreCompact hook's output as instructions, not as JSON.
    assert.equal(r.raw, `${compactInstructions(["Tabs, not spaces"])}\n`);
    assert.match(r.raw, /already saved to Kioku: "Tabs, not spaces"\./);
    const other = await w.kioku(["hook", "pre-compact"], {
      stdin: JSON.stringify({ cwd: w.repo, session_id: "other" }),
    });
    assert.match(other.raw, /Nothing was saved to Kioku in this session yet\./);
    // Unreadable input is a session with nothing saved, never an error.
    assert.equal((await w.kioku(["hook", "pre-compact"], { stdin: "not json" })).code, 0);
  }));

test("a session just compacted is told, in its opening, to save what the compaction's summary kept; no other session is (§4.1)", () =>
  world(async (w) => {
    const start = async (source: string) =>
      (
        await w.kioku(["hook", "session-start"], {
          stdin: JSON.stringify({ cwd: w.repo, source, session_id: "s" }),
        })
      ).out.hookSpecificOutput.additionalContext as string;
    const compacted = await start("compact");
    assert.ok(compacted.includes(AFTER_COMPACT));
    assert.ok(
      compacted.indexOf(AFTER_COMPACT) < compacted.indexOf("- personal:"),
      "with when to save, before the brains",
    );
    assert.ok(compacted.indexOf("Save on your own") < compacted.indexOf(AFTER_COMPACT));
    for (const source of ["startup", "resume", "clear"])
      assert.ok(!(await start(source)).includes(UNSAVED_HEADING), source);
  }));
