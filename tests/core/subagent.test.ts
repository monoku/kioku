import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readJournal } from "../../src/core/session/journal.ts";
import { RULES_CUT, SUBAGENT_OPENING, SUMMARY_CAP } from "../../src/core/session/summary.ts";
import { made, RULE, validPages } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const start = (w: World, cwd?: string) =>
  w.kioku(["hook", "subagent-start"], {
    stdin: JSON.stringify({
      cwd: cwd ?? w.repo,
      session_id: "s",
      agent_id: "a1",
      agent_type: "Explore",
      hook_event_name: "SubagentStart",
    }),
  });

test("a subagent is given the Rules of the session's brains at its start, each its Rule and its Why, and nothing else of the summary (§4.1, §6.2)", () =>
  world(async (w) => {
    const r = await start(w);
    assert.equal(r.code, 0);
    assert.equal(r.out.hookSpecificOutput.hookEventName, "SubagentStart");
    const text: string = r.out.hookSpecificOutput.additionalContext;
    assert.ok(text.startsWith(SUBAGENT_OPENING));
    assert.match(SUBAGENT_OPENING, /Save nothing to it yourself/);
    assert.match(SUBAGENT_OPENING, /load the `kioku` skill, then `kioku page search <words>`/);
    // Most specific brain first, as the session's own summary has them.
    const project = text.indexOf("### No prod migrations from a session (northwind/brain-acme");
    const team = text.indexOf("### Write commit messages in English (northwind");
    assert.ok(project > 0 && team > project);
    assert.match(text, /Never\.\n\nWhy: Incident of 2026-09\./);
    assert.doesNotMatch(text, /## Skills|## Decisions|## Instincts|front page|Save on your own/);
    assert.ok(text.length <= SUMMARY_CAP);
    // The session's summary said again: no entry of the journal, nothing said to the person, nothing started.
    assert.deepEqual(readJournal(w.home, "s"), []);
    assert.equal(r.out.systemMessage, undefined);
    assert.deepEqual(w.calls, []);
  }));

test("inside a brain a subagent is given that brain's Rules alone (§2.7, §4.1)", () =>
  world(async (w) => {
    const text: string = (await start(w, join(w.acme, "knowledge/acme"))).out.hookSpecificOutput.additionalContext;
    assert.match(text, /### No prod migrations from a session/);
    assert.doesNotMatch(text, /Write commit messages in English/);
  }));

test("a subagent is given nothing where the brains hold no Rule, or the machine is not set up (§4.1)", () =>
  world(
    async (w) => {
      assert.equal((await start(w)).raw, "");
      assert.equal((await start(w, "/")).raw, "", "a folder with the personal brain alone, which has no Rule");
    },
    {
      acmePages: validPages().filter((p) => !p.path.startsWith("rules/")),
      teamPages: [],
    },
  ));

test("Rules past the cap are cut between Rules, and the subagent is told how to list them (§4.1)", () =>
  world(
    async (w) => {
      const text: string = (await start(w)).out.hookSpecificOutput.additionalContext;
      assert.ok(text.length <= SUMMARY_CAP, `${text.length}`);
      assert.ok(text.endsWith(RULES_CUT));
    },
    {
      acmePages: Array.from({ length: 30 }, (_, n) =>
        made({
          n: 200 + n,
          type: RULE,
          title: `Rule number ${n}`,
          sections: { Rule: "x".repeat(500), Why: "Because." },
        }),
      ),
    },
  ));
