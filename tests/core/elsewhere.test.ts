import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const ACME = "northwind/brain-acme";
const SAM = "sam/brain";
const BODY = "## What happened\n\nIt broke.\n\n## Lesson\n\nMind it.\n\n## Rule of thumb\n\nCheck first.\n";
const save = (w: World, brain: string, title: string, extra: string[] = [], o: { cwd?: string } = {}) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      brain,
      "--kind",
      "memory",
      "--title",
      title,
      "--summary",
      "What to know.",
      "--source",
      "Session 2026-11-13 in acme-api",
      "--evidence",
      "they said so",
      ...extra,
    ],
    { stdin: BODY, ...o },
  );

test("save names the pages on its subject in the chain's other brains, and writes all the same (§1.4)", () =>
  world(async (w) => {
    const project = await save(w, ACME, "Squash commits before merging");
    assert.equal(project.out.status, "done", JSON.stringify(project.out));
    assert.equal(project.out.elsewhere, undefined, "nothing elsewhere: the field is not there");

    // A personal preference on the subject of the project's page: written, and the agent is told of the other.
    const personal = await save(w, SAM, "Never squash commits before merging");
    assert.equal(personal.out.status, "done", JSON.stringify(personal.out));
    assert.deepEqual(personal.out.elsewhere, [
      {
        brain: ACME,
        path: project.out.path,
        title: "Squash commits before merging",
        kind: "memory",
        subkind: null,
        summary: "What to know.",
      },
    ]);
    const text = (await save(w, SAM, "Squash commits before merging them", ["--create"], {})).out;
    assert.ok(text.elsewhere.some((e: { path: string }) => e.path === project.out.path));

    // Nothing written for a page the brain itself holds: its own similar pages, and the other brains' beside them.
    const again = await save(w, SAM, "Never squash commits before merging");
    assert.equal(again.out.status, "similar");
    assert.equal(again.out.commit, null);
    assert.ok(again.out.similar.length > 0);
    assert.deepEqual(
      again.out.elsewhere.map((e: { brain: string }) => e.brain),
      [ACME],
    );

    // A retired page elsewhere is history, not a page on the subject.
    await w.kioku(["page", "retire", project.out.path, "--brain", ACME]);
    const after = await save(w, SAM, "Squash commits before merging, always", ["--create"]);
    assert.equal(after.out.status, "done", JSON.stringify(after.out));
    assert.equal(after.out.elsewhere, undefined);
  }));

test("a person is told of them too, and inside a brain there is no other brain to name (§1.4, §2.7)", () =>
  world(async (w) => {
    const project = await save(w, ACME, "Squash commits before merging");
    const told = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        SAM,
        "--kind",
        "memory",
        "--title",
        "Never squash commits before merging",
        "--source",
        "a talk",
      ],
      { stdin: BODY, tty: true },
    );
    assert.match(told.raw, /^Saved /);
    assert.match(
      told.raw,
      /On the same subject in other brains: .*Squash commits before merging; northwind\/brain-acme\)/,
    );
    // Inside the project brain the session's chain is that brain alone.
    const inside = await save(w, ACME, "Squash the commits before merging", ["--create"], { cwd: w.acme });
    assert.equal(inside.out.status, "done", JSON.stringify(inside.out));
    assert.equal(inside.out.elsewhere, undefined);
    assert.ok(project.out.path);
  }));

test("lint lists a page on the subject of one in a more shared brain, once, in the more specific brain, and does not count it (§4.4)", () =>
  world(async (w) => {
    const project = await save(w, ACME, "Squash commits before merging");
    const personal = await save(w, SAM, "Never squash commits before merging");
    const lint = (await w.kioku(["brain", "lint"])).out.brains as {
      brain: string;
      count: number;
      similarElsewhere: { path: string; brain: string; other: string }[];
    }[];
    const of = (key: string) => lint.find((b) => b.brain === key)!;
    // The fixture's own instinct, which both brains hold, is listed too.
    assert.ok(
      of(SAM).similarElsewhere.some(
        (s) => s.path === personal.out.path && s.brain === ACME && s.other === project.out.path,
      ),
      JSON.stringify(of(SAM).similarElsewhere),
    );
    assert.ok(of(SAM).similarElsewhere.every((s) => s.brain === ACME));
    assert.deepEqual(of(ACME).similarElsewhere, [], "listed once, in the more specific brain");
    // One brain linted alone has no other to be compared with, and its count is what it was.
    const alone = (await w.kioku(["brain", "lint", SAM])).out.brains[0];
    assert.deepEqual(alone.similarElsewhere, []);
    assert.equal(alone.count, of(SAM).count, "a pair across brains is not counted: nothing could settle it");
    assert.match((await w.kioku(["brain", "lint"], { tty: true })).raw, /on the subject of one in a more shared brain/);
  }));
