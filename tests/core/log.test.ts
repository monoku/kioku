import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSince, writesSince } from "../../src/core/log.ts";
import { isolateGit } from "../remotes.ts";
import { sh, world as shared, type World } from "../world.ts";
import { scratch as scratchIn } from "../fixtures.ts";

isolateGit();

const scratch = scratchIn("log");

test("--since: today and yesterday from local midnight, a date, a span; anything else is refused", () => {
  const now = new Date(2026, 9, 8, 15, 30);
  assert.deepEqual(parseSince("today", now), new Date(2026, 9, 8));
  assert.deepEqual(parseSince("yesterday", now), new Date(2026, 9, 7));
  assert.deepEqual(parseSince("2026-10-01", now), new Date(2026, 9, 1));
  assert.deepEqual(parseSince("12h", now), new Date(2026, 9, 8, 3, 30));
  assert.deepEqual(parseSince("3d", now), new Date(now.getTime() - 3 * 86_400_000));
  assert.deepEqual(parseSince("2w", now), new Date(now.getTime() - 14 * 86_400_000));
  for (const bad of ["2026-13-01", "2026-02-30", "last week", "3 days", ""])
    assert.equal(parseSince(bad, now), undefined, bad);
});

test("a brain's writes: the page each verb is about, what a supersede replaced; other commits and other folders left out", () =>
  scratch((dir) => {
    const repo = join(dir, "repo");
    const brain = join(repo, "brains/acme");
    mkdirSync(join(brain, "memory"), { recursive: true });
    mkdirSync(join(brain, "knowledge/acme/decisions"), { recursive: true });
    mkdirSync(join(brain, "skills"), { recursive: true });
    sh(dir, "init", "-q", "-b", "main", repo);
    const commit = (message: string, files: Record<string, string | null>) => {
      for (const [rel, text] of Object.entries(files)) {
        if (text === null) rmSync(join(repo, rel));
        else writeFileSync(join(repo, rel), text);
      }
      sh(repo, "add", "-A");
      sh(repo, "commit", "-q", "-m", message);
    };
    commit("Create the project brain acme", { "brains/acme/INDEX.md": "# acme\n" });
    commit("save: Old decision", { "brains/acme/knowledge/acme/decisions/old.md": "old\n" });
    commit("save: Tests touch the database", { "brains/acme/memory/db.md": "when\n" });
    commit("update: Tests touch the database", { "brains/acme/memory/db.md": "when, twice\n" });
    commit("supersede: New decision (replaces Old decision)", {
      "brains/acme/knowledge/acme/decisions/new.md": "new\n",
      "brains/acme/knowledge/acme/decisions/old.md": "old, replaced\n",
    });
    commit("evolve: Run database tests serially", {
      "brains/acme/skills/serial.md": "steps\n",
      "brains/acme/memory/db.md": "when, evolved\n",
    });
    commit("forget: Old decision\n\nKioku-Via: claude-code", { "brains/acme/knowledge/acme/decisions/old.md": null });
    commit("Fix a typo by hand", { "brains/acme/memory/db.md": "when, evolved.\n" });
    commit("save: Elsewhere", { "README.md": "outside the brain\n" });

    const writes = writesSince(brain, new Date(0));
    assert.deepEqual(
      writes.map((w) => [w.verb, w.title, w.path, w.replaces]),
      [
        ["forget", "Old decision", "knowledge/acme/decisions/old.md", undefined],
        ["evolve", "Run database tests serially", "skills/serial.md", undefined],
        ["supersede", "New decision", "knowledge/acme/decisions/new.md", "Old decision"],
        ["update", "Tests touch the database", "memory/db.md", undefined],
        ["save", "Tests touch the database", "memory/db.md", undefined],
        ["save", "Old decision", "knowledge/acme/decisions/old.md", undefined],
      ],
    );
    assert.deepEqual(
      writes.map((w) => w.via),
      ["claude-code", null, null, null, null, null],
      "how it arrived, from the trailer; null for a commit that has none",
    );
    assert.match(writes[0]!.commit, /^[0-9a-f]{7,}$/);
    assert.ok(!Number.isNaN(Date.parse(writes[0]!.date)));
    assert.deepEqual(writesSince(brain, new Date(Date.now() + 60_000)), [], "nothing after now");
    assert.deepEqual(writesSince(join(dir, "not-a-repo"), new Date(0)), []);
  }));

