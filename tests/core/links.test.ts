import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changelogOf, parseBrainFile, sectionBody, sectionsOf } from "../../src/core/brain/file.ts";
import { writtenBy } from "../../src/core/brains/agents-md.ts";
import { ingestCommand } from "../../src/harness/claude-code-files.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { entriesFor } from "../../src/core/session/journal.ts";
import { lastTouched } from "../../src/core/touched.ts";
import { seeAlsoEntries } from "../../src/core/write/body.ts";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld as world } from "../world.ts";

isolateGit();

/** The targets of a page's See also, as written. */
const seeAlsoOf = (body: string): string[] => seeAlsoEntries(body).map((e) => e.target);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECISION_BODY =
  "## Decision\n\nRun the migrations before the deploy, not after.\n\n## Why\n\nLast time they ran after and the deploy broke.\n\n## Consequences\n\nThe pipeline waits for the migrations.\n";
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
  "Session 2026-10-07 in acme-api",
  "--evidence",
  "no, run the migrations before the deploy, not after",
  "--summary",
  "Migrations run before the deploy, never after.",
];
const DECISION = "knowledge/acme/decisions/run-migrations-before-the-deploy.md";
const PLAYBOOK_BODY = "## When\n\nCI is down.\n\n## Steps\n\n1. Run them.\n";
const RELATED = [
  "page",
  "save",
  "--brain",
  "northwind/brain-acme",
  "--kind",
  "knowledge",
  "--sub",
  "playbook",
  "--title",
  "Run migrations before the deploy by hand",
  "--source",
  "https://x.io",
  "--summary",
  "By hand.",
];
const PLAYBOOK = "knowledge/acme/playbooks/run-migrations-before-the-deploy-by-hand.md";
const MIGRATE = "knowledge/acme/playbooks/migrate.md";
const POSTGRES = "knowledge/acme/decisions/postgres-over-mysql.md";

const page = (root: string, rel: string) => {
  const parsed = parseBrainFile(readFileSync(join(root, rel), "utf8"));
  assert.ok(parsed.ok, rel);
  return parsed.file;
};

test("§3.3: a page created beside similar ones links to them under See also, before the tool's sections; --see-also narrows the list or empties it", () =>
  world(async (w) => {
    await w.kioku(SAVE, DECISION_BODY);
    assert.equal((await w.kioku(RELATED, PLAYBOOK_BODY)).out.status, "similar");

    const created = await w.kioku([...RELATED, "--create"], PLAYBOOK_BODY);
    assert.equal(created.out.status, "done", created.raw);
    const playbook = page(w.acme, PLAYBOOK);
    assert.deepEqual(sectionsOf(playbook.body), ["When", "Steps", "See also", "Changelog"]);
    assert.equal(
      sectionBody(playbook.body, "See also"),
      "- [Run migrations before the deploy](../decisions/run-migrations-before-the-deploy.md)",
    );
    assert.deepEqual(seeAlsoOf(playbook.body), ["../decisions/run-migrations-before-the-deploy.md"]);

    await w.kioku(["page", "forget", PLAYBOOK, "--brain", "northwind/brain-acme"]);
    const narrowed = await w.kioku([...RELATED, "--create", "--see-also", MIGRATE], PLAYBOOK_BODY);
    assert.equal(narrowed.out.status, "done", narrowed.raw);
    assert.equal(sectionBody(page(w.acme, PLAYBOOK).body, "See also"), "- [Migrate](./migrate.md)");

    await w.kioku(["page", "forget", PLAYBOOK, "--brain", "northwind/brain-acme"]);
    const none = await w.kioku([...RELATED, "--create", "--see-also", "none"], PLAYBOOK_BODY);
    assert.equal(none.out.status, "done", none.raw);
    assert.deepEqual(sectionsOf(page(w.acme, PLAYBOOK).body), ["When", "Steps", "Changelog"]);

    const missing = await w.kioku(
      [...RELATED, "--create", "--see-also", "knowledge/acme/playbooks/nope.md"],
      PLAYBOOK_BODY,
    );
    assert.deepEqual([missing.out.status, missing.out.error.code], ["error", "not_found"]);
    const without = await w.kioku([...RELATED, "--see-also", MIGRATE], PLAYBOOK_BODY);
    assert.deepEqual([without.out.status, without.out.error.code], ["error", "usage"], "--see-also goes with --create");
  }));

