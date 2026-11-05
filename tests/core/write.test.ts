import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBrainFile, sectionBody, sectionsOf, changelogOf, evidenceOf } from "../../src/core/brain/file.ts";
import { isUlid } from "../../src/core/brain/ulid.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { readPending, pendingPath } from "../../src/core/write/pending.ts";
import { assembleBody, replaceSection, splitSections } from "../../src/core/write/body.ts";
import { put } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld as world } from "../world.ts";

isolateGit();

const commits = (root: string) => Number(sh(root, "rev-list", "--count", "HEAD"));
const clean = (root: string) => sh(root, "status", "--porcelain") === "";

const DECISION_BODY =
  "## Decision\n\nRun the migrations before the deploy, not after.\n\n## Why\n\nLast time they ran after and the deploy broke.\n\n## Consequences\n\nThe pipeline waits for the migrations.\n";
const SAVE_8 = [
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
  "no, run the migrations before the deploy, not after; last time it broke",
  "--summary",
  "Migrations run before the deploy, never after.",
];
const PATH_8 = "knowledge/acme/decisions/run-migrations-before-the-deploy.md";
const SHAPE = ["status", "brain", "path", "commit", "publication"];

test("§2.5: a decision saved in the project brain is validated, committed as the configured identity and pushed", () =>
  world(async (w) => {
    const before = commits(w.acme);
    const r = await w.kioku(SAVE_8, DECISION_BODY);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.brain, "northwind/brain-acme");
    assert.equal(r.out.path, PATH_8);
    assert.equal(r.out.publication, "pushed");
    assert.match(r.out.commit, /^[0-9a-f]{7,}$/);
    assert.ok(isUlid(r.out.id));
    // The answer says what the page is, for the session's journal (§6.1, §4.6).
    assert.deepEqual(
      [r.out.title, r.out.kind, r.out.subkind],
      ["Run migrations before the deploy", "knowledge", "decision"],
    );

    assert.equal(commits(w.acme), before + 1);
    assert.equal(
      sh(w.acme, "log", "-1", "--format=%an <%ae>|%s"),
      "Sam <sam@example.com>|save: Run migrations before the deploy",
    );
    assert.equal(sh(w.bare.acme, "rev-parse", "main"), sh(w.acme, "rev-parse", "HEAD"), "the remote has the commit");
    assert.ok(sh(w.acme, "rev-parse", "HEAD").startsWith(r.out.commit));
    assert.ok(clean(w.acme));

    const page = parseBrainFile(readFileSync(join(w.acme, PATH_8), "utf8"));
    assert.ok(page.ok);
    assert.equal(page.file.front.getString("id"), r.out.id);
    assert.equal(page.file.front.getString("created"), "2026-10-07");
    assert.equal(
      page.file.front.getString("evidence"),
      "no, run the migrations before the deploy, not after; last time it broke",
    );
    assert.deepEqual(sectionsOf(page.file.body), ["Decision", "Why", "Consequences", "Changelog"]);
    assert.deepEqual(
      validateBrain(w.acme).findings.filter((f) => f.severity === "error"),
      [],
    );
  }));

test("a brain in a format newer than the tool reads is not written to: refused before a file is touched, with exit 2 (§5.1)", () =>
  world(async (w) => {
    const yaml = join(w.acme, "kioku.yaml");
    writeFileSync(yaml, readFileSync(yaml, "utf8").replace(/format: \d+/, "format: 99"));
    sh(w.acme, "commit", "-q", "-am", "a newer tool wrote this");
    const before = commits(w.acme);
    const r = await w.kioku(SAVE_8, DECISION_BODY);
    assert.equal(r.code, 2, r.raw);
    assert.equal(r.out.status, "error");
    assert.equal(r.out.error.code, "format_newer");
    assert.match(r.out.error.message, /format 99, newer than the newest this tool reads \(2\).*run kioku update/);
    assert.equal(commits(w.acme), before);
    assert.ok(!existsSync(join(w.acme, PATH_8)));
    assert.ok(clean(w.acme));
    const search = await w.kioku(["page", "search", "migrations"]);
    assert.equal(search.code, 0, "reading goes on");
  }));