type Kioku = (
  argv: string[],
  o?: { stdin?: string; tty?: boolean; now?: Date },
) => Promise<{ code: number; out: any; raw: string }>;
const world = <T>(fn: (w: World, k: Kioku) => Promise<T>) =>
  shared((w) =>
    fn(w, (argv, o = {}) =>
      w.kioku(argv, { stdin: o.stdin ?? "", tty: o.tty ?? false, ...(o.now && { context: { now: () => o.now! } }) }),
    ),
  );

const MEM =
  "## What happened\n\nThe tests touched the database in parallel and failed.\n\n## Lesson\n\nRun them serially.\n\n## Rule of thumb\n\nStaging deploys wait for a green build.\n";

test("kioku brain log: today's writes of the chain, newest first, by brain; --brain narrows; --since reaches back", () =>
  world(async (w, k) => {
    const saved = await k(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "memory",
        "--title",
        "Staging deploys wait for a green build",
        "--source",
        "https://x.io",
        "--summary",
        "Serially.",
      ],
      { stdin: MEM },
    );
    assert.equal(saved.out.status, "done", saved.raw);
    const mine = await k(
      [
        "page",
        "save",
        "--brain",
        "personal",
        "--kind",
        "memory",
        "--title",
        "Prefers pnpm over npm",
        "--source",
        "https://x.io",
        "--summary",
        "pnpm.",
      ],
      { stdin: MEM },
    );
    assert.equal(mine.out.status, "done", mine.raw);
    sh(w.acme, "commit", "-q", "--allow-empty", "-m", "A commit made by hand");

    const r = await k(["brain", "log"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(Object.keys(r.out), ["since", "writes", "total", "offset", "limit", "next"]);
    assert.deepEqual([r.out.total, r.out.offset, r.out.limit, r.out.next], [2, 0, 20, null]);
    assert.deepEqual(
      r.out.writes
        .map((x: { verb: string; brain: string; title: string; path: string }) => [x.verb, x.brain, x.title, x.path])
        .sort(),
      [
        ["save", "northwind/brain-acme", "Staging deploys wait for a green build", saved.out.path],
        ["save", "sam/brain", "Prefers pnpm over npm", mine.out.path],
      ].sort(),
    );
    assert.ok(Date.parse(r.out.writes[0].date) >= Date.parse(r.out.writes[1].date), "newest first");
    assert.equal(r.out.writes[0].author, "Sam");

    assert.deepEqual(
      (await k(["brain", "log", "--brain", "northwind/brain-acme"])).out.writes.map((x: { title: string }) => x.title),
      ["Staging deploys wait for a green build"],
    );
    const text = await k(["brain", "log", "--brain", "northwind/brain-acme"], { tty: true });
    assert.match(
      text.raw,
      /Staging deploys wait for a green build +save · northwind\/brain-acme · \d{4}-\d\d-\d\d \d\d:\d\d\n  memory\/staging-deploys-wait-for-a-green-build\.md · Sam/,
    );

    const first = await k(["brain", "log", "--limit", "1"]);
    assert.deepEqual(
      [first.out.writes.length, first.out.total, first.out.offset, first.out.limit, first.out.next],
      [1, 2, 0, 1, 1],
    );
    const next = await k(["brain", "log", "--limit", "1", "--offset", "1"]);
    assert.deepEqual(
      next.out.writes.map((x: { commit: string }) => x.commit),
      [r.out.writes[1].commit],
      "--offset reads on",
    );
    assert.match((await k(["brain", "log", "--limit", "1"], { tty: true })).raw, /… 1 more: --offset 1/);

    const later = new Date(Date.now() + 3 * 86_400_000);
    assert.deepEqual((await k(["brain", "log"], { now: later })).out.writes, [], "three days later, nothing today");
    assert.match((await k(["brain", "log"], { now: later, tty: true })).raw, /^Nothing written since /);
    assert.equal((await k(["brain", "log", "--since", "1w"], { now: later })).out.writes.length, 2);
    const bad = await k(["brain", "log", "--since", "last week"]);
    assert.equal(bad.out.error.code, "usage");
    assert.match(bad.out.error.message, /--since takes today, yesterday/);
  }));
