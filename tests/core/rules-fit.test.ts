import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const ACME = "northwind/brain-acme";
const saveRule = (w: World, title: string, rule: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      ACME,
      "--kind",
      "rule",
      "--title",
      title,
      "--summary",
      `${title}.`,
      "--source",
      "Session 2026-10-07 in acme-api",
      "--evidence",
      "always",
      "--create",
      "--see-also",
      "none",
    ],
    { stdin: `## Rule\n\n${rule}\n\n## Why\n\nIt went wrong once.\n` },
  );
const summaryOf = async (w: World): Promise<string> =>
  (
    await w.kioku(["hook", "session-start"], {
      stdin: JSON.stringify({ cwd: w.repo, session_id: "s", source: "startup" }),
    })
  ).out.hookSpecificOutput.additionalContext;

test("a written Rule is answered with how the Rules fit a session's summary, and lint lists the ones it leaves out (§4.1, §4.4)", () =>
  world(async (w) => {
    const first = await saveRule(w, "Name the unit of every amount", "Every amount says its unit.");
    assert.equal(first.out.status, "done", JSON.stringify(first.out));
    assert.ok(first.out.rules.rules >= 2, "this brain's and the team's");
    assert.deepEqual(first.out.rules.left, []);
    assert.ok(first.out.rules.characters < first.out.rules.room);
    assert.match(
      (await saveRule(w, "Name the zone of every time", "Every time says its zone.")).out.rules.characters.toString(),
      /^\d+$/,
    );
    assert.doesNotMatch(await summaryOf(w), /Not every Rule fits here/);
    // A page that is no Rule says nothing of them.
    const other = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        ACME,
        "--kind",
        "memory",
        "--title",
        "A lesson",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "x",
        "--create",
      ],
      { stdin: "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n" },
    );
    assert.equal(other.out.status, "done", JSON.stringify(other.out));
    assert.ok(!("rules" in other.out));

    // Rules until they pass the room: each under a Rule's own limit, together past the summary's.
    let last = first;
    for (let i = 0; i < 40 && last.out.rules.left.length === 0; i++)
      last = await saveRule(
        w,
        `Keep invariant number ${i} of the ledger`,
        `${"Hold the line on this. ".repeat(20)}Number ${i}.`,
      );
    assert.equal(last.out.status, "done", "the write is done either way");
    assert.ok(last.out.rules.left.length > 0, "some Rule is left out");
    assert.ok(last.out.rules.characters > last.out.rules.room);
    const tty = await w.kioku(["page", "update", last.out.path, "--brain", ACME, "--summary", "Another summary."], {
      tty: true,
    });
    assert.match(tty.raw, /no longer fit a session's summary .* leaves out .*Revise a Rule, or fold several into one/s);

    // What the answer names is what the next session's summary leaves out: the least specific brain's Rules go first.
    const summary = await summaryOf(w);
    assert.match(summary, /Not every Rule fits here/);
    for (const l of last.out.rules.left as { brain: string; path: string }[])
      assert.ok(!summary.includes(`, ${l.path})`), `${l.path} is not in the summary`);
    assert.ok(
      (last.out.rules.left as { brain: string }[]).some((l) => l.brain === "northwind/brain"),
      "the team's Rule is after the project's",
    );

    const lint = (await w.kioku(["brain", "lint"])).out.brains as {
      brain: string;
      rulesCut: string[];
      count: number;
    }[];
    const cut = lint.flatMap((b) => b.rulesCut.map((path) => ({ brain: b.brain, path })));
    assert.deepEqual(
      cut.sort((a, b) => (a.path < b.path ? -1 : 1)),
      [...last.out.rules.left].sort((a: any, b: any) => (a.path < b.path ? -1 : 1)),
    );
    assert.ok(lint.find((b) => b.brain === "northwind/brain")!.count >= 1);
  }));
