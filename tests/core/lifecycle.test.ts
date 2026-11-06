import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld } from "../world.ts";

isolateGit();

const SOURCE = ["--source", "Session 2026-10-07 in acme-api", "--evidence", "said so"];
const CTX = "knowledge/acme/context/staging-lives-in-the-bucket.md";
const save = (w: Parameters<Parameters<typeof stdinWorld>[0]>[0], title = "Staging lives in the bucket") =>
  w.kioku(
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
      title,
      "--summary",
      "Where staging data is",
      ...SOURCE,
    ],
    "## Context\n\nIn the staging bucket.\n",
  );

test("confirm records who and when without changing what the page says, and `pages` and `show` return it (§3.3)", () =>
  stdinWorld(async (w) => {
    assert.equal((await save(w)).code, 0);
    const before = readFileSync(join(w.acme, CTX), "utf8");
    const r = await w.kioku(["page", "confirm", CTX, "--note", "checked with the platform team"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.path, CTX);

    const text = readFileSync(join(w.acme, CTX), "utf8");
    assert.match(text, /^verified:\n  - by: human:sam\n    at: 2026-10-07T\d\d:\d\d:\d\dZ$/m);
    const stripped = text
      .replace(/^verified:\n(?: {2,4}.*\n)+/m, "")
      .replace(/\n- \d{4}-\d{2}-\d{2} Confirmed: .*$/m, "");
    assert.equal(stripped.trimEnd(), before.trimEnd(), "only the field and the Changelog line");
    assert.match(text, /- \d{4}-\d{2}-\d{2} Confirmed: checked with the platform team/);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "confirm: Staging lives in the bucket");

    const shown = await w.kioku(["page", "show", CTX]);
    assert.deepEqual([shown.out.verified.by, shown.out.verified.at.slice(0, 10)], ["human:sam", "2026-10-07"]);
    assert.equal(shown.out.status, null);
    const log = await w.kioku(["brain", "log", "--brain", "northwind/brain-acme"]);
    assert.equal(log.out.writes[0].verb, "confirm");
  }));

test("a confirmation restarts the clock `lint` keeps: not changed or confirmed for nine months is asked; confirming answers it (§4.4)", () =>
  stdinWorld(async (w) => {
    assert.equal((await save(w)).code, 0);
    // The page's age counts from the commit's real date, so ten months is counted from today.
    const later = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
    const asked = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", false, { now: () => later });
    const u = asked.out.brains[0].unconfirmed.filter((x: { path: string }) => x.path === CTX);
    assert.equal(u.length, 1);
    const touched = (await w.kioku(["page", "show", CTX])).out.touched;
    assert.deepEqual([u[0].since, u[0].window, u[0].days > 270], [touched, 270, true]);

    assert.equal((await w.kioku(["page", "confirm", CTX], "", false, { now: () => later })).code, 0);
    const done = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", false, { now: () => later });
    assert.deepEqual(
      done.out.brains[0].unconfirmed.filter((x: { path: string }) => x.path === CTX),
      [],
    );

    const text = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", true, {
      now: () => new Date(2028, 11, 1),
    });
    assert.match(text.raw, /pages not changed or confirmed for a long time\n/);
  }));

test("every brain asks after the same spans: a context page after 270 days, not before (§4.4)", () =>
  stdinWorld(async (w) => {
    assert.equal((await save(w)).code, 0);
    // The page's age counts from the commit's real date, so the days are counted from today.
    const after = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const asked = async (days: number): Promise<{ path: string; window: number }[]> =>
      (
        await w.kioku(["brain", "lint", "northwind/brain-acme"], "", false, { now: () => after(days) })
      ).out.brains[0].unconfirmed.filter((x: { path: string }) => x.path === CTX);
    assert.deepEqual(await asked(260), [], "within the span");
    assert.deepEqual(
      (await asked(280)).map((x) => [x.path, x.window]),
      [[CTX, 270]],
    );
  }));
