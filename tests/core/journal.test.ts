import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entriesFor, nextTurn, readJournal, record } from "../../src/core/session/journal.ts";
import { sessionsPath } from "../../src/core/state.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const done = (o: Record<string, unknown>) =>
  line({ status: "done", brain: "northwind/brain-acme", commit: "abc1234", publication: "local", ...o });

test("every read and every write of a command is one entry, each in one arrow (§4.6)", () => {
  const page = {
    brain: "northwind/brain-acme",
    path: "knowledge/acme/p.md",
    title: "Pool",
    kind: "knowledge",
    subkind: "context",
  };
  assert.deepEqual(entriesFor("kioku page show knowledge/acme/p.md --brain northwind/brain-acme", line(page)), [
    { what: "opened", arrow: "read", ...page },
  ]);
  assert.deepEqual(
    entriesFor(
      'kioku page search "deploy steps" --brain northwind/brain-acme --limit 5',
      line({ mode: "hybrid", hits: [{ brain: "northwind/brain-acme" }, { brain: "sam/brain" }] }),
    ),
    [
      {
        what: "searched",
        arrow: "read",
        words: "deploy steps",
        count: 2,
        brain: "northwind/brain-acme, sam/brain",
      },
    ],
  );
  assert.deepEqual(
    entriesFor(
      "kioku page list --brain northwind/brain-acme",
      line({ pages: [{ brain: "northwind/brain-acme" }, { brain: "northwind/brain-acme" }] }),
    ),
    [{ what: "listed", arrow: "read", count: 2, brain: "northwind/brain-acme" }],
  );
  assert.deepEqual(
    entriesFor(
      "kioku page list --brain northwind/brain-acme",
      line({
        pages: [{ brain: "northwind/brain-acme" }, { brain: "northwind/brain-acme" }],
        total: 75,
        offset: 0,
        limit: 2,
      }),
    ),
    [{ what: "listed", arrow: "read", count: 2, total: 75, brain: "northwind/brain-acme" }],
    "a window says how many there are in all (§4.6)",
  );
  assert.deepEqual(
    entriesFor("kioku page list --count", line({ total: 75 })),
    [{ what: "listed", arrow: "read", count: 75 }],
    "--count answers only the total",
  );
  for (const verb of ["log", "stats", "lint"])
    assert.deepEqual(entriesFor(`kioku brain ${verb}`, line({ brains: [] })), [{ what: verb, arrow: "read" }]);

  const saved = { path: "knowledge/acme/p.md", title: "Pool", kind: "knowledge", subkind: "context" };
  assert.deepEqual(entriesFor("kioku page save --brain northwind/brain-acme --title Pool", done(saved)), [
    { what: "saved", arrow: "write", brain: "northwind/brain-acme", ...saved },
  ]);
  const instinct = { path: "memory/instincts/use-pnpm.md", title: "Use pnpm", kind: "memory", subkind: "instinct" };
  assert.equal(
    entriesFor("kioku page save --brain northwind/brain-acme --sub instinct", done(instinct))[0]!.what,
    "instinct",
  );
  // An instinct seen again, and whether it is now a candidate for a Skill (§3.6); an update with no occasion is an update.
  assert.deepEqual(
    entriesFor(
      'kioku page update memory/instincts/use-pnpm.md --evidence "again" --source s',
      done({ ...instinct, candidate: true }),
    ),
    [
      {
        what: "instinct again",
        arrow: "write",
        brain: "northwind/brain-acme",
        ...instinct,
        candidate: true,
      },
    ],
  );
  assert.equal(entriesFor("kioku page update memory/instincts/use-pnpm.md", done(instinct))[0]!.what, "updated");
  assert.equal(
    entriesFor(
      "kioku page evolve memory/instincts/use-pnpm.md",
      done({ path: "skills/use-pnpm/SKILL.md", kind: "skill" }),
    )[0]!.became,
    "skill",
  );
  assert.equal(
    entriesFor("kioku page evolve x.md --to rule", done({ path: "rules/x.md", evolvedAs: "rule" }))[0]!.became,
    "rule",
  );
  for (const [verb, what] of [
    ["supersede", "replaced"],
    ["forget", "forgot"],
    ["retire", "retired"],
    ["confirm", "confirmed"],
    ["rename", "renamed"],
    ["move", "moved"],
    ["link", "linked"],
    ["promote", "promoted"],
  ] as [string, string][]) {
    const e = entriesFor(`kioku page ${verb} p.md --brain northwind/brain-acme`, done({ path: "p.md" }));
    assert.deepEqual([e[0]!.what, e[0]!.arrow], [what, "write"], verb);
  }
  // A refusal, a similar answer, one that asks for a namespace, and another command make none.
  assert.deepEqual(entriesFor("kioku page show p.md", line({ error: { code: "not_found", message: "no" } })), []);
  assert.deepEqual(
    entriesFor(
      "kioku page save --brain northwind/brain-acme",
      line({ status: "similar", brain: "northwind/brain-acme", similar: [] }),
    ),
    [],
  );
  assert.deepEqual(
    entriesFor(
      "kioku page save --brain northwind/brain-acme",
      line({ status: "namespace", brain: "northwind/brain-acme", namespaces: [] }),
    ),
    [],
  );
  assert.deepEqual(entriesFor("cat p.md", line(page)), []);
});