test("brain language declares the language in kioku.yaml, leaves the format, and the summary tells the agent (§3.2)", () =>
  world(async (w) => {
    const before = commits(w.acme);
    const r = await w.kioku(["brain", "language", "es", "--brain", "northwind/brain-acme"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(
      [r.out.status, r.out.language, r.out.format, r.out.publication],
      ["done", "es", undefined, "pushed"],
    );
    assert.equal(commits(w.acme), before + 1);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "language: es");
    const yaml = readFileSync(join(w.acme, "kioku.yaml"), "utf8");
    assert.match(yaml, /^format: 2$/m);
    assert.match(yaml, /^language: es$/m);
    assert.deepEqual(
      validateBrain(w.acme).findings.filter((f) => f.severity === "error"),
      [],
    );
    assert.ok(clean(w.acme));

    const again = await w.kioku(["brain", "language", "es", "--brain", "northwind/brain-acme"]);
    assert.equal(again.code, 1);
    assert.equal(again.out.error.code, "unchanged");
    const bad = await w.kioku(["brain", "language", "Spanish", "--brain", "northwind/brain-acme"]);
    assert.equal(bad.out.error.code, "usage");

    const start = await w.kioku(
      ["hook", "session-start"],
      JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }),
    );
    assert.match(JSON.stringify(start.out), /its pages are written in es/);
  }));

test("a second save on the same subject answers similar and writes nothing; with --create it fails on the existing path", () =>
  world(async (w) => {
    await w.kioku(SAVE_8, DECISION_BODY);
    const head = sh(w.acme, "rev-parse", "HEAD");

    const again = await w.kioku(SAVE_8, DECISION_BODY);
    assert.equal(again.code, 0);
    assert.equal(again.out.status, "similar");
    assert.deepEqual(Object.keys(again.out).slice(0, 5), SHAPE);
    assert.deepEqual([again.out.path, again.out.commit, again.out.publication], [null, null, null]);
    const { touched, ...similar } = again.out.similar[0];
    assert.deepEqual(similar, {
      brain: "northwind/brain-acme",
      path: PATH_8,
      title: "Run migrations before the deploy",
      kind: "knowledge",
      subkind: "decision",
      summary: "Migrations run before the deploy, never after.",
    });
    assert.match(touched, /^\d{4}-\d{2}-\d{2}$/, "the day of the commit that wrote it (§3.3)");
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head);

    const created = await w.kioku([...SAVE_8, "--create"], DECISION_BODY);
    assert.equal(created.code, 1);
    assert.equal(created.out.status, "error");
    assert.equal(created.out.error.code, "path_exists");
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head);
    assert.ok(clean(w.acme));
  }));

test("a related page on another subject is saved with --create; an unrelated one needs no flag", () =>
  world(async (w) => {
    await w.kioku(SAVE_8, DECISION_BODY);
    const related = [
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
    ];
    const first = await w.kioku(related, "## When\n\nCI is down.\n\n## Steps\n\n1. Run them.\n");
    assert.equal(first.out.status, "similar");
    const forced = await w.kioku([...related, "--create"], "## When\n\nCI is down.\n\n## Steps\n\n1. Run them.\n");
    assert.equal(forced.out.status, "done");
    const unrelated = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Office wifi password location",
        "--source",
        "https://x.io",
      ],
      "Ask the office manager; it is never written down.\n",
    );
    assert.equal(unrelated.out.status, "done", unrelated.raw);
  }));