test("lint does not report two similar pages that link to each other; it does once the link is gone (§4.4)", () =>
  world(async (w) => {
    await w.kioku(SAVE, DECISION_BODY);
    const created = await w.kioku([...RELATED, "--create"], PLAYBOOK_BODY);
    assert.equal(created.out.status, "done", created.raw);
    const pairs = (r: { out: any }) => r.out.brains[0].similar.map((p: { a: string; b: string }) => `${p.a} ~ ${p.b}`);
    assert.ok(
      !pairs(await w.kioku(["brain", "lint", "northwind/brain-acme"])).includes(`${DECISION} ~ ${PLAYBOOK}`),
      "linked by See also: seen and kept apart",
    );
    const cleared = await w.kioku(
      ["page", "update", PLAYBOOK, "--brain", "northwind/brain-acme", "--section", "See also"],
      "- [Migrate](./migrate.md)\n",
    );
    assert.equal(cleared.out.status, "done", cleared.raw);
    assert.ok(
      pairs(await w.kioku(["brain", "lint", "northwind/brain-acme"])).includes(`${DECISION} ~ ${PLAYBOOK}`),
      "no longer linked: back on the list",
    );
  }));

test("kioku page link: each page under the other's See also, a Changelog line where the kind has one, one commit, pushed; a second link is refused; the journal and the log see it", () =>
  world(async (w) => {
    await w.kioku(SAVE, DECISION_BODY);
    const before = Number(sh(w.acme, "rev-list", "--count", "HEAD"));
    const r = await w.kioku(["page", "link", DECISION, MIGRATE, "--brain", "northwind/brain-acme"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(
      [r.out.status, r.out.brain, r.out.path, r.out.to, r.out.publication],
      ["done", "github.com/northwind/brain-acme", DECISION, MIGRATE, "pushed"],
    );
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), before + 1);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "link: Run migrations before the deploy <-> Migrate");

    const decision = page(w.acme, DECISION);
    const migrate = page(w.acme, MIGRATE);
    assert.equal(sectionBody(decision.body, "See also"), "- [Migrate](../playbooks/migrate.md)");
    assert.equal(
      sectionBody(migrate.body, "See also"),
      "- [Run migrations before the deploy](../decisions/run-migrations-before-the-deploy.md)",
    );
    assert.deepEqual(sectionsOf(migrate.body), ["When", "Steps", "See also", "Changelog"]);
    assert.equal(
      changelogOf(migrate).at(-1)!.text,
      "Linked to [Run migrations before the deploy](../decisions/run-migrations-before-the-deploy.md).",
    );

    const again = await w.kioku(["page", "link", MIGRATE, DECISION, "--brain", "northwind/brain-acme"]);
    assert.deepEqual([again.out.status, again.out.error.code], ["error", "already_linked"]);
    const self = await w.kioku(["page", "link", MIGRATE, MIGRATE, "--brain", "northwind/brain-acme"]);
    assert.equal(self.out.error.code, "usage");
    const across = await w.kioku(["page", "link", MIGRATE, "memory/prefer-small-commits.md"]);
    assert.equal(across.out.error.code, "different_brains");

    assert.deepEqual(
      entriesFor(`kioku page link ${DECISION} ${MIGRATE} --brain northwind/brain-acme --json`, r.raw).map((e) => [
        e.what,
        e.arrow,
      ]),
      [["linked", "write"]],
      "the journal keeps the link, so its row and the footer count it",
    );
    const log = await w.kioku(["brain", "log", "--brain", "northwind/brain-acme"]);
    assert.deepEqual(log.out.writes.map((x: { verb: string; path: string }) => [x.verb, x.path]).slice(0, 1), [
      ["link", DECISION],
    ]);
  }));