const hook = (w: World, verb: string, input: Record<string, unknown>) =>
  w.kioku(["hook", verb], { stdin: JSON.stringify({ session_id: "s1", cwd: w.repo, ...input }) });

test("an entry carries its brains as Kioku names them, one label for each name, in order (§4.6)", () => {
  const labels = {
    label: (k: string) => (k === "northwind/brain-acme" ? "project" : k === "sam/brain" ? "personal" : `team · ${k}`),
  };
  const search = entriesFor(
    'kioku page search "x" --brain northwind/brain-acme',
    line({
      hits: [{ brain: "northwind/brain-acme" }, { brain: "sam/brain" }, { brain: "rival" }],
    }),
    labels,
  );
  assert.equal(search[0]!.brain, "northwind/brain-acme, sam/brain, rival");
  assert.equal(search[0]!.label, "project, personal, team · rival");
  const one = entriesFor(
    "kioku page show p.md",
    line({ brain: "northwind/brain-acme", path: "p.md", title: "Pool" }),
    labels,
  );
  assert.deepEqual(one, [
    {
      what: "opened",
      arrow: "read",
      brain: "northwind/brain-acme",
      label: "project",
      path: "p.md",
      title: "Pool",
    },
  ]);
  // Without a brain there is no label, and without labels the entry is as it was.
  assert.deepEqual(entriesFor("kioku brain log", line({ brains: [] }), labels), [{ what: "log", arrow: "read" }]);
  assert.equal(
    "label" in entriesFor("kioku page show p.md", line({ brain: "northwind/brain-acme", path: "p.md" }))[0]!,
    false,
  );
});

test("the hooks keep the session's journal: the summary, each prompt's turn, the skill, each read and write (§4.6)", () =>
  world(async (w) => {
    await hook(w, "session-start", { source: "startup" });
    const started = readJournal(w.home, "s1");
    assert.equal(started[0]?.what, "summary");
    assert.equal(started[0]?.arrow, "read");
    assert.equal(started[0]?.turn, 1);

    await hook(w, "user-prompt-submit", { prompt: "hello there" });
    await hook(w, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "kioku:kioku" } });
    await hook(w, "post-tool-use", {
      tool_input: { command: "kioku page show p.md --brain northwind/brain-acme" },
      tool_response: { stdout: line({ brain: "northwind/brain-acme", path: "p.md", title: "Pool" }) },
    });
    await hook(w, "user-prompt-submit", { prompt: "and now?" });
    await hook(w, "post-tool-use", {
      tool_input: { command: "kioku page forget p.md --brain northwind/brain-acme" },
      tool_response: { stdout: done({ path: "p.md", title: "Pool" }) },
    });
    // Another skill, and a command of no session, make none.
    await hook(w, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "commit" } });
    await w.kioku(["hook", "post-tool-use"], {
      stdin: JSON.stringify({
        tool_input: { command: "kioku page show p.md" },
        tool_response: { stdout: line({ brain: "northwind/brain-acme", path: "p.md", title: "Pool" }) },
      }),
    });

    const entries = readJournal(w.home, "s1");
    assert.deepEqual(
      entries.map((e) => [e.what, e.arrow, e.turn]),
      [
        ["summary", "read", 1],
        ["skill", "read", 1],
        ["opened", "read", 1],
        ["forgot", "write", 2],
      ],
    );
    // A brain of the session's own is named by its tier (§4.6).
    assert.equal(entries[2]!.brain, "northwind/brain-acme");
    assert.equal(entries[2]!.label, "project");
    for (const e of entries.filter((x) => x.brain !== undefined)) assert.equal(typeof e.label, "string");
    assert.deepEqual(
      readdirSync(sessionsPath(w.home)).filter((f) => f !== ".pruned"),
      ["s1.jsonl"],
    );
  }));

