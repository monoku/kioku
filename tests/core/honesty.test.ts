import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { entriesFor } from "../../src/core/session/journal.ts";
import { gitCalls } from "../git-shim.ts";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld as world } from "../world.ts";

isolateGit();

const MEMORY = "memory/prefer-small-commits.md";
const MIGRATE = "knowledge/acme/playbooks/migrate.md";
const WHO = "knowledge/acme/context/who-is-who.md";
const BODY =
  "## What happened\n\nBig commits were hard to review at Acme.\n\n## Lesson\n\nKeep commits small.\n\n## Rule of thumb\n\nOne idea per commit.\n";
const SAVE = [
  "page",
  "save",
  "--brain",
  "northwind/brain-acme",
  "--kind",
  "knowledge",
  "--sub",
  "decision",
  "--title",
  "Run migrations before the deploy",
  "--source",
  "https://x.io",
];
const DECISION_BODY = "## Decision\n\nBefore.\n\n## Why\n\nIt broke.\n\n## Consequences\n\nNone.\n";
const clean = (root: string) => sh(root, "status", "--porcelain") === "";

/** A git hook in the brain that refuses every commit: what a write meets when its commit cannot be made. */
function refuseCommits(root: string): void {
  const hook = join(root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'the hook says no' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
}

test("a promote whose original cannot be retired answers error with the destination's commit, brain and publication, and the journal counts the write (§1.6)", () =>
  world(async (w) => {
    refuseCommits(w.sam);
    const command = `kioku page promote ${MEMORY} --brain sam/brain --to team`;
    const r = await w.kioku(["page", "promote", MEMORY, "--brain", "sam/brain", "--to", "team"], BODY);
    assert.equal(r.code, 1);
    assert.equal(r.out.status, "error", r.raw);
    assert.equal(r.out.brain, "github.com/northwind/brain", "the destination's");
    assert.equal(r.out.path, MEMORY);
    assert.match(r.out.commit, /^[0-9a-f]{7,}$/);
    assert.equal(r.out.publication, "pushed");
    assert.match(
      r.out.error.message,
      /^the page is in northwind\/brain \(commit [0-9a-f]+\) and the original .* is still in sam\/brain as it was, but git commit failed/,
    );
    assert.equal(sh(w.team, "log", "-1", "--format=%s"), "promote: Prefer small commits".replace("promote", "save"));
    assert.equal(sh(w.team, "rev-parse", "--short", "HEAD").startsWith(r.out.commit.slice(0, 7)), true);
    assert.doesNotMatch(readFileSync(join(w.sam, MEMORY), "utf8"), /status:/, "the original is as it was");
    assert.ok(clean(w.sam));
    // The journal keeps the write, so its row and the footer count it (§1.6, §4.6).
    const entries = entriesFor(command, r.raw);
    assert.equal(entries.length, 1);
    assert.deepEqual(
      [entries[0]!.what, entries[0]!.arrow, entries[0]!.brain],
      ["promoted", "write", "github.com/northwind/brain"],
    );
  }));

/** Every file-system call that writes under `root` while `body` runs, as a shim on the file system sees them. */
async function writesUnder(root: string, body: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const names = ["openSync", "writeFileSync", "renameSync", "rmSync", "unlinkSync", "mkdirSync"] as const;
  const originals = Object.fromEntries(names.map((n) => [n, fs[n]])) as Record<(typeof names)[number], unknown>;
  for (const name of names) {
    (fs as unknown as Record<string, unknown>)[name] = (path: fs.PathLike, ...rest: unknown[]) => {
      const p = String(path);
      const writes = name !== "openSync" || (typeof rest[0] === "string" && /[wa+]/.test(rest[0]));
      if (writes && p.startsWith(root) && !p.startsWith(join(root, ".git")))
        seen.push(`${name} ${p.slice(root.length + 1)}`);
      return (originals[name] as (...a: unknown[]) => unknown)(path, ...rest);
    };
  }
  syncBuiltinESMExports();
  try {
    await body();
  } finally {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  }
  return seen;
}

test("a save the validator refuses writes no file at all, and the tree stays clean (§1.6, §5.1)", () =>
  world(async (w) => {
    const head = sh(w.acme, "rev-parse", "HEAD");
    let r: { out: { status: string; error: { code: string } } } | undefined;
    const writes = await writesUnder(w.acme, async () => {
      r = await w.kioku(SAVE, "## Decision\n\nBefore.\n\n## Why\n\nIt broke.\n");
    });
    assert.equal(r!.out.status, "error");
    assert.equal(r!.out.error.code, "invalid_page");
    assert.deepEqual(writes, [], "nothing under the brain was opened for writing, made, renamed or removed");
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head);
    assert.ok(clean(w.acme));
  }));