test("a whole-page update keeps See also, which the agent never re-sends; update --section rewrites it (§3.3)", () =>
  world(async (w) => {
    await w.kioku(SAVE, DECISION_BODY);
    await w.kioku(["page", "link", DECISION, MIGRATE, "--brain", "northwind/brain-acme"]);
    const rewritten = await w.kioku(
      ["page", "update", DECISION, "--brain", "northwind/brain-acme"],
      DECISION_BODY.replace("not after.", "not after, ever."),
    );
    assert.equal(rewritten.out.status, "done", rewritten.raw);
    const after = page(w.acme, DECISION);
    assert.deepEqual(sectionsOf(after.body), ["Decision", "Why", "Consequences", "See also", "Changelog"]);
    assert.deepEqual(seeAlsoOf(after.body), ["../playbooks/migrate.md"]);

    const cleared = await w.kioku(
      ["page", "update", DECISION, "--brain", "northwind/brain-acme", "--section", "See also"],
      "- [Migrate](../playbooks/migrate.md)\n- [Who is who](../context/who-is-who.md)\n",
    );
    assert.equal(cleared.out.status, "done", cleared.raw);
    assert.deepEqual(seeAlsoOf(page(w.acme, DECISION).body), ["../playbooks/migrate.md", "../context/who-is-who.md"]);
  }));

test("--see-also takes brain-relative paths in any spelling and refuses what leaves the brain", () =>
  world(async (w) => {
    await w.kioku(SAVE, DECISION_BODY);
    const dotted = await w.kioku([...RELATED, "--create", "--see-also", `./${MIGRATE}`], PLAYBOOK_BODY);
    assert.equal(dotted.out.status, "done", dotted.raw);
    assert.deepEqual(seeAlsoOf(page(w.acme, PLAYBOOK).body), ["./migrate.md"]);
    await w.kioku(["page", "forget", PLAYBOOK, "--brain", "northwind/brain-acme"]);
    for (const bad of ["../brain/INDEX.md", "/etc/passwd", `knowledge/acme/playbooks/../../../kioku.yaml`]) {
      const r = await w.kioku([...RELATED, "--create", "--see-also", bad], PLAYBOOK_BODY);
      assert.equal(r.out.status, "error", bad);
      assert.ok(["not_found", "not_a_page"].includes(r.out.error.code), `${bad}: ${r.out.error.code}`);
    }
  }));

test("a link one way is completed the other way; a hand-written See also entry counts", () =>
  world(async (w) => {
    // Postgres already links to Migrate in its Consequences, not under See also; a link adds both See also entries.
    const r = await w.kioku(["page", "link", POSTGRES, MIGRATE, "--brain", "northwind/brain-acme"]);
    assert.equal(r.out.status, "done", r.raw);
    assert.deepEqual(seeAlsoOf(page(w.acme, POSTGRES).body), ["../playbooks/migrate.md"]);
    assert.deepEqual(seeAlsoOf(page(w.acme, MIGRATE).body), ["../decisions/postgres-over-mysql.md"]);
  }));

test("touched is the day of the last commit that changed a page, from git, never a field (§3.3)", () =>
  world(async (w) => {
    const touched = lastTouched(w.acme);
    assert.match(touched.get(POSTGRES)!, DAY);
    assert.equal(touched.get("nope.md"), undefined);
    await w.kioku(SAVE, DECISION_BODY);
    assert.match(lastTouched(w.acme).get(DECISION)!, DAY);
    assert.doesNotMatch(readFileSync(join(w.acme, DECISION), "utf8"), /touched/);

    const search = await w.kioku(["page", "search", "postgres", "--brain", "northwind/brain-acme"]);
    const hit = search.out.hits.find((h: { path: string }) => h.path === POSTGRES);
    assert.equal(hit.created, "2026-10-07");
    assert.match(hit.touched, DAY);
  }));

