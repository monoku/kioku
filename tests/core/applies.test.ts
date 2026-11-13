import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { globMatches, globProblem } from "../../src/core/brain/applies.ts";
import { appliesMarkerPath } from "../../src/core/index/db.ts";
import { readJournal } from "../../src/core/session/journal.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

test("a glob of applies_to is a file, a folder and what is under it, or a pattern, inside the project folder (§3.3)", () => {
  const yes: [string, string][] = [
    ["src/billing", "src/billing/invoice.ts"],
    ["src/billing", "src/billing"],
    ["src/billing/", "src/billing/a/b.ts"],
    ["./deploy.sh", "deploy.sh"],
    ["src/billing/**", "src/billing/a/b.ts"],
    ["**/*.sql", "db/migrations/1.sql"],
    ["**/*.sql", "1.sql"],
    ["migrations/*.sql", "migrations/1.sql"],
    ["src/**/test?.ts", "src/a/b/test1.ts"],
  ];
  const no: [string, string][] = [
    ["src/billing", "src/billing2/x.ts"],
    ["*.md", "docs/a.md"],
    ["migrations/*.sql", "migrations/a/b.sql"],
    ["a.b", "aXb"],
    ["../secrets", "secrets"],
  ];
  for (const [glob, path] of yes) assert.equal(globMatches(glob, path), true, `${glob} ~ ${path}`);
  for (const [glob, path] of no) assert.equal(globMatches(glob, path), false, `${glob} !~ ${path}`);
  for (const bad of ["", "/etc/passwd", "~/.ssh", "../x", "a/../../x", "**", "**/*", "*", "a\\b"])
    assert.ok(globProblem(bad) !== undefined, bad);
  assert.equal(globProblem("src/**"), undefined);
});

const SAVE = (title: string, applies: string | undefined, brain = "northwind/brain-acme") => [
  "page",
  "save",
  "--brain",
  brain,
  "--kind",
  "memory",
  "--title",
  title,
  "--summary",
  "What to know there.",
  "--source",
  "Session 2026-11-13 in acme-api",
  "--evidence",
  "it broke last time",
  ...(applies === undefined ? [] : ["--applies-to", applies]),
  "--create",
];
const BODY = "## What happened\n\nIt broke.\n\n## Lesson\n\nMind it.\n\n## Rule of thumb\n\nCheck first.\n";

const touch = (w: World, tool: string, file: string, o: { session?: string; cwd?: string } = {}) =>
  w.kioku(["hook", "pre-tool-path"], {
    stdin: JSON.stringify({
      cwd: o.cwd ?? w.repo,
      session_id: o.session ?? "s",
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: tool === "NotebookEdit" ? { notebook_path: file } : { file_path: file },
    }),
  });
const contextOf = (r: { out: any }): string => r.out?.hookSpecificOutput?.additionalContext ?? "";
/** What a sync, a search or the next save does: the index is brought up to the brains' files (§4.3). */
const reindex = (w: World) => w.kioku(["page", "search", "billing"]);

test("save and update write applies_to as a list, refuse a glob that is none, and show answers it (§3.3)", () =>
  world(async (w) => {
    const saved = await w.kioku(SAVE("Billing rounds each line", "src/billing/**, ./db/migrations/"), { stdin: BODY });
    assert.equal(saved.out.status, "done", JSON.stringify(saved.out));
    const path: string = saved.out.path;
    const text = () => readFileSync(join(w.acme, path), "utf8");
    assert.match(
      text(),
      /^applies_to: \[src\/billing\/\*\*, db\/migrations\]$|^applies_to:\n {2}- src\/billing\/\*\*\n {2}- db\/migrations$/m,
    );
    const show = async () =>
      (await w.kioku(["page", "show", path, "--brain", "northwind/brain-acme", "--json"])).out.applies_to;
    assert.deepEqual(await show(), ["src/billing/**", "db/migrations"]);

    for (const bad of ["/etc/passwd", "../other", "**"]) {
      const r = await w.kioku(SAVE(`Another page ${bad.length}`, bad), { stdin: BODY });
      assert.equal(r.out.status, "error");
      assert.equal(r.out.error.code, "applies_to_invalid");
      assert.match(r.out.error.message, /--applies-to does not take/);
    }

    const update = (globs: string) =>
      w.kioku(["page", "update", path, "--brain", "northwind/brain-acme", "--applies-to", globs]);
    assert.equal((await update("src/checkout")).out.status, "done");
    assert.deepEqual(await show(), ["src/checkout"]);
    assert.equal((await update("none")).out.status, "done");
    assert.deepEqual(await show(), []);
    assert.doesNotMatch(text(), /applies_to/);
  }));

test("the validator warns of a glob that matches no file, and of applies_to outside a project brain (§5.1)", () =>
  world(async (w) => {
    const personal = await w.kioku(SAVE("My editor setup", "src/**", "sam/brain"), { stdin: BODY });
    assert.equal(personal.out.status, "done", JSON.stringify(personal.out));
    assert.ok(
      JSON.stringify(personal.out.warnings).includes("applies-to-not-project"),
      JSON.stringify(personal.out.warnings),
    );
    const project = await w.kioku(SAVE("Billing rounds each line", "src/billing"), { stdin: BODY });
    assert.ok(!JSON.stringify(project.out.warnings ?? []).includes("applies-to"));
    // Written by hand, past the tool: the validator names it and blocks nothing.
    const file = join(w.acme, project.out.path);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^applies_to:.*$/m, "applies_to: [/etc/passwd]"));
    const report = (await w.kioku(["brain", "validate", "northwind/brain-acme"])).out;
    assert.equal(report.errors, 0);
    assert.ok(JSON.stringify(report).includes("applies-to-invalid"));
  }));

