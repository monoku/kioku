import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evidenceOf, parseBrainFile, sectionBody } from "../../src/core/brain/file.ts";
import { writesSince } from "../../src/core/log.ts";
import { statsOf } from "../../src/core/stats.ts";
import { entriesFor } from "../../src/core/session/journal.ts";
import { pagesOfJournal } from "../../src/core/handoff.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld } from "../world.ts";

isolateGit();

type World = Parameters<Parameters<typeof stdinWorld>[0]>[0];
const ACME = "northwind/brain-acme";
const SOURCE = ["--source", "Session 2026-10-07 in acme-api", "--evidence", "said so"];
const commits = (root: string) => Number(sh(root, "rev-list", "--count", "HEAD"));
const page = (root: string, rel: string) => {
  const parsed = parseBrainFile(readFileSync(join(root, rel), "utf8"));
  assert.ok(parsed.ok);
  return parsed.file;
};
const context = (w: World, title: string, aliases?: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      ACME,
      "--kind",
      "knowledge",
      "--sub",
      "context",
      "--title",
      title,
      "--summary",
      `About ${title}`,
      "--create",
      "--see-also",
      "none",
      ...(aliases === undefined ? [] : ["--aliases", aliases]),
      ...SOURCE,
    ],
    `## Context\n\n${title}.\n`,
  );
const instinct = (w: World, title: string, evidence: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      ACME,
      "--kind",
      "memory",
      "--sub",
      "instinct",
      "--title",
      title,
      "--summary",
      title,
      "--create",
      "--see-also",
      "none",
      "--source",
      "Session 2026-10-07 in acme-api",
      "--evidence",
      evidence,
    ],
    `## When\n\n${title}.\n\n## Do\n\nThe thing.\n`,
  );

test("merge makes one page of two in one commit: the id stays, the other's names become aliases, links follow and it is gone (§3.5)", () =>
  stdinWorld(async (w) => {
    const from = await context(w, "Staging bucket", "stage data");
    const into = await context(w, "Where staging lives", "staging");
    const third = await context(w, "Backups");
    const fourth = await context(w, "Retention");
    for (const r of [from, into, third, fourth]) assert.equal(r.code, 0, r.raw);
    const link = (a: string, b: string) => w.kioku(["page", "link", a, b, "--brain", ACME]);
    // The two link to each other, a third links to the one going, and that one alone links to a fourth.
    for (const [a, b] of [
      [from.out.path, into.out.path],
      [third.out.path, from.out.path],
      [from.out.path, fourth.out.path],
    ])
      assert.equal((await link(a!, b!)).code, 0);
    const before = commits(w.acme);

    const r = await w.kioku(
      ["page", "merge", from.out.path, into.out.path],
      "## Context\n\nStaging data lives in the bucket.\n",
    );
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.path, into.out.path);
    assert.equal(r.out.id, into.out.id);
    assert.equal(r.out.from, from.out.path);
    assert.deepEqual(r.out.relinked.sort(), [fourth.out.path, third.out.path].sort());
    assert.equal(commits(w.acme), before + 1);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "merge: Staging bucket (into Where staging lives)");
    assert.equal(sh(w.acme, "status", "--porcelain"), "");
    assert.equal(existsSync(join(w.acme, from.out.path)), false);

    const merged = page(w.acme, into.out.path);
    assert.deepEqual(merged.front.getList("aliases"), ["staging", "Staging bucket", "stage data"]);
    assert.match(sectionBody(merged.body, "Context")!, /lives in the bucket/);
    // Its See also: never the page that is gone nor itself; the fourth, which only the other named, once.
    assert.deepEqual(sectionBody(merged.body, "See also")!.split("\n"), [
      "- [Backups](./backups.md)",
      "- [Retention](./retention.md)",
    ]);
    assert.match(sectionBody(merged.body, "Changelog")!, /Merged with "Staging bucket"\.$/);
    assert.match(
      readFileSync(join(w.acme, third.out.path), "utf8"),
      /\[Where staging lives\]\(\.\/where-staging-lives\.md\)/,
    );
    assert.deepEqual(
      validateBrain(w.acme).findings.filter((f) => f.severity === "error"),
      [],
    );

    // The log names the page taken in, which is gone, and the one it is now part of; stats count the verb.
    const writes = writesSince(w.acme, new Date(0));
    assert.deepEqual(
      [writes[0]!.verb, writes[0]!.title, writes[0]!.path, writes[0]!.into],
      ["merge", "Staging bucket", from.out.path, "Where staging lives"],
    );
    assert.equal(statsOf(writes).by_verb.merge, 1);
    assert.equal(statsOf(writes).reverted, 0, "a page merged was not rejected");

    // The journal's entry is the page that holds both, with the one that went; a handoff no longer names that one.
    const entries = entriesFor(`kioku page merge ${from.out.path} ${into.out.path}`, r.raw);
    assert.deepEqual(
      entries.map((e) => [e.what, e.arrow, e.path, e.from]),
      [["merged", "write", into.out.path, from.out.path]],
    );
    const saved = entriesFor("kioku page save --brain x", from.raw);
    const journal = [...saved, ...entries].map((e, i) => ({ ...e, at: `2026-10-07T12:00:0${i}Z`, turn: 1 }));
    assert.deepEqual(
      pagesOfJournal(journal).map((p) => p.path),
      [into.out.path],
    );
  }));