test("a body missing a required section, or carrying a secret, is refused with the findings and the tree stays clean", () =>
  world(async (w) => {
    const head = sh(w.acme, "rev-parse", "HEAD");
    const missing = await w.kioku(SAVE_8, "## Decision\n\nBefore.\n\n## Why\n\nIt broke.\n");
    assert.equal(missing.code, 1);
    assert.equal(missing.out.status, "error");
    assert.equal(missing.out.error.code, "invalid_page");
    assert.deepEqual(
      missing.out.error.findings
        .filter((f: { severity: string }) => f.severity === "error")
        .map((f: { rule: number }) => f.rule),
      [6],
    );
    assert.equal(existsSync(join(w.acme, PATH_8)), false);

    const secret = await w.kioku(
      SAVE_8,
      DECISION_BODY.replace(
        "The pipeline waits",
        "Connect with postgres://admin:hunter2hunter2@db:5432/app; the pipeline waits",
      ),
    );
    assert.equal(secret.out.error.code, "invalid_page");
    assert.deepEqual(
      secret.out.error.findings
        .filter((f: { severity: string }) => f.severity === "error")
        .map((f: { rule: number }) => f.rule),
      [8],
    );
    assert.ok(!secret.raw.includes("hunter2"), "the refusal never echoes the secret");

    assert.equal(sh(w.acme, "rev-parse", "HEAD"), head);
    assert.ok(clean(w.acme));
  }));

test("update --section replaces that section only and appends one Changelog line", () =>
  world(async (w) => {
    const saved = await w.kioku(SAVE_8, DECISION_BODY);
    const before = parseBrainFile(readFileSync(join(w.acme, PATH_8), "utf8"));
    assert.ok(before.ok);
    const r = await w.kioku(
      ["page", "update", PATH_8, "--section", "Why"],
      "Twice the deploy ran first and the schema was behind.\n",
    );
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(Object.keys(r.out).slice(0, 5), SHAPE);
    assert.equal(r.out.publication, "pushed");
    const after = parseBrainFile(readFileSync(join(w.acme, PATH_8), "utf8"));
    assert.ok(after.ok);
    assert.equal(sectionBody(after.file.body, "Why"), "Twice the deploy ran first and the schema was behind.");
    for (const s of ["Decision", "Consequences"])
      assert.equal(sectionBody(after.file.body, s), sectionBody(before.file.body, s));
    assert.deepEqual(changelogOf(after.file), [{ date: "2026-10-07", text: "Updated Why." }]);
    assert.equal(
      after.file.front.toString(),
      before.file.front.toString(),
      "the front matter, id included, does not change",
    );
    assert.equal(after.file.front.getString("id"), saved.out.id);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "update: Run migrations before the deploy");

    const noted = await w.kioku(
      ["page", "update", PATH_8, "--section", "Consequences", "--note", "Added the rollback."],
      "The pipeline waits; a failed migration rolls back.\n",
    );
    assert.equal(noted.out.status, "done");
    const latest = parseBrainFile(readFileSync(join(w.acme, PATH_8), "utf8"));
    assert.ok(latest.ok);
    assert.equal(changelogOf(latest.file).at(-1)!.text, "Added the rollback.");
  }));

test("two writes to one page at once on one machine lose neither: the one that read it before the other wrote is refused, and run again it lands (§1.6)", () =>
  world(async (w) => {
    const rel = "memory/instincts/run-database-tests-serially.md";
    const evidence = (what: string) => [
      "page",
      "update",
      rel,
      "--brain",
      "personal",
      "--evidence",
      what,
      "--source",
      "Session 2026-10-07 in acme-billing",
    ];
    const [a, b] = await Promise.all([
      w.kioku(evidence("a deadlock in billing")),
      w.kioku(evidence("a deadlock in search")),
    ]);
    const outcomes = [a, b].map((r) => r.out.error?.code ?? r.out.status).sort();
    assert.deepEqual(outcomes, ["changed", "done"], `${a.raw}\n${b.raw}`);
    const refused = a.out.status === "done" ? b : a;
    assert.equal(refused.code, 2, "the brain refused the write");
    assert.match(refused.out.error.message, /nothing was written.*Run it again/);
    assert.equal(
      (await w.kioku(evidence(refused === a ? "a deadlock in billing" : "a deadlock in search"))).out.status,
      "done",
    );
    const after = readFileSync(join(w.sam, rel), "utf8");
    assert.match(after, /a deadlock in billing/);
    assert.match(after, /a deadlock in search/);
  }));

