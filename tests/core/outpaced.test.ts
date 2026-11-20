import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lintReportPath } from "../../src/core/state.ts";
import { isolateGit } from "../remotes.ts";
import { sh, world, type World } from "../world.ts";

isolateGit();

const ACME = "northwind/brain-acme";
const LESSON = "## What happened\n\nIt broke.\n\n## Lesson\n\nMind it.\n\n## Rule of thumb\n\nCheck first.\n";

/** A commit of the project folder on a day of its own: a page's day is the day the test runs, so the code's are years on. */
function commit(w: World, day: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(w.repo, file)), { recursive: true });
    writeFileSync(join(w.repo, file), text);
  }
  sh(w.repo, "add", "-A");
  const at = `${day}T12:00:00`;
  execFileSync("git", ["-C", w.repo, "commit", "-q", "-m", `Change ${Object.keys(files).join(", ")}`], {
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
}

const save = (w: World, title: string, applies: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      ACME,
      "--kind",
      "memory",
      "--title",
      title,
      "--summary",
      "What to know there.",
      "--source",
      "Session 2026-10-07 in acme-api",
      "--evidence",
      "it broke last time",
      "--applies-to",
      applies,
      "--create",
    ],
    { stdin: LESSON },
  );
const lint = async (w: World, o: { cwd?: string; tty?: boolean } = {}) =>
  w.kioku(["brain", "lint", ACME], { ...(o.cwd && { cwd: o.cwd }), ...(o.tty && { tty: true }) });
const touch = (w: World, file: string, session: string) =>
  w.kioku(["hook", "pre-tool-path"], {
    stdin: JSON.stringify({
      cwd: w.repo,
      session_id: session,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: join(w.repo, file) },
    }),
  });
const contextOf = (r: { out: any }): string => r.out?.hookSpecificOutput?.additionalContext ?? "";

test("a project folder that is no git repository has no list and no mark, and nothing fails (§4.4)", () =>
  world(async (w) => {
    const saved = await save(w, "Billing rounds each line", "src/billing/**");
    assert.equal(saved.out.status, "done", JSON.stringify(saved.out));
    const r = await lint(w);
    assert.equal(r.code, 0);
    assert.deepEqual(r.out.brains[0].outpaced, []);
    const at = await touch(w, "src/billing/invoice.ts", "a");
    assert.equal(at.code, 0);
    assert.match(contextOf(at), /Billing rounds each line/);
    assert.doesNotMatch(contextOf(at), /\[/);
  }));

test("a page whose files were committed to on a later day is listed by lint and marked where it is used, until it is confirmed (§4.4, §4.7)", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q", "-b", "main");
    commit(w, "2020-01-01", {
      "src/billing/invoice.ts": "1\n",
      "src/billing/tax.ts": "1\n",
      "src/checkout/cart.ts": "1\n",
    });
    const saved = await save(w, "Billing rounds each line", "src/billing/**");
    const path = saved.out.path as string;
    const show = async (context = {}) => (await w.kioku(["page", "show", path, "--brain", ACME], { context })).out;
    const day = (await show()).touched as string;

    // Nothing after the page yet: commits before it, one to a file it is not about, and an edit not committed.
    commit(w, "2030-01-05", { "src/checkout/cart.ts": "2\n" });
    writeFileSync(join(w.repo, "src/billing/invoice.ts"), "not committed\n");
    assert.deepEqual((await lint(w)).out.brains[0].outpaced, []);
    assert.equal((await show()).review, null);
    assert.doesNotMatch(contextOf(await touch(w, "src/billing/invoice.ts", "a")), /\[/);

    // Two commits to one of its files.
    commit(w, "2030-01-06", { "src/billing/invoice.ts": "2\n" });
    commit(w, "2030-01-08", { "src/billing/invoice.ts": "3\n" });
    const before = (await lint(w)).out.brains[0];
    const entry = { path, since: day, commits: 2, last: "2030-01-08" };
    assert.deepEqual(before.outpaced, [entry]);
    assert.ok(before.count >= 1, "it counts toward what there is to review");
    assert.match(
      (await lint(w, { tty: true })).raw,
      /pages whose files changed after them\n.*2 commits since .*, last 2030-01-08/,
    );

    const review = { reason: "outpaced", since: day, commits: 2, last: "2030-01-08" };
    assert.deepEqual((await show()).review, review);
    const hit = (await w.kioku(["page", "search", "billing rounds"])).out.hits.find(
      (h: { path: string }) => h.path === path,
    );
    assert.deepEqual(hit.review, review);

    // At a file, the mark is about that file: the one committed to says so, its neighbour says nothing.
    assert.match(
      contextOf(await touch(w, "src/billing/invoice.ts", "b")),
      new RegExp(`\\[this file changed after it: 2 commits since ${day}, last 2030-01-08\\]$`, "m"),
    );
    const neighbour = contextOf(await touch(w, "src/billing/tax.ts", "c"));
    assert.match(neighbour, /Billing rounds each line/);
    assert.doesNotMatch(neighbour, /\[/);

    // The report holds pages, counts and days: no path of the project's files.
    assert.doesNotMatch(readFileSync(lintReportPath(w.home), "utf8"), /invoice|src\/billing\/[a-z]/);

    // Away from the project folder, lint answers the list last recorded and says from when.
    const away = (await lint(w, { cwd: w.dir })).out.brains[0];
    assert.deepEqual(away.outpaced, [entry]);
    assert.equal(away.outpaced_as_of, before.outpaced_as_of);

    // Confirming the page moves its day: the mark ends at once, and the next lint lists nothing.
    const later = { now: () => new Date(2030, 1, 1, 12, 0, 0) };
    const confirmed = await w.kioku(["page", "confirm", path, "--brain", ACME], { context: later });
    assert.equal(confirmed.out.status, "done", JSON.stringify(confirmed.out));
    assert.equal((await show(later)).review, null);
    assert.doesNotMatch(contextOf(await touch(w, "src/billing/invoice.ts", "d")), /\[/);
    assert.deepEqual((await lint(w, { cwd: w.dir })).out.brains[0].outpaced, [], "away: the page's day moved");
    assert.deepEqual((await lint(w)).out.brains[0].outpaced, []);
  }));