test("a decision is history: lint does not ask it to be confirmed (§4.4)", () =>
  stdinWorld(async (w) => {
    const later = new Date(2030, 0, 1);
    const r = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", false, { now: () => later });
    assert.equal(r.out.brains[0].unconfirmed.filter((x: { path: string }) => x.path.includes("/decisions/")).length, 0);
  }));

test("retire keeps the page and its links, takes it out of the summary and the default search, and --undo brings it back (§3.3)", () =>
  stdinWorld(async (w) => {
    assert.equal((await save(w)).code, 0);
    await w.kioku(["sync"]);
    const found = (r: { out: any }) => r.out.hits.map((h: { path: string }) => h.path);
    assert.ok(found(await w.kioku(["page", "search", "staging", "bucket"])).includes(CTX));

    const r = await w.kioku(["page", "retire", CTX, "--reason", "staging moved to a new account"]);
    assert.equal(r.code, 0, r.raw);
    assert.match(readFileSync(join(w.acme, CTX), "utf8"), /^status: deprecated$/m);
    assert.match(readFileSync(join(w.acme, CTX), "utf8"), /Retired: staging moved to a new account/);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "retire: Staging lives in the bucket");

    assert.ok(
      !found(await w.kioku(["page", "search", "staging", "bucket"])).includes(CTX),
      "not in the default search",
    );
    const all = await w.kioku(["page", "search", "staging", "bucket", "--include-retired"]);
    const hit = all.out.hits.find((h: { path: string }) => h.path === CTX);
    assert.equal(hit.status, "deprecated");
    assert.equal((await w.kioku(["page", "show", CTX])).out.status, "deprecated");

    const again = await w.kioku(["page", "retire", CTX]);
    assert.equal(again.out.error.code, "already_retired");
    const confirm = await w.kioku(["page", "confirm", CTX]);
    assert.equal(confirm.out.error.code, "retired");

    const back = await w.kioku(["page", "retire", CTX, "--undo"]);
    assert.equal(back.code, 0, back.raw);
    assert.doesNotMatch(readFileSync(join(w.acme, CTX), "utf8"), /^status:/m);
    assert.ok(found(await w.kioku(["page", "search", "staging", "bucket"])).includes(CTX));
    assert.equal((await w.kioku(["page", "retire", CTX, "--undo"])).out.error.code, "not_retired");
  }));

test("a superseded decision is history like a retired page: out of search, back with --include-retired (§3.5)", () =>
  stdinWorld(async (w) => {
    const OLD = "knowledge/acme/decisions/run-migrations-before-the-deploy.md";
    const NEW = "knowledge/acme/decisions/run-migrations-after-the-deploy.md";
    const body = (what: string) =>
      `## Decision\n\n${what}\n\n## Why\n\nThe pipeline says so.\n\n## Consequences\n\nNone.\n`;
    const decide = (title: string, what: string) =>
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
          "--summary",
          `${title} of the migrations`,
          ...SOURCE,
        ],
        body(what),
      );
    assert.equal((await decide("Run migrations before the deploy", "Migrations run before the deploy.")).code, 0);
    const r = await w.kioku(
      [
        "page",
        "supersede",
        OLD,
        "--brain",
        "northwind/brain-acme",
        "--title",
        "Run migrations after the deploy",
        "--summary",
        "Run migrations after the deploy of the migrations",
        ...SOURCE,
      ],
      body("Migrations run after the deploy."),
    );
    assert.equal(r.code, 0, r.raw);
    assert.equal((await w.kioku(["sync"])).code, 0);

    const found = (x: { out: any }) => x.out.hits.map((h: { path: string }) => h.path);
    const hits = found(await w.kioku(["page", "search", "migrations", "deploy"]));
    assert.ok(hits.includes(NEW));
    assert.ok(!hits.includes(OLD), "the replaced decision is not in the default search");
    const all = await w.kioku(["page", "search", "migrations", "deploy", "--include-retired"]);
    assert.equal(all.out.hits.find((h: { path: string }) => h.path === OLD).status, "superseded");
    assert.equal(all.out.hits.find((h: { path: string }) => h.path === NEW).status, undefined);
  }));