test("a write is not refused when what changed meanwhile is another page (§1.6)", () =>
  world(async (w) => {
    const [a, b] = await Promise.all([
      w.kioku([
        "page",
        "update",
        "memory/instincts/run-database-tests-serially.md",
        "--brain",
        "personal",
        "--evidence",
        "a deadlock in billing",
        "--source",
        "Session 2026-10-07",
      ]),
      w.kioku(["page", "confirm", "memory/prefer-small-commits.md", "--brain", "personal"]),
    ]);
    assert.equal(a.out.status, "done", a.raw);
    assert.equal(b.out.status, "done", b.raw);
  }));

test("update --evidence on an instinct adds one dated Evidence line and leaves the rest untouched", () =>
  world(async (w) => {
    const rel = "memory/instincts/run-database-tests-serially.md";
    const before = readFileSync(join(w.sam, rel), "utf8");
    const r = await w.kioku([
      "page",
      "update",
      rel,
      "--brain",
      "personal",
      "--evidence",
      "the same deadlock in billing",
      "--source",
      "Session 2026-10-07 in acme-billing",
    ]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.brain, "sam/brain");
    assert.equal(r.out.publication, "local");
    const after = readFileSync(join(w.sam, rel), "utf8");
    assert.equal(
      after,
      before.replace(/\n$/, "") + "\n- 2026-10-07: the same deadlock in billing (Session 2026-10-07 in acme-billing)\n",
    );
    const parsed = parseBrainFile(after);
    assert.ok(parsed.ok && evidenceOf(parsed.file).length === 2);
    assert.equal(sectionsOf(parsed.ok ? parsed.file.body : "").includes("Changelog"), false);

    const wrong = await w.kioku([
      "page",
      "update",
      "memory/prefer-small-commits.md",
      "--evidence",
      "x",
      "--source",
      "y",
    ]);
    assert.equal(wrong.out.error.code, "not_instinct");
    const noSource = await w.kioku(["page", "update", rel, "--brain", "sam/brain", "--evidence", "x"]);
    assert.equal(noSource.out.error.code, "usage");
  }));

