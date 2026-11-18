import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HANDOFF_DAYS, HANDOFF_MAX, HANDOFF_PAGES_MAX, pagesOfJournal } from "../../src/core/handoff.ts";
import { readJournal, record } from "../../src/core/session/journal.ts";
import { WHEN_TO_HANDOFF } from "../../src/core/session/summary.ts";
import { handoffsPath } from "../../src/core/state.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const NOTE =
  "Moving the invoice totals to cents.\nNext: the migration for old rows.\nNot decided: rounding of refunds.";
const handoff = (
  w: World,
  what: string,
  { branch, ...o }: { stdin?: string; cwd?: string; context?: object; tty?: boolean; branch?: string } = {},
) => w.kioku(["handoff", what, ...(branch === undefined ? [] : ["--branch", branch])], o);
/** What a session's start gives of the handoff: the hook of its own (§4.8), which answers nothing when there is none. */
const start = async (w: World, source = "startup", o: { cwd?: string; context?: object } = {}): Promise<string> =>
  (
    await w.kioku(["hook", "session-start-handoff"], {
      stdin: JSON.stringify({ cwd: o.cwd ?? w.repo, source, session_id: "s" }),
      ...(o.context && { context: o.context }),
    })
  ).out?.hookSpecificOutput?.additionalContext ?? "";
/** The summary's first part, which says when to leave one. */
const opening = async (w: World): Promise<string> =>
  (
    await w.kioku(["hook", "session-start"], {
      stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }),
    })
  ).out.hookSpecificOutput.additionalContext;

test("a handoff is left, shown, replaced and dropped, a folder's own, on this machine alone (§4.8)", () =>
  world(async (w) => {
    assert.equal((await handoff(w, "show")).out.handoff, null);
    const set = await handoff(w, "set", { stdin: `${NOTE}\n` });
    assert.equal(set.out.status, "done", JSON.stringify(set.out));
    assert.equal((await handoff(w, "show")).out.handoff.text, NOTE);
    // The project folder's, from wherever inside it; another folder has none.
    mkdirSync(join(w.repo, "src/billing"), { recursive: true });
    assert.equal((await handoff(w, "show", { cwd: join(w.repo, "src/billing") })).out.handoff.text, NOTE);
    assert.equal((await handoff(w, "show", { cwd: w.home })).out.handoff, null);
    await handoff(w, "set", { stdin: "Only the refunds are left." });
    assert.equal(
      (await handoff(w, "show")).out.handoff.text,
      "Only the refunds are left.",
      "one a folder: the next replaces it",
    );
    // Machine state: no brain's file, no commit, no entry of the journal.
    // One file a folder, as a session's journal is one a session; with the folder's path in it, for whoever opens it.
    const files = readdirSync(handoffsPath(w.home));
    assert.equal(files.length, 1);
    const kept = readFileSync(join(handoffsPath(w.home), files[0]!), "utf8");
    assert.ok(!kept.includes("Moving the invoice") && kept.includes("Only the refunds are left."));
    assert.equal(JSON.parse(kept).folder, realpathSync(w.repo));
    assert.deepEqual(readJournal(w.home, "s"), []);
    assert.equal((await handoff(w, "clear")).out.cleared, true);
    assert.equal((await handoff(w, "clear")).out.cleared, false);
    assert.equal((await handoff(w, "show")).out.handoff, null);
  }));

test("a handoff that is empty, too long or holds a secret is refused, and the one there stays (§4.8, §1.5)", () =>
  world(async (w) => {
    await handoff(w, "set", { stdin: NOTE });
    for (const [text, code] of [
      ["  \n", "handoff_empty"],
      ["x".repeat(HANDOFF_MAX + 1), "handoff_too_long"],
      ["Next: rotate it.\nDB_PASSWORD=hunter2hunter2hunter2hunter2", "handoff_secret"],
    ] as const) {
      const r = await handoff(w, "set", { stdin: text });
      assert.equal(r.out.error.code, code, JSON.stringify(r.out));
      assert.ok(!JSON.stringify(r.out).includes("hunter2"), "a refusal never repeats the match");
    }
    assert.equal((await handoff(w, "show")).out.handoff.text, NOTE);
    assert.equal((await handoff(w, "nope")).out.error.code, "usage");
  }));