test("a journal thirty days old is dropped at a prompt, one of some weeks is kept, and an id that is not one names no file (§4.6)", () =>
  world(async (w) => {
    // The world's clock is 2026-10-07 at noon.
    const aged = (session: string, then: Date): string => {
      record(w.home, session, [{ what: "opened", arrow: "read" }], then);
      const file = join(sessionsPath(w.home), `${session}.jsonl`);
      utimesSync(file, then, then);
      return file;
    };
    const old = aged("old", new Date(2026, 8, 1));
    const weeks = aged("weeks", new Date(2026, 8, 15));
    await hook(w, "user-prompt-submit", { prompt: "hello there" });
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(weeks), true, "a session resumed three weeks later still has its journal");
    unlinkSync(weeks);
    record(w.home, "../escape", [{ what: "opened", arrow: "read" }], new Date());
    assert.deepEqual(
      readdirSync(sessionsPath(w.home)).filter((f) => f !== ".pruned"),
      ["s1.jsonl"],
    );
  }));

test("old journals are looked for once a day, whatever the number of prompts (§4.6)", () =>
  world(async (w) => {
    const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);
    const old = join(sessionsPath(w.home), "old.jsonl");
    const write = () => {
      // Older than a journal is kept: from the August before.
      const then = new Date(2026, 7, 20);
      record(w.home, "old", [{ what: "opened", arrow: "read" }], then);
      utimesSync(old, then, then);
    };
    nextTurn(w.home, "s1", at(7));
    write();
    nextTurn(w.home, "s1", at(7, 18));
    assert.equal(existsSync(old), true, "less than a day after the last look, nothing is looked at");
    nextTurn(w.home, "s1", at(8, 12));
    assert.equal(existsSync(old), false, "a day after it, the old journal goes");
    write();
    writeFileSync(join(sessionsPath(w.home), ".pruned"), "not a date");
    nextTurn(w.home, "s1", at(8, 13));
    assert.equal(existsSync(old), false, "a stamp that cannot be read holds nothing back");
    write();
    writeFileSync(join(sessionsPath(w.home), ".pruned"), at(30).toISOString());
    nextTurn(w.home, "s1", at(8, 14));
    assert.equal(existsSync(old), false, "nor does one from the future");
  }));

test("a session resumed or compacted loads its summary again in a turn of its own, and says why (§4.6)", () =>
  world(async (w) => {
    await hook(w, "session-start", { source: "startup" });
    await hook(w, "session-start", { source: "resume" });
    await hook(w, "user-prompt-submit", { prompt: "and now?" });
    await hook(w, "session-start", { source: "compact" });
    const summaries = readJournal(w.home, "s1").filter((e) => e.what === "summary");
    assert.deepEqual(
      summaries.map((e) => [e.source, e.turn]),
      [
        ["startup", 1],
        ["resume", 2],
        ["compact", 4],
      ],
    );
  }));

test("a search's entry holds the pages its answer brought, in order and without their text (§4.6)", () => {
  const hits = [
    {
      brain: "northwind/brain-acme",
      path: "knowledge/acme/a.md",
      title: "A",
      text: "never kept",
      score: 0.9,
    },
    { brain: "sam/brain", path: "knowledge/sam/b.md", title: "B" },
  ];
  assert.deepEqual(entriesFor("kioku page search deploy", line({ mode: "hybrid", hits })), [
    {
      what: "searched",
      arrow: "read",
      words: "deploy",
      count: 2,
      brain: "northwind/brain-acme, sam/brain",
      hits: [
        { brain: "northwind/brain-acme", path: "knowledge/acme/a.md", title: "A" },
        { brain: "sam/brain", path: "knowledge/sam/b.md", title: "B" },
      ],
    },
  ]);
  const many = Array.from({ length: 20 }, (_, i) => ({
    brain: "northwind/brain-acme",
    path: `p${i}.md`,
    title: `T${i}`,
  }));
  assert.equal(
    entriesFor("kioku page search x", line({ hits: many }))[0]!.hits!.length,
    20,
    "as many as the call returned",
  );
});