test("update of a Memory corrects it in place with no Changelog; an update that changes nothing is refused", () =>
  world(async (w) => {
    const rel = "memory/prefer-small-commits.md";
    const body =
      "## What happened\n\nA big commit hid a bug.\n\n## Lesson\n\nSmall commits.\n\n## Rule of thumb\n\nOne change per commit.\n";
    const r = await w.kioku(["page", "update", rel], body);
    assert.equal(r.code, 0, r.raw);
    const text = readFileSync(join(w.sam, rel), "utf8");
    assert.ok(!text.includes("## Changelog"));
    assert.match(text, /## Lesson\n\nSmall commits\.\n/);
    const head = sh(w.sam, "rev-parse", "HEAD");
    const same = await w.kioku(["page", "update", rel], body);
    assert.equal(same.out.error.code, "unchanged");
    assert.equal(sh(w.sam, "rev-parse", "HEAD"), head);
    const summary = await w.kioku(["page", "update", rel, "--summary", "Small commits find bugs."]);
    assert.equal(summary.out.status, "done");
    assert.match(readFileSync(join(w.sam, rel), "utf8"), /^summary: Small commits find bugs\.$/m);
  }));

test("supersede writes the new decision and marks the old one, each linking to the other, in one commit", () =>
  world(async (w) => {
    const old = "knowledge/acme/decisions/postgres-over-mysql.md";
    const before = commits(w.acme);
    const r = await w.kioku(
      [
        "page",
        "supersede",
        old,
        "--title",
        "CockroachDB over Postgres",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "we move to Cockroach for the multi-region setup",
      ],
      "## Decision\n\nCockroachDB.\n\n## Why\n\nMulti-region.\n\n## Consequences\n\nA migration.\n",
    );
    assert.equal(r.code, 0, r.raw);
    const fresh = "knowledge/acme/decisions/cockroachdb-over-postgres.md";
    assert.equal(r.out.path, fresh);
    assert.equal(r.out.supersedes, old);
    assert.equal(commits(w.acme), before + 1);
    assert.equal(
      sh(w.acme, "log", "-1", "--format=%s"),
      "supersede: CockroachDB over Postgres (replaces Postgres over MySQL)",
    );
    const n = parseBrainFile(readFileSync(join(w.acme, fresh), "utf8"));
    const o = parseBrainFile(readFileSync(join(w.acme, old), "utf8"));
    assert.ok(n.ok && o.ok);
    assert.equal(n.file.front.getString("supersedes"), "./postgres-over-mysql.md");
    assert.equal(o.file.front.getString("superseded_by"), "./cockroachdb-over-postgres.md");
    assert.deepEqual(changelogOf(o.file).at(-1), {
      date: "2026-10-07",
      text: "Superseded by ./cockroachdb-over-postgres.md.",
    });
    assert.deepEqual(
      validateBrain(w.acme).findings.filter((f) => f.severity === "error"),
      [],
    );
    assert.equal(sh(w.bare.acme, "rev-parse", "main"), sh(w.acme, "rev-parse", "HEAD"));

    const twice = await w.kioku(
      ["page", "supersede", old, "--title", "Something else", "--source", "s"],
      "## Decision\n\nx\n\n## Why\n\nx\n\n## Consequences\n\nx\n",
    );
    assert.equal(twice.out.error.code, "already_superseded");
    const notDecision = await w.kioku(
      ["page", "supersede", "knowledge/acme/playbooks/migrate.md", "--title", "T", "--source", "s"],
      "x",
    );
    assert.equal(notDecision.out.error.code, "not_a_decision");
  }));

test("forget removes the page with a commit and lists the pages that linked to it", () =>
  world(async (w) => {
    const rel = "knowledge/acme/playbooks/migrate.md";
    const before = commits(w.acme);
    const r = await w.kioku(["page", "forget", rel]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(Object.keys(r.out).slice(0, 5), SHAPE);
    assert.deepEqual(r.out.linkedFrom, ["knowledge/acme/decisions/postgres-over-mysql.md"]);
    assert.equal(existsSync(join(w.acme, rel)), false);
    assert.equal(commits(w.acme), before + 1);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "forget: Migrate");
    assert.ok(clean(w.acme));
    assert.ok(sh(w.acme, "show", "HEAD~1:" + rel).includes("title: Migrate"), "git keeps it");

    const text = await w.kioku(["page", "forget", "knowledge/acme/decisions/mysql-for-acme.md"], "", true);
    assert.match(
      text.out,
      /^Forgot knowledge\/acme\/decisions\/mysql-for-acme\.md in northwind\/brain-acme \(commit [0-9a-f]+, published\)\.\nThese pages linked to it: knowledge\/acme\/decisions\/postgres-over-mysql\.md\.\n$/,
    );
    assert.equal(
      (await w.kioku(["page", "forget", "BRAIN.md", "--brain", "northwind/brain-acme"])).out.error.code,
      "not_a_page",
    );
    assert.equal((await w.kioku(["page", "forget", "memory/nothing.md"])).out.error.code, "not_found");
  }));

test("with the remote unreachable a shared save commits and is pending; the next push clears it; the personal brain is local", () =>
  world(async (w) => {
    const away = `${w.bare.acme}.away`;
    renameSync(w.bare.acme, away);
    const r = await w.kioku(SAVE_8, DECISION_BODY);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.publication, "pending");
    assert.ok(existsSync(join(w.acme, PATH_8)));
    const pending = readPending(w.home);
    assert.deepEqual(Object.keys(pending), ["northwind/brain-acme"]);
    assert.equal(pending["northwind/brain-acme"]!.path, w.acme);
    assert.ok(existsSync(pendingPath(w.home)));
    const text = await w.kioku(["page", "update", PATH_8, "--section", "Why"], "Because.\n", true);
    assert.match(text.out, /publication pending; sync retries it/);
    assert.equal(
      readPending(w.home)["northwind/brain-acme"]!.since,
      pending["northwind/brain-acme"]!.since,
      "the first failure's time is kept",
    );

    renameSync(away, w.bare.acme);
    const next = await w.kioku(["page", "update", PATH_8, "--section", "Consequences"], "None.\n");
    assert.equal(next.out.publication, "pushed");
    assert.deepEqual(readPending(w.home), {});
    assert.equal(
      sh(w.bare.acme, "rev-parse", "main"),
      sh(w.acme, "rev-parse", "HEAD"),
      "every pending commit went out",
    );

    const personal = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "personal",
        "--kind",
        "memory",
        "--title",
        "Coffee before standup",
        "--source",
        "https://x.io",
      ],
      "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n",
    );
    assert.equal(personal.out.status, "done", personal.raw);
    assert.equal(personal.out.brain, "sam/brain");
    assert.equal(personal.out.publication, "local");
    assert.deepEqual(readPending(w.home), {});
  }));