test("a page that says which files it is about is named when the agent reads or changes one, once a session, by path (§4.6, §4.7)", () =>
  world(async (w) => {
    assert.ok(!existsSync(appliesMarkerPath(w.home)), "no page says so yet: the wrapper starts nothing");
    assert.equal(
      (await touch(w, "Read", join(w.repo, "src/billing/invoice.ts"))).raw,
      "",
      "and the hook finds nothing",
    );

    const saved = await w.kioku(SAVE("Billing rounds each line", "src/billing/**,*.sql"), { stdin: BODY });
    assert.equal(saved.out.status, "done", JSON.stringify(saved.out));
    assert.equal(
      contextOf(await touch(w, "Read", join(w.repo, "src/billing/invoice.ts"), { session: "early" })),
      "",
      "a page is named once the index has it: from the next sync, search or save",
    );
    await w.kioku(SAVE("A page about nothing in particular", undefined), { stdin: BODY });
    assert.ok(existsSync(appliesMarkerPath(w.home)), "the index marks that a page says which files it is about");

    const r = await touch(w, "Read", join(w.repo, "src/billing/invoice.ts"));
    assert.equal(r.code, 0);
    assert.equal(r.out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined, "it decides nothing about the call");
    const text = contextOf(r);
    assert.match(text, /^## Kioku: pages about this file\n/);
    assert.match(text, /`kioku page show <path> --brain <brain>` before relying on it/);
    assert.match(
      text,
      /^- Billing rounds each line: What to know there\. \(northwind\/brain-acme, memory\/billing-rounds-each-line\.md\)$/m,
    );
    assert.doesNotMatch(text, /nothing in particular|It broke/);
    assert.equal(r.out.systemMessage, "\n⬢ kioku.md ↓ recalled  by path · 1 page (project)");
    const entry = readJournal(w.home, "s").find((e) => e.what === "recalled")!;
    assert.equal(entry.by, "path");
    assert.deepEqual(
      entry.hits?.map((h) => h.path),
      ["memory/billing-rounds-each-line.md"],
    );
    assert.ok(
      !readFileSync(join(w.home, ".kioku/sessions/s.jsonl"), "utf8").includes("invoice.ts"),
      "the file is kept nowhere",
    );

    assert.equal(contextOf(await touch(w, "Edit", join(w.repo, "src/billing/tax.ts"))), "", "once a session");
    assert.match(
      contextOf(await touch(w, "Edit", "src/billing/tax.ts", { session: "b" })),
      /Billing rounds/,
      "relative to the session's folder",
    );
    assert.match(contextOf(await touch(w, "Write", join(w.repo, "schema.sql"), { session: "c" })), /Billing rounds/);
    assert.match(
      contextOf(await touch(w, "NotebookEdit", join(w.repo, "src/billing/a.ipynb"), { session: "d" })),
      /Billing rounds/,
    );
    for (const [why, tool, file, cwd] of [
      ["another file", "Read", join(w.repo, "src/checkout/cart.ts"), undefined],
      ["a pattern of one folder", "Read", join(w.repo, "db/schema.sql"), undefined],
      ["outside the project folder", "Read", resolve(w.repo, "../elsewhere/src/billing/x.ts"), undefined],
      ["not a file tool", "Bash", join(w.repo, "src/billing/x.ts"), undefined],
      ["inside a brain", "Read", join(w.acme, "src/billing/x.ts"), w.acme],
    ] as const)
      assert.equal(contextOf(await touch(w, tool, file, { session: "e", ...(cwd && { cwd }) })), "", why);

    // A page forgotten leaves no row, and the marker goes with the last one.
    await w.kioku(["page", "forget", saved.out.path, "--brain", "northwind/brain-acme"]);
    await reindex(w);
    assert.ok(!existsSync(appliesMarkerPath(w.home)));
    assert.equal(contextOf(await touch(w, "Read", join(w.repo, "src/billing/invoice.ts"), { session: "f" })), "");
  }));

test("the hook's wrapper starts nothing for a file while no page says which files it is about (§4.7)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-wrapper-"));
  try {
    const wrapper = resolve(import.meta.dirname, "../../plugins/claude-code/hooks/kioku.sh");
    const fake = join(dir, "kioku");
    writeFileSync(fake, '#!/bin/sh\necho "ran $*"\n');
    chmodSync(fake, 0o755);
    const run = (verb: string): string =>
      execFileSync("bash", [wrapper, "hook", verb], {
        env: { PATH: "/usr/bin:/bin", HOME: dir, KIOKU_HOME: dir, KIOKU_BIN: fake },
        encoding: "utf8",
      });
    assert.equal(run("pre-tool-path"), "", "no marker: the tool is not started");
    assert.equal(run("pre-tool-use"), "ran hook pre-tool-use\n", "every other hook runs as before");
    mkdirSync(join(dir, ".kioku"));
    writeFileSync(appliesMarkerPath(dir), "");
    assert.equal(run("pre-tool-path"), "ran hook pre-tool-path\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