test("brain refresh writes the files the tool owns where they are missing or old, commits once, pushes; a current brain is left alone (§2.7)", () =>
  world(async (w) => {
    const warnings = () =>
      validateBrain(w.acme)
        .findings.filter((f) => f.severity === "warning")
        .map((f) => f.warning);
    rmSync(join(w.acme, "AGENTS.md"));
    rmSync(join(w.acme, "CLAUDE.md"));
    rmSync(join(w.acme, ".claude"), { recursive: true });
    mkdirSync(join(w.acme, ".github/workflows"), { recursive: true });
    writeFileSync(join(w.acme, ".github/workflows/kioku-validate.yml"), "old\n");
    sh(w.acme, "add", "-A");
    sh(w.acme, "commit", "-q", "-m", "a brain without the files the tool owns");
    assert.deepEqual(warnings(), ["agents-md-missing", "host-file-missing", "host-file-missing"]);
    const before = Number(sh(w.acme, "rev-list", "--count", "HEAD"));

    const r = await w.kioku(["brain", "refresh", "northwind/brain-acme"]);
    assert.equal(r.code, 0, r.raw);
    const [acme] = r.out.brains;
    assert.deepEqual(acme.written, ["AGENTS.md", "CLAUDE.md", ".claude/commands/ingest.md"]);
    assert.equal(
      readFileSync(join(w.acme, ".github/workflows/kioku-validate.yml"), "utf8"),
      "old\n",
      "a workflow a brain carries from before is left alone, and nothing is said of it",
    );
    assert.doesNotMatch(r.raw, /workflow/);
    assert.equal(readFileSync(join(w.acme, "BRAIN.md"), "utf8"), "# acme\n", "the front page is left alone");
    assert.ok(readFileSync(join(w.acme, "CLAUDE.md"), "utf8").startsWith("@AGENTS.md\n"));
    assert.equal(acme.publication, "pushed");
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), before + 1);
    assert.equal(
      sh(w.acme, "log", "-1", "--format=%(trailers:key=Kioku-Via,valueonly,unfold)").trim(),
      "kioku",
      "what the tool writes by itself says so (§1.6)",
    );
    assert.equal(sh(w.acme, "status", "--porcelain"), "");
    assert.deepEqual(warnings(), []);
    assert.equal(
      readFileSync(join(w.acme, ".claude/commands/ingest.md"), "utf8"),
      ingestCommand("northwind/brain-acme"),
    );

    const again = await w.kioku(["brain", "refresh", "northwind/brain-acme"]);
    assert.deepEqual([again.out.brains[0].written, again.out.brains[0].commit], [[], null]);
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), before + 1);

    const inside = await w.kioku(["brain", "refresh"], "", false, { cwd: join(w.sam, "memory") });
    assert.deepEqual(
      [inside.out.brains.length, inside.out.brains[0].brain],
      [1, "github.com/sam/brain"],
      "with no argument, the brain the folder is in",
    );
    const list = await w.kioku(["brain", "list"], "", false, { cwd: join(w.sam, "memory") });
    assert.equal(list.out.inside, "github.com/sam/brain");
    assert.equal((await w.kioku(["brain", "list"])).out.inside, null);

    // --all: every brain the machine knows and has on disk, as after an update of the tool. The tests run a build
    // that is not a release, which leaves shared brains to a release or to the person naming them (§2.7).
    rmSync(join(w.sam, "CLAUDE.md"));
    sh(w.sam, "commit", "-q", "-am", "older personal brain");
    const all = await w.kioku(["brain", "refresh", "--all"]);
    assert.equal(all.code, 0, all.raw);
    assert.deepEqual(
      all.out.brains
        .map((b: { brain: string; written: string[]; left?: string }) => [b.brain, b.written, b.left])
        .sort(),
      [
        ["github.com/northwind/brain", [], "build"],
        ["github.com/northwind/brain-acme", [], "build"],
        ["github.com/sam/brain", ["CLAUDE.md"], undefined],
      ],
      "the three brains the configuration knows; the personal one is the person's alone",
    );
    assert.equal(
      all.out.brains.find((b: { brain: string }) => b.brain === "github.com/sam/brain").publication,
      "local",
    );
    assert.equal((await w.kioku(["brain", "refresh", "northwind/brain-acme", "--all"])).out.error.code, "usage");
  }));