test("a session that starts anew in the folder is given the handoff, as a note and not as memory; one that goes on is not (§4.8, §4.1)", () =>
  world(async (w) => {
    assert.ok((await opening(w)).includes(WHEN_TO_HANDOFF), "every session is told when to leave one");
    assert.equal(await start(w), "", "with none, the hook answers nothing");

    await handoff(w, "set", { stdin: `${NOTE}\n\n## A heading of its own\n` });
    const s = await start(w);
    assert.match(
      s,
      /^# Kioku: where the last session here left off\n\nA handoff the agent left on \d{4}-\d\d-\d\d, on this machine/,
    );
    assert.match(s, /It is a note, not memory, and may be stale/);
    assert.ok(s.includes("Next: the migration for old rows."));
    assert.match(s, /^#### A heading of its own$/m, "its headings sit under the part's own");
    assert.doesNotMatch(await opening(w), /left off/, "a part of its own: nothing of it in the summary's");
    assert.match(await start(w, "clear"), /where the last session here left off/, "a cleared session starts anew");
    for (const source of ["resume", "compact"]) assert.equal(await start(w, source), "", source);
    assert.equal(await start(w, "startup", { cwd: w.home }), "", "another folder");

    // Nobody wrote it for a month: it says nothing true of the folder any more.
    // The tests' clock stands still at one day (`ctx` in the fixtures): later is counted from it.
    const later = (days: number) => ({ now: () => new Date(new Date(2026, 9, 7, 12).getTime() + days * 86_400_000) });
    assert.match(await start(w, "startup", { context: later(HANDOFF_DAYS - 1) }), /left off/);
    assert.doesNotMatch(await start(w, "startup", { context: later(HANDOFF_DAYS + 1) }), /left off/);
    assert.equal((await handoff(w, "show", { context: later(HANDOFF_DAYS + 1) })).out.handoff, null);
  }));

test("a handoff belongs to a folder and its branch: a checkout that moves between branches has one a branch (§4.8)", () =>
  world(async (w) => {
    const git = (...args: string[]) => execFileSync("git", ["-C", w.repo, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "start");
    git("checkout", "-q", "-b", "feat/cents");
    const set = await handoff(w, "set", { stdin: NOTE });
    assert.equal(set.out.branch, "feat/cents");
    assert.match((await handoff(w, "show", { tty: true })).raw, / on feat\/cents:\n\nMoving the invoice/);
    const same = await start(w);
    assert.match(same, /on this machine for the branch `feat\/cents`, when the person stopped\. It is a note/);
    assert.doesNotMatch(same, /This folder has/);

    // Another branch of the same checkout: its own handoff, and the other is named, not shown.
    git("checkout", "-q", "-b", "fix/refunds");
    assert.equal((await handoff(w, "show")).out.handoff, null);
    assert.deepEqual(
      (await handoff(w, "show")).out.elsewhere.map((e: { branch: string }) => e.branch),
      ["feat/cents"],
    );
    const none = await start(w);
    assert.match(
      none,
      /^# Kioku: where the last session here left off\n\nNo handoff was left for the branch `fix\/refunds`\. This folder has a handoff on `feat\/cents` \(left \d{4}-\d\d-\d\d\): `kioku handoff show --branch <branch>` reads one\./,
    );
    assert.ok(!none.includes("Moving the invoice totals"), "another branch's work is not this one's");
    assert.equal((await handoff(w, "show", { branch: "feat/cents" })).out.handoff.text, NOTE);

    await handoff(w, "set", { stdin: "Refunds round half up; tests left." });
    const both = await start(w);
    assert.ok(both.includes("Refunds round half up; tests left."));
    assert.match(both, /This folder has a handoff on `feat\/cents`/);
    git("checkout", "-q", "feat/cents");
    assert.ok((await start(w)).includes("Moving the invoice totals to cents."), "back on its branch, its own again");
    assert.equal((await handoff(w, "set", { stdin: NOTE, branch: "main" })).out.error.code, "usage");
    assert.equal((await handoff(w, "clear", { branch: "fix/refunds" })).out.cleared, true);
    assert.deepEqual((await handoff(w, "show")).out.elsewhere, []);
  }));

test("a worktree has its own handoff, and a folder that is no repository has one with no branch (§4.8)", () =>
  world(async (w) => {
    const git = (...args: string[]) => execFileSync("git", ["-C", w.repo, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("add", "kioku.yaml");
    git("commit", "-q", "-m", "start");
    const tree = join(w.dir, "tree");
    git("worktree", "add", "-q", "-b", "feat/tree", tree);
    await handoff(w, "set", { stdin: "In the worktree: the importer.", cwd: tree });
    await handoff(w, "set", { stdin: "In the main checkout: the exporter." });
    assert.equal((await handoff(w, "show", { cwd: tree })).out.handoff.text, "In the worktree: the importer.");
    assert.equal((await handoff(w, "show", { cwd: tree })).out.branch, "feat/tree");
    assert.deepEqual((await handoff(w, "show", { cwd: tree })).out.elsewhere, [], "another folder's are not its own");
    assert.equal((await handoff(w, "show")).out.handoff.text, "In the main checkout: the exporter.");
    assert.ok((await start(w, "startup", { cwd: tree })).includes("In the worktree: the importer."));

    // No repository: no branch asked, kept or said; a folder inside it is the same place only by its project folder.
    const plain = join(w.dir, "notes");
    mkdirSync(join(plain, "deep"), { recursive: true });
    const set = await handoff(w, "set", { stdin: "Sorting the receipts.", cwd: plain });
    assert.equal(set.out.branch, null);
    const s = await start(w, "startup", { cwd: plain });
    assert.match(s, /A handoff the agent left on \d{4}-\d\d-\d\d, on this machine, when the person stopped\./);
    assert.equal(
      (await handoff(w, "show", { cwd: join(plain, "deep") })).out.handoff,
      null,
      "a folder is its own place",
    );
    // Inside a repository, from any folder of it: the top of the repository is the place.
    mkdirSync(join(tree, "src/deep"), { recursive: true });
    assert.equal(
      (await handoff(w, "show", { cwd: join(tree, "src/deep") })).out.handoff.text,
      "In the worktree: the importer.",
    );
  }));

test("a handoff as long as it may be is given whole, in a part of its own under its hook's cap (§4.8)", () =>
  world(async (w) => {
    const long = Array.from({ length: 66 }, (_, i) => `Step ${i}: ${"x".repeat(50)}`).join("\n");
    assert.ok(long.length > 3900 && long.length <= HANDOFF_MAX);
    const without = await opening(w);
    assert.equal((await handoff(w, "set", { stdin: long })).out.status, "done");
    const s = await start(w);
    assert.ok(s.includes("Step 0:") && s.includes("Step 65:"), "whole");
    assert.ok(s.length <= 10_000, `${s.length}`);
    assert.equal(await opening(w), without, "the summary's own parts are what they were: it takes none of their room");
    await handoff(w, "clear");
    assert.ok(
      !existsSync(handoffsPath(w.home)),
      "with none left its file and their folder go, and the wrapper starts nothing",
    );
  }));

test("a handoff left in a session names the pages that session wrote and opened, from its journal, and the next session is given them (§4.8)", () =>
  world(async (w) => {
    const B = "northwind/brain-acme";
    record(
      w.home,
      "s",
      [
        {
          what: "opened",
          arrow: "read",
          brain: B,
          path: "knowledge/acme/decisions/postgres-over-mysql.md",
          title: "Postgres over MySQL",
        },
        { what: "searched", arrow: "read", brain: B, words: "cents", count: 2 },
        {
          what: "saved",
          arrow: "write",
          brain: "sam/brain",
          path: "memory/totals-in-cents.md",
          title: "Totals in\ncents",
        },
        { what: "saved", arrow: "write", brain: B, path: "memory/a-mistake.md", title: "A mistake" },
        { what: "forgot", arrow: "write", brain: B, path: "memory/a-mistake.md", title: "A mistake" },
        {
          what: "opened",
          arrow: "read",
          brain: "sam/brain",
          path: "memory/totals-in-cents.md",
          title: "Totals in cents",
        },
      ],
      new Date(),
    );
    // The agent leaves it; then the shell tool's hook, which knows the session, is told of that call.
    const set = await handoff(w, "set", { stdin: NOTE });
    const after = (session: string) =>
      w.kioku(["hook", "post-tool-use"], {
        stdin: JSON.stringify({
          cwd: w.repo,
          session_id: session,
          tool_name: "Bash",
          tool_input: { command: "kioku handoff set <<'EOF'\nMoving the invoice totals to cents.\nEOF" },
          tool_response: { stdout: set.raw },
        }),
      });
    assert.deepEqual((await handoff(w, "show")).out.handoff.pages, [], "the tool alone does not know the session");
    assert.equal((await after("s")).raw, "", "the hook answers nothing");
    assert.deepEqual((await handoff(w, "show")).out.handoff.pages, [
      { brain: "sam/brain", path: "memory/totals-in-cents.md", title: "Totals in cents", did: "wrote" },
      {
        brain: B,
        path: "knowledge/acme/decisions/postgres-over-mysql.md",
        title: "Postgres over MySQL",
        did: "opened",
      },
    ]);
    assert.deepEqual(
      readJournal(w.home, "s").filter((e) => e.what !== "opened" && e.arrow === "read").length,
      1,
      "no entry of its own",
    );

    const s = await start(w);
    inOrderOf(s, [
      "Next: the migration for old rows.",
      "Pages of the memory that session wrote or opened, each read again with `kioku page show <path> --brain <brain>`:",
      "- wrote: Totals in cents (sam/brain, memory/totals-in-cents.md)",
      "- opened: Postgres over MySQL (northwind/brain-acme, knowledge/acme/decisions/postgres-over-mysql.md)",
    ]);
    assert.match(
      (await handoff(w, "show", { tty: true })).raw,
      /Pages that session wrote or opened:\n {2}wrote: Totals in cents/,
    );

    // A handoff left since by another session is not this one's to name pages on; a new one starts with none.
    await handoff(w, "set", { stdin: "Only the refunds are left.", context: { now: () => new Date(2026, 9, 8, 9) } });
    await after("s");
    assert.deepEqual((await handoff(w, "show")).out.handoff.pages, []);
  }));

/** Each line is in the text, after the one before it. */
function inOrderOf(text: string, lines: string[]): void {
  let at = -1;
  for (const line of lines) {
    const next = text.indexOf(line, at + 1);
    assert.ok(next > at, `missing, or out of order: ${line}`);
    at = next;
  }
}

test("a handoff names eight pages at most, the ones written before the ones only opened (§4.8)", () => {
  const journal = Array.from({ length: 12 }, (_, i) => ({
    at: "2026-11-13T10:00:00Z",
    turn: 1,
    what: i % 2 === 0 ? ("opened" as const) : ("saved" as const),
    arrow: i % 2 === 0 ? ("read" as const) : ("write" as const),
    brain: "sam/brain",
    path: `memory/p${i}.md`,
    title: `Page ${i}`,
  }));
  const pages = pagesOfJournal(journal);
  assert.equal(pages.length, HANDOFF_PAGES_MAX);
  assert.deepEqual(
    pages.slice(0, 6).map((p) => p.did),
    Array(6).fill("wrote"),
  );
  assert.equal(pages[0]!.path, "memory/p11.md", "the latest first");
  assert.deepEqual(
    pages.slice(6).map((p) => p.did),
    ["opened", "opened"],
  );
});

test("the hook's wrapper starts nothing for a session's handoff on a machine that holds none (§4.8)", () => {
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
    assert.equal(run("session-start-handoff"), "", "no handoff on the machine: the tool is not started");
    assert.equal(run("session-start-holds"), "ran hook session-start-holds\n", "the summary's hooks run as before");
    mkdirSync(join(dir, ".kioku"));
    mkdirSync(handoffsPath(dir));
    assert.equal(run("session-start-handoff"), "ran hook session-start-handoff\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each folder has a file of its own, and one nobody wrote for thirty days is dropped at a session's start (§4.8)", () =>
  world(async (w) => {
    const other = join(w.dir, "elsewhere");
    mkdirSync(other);
    await handoff(w, "set", { stdin: NOTE });
    await handoff(w, "set", { stdin: "Another folder's work.", cwd: other });
    const dir = handoffsPath(w.home);
    assert.equal(readdirSync(dir).length, 2, "two folders, two files: neither writes the other's");
    // The other folder's was last written long ago.
    const theirs = readdirSync(dir).find((f) => readFileSync(join(dir, f), "utf8").includes("Another folder"))!;
    const then = new Date(2026, 7, 1);
    utimesSync(join(dir, theirs), then, then);
    assert.ok((await start(w)).includes("Moving the invoice totals"));
    assert.deepEqual(readdirSync(dir).length, 1, "the stale file is gone, this folder's stays");
    await handoff(w, "clear");
    assert.ok(!existsSync(dir));
  }));
