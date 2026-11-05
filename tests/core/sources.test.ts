import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { stdinWorld } from "../world.ts";

isolateGit();

const DOC = "docs/runbook.md in acme-api";
const save = (w: Parameters<Parameters<typeof stdinWorld>[0]>[0], title: string, source: string, version?: string) =>
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
      `About ${title}`,
      "--source",
      source,
      ...(version === undefined ? [] : ["--source-version", version]),
    ],
    `## Context\n\n${title}.\n`,
  );
const sourcesOf = async (w: Parameters<Parameters<typeof stdinWorld>[0]>[0], ...args: string[]) =>
  (await w.kioku(["brain", "sources", "--brain", "northwind/brain-acme", ...args])).out.sources;

test("a page keeps the version of its source, and pages and show return it", () =>
  stdinWorld(async (w) => {
    const r = await save(w, "Deploys go out on Tuesdays", DOC, "9f2c1ab");
    assert.equal(r.code, 0, r.raw);
    assert.match(
      readFileSync(join(w.acme, r.out.path), "utf8"),
      /^source: "docs\/runbook\.md in acme-api"\nsource_version: "9f2c1ab"$/m,
    );
    assert.equal((await w.kioku(["page", "show", r.out.path])).out.source_version, "9f2c1ab");
    const plain = await save(w, "Staging has one replica", DOC);
    assert.equal((await w.kioku(["page", "show", plain.out.path])).out.source_version, null);
    assert.equal((await w.kioku(["brain", "validate", "northwind/brain-acme"])).code, 0);
  }));

test("sources lists what was ingested from the pages' own source, newest first, without sessions unless asked", () =>
  stdinWorld(async (w) => {
    await save(w, "Deploys go out on Tuesdays", DOC, "v1");
    await save(w, "Staging has one replica", DOC, "v1");
    await save(w, "Release notes live in Notion", "Notion page Release notes", "2026-10-07");
    await save(w, "Standup is at ten", "Session 2026-10-07 in acme-api");

    const listed = await sourcesOf(w);
    const mine = listed.filter((s: { source: string }) => s.source === DOC || s.source === "Notion page Release notes");
    assert.deepEqual(
      mine.map((s: { source: string; count: number; version: string; versions: string[] }) => [
        s.source,
        s.count,
        s.version,
        s.versions,
      ]),
      [
        [DOC, 2, "v1", ["v1"]],
        ["Notion page Release notes", 1, "2026-10-07", ["2026-10-07"]],
      ].sort(
        (a, b) =>
          listed.findIndex((s: { source: string }) => s.source === a[0]) -
          listed.findIndex((s: { source: string }) => s.source === b[0]),
      ),
    );
    assert.ok(
      listed.every((s: { source: string }) => !s.source.startsWith("Session")),
      "a session is not a document",
    );
    assert.ok(
      (await sourcesOf(w, "--all")).some((s: { source: string }) => s.source === "Session 2026-10-07 in acme-api"),
    );
    assert.ok(
      listed.every(
        (s: { brain: string; last: string | null }) => s.brain === "northwind/brain-acme" && s.last !== null,
      ),
    );

    const text = await w.kioku(["brain", "sources", "--brain", "northwind/brain-acme"], "", true);
    assert.match(text.raw, /acme: docs\/runbook\.md in acme-api · 2 pages · last \d{4}-\d{2}-\d{2} · version v1/);
  }));

test("sources <source> lists the pages that come from it, and update --source-version brings one up to date", () =>
  stdinWorld(async (w) => {
    const a = await save(w, "Deploys go out on Tuesdays", DOC, "v1");
    await save(w, "Staging has one replica", DOC, "v1");

    const named = await sourcesOf(w, DOC);
    assert.equal(named.length, 1);
    assert.deepEqual(
      named[0].pages.map((p: { title: string }) => p.title),
      ["Deploys go out on Tuesdays", "Staging has one replica"],
    );

    const u = await w.kioku([
      "page",
      "update",
      a.out.path,
      "--brain",
      "northwind/brain-acme",
      "--source-version",
      "v2",
    ]);
    assert.equal(u.code, 0, u.raw);
    assert.match(readFileSync(join(w.acme, a.out.path), "utf8"), /^source_version: "v2"$/m);
    assert.match(readFileSync(join(w.acme, a.out.path), "utf8"), /Read the source again\./);
    const mixed = (await sourcesOf(w, DOC))[0];
    assert.equal(mixed.version, null, "the pages do not agree");
    assert.deepEqual(mixed.versions, ["v1", "v2"], "one page is still at the old version");
    assert.equal(
      (await w.kioku(["page", "update", a.out.path, "--brain", "northwind/brain-acme", "--source-version", "v2"])).out
        .error.code,
      "unchanged",
    );
    assert.equal(
      (await w.kioku(["page", "update", a.out.path, "--brain", "northwind/brain-acme", "--source-version", "none"]))
        .code,
      0,
    );
    assert.equal(
      (await w.kioku(["page", "show", a.out.path, "--brain", "northwind/brain-acme"])).out.source_version,
      null,
    );
    assert.equal(
      (await w.kioku(["brain", "sources", "--brain", "northwind/brain-acme", "one", "two"])).out.error.code,
      "usage",
    );
  }));

test("a retired page does not count as ingested, and a source nobody wrote from is empty", () =>
  stdinWorld(async (w) => {
    const a = await save(w, "Deploys go out on Tuesdays", DOC, "v1");
    assert.equal((await w.kioku(["page", "retire", a.out.path, "--brain", "northwind/brain-acme"])).code, 0);
    assert.deepEqual(await sourcesOf(w, DOC), []);
    const text = await w.kioku(["brain", "sources", "--brain", "northwind/brain-acme", "Nothing"], "", true);
    assert.match(text.raw, /No page comes from "Nothing"\./);
  }));