test("a superseded decision that links to a retired replacement is history, not a finding of retiredLinks (§4.4)", () =>
  stdinWorld(async (w) => {
    const OLD = "knowledge/acme/decisions/run-migrations-before-the-deploy.md";
    const NEW = "knowledge/acme/decisions/run-migrations-after-the-deploy.md";
    const body = (what: string) =>
      `## Decision\n\n${what}\n\n## Why\n\nThe pipeline says so.\n\n## Consequences\n\nNone.\n`;
    await w.kioku(
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
        "Run migrations before the deploy",
        "--summary",
        "Before",
        ...SOURCE,
      ],
      body("Before."),
    );
    assert.equal(
      (
        await w.kioku(
          [
            "page",
            "supersede",
            OLD,
            "--brain",
            "northwind/brain-acme",
            "--title",
            "Run migrations after the deploy",
            "--summary",
            "After",
            ...SOURCE,
          ],
          body("After."),
        )
      ).code,
      0,
    );
    assert.equal(
      (await w.kioku(["page", "retire", NEW, "--brain", "northwind/brain-acme", "--reason", "moved to the team brain"]))
        .code,
      0,
    );
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].retiredLinks, [], "history that links to history");
    assert.ok(
      lint.out.brains[0].superseded.some((x: { path: string }) => x.path === OLD),
      "still listed as superseded",
    );
  }));

test("a retired Rule and a retired Skill leave the session summary; lint says who still links to a retired page (§4.1, §4.4)", () =>
  stdinWorld(async (w) => {
    const stdin = JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" });
    // Both parts of the summary: the Rules are in the first, the Skills in the second (§4.1).
    const summary = async () =>
      [
        (await w.kioku(["hook", "session-start"], stdin)).out.hookSpecificOutput.additionalContext,
        (await w.kioku(["hook", "session-start-holds"], stdin)).out.hookSpecificOutput.additionalContext,
      ].join("\n\n") as string;
    assert.match(await summary(), /No prod migrations from a session/);
    assert.match(await summary(), /Release a hotfix/);

    const rule = "rules/no-prod-migrations-from-a-session.md";
    const skill = "skills/release-a-hotfix.md";
    assert.equal((await w.kioku(["page", "retire", rule, "--brain", "northwind/brain-acme"])).code, 0);
    assert.equal((await w.kioku(["page", "retire", skill, "--brain", "northwind/brain-acme"])).code, 0);
    const s = await summary();
    assert.doesNotMatch(s, /No prod migrations from a session/);
    assert.doesNotMatch(s, /Release a hotfix/);

    // A page that links to a retired page is a thing to review.
    const linker = await w.kioku(
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
        "Release notes",
        "--summary",
        "Releases",
        ...SOURCE,
      ],
      `## Context\n\nSee [the hotfix skill](../../../${skill}).\n`,
    );
    assert.equal(linker.code, 0, linker.raw);
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(
      lint.out.brains[0].retiredLinks.map((l: { path: string }) => l.path),
      ["knowledge/acme/context/release-notes.md"],
    );
  }));

