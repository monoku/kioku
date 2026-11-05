import { test } from "node:test";
import assert from "node:assert/strict";
import { statsOf } from "../../src/core/stats.ts";
import type { Write } from "../../src/core/log.ts";
import { isolateGit } from "../remotes.ts";
import { world as shared, type World } from "../world.ts";

isolateGit();

const w = (verb: Write["verb"], path: string): Write => ({
  verb,
  title: path,
  path,
  date: "2026-10-01T10:00:00Z",
  author: "Sam",
  via: null,
  commit: "abc1234",
});

test("a brain's writes add up by verb; a saved page forgotten in the span is reverted, one saved before it is only a forget (§6.1)", () => {
  const s = statsOf([
    w("save", "a.md"),
    w("save", "b.md"),
    w("forget", "a.md"),
    w("forget", "old.md"),
    w("update", "b.md"),
    w("confirm", "b.md"),
  ]);
  assert.equal(s.writes, 6);
  assert.equal(s.saved, 2);
  assert.equal(s.reverted, 1, "a.md; old.md was saved before the span");
  assert.equal(s.revert_rate, 0.5);
  assert.equal(s.confirmed, 1);
  assert.deepEqual(s.by_verb, {
    save: 2,
    update: 1,
    supersede: 0,
    forget: 2,
    evolve: 0,
    link: 0,
    confirm: 1,
    retire: 0,
    rename: 0,
    move: 0,
  });
});

test("nothing saved has no rate", () => {
  assert.equal(statsOf([]).revert_rate, null);
  assert.equal(statsOf([w("update", "a.md")]).revert_rate, null);
});

const MEM =
  "## What happened\n\nThe tests touched the database in parallel and failed.\n\n## Lesson\n\nRun them serially.\n\n## Rule of thumb\n\nStaging deploys wait for a green build.\n";
const save = (k: World["kioku"], title: string) =>
  k(
    [
      "page",
      "save",
      "--brain",
      "northwind/brain-acme",
      "--kind",
      "memory",
      "--title",
      title,
      "--source",
      "https://x.io",
      "--summary",
      "Serially.",
      "--create",
    ],
    { stdin: MEM },
  );

test("kioku brain stats: per brain, 30d by default, no author; --since and --brain narrow; a bad span is usage (§6.1)", () =>
  shared(async (world) => {
    const a = await save(world.kioku, "Staging deploys wait for a green build");
    const b = await save(world.kioku, "Tests run serially");
    assert.equal(a.out.status, "done", a.raw);
    assert.equal((await world.kioku(["page", "forget", a.out.path, "--brain", "northwind/brain-acme"])).code, 0);

    const r = await world.kioku(["brain", "stats", "--brain", "northwind/brain-acme"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(Object.keys(r.out), ["since", "brains"]);
    const [acme] = r.out.brains;
    assert.equal(acme.brain, "northwind/brain-acme");
    assert.equal(acme.saved, 2);
    assert.equal(acme.reverted, 1);
    assert.equal(acme.revert_rate, 0.5);
    assert.ok(!JSON.stringify(r.out).includes("Sam"), "no author");
    assert.equal(b.out.status, "done", b.raw);

    const all = await world.kioku(["brain", "stats"]);
    assert.ok(all.out.brains.length >= 1);
    const text = await world.kioku(["brain", "stats", "--brain", "northwind/brain-acme"], { tty: true });
    assert.match(text.raw, /^northwind\/brain-acme +3 +2 +0 +0 +0 +1\b/m);

    const bad = await world.kioku(["brain", "stats", "--since", "last week"]);
    assert.equal(bad.out.error.code, "usage");
  }));

test("the writes are split by how they arrived, never by person; a commit with no trailer is unknown, not the agent's or a person's (§6.1)", () => {
  const via = (verb: Write["verb"], path: string, v: string | null): Write => ({ ...w(verb, path), via: v });
  const s = statsOf([
    via("save", "a.md", "claude-code"),
    via("save", "b.md", "claude-code"),
    via("forget", "a.md", "terminal"),
    via("save", "c.md", "terminal"),
    via("save", "d.md", null),
  ]);
  assert.deepEqual(s.by_via["claude-code"], { writes: 2, saved: 2, reverted: 1, revert_rate: 0.5 });
  assert.deepEqual(s.by_via.terminal, { writes: 2, saved: 1, reverted: 0, revert_rate: 0 });
  assert.deepEqual(s.by_via.unknown, { writes: 1, saved: 1, reverted: 0, revert_rate: 0 });
  assert.equal(Object.keys(s).includes("author"), false, "no author is kept");
});
