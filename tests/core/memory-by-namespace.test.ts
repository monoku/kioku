import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lastTouched } from "../../src/core/touched.ts";
import { made, MEMORY, sh, validPages } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const ACME = "northwind/brain-acme";
const terminal = { context: { interactive: true } };
const LESSON = "run-migrations-before-the-deploy.md";
const HABIT = "run-database-tests-serially.md";
const POSTGRES = "knowledge/acme/decisions/postgres-over-mysql.md";
/** The day the pages were last changed before the brain was raised, long before the test runs. */
const THEN = "2026-01-05";
const LESSON_BODY = "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n";

/** The project brain with every page of the fixture, a Memory and an instinct among them. */
const withMemory = { acmePages: validPages() };

/**
 * The project brain as a tool before `format: 3` left it (§3.1): `format: 2`, its Memory pages in `memory/` and
 * `memory/instincts/` whatever their namespace, committed long ago and published.
 */
function asFormat2(w: World): void {
  const move = (from: string, to: string) => {
    mkdirSync(dirname(join(w.acme, to)), { recursive: true });
    renameSync(join(w.acme, from), join(w.acme, to));
  };
  for (const f of readdirSync(join(w.acme, "memory/acme/instincts")))
    move(`memory/acme/instincts/${f}`, `memory/instincts/${f}`);
  for (const f of readdirSync(join(w.acme, "memory/acme")).filter((n) => n.endsWith(".md")))
    move(`memory/acme/${f}`, `memory/${f}`);
  const yaml = join(w.acme, "kioku.yaml");
  writeFileSync(yaml, readFileSync(yaml, "utf8").replace(/^format: \d+$/m, "format: 2"));
  sh(w.acme, "add", "-A");
  const at = `${THEN}T12:00:00`;
  execFileSync("git", ["-C", w.acme, "commit", "-q", "-m", "As format 2 left it"], {
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
  sh(w.acme, "push", "-q", "origin", "HEAD");
}

const errorsOf = async (w: World): Promise<unknown[]> =>
  (await w.kioku(["brain", "validate", ACME])).out.brains[0].findings.filter(
    (f: { severity: string }) => f.severity === "error",
  );

test("a brain of format 2 is read and written as it is: its Memory in one folder, whatever the namespace (§3.1, §3.2)", () =>
  world(async (w) => {
    asFormat2(w);
    assert.deepEqual(await errorsOf(w), []);
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        ACME,
        "--kind",
        "memory",
        "--title",
        "Deploys wait for green",
        "--source",
        "https://x.io",
      ],
      { stdin: LESSON_BODY },
    );
    assert.equal(saved.out.status, "done", saved.raw);
    assert.equal(saved.out.path, "memory/deploys-wait-for-green.md");
    assert.match(readFileSync(join(w.acme, "kioku.yaml"), "utf8"), /^format: 2$/m, "a write raises nothing");
    assert.deepEqual(await errorsOf(w), []);
  }, withMemory));