test("in a shared brain the files the tool owns only move forward, and a build that is not a release writes them only into a brain named (§2.7)", () =>
  world(async (w) => {
    const refresh = async (version: string, ...argv: string[]) => {
      const r = await w.kioku(["brain", "refresh", ...argv], "", false, { version });
      assert.equal(r.code, 0, r.raw);
      const text = await w.kioku(["brain", "refresh", ...argv], "", true, { version });
      return {
        acme: r.out.brains.find((b: { brain: string }) => b.brain === "github.com/northwind/brain-acme"),
        raw: text.raw,
      };
    };
    const pinned = () => writtenBy(readFileSync(join(w.acme, "AGENTS.md"), "utf8"));

    assert.ok((await refresh("1.1.0", "northwind/brain-acme")).acme.written.includes("AGENTS.md"));
    assert.equal(pinned(), "1.1.0");
    const commits = () => Number(sh(w.acme, "rev-list", "--count", "HEAD"));
    const before = commits();

    const older = await refresh("1.0.0", "--all");
    assert.deepEqual(
      [older.acme.written, older.acme.left, older.acme.held],
      [[], "newer", "1.1.0"],
      "a member not yet updated does not take it back",
    );
    assert.match(
      older.raw,
      /^northwind\/brain-acme: left as they are; kioku 1\.1\.0 wrote them, newer than 1\.0\.0\.$/m,
    );
    assert.equal((await refresh("1.0.0", "northwind/brain-acme")).acme.left, "newer", "named too: never back");

    const build = await refresh("1.2.0-dev.1", "--all");
    assert.deepEqual([build.acme.written, build.acme.left], [[], "build"], "a build is not imposed on the team");
    assert.match(
      build.raw,
      /^northwind\/brain-acme: left as they are; 1\.2\.0-dev\.1 is a build, not a release, which writes a shared brain only when it is named: kioku brain refresh northwind\/brain-acme\.$/m,
    );
    assert.equal(commits(), before);

    assert.ok(
      (await refresh("1.2.0-dev.1", "northwind/brain-acme")).acme.written.length > 0,
      "named, the person tries the build in it",
    );
    assert.equal(pinned(), "1.2.0-dev.1");
    assert.equal((await refresh("1.1.0", "--all")).acme.left, "newer", "the release before the build leaves it");
    assert.ok(
      (await refresh("1.2.0", "--all")).acme.written.length > 0,
      "the release it is a candidate for takes it on",
    );
    assert.equal(pinned(), "1.2.0");

    writeFileSync(join(w.acme, "AGENTS.md"), "edited by hand\n");
    sh(w.acme, "commit", "-q", "-am", "edit AGENTS.md");
    assert.deepEqual(
      (await refresh("1.2.0", "--all")).acme.written,
      ["AGENTS.md"],
      "the same version writes back what a person edited",
    );

    writeFileSync(join(w.acme, "AGENTS.md"), "edited by hand\n");
    sh(w.acme, "commit", "-q", "-am", "an AGENTS.md with no version");
    assert.deepEqual(
      (await refresh("1.0.0", "--all")).acme.written,
      ["AGENTS.md"],
      "when AGENTS.md names no version, it is rewritten",
    );

    assert.ok((await refresh("1.3.0", "northwind/brain-acme")).acme.written.includes("AGENTS.md"));
    assert.equal(existsSync(join(w.acme, ".github")), false, "and no workflow is ever written");
    const back = await refresh("1.2.0", "--all");
    assert.deepEqual([back.acme.written, back.acme.left, back.acme.held], [[], "newer", "1.3.0"]);
  }));