test("merge joins the occasions of two instincts by date; it refuses two kinds, a decision, itself and no body (§3.5)", () =>
  stdinWorld(async (w) => {
    const a = await instinct(w, "Run database tests serially here", "the suite deadlocked");
    const b = await instinct(w, "Serial tests when the database is shared", "it deadlocked again");
    assert.equal(a.code, 0, a.raw);
    assert.equal(b.code, 0, b.raw);
    const r = await w.kioku(
      ["page", "merge", b.out.path, a.out.path, "--brain", ACME],
      "## When\n\nTests touch the database.\n\n## Do\n\nRun them serially.\n",
    );
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(
      evidenceOf(page(w.acme, a.out.path)).map((e) => e.text),
      ["the suite deadlocked", "it deadlocked again"],
    );

    let ctx = await context(w, "Staging bucket");
    const body = "## Context\n\nx\n";
    const said = await w.kioku(
      ["page", "merge", ctx.out.path, (await context(w, "Staging data")).out.path],
      body,
      true,
    );
    assert.match(
      said.out,
      /^Merged knowledge\/acme\/context\/staging-bucket\.md into knowledge\/acme\/context\/staging-data\.md in northwind\/brain-acme \(commit [0-9a-f]+, published\)\.\n$/,
    );
    ctx = await context(w, "Staging bucket");
    const kinds = await w.kioku(["page", "merge", ctx.out.path, a.out.path], body);
    assert.equal(kinds.out.error.code, "different_kinds");
    const decisions = await w.kioku(
      [
        "page",
        "merge",
        "knowledge/acme/decisions/mysql-for-acme.md",
        "knowledge/acme/decisions/postgres-over-mysql.md",
      ],
      body,
    );
    assert.equal(decisions.out.error.code, "is_a_decision");
    assert.equal((await w.kioku(["page", "merge", ctx.out.path, ctx.out.path], body)).out.error.code, "usage");
    const other = await context(w, "Backups");
    assert.equal((await w.kioku(["page", "merge", ctx.out.path, other.out.path], "")).out.error.code, "usage");
    assert.equal(
      (await w.kioku(["page", "merge", "memory/nothing.md", other.out.path], body)).out.error.code,
      "not_found",
    );
    assert.ok(existsSync(join(w.acme, ctx.out.path)), "a refusal writes nothing");
  }));

test("restore brings a forgotten page back as it was, in one commit, and refuses a path that is taken or was never deleted (§3.5)", () =>
  stdinWorld(async (w) => {
    const saved = await context(w, "Staging bucket", "stage data");
    const was = readFileSync(join(w.acme, saved.out.path), "utf8");
    const forgot = await w.kioku(["page", "forget", saved.out.path]);
    assert.equal(forgot.code, 0, forgot.raw);
    const before = commits(w.acme);

    // Nothing in the brain says where the page was: the brain is named.
    assert.equal((await w.kioku(["page", "restore", saved.out.path])).out.error.code, "usage");
    const r = await w.kioku(["page", "restore", saved.out.path, "--brain", ACME]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.path, saved.out.path);
    assert.equal(r.out.id, saved.out.id);
    assert.equal(r.out.title, "Staging bucket");
    assert.equal(r.out.undoes, forgot.out.commit);
    assert.equal(readFileSync(join(w.acme, saved.out.path), "utf8"), was);
    assert.equal(commits(w.acme), before + 1);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "restore: Staging bucket");
    assert.equal(sh(w.acme, "status", "--porcelain"), "");

    // A save forgotten and restored is not a reverted save.
    const writes = writesSince(w.acme, new Date(0));
    assert.deepEqual([writes[0]!.verb, writes[0]!.path], ["restore", saved.out.path]);
    const stats = statsOf(writes);
    assert.equal(stats.by_verb.restore, 1);
    assert.equal(stats.reverted, 0);
    assert.deepEqual(
      entriesFor(`kioku page restore ${saved.out.path} --brain ${ACME}`, r.raw).map((e) => [e.what, e.path]),
      [["restored", saved.out.path]],
    );

    assert.equal((await w.kioku(["page", "restore", saved.out.path, "--brain", ACME])).out.error.code, "path_exists");
    assert.equal((await w.kioku(["page", "restore", "memory/never.md", "--brain", ACME])).out.error.code, "not_found");
    assert.equal((await w.kioku(["page", "restore", "BRAIN.md", "--brain", ACME])).out.error.code, "not_a_page");
  }));

test("restore brings back a page a merge took in, and is refused when what it linked to is gone (§3.5)", () =>
  stdinWorld(async (w) => {
    const from = await context(w, "Staging bucket");
    const into = await context(w, "Where staging lives");
    const third = await context(w, "Backups");
    assert.equal((await w.kioku(["page", "link", from.out.path, third.out.path, "--brain", ACME])).code, 0);
    const merged = await w.kioku(["page", "merge", from.out.path, into.out.path], "## Context\n\nBoth.\n");
    assert.equal(merged.code, 0, merged.raw);

    const back = await w.kioku(["page", "restore", from.out.path, "--brain", ACME]);
    assert.equal(back.code, 0, back.raw);
    assert.equal(back.out.id, from.out.id);
    assert.equal(back.out.undoes, merged.out.commit);

    // Forgotten again, and then the page it linked to: as it was, it would link to nothing.
    assert.equal((await w.kioku(["page", "forget", from.out.path])).code, 0);
    assert.equal((await w.kioku(["page", "forget", third.out.path])).code, 0);
    const refused = await w.kioku(["page", "restore", from.out.path, "--brain", ACME]);
    assert.equal(refused.out.error.code, "invalid_page");
    assert.equal(existsSync(join(w.acme, from.out.path)), false);
  }));