test("brain upgrade raises format 2 to 3 in one commit: each Memory in the folder of its namespace, links and a Skill's source following, its history kept (§3.1, §3.2, §3.3)", () =>
  world(async (w) => {
    asFormat2(w);
    // As a tool of format 2 wrote them: a link each way between a decision and the instinct, and a Skill evolved from it.
    const linked = await w.kioku(["page", "link", POSTGRES, `memory/instincts/${HABIT}`, "--brain", ACME]);
    assert.equal(linked.out.status, "done", linked.raw);
    const evolved = await w.kioku(["page", "evolve", `memory/instincts/${HABIT}`, "--brain", ACME]);
    assert.equal(evolved.out.status, "done", evolved.raw);
    const before = Number(sh(w.acme, "rev-list", "--count", "HEAD"));

    const r = await w.kioku(["brain", "upgrade", ACME], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.from, r.out.to, r.out.published], [2, 3, "pushed"]);
    assert.deepEqual(r.out.moved, [
      { from: `memory/instincts/${HABIT}`, to: `memory/acme/instincts/${HABIT}` },
      { from: `memory/${LESSON}`, to: `memory/acme/${LESSON}` },
    ]);
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), before + 1, "one commit");
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "format: 3, 2 memory pages in the folder of their namespace");
    assert.equal(sh(w.acme, "status", "--porcelain"), "");
    assert.equal(sh(w.bare.acme, "rev-parse", "HEAD"), sh(w.acme, "rev-parse", "HEAD"), "published");

    assert.match(readFileSync(join(w.acme, "kioku.yaml"), "utf8"), /^format: 3$/m);
    assert.ok(existsSync(join(w.acme, `memory/acme/${LESSON}`)));
    assert.ok(existsSync(join(w.acme, `memory/acme/instincts/${HABIT}`)));
    assert.ok(!existsSync(join(w.acme, `memory/${LESSON}`)));
    assert.ok(!existsSync(join(w.acme, "memory/instincts")), "the folder the instincts left is gone");

    // Every link arrives: the validator and lint find nothing, and each side says the new path.
    assert.deepEqual(await errorsOf(w), []);
    assert.deepEqual((await w.kioku(["brain", "lint", ACME])).out.brains[0].brokenLinks, []);
    assert.match(
      readFileSync(join(w.acme, POSTGRES), "utf8"),
      /\(\.\.\/\.\.\/\.\.\/memory\/acme\/instincts\/run-database-tests-serially\.md\)/,
      "a page that linked to a Memory links to where it is",
    );
    const instinct = readFileSync(join(w.acme, `memory/acme/instincts/${HABIT}`), "utf8");
    assert.match(instinct, /\(\.\.\/\.\.\/\.\.\/knowledge\/acme\/decisions\/postgres-over-mysql\.md\)/);
    assert.match(instinct, /\(\.\.\/\.\.\/\.\.\/skills\/run-database-tests-serially\.md\)/);
    assert.match(instinct, /^namespace: acme$/m, "its fields stay");
    assert.match(
      readFileSync(join(w.acme, "skills/run-database-tests-serially.md"), "utf8"),
      /^source: "?memory\/acme\/instincts\/run-database-tests-serially\.md"?$/m,
      "a Skill says where the instinct it came from is",
    );

    // The move is no touch (§3.3): a page says the day it was last changed, and its history reaches before the move.
    assert.equal(lastTouched(w.acme).get(`memory/acme/${LESSON}`), THEN);
    const shown = await w.kioku(["page", "show", `memory/acme/${LESSON}`, "--brain", ACME]);
    assert.equal(shown.out.touched, THEN);
    assert.deepEqual(
      shown.out.history.map((h: { message: string }) => h.message).slice(0, 2),
      ["format: 3, 2 memory pages in the folder of their namespace", "As format 2 left it"],
      "the commits before the move are its own",
    );

    // What is saved from now on goes to its namespace's folder, and a second upgrade has nothing to do.
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        ACME,
        "--kind",
        "memory",
        "--title",
        "Deploys wait for green",
        "--source",
        "https://x.io",
      ],
      { stdin: LESSON_BODY },
    );
    assert.equal(saved.out.path, "memory/acme/deploys-wait-for-green.md", saved.raw);
    const again = await w.kioku(["brain", "upgrade", ACME], terminal);
    assert.deepEqual([again.out.from, again.out.to, again.out.commit], [3, 3, undefined]);
  }, withMemory));

