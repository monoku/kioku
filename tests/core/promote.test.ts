import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld } from "../world.ts";

isolateGit();

const MEMORY = "memory/prefer-small-commits.md";
const BODY =
  "## What happened\n\nBig commits were hard to review at Acme.\n\n## Lesson\n\nKeep commits small.\n\n## Rule of thumb\n\nOne idea per commit.\n";

test("promote writes the page again in a more shared brain, retires the original, and says where it came from (§1.3)", () =>
  stdinWorld(async (w) => {
    const r = await w.kioku(["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team"], BODY);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.brain, "northwind/brain");
    assert.equal(r.out.path, "memory/prefer-small-commits.md");
    assert.deepEqual(r.out.promotedFrom, { brain: "sam/brain", path: MEMORY, action: "retired" });

    const made = readFileSync(join(w.team, "memory/prefer-small-commits.md"), "utf8");
    assert.match(made, /^source: "Promoted from sam\/brain: memory\/prefer-small-commits\.md"$/m);
    assert.match(made, /Big commits were hard to review at Acme/);
    assert.equal(sh(w.team, "log", "-1", "--format=%s"), "save: Prefer small commits");

    const original = readFileSync(join(w.sam, MEMORY), "utf8");
    assert.match(original, /^status: deprecated$/m);
    assert.equal(sh(w.sam, "log", "-1", "--format=%s"), "retire: Prefer small commits");
  }));

test("promote refuses a page that is not going up, an empty body, a Skill and a retired page", () =>
  stdinWorld(async (w) => {
    const down = await w.kioku(
      [
        "page",
        "promote",
        "knowledge/acme/decisions/postgres-over-mysql.md",
        "--brain",
        "northwind/brain-acme",
        "--to",
        "sam/brain",
      ],
      BODY,
    );
    assert.equal(down.out.error.code, "not_up");
    const same = await w.kioku(
      [
        "page",
        "promote",
        "knowledge/acme/decisions/postgres-over-mysql.md",
        "--brain",
        "northwind/brain-acme",
        "--to",
        "northwind/brain-acme",
      ],
      BODY,
    );
    assert.equal(same.out.error.code, "not_up");
    assert.equal(
      (await w.kioku(["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team"], "")).out.error.code,
      "usage",
    );
    assert.equal(
      (await w.kioku(["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team", "--keep", "--forget"], BODY))
        .out.error.code,
      "usage",
    );

    assert.equal((await w.kioku(["page", "retire", MEMORY, "--brain", "sam/brain"])).code, 0);
    assert.equal(
      (await w.kioku(["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team"], BODY)).out.error.code,
      "retired",
    );
    assert.equal(sh(w.team, "status", "--porcelain"), "", "nothing was written in the destination");
  }));

test("when the destination has pages on the same subject it returns them and changes nothing, in either brain (§1.4)", () =>
  stdinWorld(async (w) => {
    const SIM = "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n";
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "sam/brain",
        "--kind",
        "memory",
        "--title",
        "Postgres over MySQL for services",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "said so",
        "--summary",
        "Postgres",
      ],
      SIM,
    );
    assert.equal(saved.code, 0, saved.raw);
    const sam = sh(w.sam, "rev-parse", "HEAD");
    const acme = sh(w.acme, "rev-parse", "HEAD");
    const r = await w.kioku(["page", "promote", saved.out.path, "--brain", "sam/brain", "--to", "project"], SIM);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "similar");
    assert.ok(
      r.out.similar.some((s: { path: string }) => s.path === "knowledge/acme/decisions/postgres-over-mysql.md"),
    );
    assert.equal(sh(w.sam, "rev-parse", "HEAD"), sam, "the original is untouched");
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), acme, "and nothing was written");

    const created = await w.kioku(
      ["page", "promote", saved.out.path, "--brain", "sam/brain", "--to", "project", "--create"],
      SIM,
    );
    assert.equal(created.out.status, "done");
  }));

test("--forget deletes the original; --keep leaves it as it was; --evidence and --title and --namespace are the destination's (§1.3)", () =>
  stdinWorld(async (w) => {
    const kept = await w.kioku(
      [
        "page",
        "promote",
        MEMORY,
        "--brain",
        "sam/brain",
        "--to",
        "team",
        "--keep",
        "--title",
        "Small commits at Northwind",
        "--evidence",
        "ana: keep commits small",
        "--namespace",
        "northwind",
      ],
      BODY,
    );
    assert.equal(kept.code, 0, kept.raw);
    assert.equal(kept.out.promotedFrom.action, "kept");
    assert.doesNotMatch(readFileSync(join(w.sam, MEMORY), "utf8"), /status:/);
    const made = readFileSync(join(w.team, "memory/small-commits-at-northwind.md"), "utf8");
    assert.match(made, /^title: Small commits at Northwind$/m);
    assert.match(made, /^evidence: "ana: keep commits small"$/m);

    const gone = await w.kioku(
      ["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team", "--forget", "--title", "Review fast"],
      BODY,
    );
    assert.equal(gone.code, 0, gone.raw);
    assert.equal(gone.out.promotedFrom.action, "forgotten");
    assert.ok(!existsSync(join(w.sam, MEMORY)));
  }));

test("a secret in the new body is refused by the destination and the original stays as it was", () =>
  stdinWorld(async (w) => {
    const r = await w.kioku(
      ["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team"],
      `${BODY}\nToken: ghp_abcdefghijklmnopqrstuvwxyz0123456789ab\n`,
    );
    assert.equal(r.out.status, "error");
    assert.equal(r.out.error.code, "invalid_page");
    assert.doesNotMatch(readFileSync(join(w.sam, MEMORY), "utf8"), /status:/);
    assert.ok(!existsSync(join(w.team, MEMORY)));
  }));
