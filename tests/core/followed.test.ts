import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNFOLLOWED_RECALLS } from "../../src/core/lint.ts";
import { readReads } from "../../src/core/reads.ts";
import { followedIn } from "../../src/core/session/followed.ts";
import { readJournal, type JournalEntry } from "../../src/core/session/journal.ts";
import { readsStatePath } from "../../src/core/state.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const B = "northwind/brain-acme";
const entry = (e: Partial<JournalEntry>): JournalEntry => ({
  at: "2026-11-13T10:00:00Z",
  turn: 1,
  what: "opened",
  arrow: "read",
  ...e,
});
const recalled = (path: string, id?: string) =>
  entry({ what: "recalled", hits: [{ brain: B, path, title: "T", ...(id !== undefined && { id }) }] });

test("a page opened after a recall named it to the session is that recall followed, once (§4.5)", () => {
  const page = { brain: B, path: "memory/a.md" };
  assert.deepEqual(followedIn([recalled("memory/a.md", "ID1")], [page]), [{ brain: B, id: "ID1" }]);
  assert.deepEqual(followedIn([], [page]), [], "opened with no recall before it");
  assert.deepEqual(followedIn([recalled("memory/b.md", "ID2")], [page]), [], "another page was recalled");
  assert.deepEqual(
    followedIn([recalled("memory/a.md", "ID1"), entry({ brain: B, path: "memory/a.md" })], [page]),
    [],
    "already opened since its recall: opened again says nothing more",
  );
  assert.deepEqual(followedIn([recalled("memory/a.md")], [page]), [], "a recall from before ids were kept");
  assert.deepEqual(
    followedIn([entry({ brain: B, path: "memory/a.md" }), recalled("memory/a.md", "ID1")], [page]),
    [{ brain: B, id: "ID1" }],
    "opened before the recall is not the recall followed; after it, it is",
  );
});

const BODY = "## What happened\n\nIt broke.\n\n## Lesson\n\nMind it.\n\n## Rule of thumb\n\nCheck first.\n";
const save = (w: World, title: string, applies: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      B,
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
      "--applies-to",
      applies,
      "--create",
    ],
    { stdin: BODY },
  );
/** The agent reads a file: what the path's hook is told (§4.7). */
const touch = (w: World, file: string, session: string) =>
  w.kioku(["hook", "pre-tool-path"], {
    stdin: JSON.stringify({ cwd: w.repo, session_id: session, tool_name: "Read", tool_input: { file_path: file } }),
  });
/** The agent opens a page: the tool's answer, then what the shell tool's hook is told of it (§4.6). */
async function open(w: World, path: string, session: string) {
  const shown = await w.kioku(["page", "show", path, "--brain", B, "--json"]);
  return w.kioku(["hook", "post-tool-use"], {
    stdin: JSON.stringify({
      cwd: w.repo,
      session_id: session,
      tool_name: "Bash",
      tool_input: { command: `kioku page show ${path} --brain ${B}` },
      tool_response: { stdout: shown.raw },
    }),
  });
}

test("the machine counts each recall of a page and each one the session then opened; stats adds them up and lint lists what is never followed (§4.4, §4.5, §6.1)", () =>
  world(async (w) => {
    const billing = (await save(w, "Billing rounds each line", "src/billing")).out.path as string;
    const checkout = (await save(w, "Checkout holds stock", "src/checkout")).out.path as string;
    await w.kioku(["page", "search", "billing"]); // the index is brought up to the brains' files (§4.3)
    const counts = () => {
      const all = Object.values(readReads(w.home)!.brains[B] ?? {});
      return all.filter((e) => (e.recalled ?? 0) > 0).map((e) => [e.recalled, e.followed ?? 0, e.surfaced]);
    };

    await touch(w, join(w.repo, "src/billing/a.ts"), "s1");
    assert.deepEqual(counts(), [[1, 0, 1]], "recalled once, and offered once");
    assert.ok(readJournal(w.home, "s1").find((e) => e.what === "recalled")!.hits![0]!.id, "the recall keeps the id");
    await open(w, billing, "s1");
    assert.deepEqual(counts(), [[1, 1, 1]], "the session opened it: the recall was followed");
    await open(w, billing, "s1");
    assert.deepEqual(counts(), [[1, 1, 1]], "opened again says nothing more");
    assert.equal(readJournal(w.home, "s1").filter((e) => e.what === "opened").length, 2, "both are in the journal");

    await touch(w, join(w.repo, "src/billing/b.ts"), "s2");
    await open(w, checkout, "s2");
    assert.deepEqual(counts(), [[2, 1, 2]], "another session was given it and opened another page");

    const stats = (await w.kioku(["brain", "stats", "--brain", B])).out.brains[0];
    assert.deepEqual([stats.recalled, stats.followed, stats.follow_rate], [2, 1, 0.5]);
    const text = (await w.kioku(["brain", "stats", "--brain", B], { tty: true })).raw;
    assert.match(text, /RECALLED +FOLLOWED/);
    assert.match(text, /followed the times the session then opened it/);

    // Checkout's page: recalled as often as lint asks, and never opened after.
    const lintOf = async () => (await w.kioku(["brain", "lint", B])).out.brains[0];
    assert.deepEqual((await lintOf()).unfollowed, []);
    for (let i = 0; i < UNFOLLOWED_RECALLS; i++) await touch(w, join(w.repo, "src/checkout/cart.ts"), `c${i}`);
    for (let i = 0; i < UNFOLLOWED_RECALLS; i++) await touch(w, join(w.repo, "src/billing/c.ts"), `b${i}`);
    const report = await lintOf();
    assert.deepEqual(
      report.unfollowed,
      [{ path: checkout, recalled: UNFOLLOWED_RECALLS }],
      "billing's was followed once",
    );
    assert.match(
      (await w.kioku(["brain", "lint", B], { tty: true })).raw,
      /a recall keeps bringing and no session opens/,
    );
  }));

test("a count from before recalls were counted reads as none, and stats has no rate (§4.5)", () =>
  world(async (w) => {
    writeFileSync(
      readsStatePath(w.home),
      `${JSON.stringify({ counting_since: "2026-01-01", brains: { [B]: { X: { opened: 1, last_opened: "2026-02-01", surfaced: 3, last_surfaced: "2026-02-01" } } } })}\n`,
    );
    const stats = (await w.kioku(["brain", "stats", "--brain", B])).out.brains[0];
    assert.deepEqual([stats.recalled, stats.followed, stats.follow_rate], [0, 0, null]);
    assert.deepEqual((await w.kioku(["brain", "lint", B])).out.brains[0].unfollowed, []);
  }));