test("brain upgrade refuses, touching nothing, while a Memory names no namespace of the brain, and says which and how (§3.2)", () =>
  world(async (w) => {
    asFormat2(w);
    const page = join(w.acme, `memory/${LESSON}`);
    writeFileSync(page, readFileSync(page, "utf8").replace("namespace: acme", "namespace: ghost"));
    sh(w.acme, "commit", "-q", "-am", "A namespace nobody declared");
    const head = sh(w.acme, "rev-parse", "HEAD");

    const r = await w.kioku(["brain", "upgrade", ACME], terminal);
    assert.equal(r.code, 2, r.raw);
    assert.equal(r.out.error.code, "memory_unplaced");
    assert.match(
      r.out.error.message,
      /stays in format 2, and nothing was written.*1 page has none to go to: memory\/run-migrations-before-the-deploy\.md \(namespace ghost, which the brain does not declare\)/,
    );
    assert.match(r.out.error.message, /kioku page move <path> --namespace <namespace> --brain northwind\/brain-acme/);
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head, "no commit");
    assert.equal(sh(w.acme, "status", "--porcelain"), "", "no file touched");
    assert.match(readFileSync(join(w.acme, "kioku.yaml"), "utf8"), /^format: 2$/m);
    assert.ok(existsSync(join(w.acme, `memory/instincts/${HABIT}`)), "none moved, the placed ones included");

    // Given a namespace of the brain, which in format 2 moves no file, the brain is raised.
    const moved = await w.kioku(["page", "move", `memory/${LESSON}`, "--namespace", "acme", "--brain", ACME], terminal);
    assert.equal(moved.out.status, "done", moved.raw);
    assert.equal(moved.out.path, `memory/${LESSON}`);
    const raised = await w.kioku(["brain", "upgrade", ACME], terminal);
    assert.deepEqual([raised.out.from, raised.out.to], [2, 3], raised.raw);
    assert.ok(existsSync(join(w.acme, `memory/acme/${LESSON}`)));
    assert.deepEqual(await errorsOf(w), []);
  }, withMemory));

test("sync moves to its namespace's folder a Memory a teammate saved before the brain was raised and published after (§3.2)", () =>
  world(async (w) => {
    // A teammate's clone, where a page was saved in the one folder format 2 kept and pushed once the brain was raised.
    const mate = join(w.dir, "mate");
    execFileSync("git", ["clone", "-q", w.bare.acme, mate]);
    const late = made({ n: 70, type: MEMORY, title: "Late lesson", format: 2 });
    assert.equal(late.path, "memory/late-lesson.md");
    writeFileSync(join(mate, late.path), late.text);
    sh(mate, "add", "-A");
    sh(mate, "commit", "-q", "-m", "save: Late lesson");
    sh(mate, "push", "-q", "origin", "HEAD");

    const sync = await w.kioku(["sync"]);
    assert.equal(sync.code, 0, sync.raw);
    assert.ok(existsSync(join(w.acme, "memory/acme/late-lesson.md")), "in its namespace's folder");
    assert.ok(!existsSync(join(w.acme, late.path)));
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "format: 3, 1 memory page in the folder of its namespace");
    assert.equal(sh(w.bare.acme, "rev-parse", "HEAD"), sh(w.acme, "rev-parse", "HEAD"), "and published");
    assert.deepEqual(await errorsOf(w), []);
    const head = sh(w.acme, "rev-parse", "HEAD");
    await w.kioku(["sync"]);
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head, "a brain with nothing to move gets no commit");
  }, withMemory));

test("a Memory forgotten before the brain was raised is restored in the folder of its namespace (§3.5)", () =>
  world(async (w) => {
    asFormat2(w);
    const gone = await w.kioku(["page", "forget", `memory/${LESSON}`, "--brain", ACME]);
    assert.equal(gone.out.status, "done", gone.raw);
    assert.equal((await w.kioku(["brain", "upgrade", ACME], terminal)).out.to, 3);
    const back = await w.kioku(["page", "restore", `memory/${LESSON}`, "--brain", ACME]);
    assert.equal(back.out.status, "done", back.raw);
    assert.equal(back.out.path, `memory/acme/${LESSON}`);
    assert.ok(existsSync(join(w.acme, `memory/acme/${LESSON}`)));
    assert.ok(!existsSync(join(w.acme, `memory/${LESSON}`)));
    assert.deepEqual(await errorsOf(w), []);
  }, withMemory));