test("a write cut short at its commit, after its files are in place, puts them back and leaves the tree clean (§1.6)", () =>
  world(async (w) => {
    refuseCommits(w.acme);
    const head = sh(w.acme, "rev-parse", "HEAD");
    const r = await w.kioku(SAVE, DECISION_BODY);
    assert.equal(r.out.status, "error", r.raw);
    assert.match(r.out.error.message, /git commit failed/);
    assert.equal(r.out.commit, null, "no commit was made, so none is claimed");
    assert.ok(!existsSync(join(w.acme, "knowledge/acme/decisions/run-migrations-before-the-deploy.md")));
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head);
    assert.ok(clean(w.acme));
  }));

test("a conflict found when publishing carries the commit it set aside, and the journal counts the write (§1.6)", () =>
  world(async (w) => {
    // Another machine changes the same line of the same page, and pushes the moment this write pushes.
    const other = join(w.dir, "other");
    execFileSync("git", ["clone", "-q", w.bare.acme, other]);
    const theirs = readFileSync(join(other, MIGRATE), "utf8").replace(/^summary: .*$/m, "summary: Theirs.");
    writeFileSync(join(other, MIGRATE), theirs);
    sh(other, "commit", "-q", "-am", "update: Migrate");
    const command = `kioku page update ${MIGRATE} --brain northwind/brain-acme --summary Ours.`;
    let r: { code: number; raw: string; out: any } | undefined;
    const calls = await gitCalls(
      w.dir,
      async () => {
        r = await w.kioku(["page", "update", MIGRATE, "--brain", "northwind/brain-acme", "--summary", "Ours."]);
      },
      other,
    );
    assert.equal(r!.code, 1);
    assert.equal(r!.out.status, "error", r!.raw);
    assert.equal(r!.out.error.code, "conflict");
    assert.match(r!.out.commit, /^[0-9a-f]{7,}$/, "the commit exists, on the conflict's branch");
    assert.equal(r!.out.publication, null);
    assert.deepEqual([r!.out.brain, r!.out.path], ["github.com/northwind/brain-acme", MIGRATE]);
    assert.match(
      r!.out.error.message,
      /^your change was committed \([0-9a-f]+\), but it and your changes to .* could not sit on top/,
    );
    assert.doesNotMatch(r!.out.error.message, /nothing was written/);
    const branch = r!.out.error.conflict.branch as string;
    assert.match(branch, /^kioku\/conflict-/);
    assert.match(sh(w.acme, "show", `${branch}:${MIGRATE}`), /summary: Ours\./, "what was written is kept as it was");
    assert.match(
      readFileSync(join(w.acme, MIGRATE), "utf8"),
      /summary: Theirs\./,
      "the page says what the others wrote",
    );
    assert.ok(clean(w.acme));
    assert.ok(
      calls.some((c) => c.includes("\u001fpush\u001f")),
      "it did push",
    );
    assert.equal(entriesFor(command, r!.raw).length, 1);
  }));

test("retire --undo commits under its own verb: brain log and brain stats count a retire, not an update (§3.5)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["page", "retire", WHO, "--brain", "northwind/brain-acme"])).code, 0);
    const back = await w.kioku(["page", "retire", WHO, "--brain", "northwind/brain-acme", "--undo"]);
    assert.equal(back.code, 0, back.raw);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "retire: Who is who");
    const log = await w.kioku(["brain", "log", "--brain", "northwind/brain-acme"]);
    assert.deepEqual(
      log.out.writes.slice(0, 2).map((x: { verb: string }) => x.verb),
      ["retire", "retire"],
    );
    const stats = await w.kioku(["brain", "stats", "--brain", "northwind/brain-acme"]);
    const [acme] = stats.out.brains;
    assert.equal(acme.by_verb.retire, 2);
    assert.equal(acme.by_verb.update, 0);
  }));

test("a page named by its real path, through the symlinked folder its brain is under, is found with and without --brain", () =>
  world(async (w) => {
    const real = realpathSync(w.acme);
    if (real === w.acme) {
      // Nothing to tell apart here: the temporary folder is no symlink on this machine.
      return;
    }
    const shown = await w.kioku(["page", "show", join(real, MIGRATE), "--brain", "northwind/brain-acme"]);
    assert.equal(shown.out.path, MIGRATE, shown.raw);
    const found = await w.kioku(["page", "show", join(real, MIGRATE)]);
    assert.equal(found.out.path, MIGRATE, found.raw);
    const confirmed = await w.kioku(["page", "confirm", join(real, MIGRATE), "--brain", "northwind/brain-acme"]);
    assert.equal(confirmed.out.status, "done", confirmed.raw);
    // And a path that does not exist yet, under the real path, is still inside the brain.
    const missing = await w.kioku([
      "page",
      "show",
      join(real, "knowledge/acme/context/nope.md"),
      "--brain",
      "northwind/brain-acme",
    ]);
    assert.equal(typeof missing.out.error.code, "string");
    assert.doesNotMatch(missing.out.error.message, /not inside/);
  }));