test("a push after someone else's push rebases on it", () =>
  world(async (w) => {
    const other = join(w.home, "other");
    execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain-acme.git", other]);
    writeFileSync(join(other, "BRAIN.md"), "# acme\n\nEdited elsewhere.\n");
    sh(other, "commit", "-q", "-am", "edit elsewhere");
    sh(other, "push", "-q", "origin", "main");
    const r = await w.kioku(SAVE_8, DECISION_BODY);
    assert.equal(r.out.publication, "pushed", r.raw);
    assert.equal(
      sh(w.bare.acme, "log", "--format=%s", "-2", "main"),
      "save: Run migrations before the deploy\nedit elsewhere",
    );
    assert.match(readFileSync(join(w.acme, "BRAIN.md"), "utf8"), /Edited elsewhere/);
  }));

test("a new instinct starts with one Evidence line", () =>
  world(async (w) => {
    const r = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "personal",
        "--kind",
        "memory",
        "--sub",
        "instinct",
        "--title",
        "Rebase before pushing a shared brain",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "the push was refused until a rebase",
      ],
      "## When\n\nA push is refused.\n\n## Do\n\nRebase, then push.\n",
    );
    assert.equal(r.out.status, "done", r.raw);
    const page = parseBrainFile(readFileSync(join(w.sam, r.out.path), "utf8"));
    assert.ok(page.ok);
    assert.deepEqual(evidenceOf(page.file), [
      { date: "2026-10-07", text: "the push was refused until a rebase", source: "Session 2026-10-07 in acme-api" },
    ]);
    assert.equal(r.out.path, "memory/instincts/rebase-before-pushing-a-shared-brain.md");
  }));