test("rename moves the page, keeps its id, keeps the old title as an alias, and every link and supersedes follows, in one commit (§3.3)", () =>
  stdinWorld(async (w) => {
    const decision = (title: string) => [
      "--brain",
      "northwind/brain-acme",
      "--kind",
      "knowledge",
      "--sub",
      "decision",
      "--title",
      title,
      ...SOURCE,
    ];
    const BODY = (t: string) => `## Decision\n\n${t}.\n\n## Why\n\nBecause.\n\n## Consequences\n\nNone.\n`;
    const first = await w.kioku(["page", "save", ...decision("Use REST"), "--summary", "REST"], BODY("REST"));
    const next = await w.kioku(
      [
        "page",
        "supersede",
        first.out.path,
        "--brain",
        "northwind/brain-acme",
        "--title",
        "Use gRPC",
        ...SOURCE.slice(0),
        "--summary",
        "gRPC",
      ],
      BODY("gRPC"),
    );
    assert.equal(next.code, 0, next.raw);
    const OLD = next.out.path;
    const note = await save(w, "Where the API contract lives");
    assert.equal((await w.kioku(["page", "link", note.out.path, OLD, "--brain", "northwind/brain-acme"])).code, 0);

    const before = readFileSync(join(w.acme, OLD), "utf8");
    const id = /^id: (.+)$/m.exec(before)![1];
    const commits = Number(sh(w.acme, "rev-list", "--count", "HEAD"));

    const r = await w.kioku(["page", "rename", OLD, "--title", "Use gRPC for services"]);
    assert.equal(r.code, 0, r.raw);
    const NEW = "knowledge/acme/decisions/use-grpc-for-services.md";
    assert.deepEqual([r.out.path, r.out.from], [NEW, OLD]);
    assert.ok(!existsSync(join(w.acme, OLD)));
    const moved = readFileSync(join(w.acme, NEW), "utf8");
    assert.match(moved, new RegExp(`^id: ${id}$`, "m"));
    assert.match(moved, /^title: Use gRPC for services$/m);
    assert.match(moved, /^aliases: \[Use gRPC\]$/m);
    assert.match(moved, /Renamed from "Use gRPC"\./);
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), commits + 1, "one commit");
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "rename: Use gRPC for services");

    // The decision it replaced says `superseded_by`; the note links to it in See also, with the old title as text.
    assert.match(readFileSync(join(w.acme, first.out.path), "utf8"), /^superseded_by: \.\/use-grpc-for-services\.md$/m);
    assert.match(
      readFileSync(join(w.acme, note.out.path), "utf8"),
      /- \[Use gRPC for services\]\(\.\.\/decisions\/use-grpc-for-services\.md\)/,
    );
    assert.deepEqual([...r.out.relinked].sort(), [first.out.path, note.out.path].sort());
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].brokenLinks, [], "nothing points at the old path");
    assert.equal((await w.kioku(["brain", "validate", "northwind/brain-acme"])).out.errors, 0);

    await w.kioku(["sync"]);
    const search = await w.kioku(["page", "search", "grpc"]);
    assert.ok(search.out.hits.some((h: { path: string }) => h.path === NEW));
  }));

test("rename-namespace moves the folder, the pages' namespace and the links into it in one commit; ids stay; --dry-run writes nothing", () =>
  stdinWorld(async (w) => {
    const first = await save(w);
    const second = await save(w, "Where the API contract lives");
    assert.equal(
      (await w.kioku(["page", "link", first.out.path, second.out.path, "--brain", "northwind/brain-acme"])).code,
      0,
    );
    const id = /^id: (.+)$/m.exec(readFileSync(join(w.acme, first.out.path), "utf8"))![1];
    const commits = Number(sh(w.acme, "rev-list", "--count", "HEAD"));

    const listed = await w.kioku(["namespace", "list", "--brain", "northwind/brain-acme"]);
    assert.equal(listed.code, 0, listed.raw);
    const [ns] = listed.out.brains[0].namespaces;
    assert.equal(listed.out.brains[0].namespaces.length, 1);
    assert.equal(ns.namespace, "acme");
    assert.ok(ns.pages.context >= 2);
    assert.equal(
      ns.total,
      Object.values<number>(ns.pages).reduce((a, b) => a + b, 0),
    );

    const dry = await w.kioku(["namespace", "rename", "acme", "platform", "--dry-run"]);
    assert.equal(dry.code, 0, dry.raw);
    assert.equal(dry.out.status, "dry-run");
    assert.ok(existsSync(join(w.acme, first.out.path)), "nothing moved");
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), commits);

    const r = await w.kioku(["namespace", "rename", "acme", "platform"]);
    assert.equal(r.code, 0, r.raw);
    const MOVED = first.out.path.replace("knowledge/acme/", "knowledge/platform/");
    assert.ok(!existsSync(join(w.acme, first.out.path)));
    assert.ok(existsSync(join(w.acme, MOVED)));
    assert.ok(existsSync(join(w.acme, "knowledge/platform/INDEX.md")));
    assert.ok(!existsSync(join(w.acme, "knowledge/acme")));
    assert.match(readFileSync(join(w.acme, "kioku.yaml"), "utf8"), /namespaces:\n {2}- platform\n/);
    const text = readFileSync(join(w.acme, MOVED), "utf8");
    assert.match(text, /^namespace: platform$/m);
    assert.match(text, new RegExp(`^id: ${id}$`, "m"));
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), commits + 1, "one commit");
    assert.equal((await w.kioku(["brain", "validate", "northwind/brain-acme"])).out.errors, 0);
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].brokenLinks, []);

    assert.equal((await w.kioku(["namespace", "rename", "acme", "x"])).out.error.code, "not_found");
    assert.equal((await w.kioku(["namespace", "rename", "platform", "bad name"])).out.error.code, "usage");
    assert.equal(
      (await w.kioku(["namespace", "rename", "platform", "bad/name"])).out.error.code,
      "not_found",
      "its parent is not a namespace of the brain",
    );
    assert.equal((await w.kioku(["namespace", "rename", "platform", "platform"])).out.error.code, "unchanged");
  }));