test("kioku page list lists every page with its fields, last touch and links both ways; kioku page show adds the body (§1.2, §6.1)", () =>
  world(async (w) => {
    const all = await w.kioku(["page", "list"]);
    assert.equal(all.code, 0, all.raw);
    const brains = new Set(all.out.pages.map((p: { brain: string }) => p.brain));
    assert.deepEqual([...brains].sort(), [
      "github.com/northwind/brain",
      "github.com/northwind/brain-acme",
      "github.com/sam/brain",
    ]);
    assert.ok(
      !all.out.pages.some((p: { path: string }) => p.path === "BRAIN.md" || p.path === "CLAUDE.md"),
      "front pages and CLAUDE.md are not pages",
    );

    const acme = await w.kioku(["page", "list", "--brain", "northwind/brain-acme"]);
    const postgres = acme.out.pages.find((p: { path: string }) => p.path === POSTGRES);
    assert.deepEqual(postgres.links, ["knowledge/acme/decisions/mysql-for-acme.md", MIGRATE]);
    assert.deepEqual(postgres.linkedFrom, []);
    assert.equal(postgres.supersedes, "./mysql-for-acme.md");
    assert.deepEqual(
      [postgres.kind, postgres.subkind, postgres.namespace, postgres.created],
      ["knowledge", "decision", "acme", "2026-10-07"],
    );
    assert.match(postgres.touched, DAY);
    const mysql = acme.out.pages.find((p: { path: string }) => p.path === "knowledge/acme/decisions/mysql-for-acme.md");
    assert.deepEqual(mysql.linkedFrom, [POSTGRES]);
    const migrate = acme.out.pages.find((p: { path: string }) => p.path === MIGRATE);
    assert.deepEqual(migrate.linkedFrom, [POSTGRES]);
    assert.equal(postgres.occasions, null, "only instincts count occasions");
    const instinct = all.out.pages.find((p: { subkind: string | null }) => p.subkind === "instinct");
    assert.equal(instinct.occasions, 1, instinct.path);

    const shown = await w.kioku(["page", "show", POSTGRES]);
    assert.equal(shown.code, 0, shown.raw);
    assert.equal(shown.out.title, "Postgres over MySQL");
    assert.deepEqual(shown.out.links, postgres.links);
    assert.match(shown.out.body, /^## Decision\n\nPostgres\./);
    assert.ok(shown.out.history.length >= 1, "the commits that changed the page, newest first");
    assert.match(shown.out.history[0].commit, /^[0-9a-f]{40}$/);
    assert.match(shown.out.history[0].date, DAY);
    assert.equal(shown.out.history[0].message, "init");
    assert.ok(shown.out.history[0].author.length > 0);
    const text = await w.kioku(["page", "show", POSTGRES], "", true);
    assert.match(
      text.raw,
      /^northwind\/brain-acme: knowledge\/acme\/decisions\/postgres-over-mysql\.md \(knowledge\/decision\) Postgres over MySQL · touched \d{4}-\d{2}-\d{2}\n/,
    );
    assert.match(
      text.raw,
      /\nlinks: knowledge\/acme\/decisions\/mysql-for-acme\.md, knowledge\/acme\/playbooks\/migrate\.md\n/,
    );
    assert.match(text.raw, /\nhistory:\n  \d{4}-\d{2}-\d{2}  [0-9a-f]{7}  .+: init\n$/);

    const missing = await w.kioku(["page", "show", "knowledge/acme/decisions/nope.md"]);
    assert.equal(missing.out.error.code, "not_found");
  }));