test("every verb answers with the same shape, and in one or two lines of text", () =>
  world(async (w) => {
    const outs = [
      await w.kioku(SAVE_8, DECISION_BODY),
      await w.kioku(SAVE_8, DECISION_BODY),
      await w.kioku(["page", "update", PATH_8, "--section", "Why"], "Because.\n"),
      await w.kioku(
        ["page", "supersede", PATH_8, "--title", "Migrations run in the deploy job", "--source", "https://x.io"],
        "## Decision\n\nx\n\n## Why\n\ny\n\n## Consequences\n\nz\n",
      ),
      await w.kioku(["page", "forget", "memory/prefer-small-commits.md"]),
      await w.kioku(
        ["page", "save", "--brain", "northwind/brain-acme", "--kind", "wiki", "--title", "x", "--source", "y"],
        "x",
      ),
      await w.kioku(["page", "update", "nowhere.md"]),
    ];
    for (const o of outs) assert.deepEqual(Object.keys(o.out).slice(0, 5), SHAPE, JSON.stringify(o.out));
    assert.deepEqual(
      outs.map((o) => o.out.status),
      ["done", "similar", "done", "done", "done", "error", "error"],
    );
    assert.equal(outs[5]!.out.error.code, "usage");
    assert.equal(outs[6]!.out.error.code, "not_found");

    const texts = [
      await w.kioku(
        [
          "page",
          "update",
          "memory/instincts/run-database-tests-serially.md",
          "--brain",
          "sam/brain",
          "--evidence",
          "again",
          "--source",
          "s",
        ],
        "",
        true,
      ),
      await w.kioku(
        [
          "page",
          "save",
          "--brain",
          "northwind/brain-acme",
          "--kind",
          "rule",
          "--title",
          "Run migrations before the deploy",
          "--source",
          "s",
        ],
        "## Rule\n\nx\n\n## Why\n\ny\n",
        true,
      ),
      await w.kioku(["page", "forget", "nowhere.md"], "", true),
    ];
    for (const t of texts) {
      const lines = t.out.trim().split("\n");
      assert.ok(lines.length >= 1 && lines.length <= 2, t.out);
    }
  }));

test("--brain names a brain by name or tier; a path is found in the one brain that has it, or must be named", () =>
  world(async (w) => {
    const body = "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n";
    for (const brain of ["sam/brain", "personal"]) {
      const r = await w.kioku(
        ["page", "save", "--brain", brain, "--kind", "memory", "--title", `Lesson via ${brain}`, "--source", "s"],
        body,
      );
      assert.equal(r.out.brain, "sam/brain", r.raw);
    }
    assert.equal(
      (
        await w.kioku(
          ["page", "save", "--brain", "project", "--kind", "memory", "--title", "Via tier", "--source", "s"],
          body,
        )
      ).out.brain,
      "northwind/brain-acme",
    );
    assert.equal(
      (await w.kioku(["page", "save", "--brain", "nope", "--kind", "memory", "--title", "x", "--source", "s"], body))
        .out.error.code,
      "brain_unknown",
    );
    assert.equal(
      (await w.kioku(["page", "save", "--kind", "memory", "--title", "x", "--source", "s"], body)).out.error.code,
      "usage",
    );

    // The same relative path in two brains.
    put(w.sam, "INDEX2.md", "x");
    writeFileSync(join(w.sam, "memory/same.md"), readFileSync(join(w.sam, "memory/prefer-small-commits.md"), "utf8"));
    writeFileSync(
      join(w.acme, "memory/same.md"),
      readFileSync(join(w.sam, "memory/prefer-small-commits.md"), "utf8").replace("namespace: sam", "namespace: acme"),
    );
    assert.equal((await w.kioku(["page", "forget", "memory/same.md"])).out.error.code, "ambiguous");
    const named = await w.kioku(["page", "forget", "memory/same.md", "--brain", "northwind/brain-acme"]);
    assert.equal(named.out.brain, "northwind/brain-acme", named.raw);
    const absolute = await w.kioku([
      "page",
      "update",
      join(w.sam, "memory/prefer-small-commits.md"),
      "--summary",
      "Small.",
    ]);
    assert.equal(absolute.out.brain, "sam/brain", absolute.raw);
    assert.equal(absolute.out.path, "memory/prefer-small-commits.md");
  }));