test("rename rewrites the links in the brain's other Markdown too, a namespace's INDEX.md and the front page, as move does (§3.5)", () =>
  stdinWorld(async (w) => {
    const page = await save(w, "Where the API contract lives");
    assert.equal(page.code, 0, page.raw);
    const index = join(w.acme, "knowledge/acme/INDEX.md");
    writeFileSync(
      index,
      `${readFileSync(index, "utf8")}\n## Load first\n\n- [Where the API contract lives](context/where-the-api-contract-lives.md)\n`,
    );
    writeFileSync(
      join(w.acme, "BRAIN.md"),
      `${readFileSync(join(w.acme, "BRAIN.md"), "utf8")}\nStart with [the contract](knowledge/acme/context/where-the-api-contract-lives.md).\n`,
    );
    sh(w.acme, "add", "-A");
    sh(w.acme, "commit", "-q", "-m", "the person's links");
    const commits = Number(sh(w.acme, "rev-list", "--count", "HEAD"));

    const r = await w.kioku([
      "page",
      "rename",
      page.out.path,
      "--brain",
      "northwind/brain-acme",
      "--title",
      "The API contract",
    ]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.path, "knowledge/acme/context/the-api-contract.md");
    assert.deepEqual([...r.out.relinked].sort(), ["BRAIN.md", "knowledge/acme/INDEX.md"]);
    assert.match(
      readFileSync(index, "utf8"),
      /- \[The API contract\]\((\.\/)?context\/the-api-contract\.md\)/,
      "the link and the old title as its text follow",
    );
    assert.match(
      readFileSync(join(w.acme, "BRAIN.md"), "utf8"),
      /\[the contract\]\((\.\/)?knowledge\/acme\/context\/the-api-contract\.md\)/,
      "a text of the person's own stays",
    );
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), commits + 1, "in the one commit");
    assert.deepEqual((await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].brokenLinks, []);
  }));

test("rename refuses a title already taken and one that changes nothing", () =>
  stdinWorld(async (w) => {
    const POSTGRES = "knowledge/acme/decisions/postgres-over-mysql.md";
    assert.equal(
      (await w.kioku(["page", "rename", POSTGRES, "--title", "Postgres over MySQL"])).out.error.code,
      "unchanged",
    );
    assert.equal(
      (await w.kioku(["page", "rename", POSTGRES, "--title", "MySQL for Acme"])).out.error.code,
      "path_exists",
    );
    assert.equal((await w.kioku(["page", "rename", POSTGRES])).out.error.code, "usage");
    writeFileSync(join(w.acme, "knowledge/acme/context/x.md"), "no front matter\n");
    assert.equal(
      (await w.kioku(["page", "rename", "knowledge/acme/context/x.md", "--title", "Y"])).out.error.code,
      "not_a_page",
    );
  }));
