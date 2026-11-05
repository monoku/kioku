import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath } from "../../src/core/config/machine.ts";
import { purgeReads, readReads, recordOpened, recordSurfaced } from "../../src/core/reads.ts";
import { readsStatePath } from "../../src/core/state.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

const POSTGRES = "knowledge/acme/decisions/postgres-over-mysql.md";
const terminal = { context: { interactive: true } };
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

test("opened and surfaced are two counts, by brain and id, with the day of the last of each (§4.5)", () => {
  const home = mkdtempSync(join(tmpdir(), "kioku-reads-"));
  try {
    assert.equal(readReads(home), undefined, "nothing is counted before the first read");
    recordOpened(home, at(2026, 10, 1), "acme/brain", "p-1");
    recordOpened(home, at(2026, 10, 3), "acme/brain", "p-1");
    recordSurfaced(home, at(2026, 10, 2), [
      { brain: "acme/brain", id: "p-1" },
      { brain: "acme/brain", id: "p-2" },
      { brain: "acme/brain", id: null },
    ]);
    const s = readReads(home)!;
    assert.equal(s.counting_since, "2026-10-01");
    assert.deepEqual(s.brains["acme/brain"]!["p-1"], {
      opened: 2,
      last_opened: "2026-10-03",
      surfaced: 1,
      last_surfaced: "2026-10-02",
    });
    assert.deepEqual(s.brains["acme/brain"]!["p-2"], {
      opened: 0,
      last_opened: null,
      surfaced: 1,
      last_surfaced: "2026-10-02",
    });
    assert.equal(Object.keys(s.brains["acme/brain"]!).length, 2, "a page with no id is not counted");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a page no brain holds any more is dropped, other brains are left alone, and clearing starts over (§4.5)", () => {
  const home = mkdtempSync(join(tmpdir(), "kioku-reads-"));
  try {
    recordOpened(home, at(2026, 10, 1), "a", "keep");
    recordOpened(home, at(2026, 10, 1), "a", "gone");
    recordOpened(home, at(2026, 10, 1), "b", "elsewhere");
    purgeReads(home, { a: new Set(["keep"]) });
    const s = readReads(home)!;
    assert.deepEqual(Object.keys(s.brains.a!), ["keep"]);
    assert.deepEqual(Object.keys(s.brains.b!), ["elsewhere"], "a brain this chain does not hold is not judged");
    rmSync(readsStatePath(home), { force: true });
    assert.equal(existsSync(readsStatePath(home)), false);
    recordOpened(home, at(2026, 11, 5), "a", "keep");
    assert.equal(readReads(home)!.counting_since, "2026-11-05");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("page show counts a page opened, whole or in part; the web's reading does not (§4.5)", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["page", "show", POSTGRES, "--brain", "northwind/brain-acme"])).code, 0);
    assert.equal((await w.kioku(["page", "show", POSTGRES, "--brain", "northwind/brain-acme", "--outline"])).code, 0);
    const s = readReads(w.home)!;
    const [brain] = Object.keys(s.brains);
    const [entry] = Object.values(s.brains[brain!]!);
    assert.equal(entry!.opened, 2);
    assert.equal(entry!.surfaced, 0);
    assert.ok(!JSON.stringify(s).includes("Postgres"), "no text, no title");
  }));

test("a session's summary counts the pages it offered, apart from the opened (§4.5)", () =>
  world(async (w) => {
    const start = await w.kioku(["hook", "session-start"], {
      stdin: JSON.stringify({ cwd: w.repo, source: "startup", hook_event_name: "SessionStart" }),
    });
    assert.equal(start.code, 0, start.raw);
    const s = readReads(w.home)!;
    const entries = Object.values(s.brains).flatMap((b) => Object.values(b));
    assert.ok(entries.length > 0 && entries.every((e) => e.surfaced === 1 && e.opened === 0), "offered, not opened");
  }));

test("a page not opened for sixty days since the machine began to count is listed by lint and counted by stats; Rules are not asked (§4.4, §4.5)", () =>
  world(async (w) => {
    const first = await w.kioku(["page", "show", POSTGRES, "--brain", "northwind/brain-acme"]);
    assert.equal(first.code, 0, first.raw);
    // The machine began to count a hundred days ago, and the pages are from before that: sixty days have passed.
    const state = readReads(w.home)!;
    writeFileSync(readsStatePath(w.home), `${JSON.stringify({ ...state, counting_since: "2020-01-01" })}\n`);
    const later = { context: { now: () => new Date(Date.now() + 100 * 86_400_000) } };
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"], later);
    assert.equal(lint.code, 0, lint.raw);
    const report = lint.out.brains[0];
    assert.ok(report.unopened.length > 0, "something is listed");
    assert.equal(report.counting_since, "2020-01-01");
    assert.ok(!report.unopened.some((u: { path: string }) => u.path === POSTGRES), "an opened page is not asked");
    assert.ok(
      !report.unopened.some((u: { path: string }) => u.path.startsWith("rules/")),
      "a Rule is whole in every summary",
    );
    const stats = await w.kioku(["brain", "stats", "--brain", "northwind/brain-acme"], later);
    assert.equal(stats.out.brains[0].unopened, report.unopened.length);
    assert.equal(stats.out.brains[0].opened, 1);
    assert.equal(stats.out.brains[0].counting_since, "2020-01-01");
  }));

test("a page is unopened after sixty days on every machine: lint.unopened_after_days is refused, in the file and by config (§2.5, §4.5)", () =>
  world(async (w) => {
    await w.kioku(["page", "show", POSTGRES, "--brain", "northwind/brain-acme"]);
    const after = (days: number) => ({ context: { now: () => new Date(Date.now() + days * 86_400_000) } });
    const unopened = async (days: number) =>
      (await w.kioku(["brain", "lint", "northwind/brain-acme"], after(days))).out.brains[0].unopened.length;
    assert.equal(await unopened(59), 0, "fifty-nine days are not sixty");
    assert.ok((await unopened(60)) > 0, "sixty are");
    const set = await w.kioku(["config", "set", "lint.unopened_after_days", "120"], terminal);
    assert.equal(set.out.error.code, "config_key_unknown", set.raw);
    const before = readFileSync(configPath(w.home), "utf8");
    writeFileSync(configPath(w.home), `${before}lint:\n  unopened_after_days: 120\n`);
    assert.match((await w.kioku(["doctor"])).raw, /unknown key `lint`/);
  }));