test("bodies: sections in the template's order, unknown ones after, the tool's own kept from the page", () => {
  const decision = { kind: "knowledge" as const, sub: "decision" as const };
  assert.equal(
    assembleBody(
      decision,
      "## Why\n\nw\n\n## Notes\n\nn\n\n## Decision\n\nd\n\n## Consequences\n\nc\n\n## Changelog\n\n- 2020-01-01 forged\n",
    ),
    "## Decision\n\nd\n\n## Why\n\nw\n\n## Consequences\n\nc\n\n## Notes\n\nn\n\n## Changelog\n",
  );
  assert.equal(
    assembleBody(decision, "## Decision\n\nD2\n", "## Decision\n\nD\n\n## Changelog\n\n- 2026-01-01 kept\n"),
    "## Decision\n\nD2\n\n## Changelog\n\n- 2026-01-01 kept\n",
  );
  assert.equal(assembleBody({ kind: "knowledge", sub: "context" }, "Free text.\n"), "Free text.\n\n## Changelog\n");
  assert.equal(
    replaceSection("## A\n\na\n\n## Changelog\n", "B", "## B\n\nb\n"),
    "## A\n\na\n\n## B\n\nb\n\n## Changelog\n",
  );
  assert.throws(() => replaceSection("## A\n", "Changelog", "x"), /kept by the tool/);
  assert.deepEqual(
    splitSections("```\n## not\n```\n## Real\n\nx").sections.map((s) => s.heading),
    ["Real"],
  );
});

test("each commit says how the write arrived in a Kioku-Via trailer: the host's id, terminal or agent (§1.6)", () =>
  world(async (w) => {
    const via = () => sh(w.acme, "log", "-1", "--format=%(trailers:key=Kioku-Via,valueonly,unfold)").trim();
    const subject = () => sh(w.acme, "log", "-1", "--format=%s");
    const save = (title: string, context: object) =>
      w.kioku(
        [
          "page",
          "save",
          "--brain",
          "northwind/brain-acme",
          "--kind",
          "knowledge",
          "--sub",
          "decision",
          "--title",
          title,
          "--source",
          "Session 2026-10-07 in acme-api",
          "--evidence",
          "said so",
          "--summary",
          `${title} is so.`,
          "--create",
        ],
        DECISION_BODY,
        false,
        context as never,
      );

    assert.equal((await save("Claude Code wrote this", { env: { CLAUDECODE: "1" } })).code, 0);
    assert.equal(via(), "claude-code");
    assert.equal(subject(), "save: Claude Code wrote this", "the subject is what it was");

    assert.equal((await save("A person wrote this", { interactive: true })).code, 0);
    assert.equal(via(), "terminal");

    assert.equal((await save("Some agent wrote this", {})).code, 0);
    assert.equal(via(), "agent", "no terminal, and no host recognised");

    const log = await w.kioku(["brain", "log", "--brain", "northwind/brain-acme"]);
    assert.deepEqual(
      log.out.writes.slice(0, 3).map((x: { via: string | null }) => x.via),
      ["agent", "terminal", "claude-code"],
    );
  }));

test("a machine where git knows no one still commits a page, as the person's user (§6.3)", () =>
  world(async (w) => {
    const saved = { ...process.env };
    for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"])
      delete process.env[k];
    // Git then refuses to guess an identity from the host's name, as it does on a machine with none.
    const n = Number(process.env.GIT_CONFIG_COUNT ?? "0");
    Object.assign(process.env, {
      GIT_CONFIG_COUNT: String(n + 1),
      [`GIT_CONFIG_KEY_${n}`]: "user.useConfigOnly",
      [`GIT_CONFIG_VALUE_${n}`]: "true",
    });
    try {
      const before = commits(w.acme);
      const r = await w.kioku(SAVE_8, DECISION_BODY);
      assert.equal(r.code, 0, r.raw);
      assert.equal(r.out.status, "done");
      assert.match(sh(w.acme, "log", "-1", "--format=%an <%ae>"), /^\S+ <\S+@localhost>$/);
      assert.equal(
        commits(w.acme),
        before + 1,
        "the commit git refused for want of an identity made nothing: one commit",
      );
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  }));
