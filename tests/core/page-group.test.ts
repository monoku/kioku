import { test } from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

test("a page verb at the first level is unknown, and is told the group's verb it is; a word near a verb is told that verb (§6.1)", () =>
  world(async (w) => {
    const cases: [string, string | undefined][] = [
      ["save", "kioku page save"],
      ["search", "kioku page search"],
      ["show", "kioku page show"],
      ["evolve", "kioku page evolve"],
      ["pages", "kioku page"],
      ["confg", "kioku config"],
      ["nonsense", undefined],
    ];
    for (const [word, near] of cases) {
      const r = await w.kioku([word]);
      assert.equal(r.code, 1, word);
      assert.equal(r.out.error.code, "unknown_verb", word);
      assert.equal(
        r.out.error.message,
        `unknown verb "${word}"${near === undefined ? "" : `: did you mean ${near}?`} (kioku help lists the verbs)`,
        word,
      );
    }
    const list = await w.kioku(["list"]);
    assert.equal(
      list.out.error.message,
      'unknown verb "list": did you mean kioku page list or kioku brain list or kioku namespace list? (kioku help lists the verbs)',
    );
  }));

test("kioku page without a verb lists them, as help does; with one it does not have, it is unknown and the near one is named", () =>
  world(async (w) => {
    const none = await w.kioku(["page"]);
    assert.equal(none.code, 0, none.raw);
    assert.deepEqual(
      none.out.verbs.map((v: { verb: string }) => v.verb.slice("page ".length)),
      [
        "search",
        "list",
        "show",
        "save",
        "update",
        "supersede",
        "forget",
        "confirm",
        "retire",
        "rename",
        "move",
        "link",
        "promote",
        "evolve",
      ],
    );
    const near = await w.kioku(["page", "lis"]);
    assert.equal(near.out.error.code, "unknown_verb");
    assert.equal(
      near.out.error.message,
      'unknown verb "lis" in kioku page: did you mean kioku page list? (kioku help page lists its verbs)',
    );
    const brain = await w.kioku(["brain"]);
    assert.deepEqual(
      [brain.code, brain.out.verbs.slice(0, 3).map((v: { verb: string }) => v.verb)],
      [0, ["brain create", "brain clone", "brain sync"]],
    );
  }));

test("kioku help, kioku alone, --help and -h print the overview; help <verb> is one verb's usage (§6.1)", () =>
  world(async (w) => {
    for (const argv of [["help"], [], ["--help"], ["-h"]]) {
      const r = await w.kioku(argv, { tty: true });
      assert.equal(r.code, 0, argv.join(" "));
      assert.match(
        r.raw,
        /^kioku\.md · memory for coding agents\n\nkioku <verb> \[arguments\] \[--json\]\n\nMachine\n {2}setup\s+once per machine/,
      );
      assert.match(r.raw, /\n {2}page\s+search, list and show the pages/);
      assert.match(r.raw, /the reference has them all: https:\/\/[^\s]+\/docs\/reference\/cli\.md\n$/);
    }
    const one = await w.kioku(["help", "brain", "path"], { tty: true });
    assert.match(
      one.raw,
      /^kioku brain path <brain>\n\nPrints a brain's folder\.\n\nMore in the reference, under `kioku brain path`:\shttps:\/\/[^\s]+\/docs\/reference\/cli\.md#kioku-brain-path\n$/,
    );
    const group = await w.kioku(["help", "page"], { tty: true });
    assert.match(
      group.raw,
      /^kioku page <verb>\n\nSearch, list and show the pages[^\n]*\.\n\n {2}search\s+searches the brains/,
    );
    const json = await w.kioku(["help"]);
    assert.ok(json.out.verbs.length >= 30);
    assert.deepEqual(Object.keys(json.out.verbs[0]), ["verb", "usage", "does"]);
    const text = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--namespace", "nowhere"], {
      tty: true,
    });
    assert.match(
      text.raw,
      /^No pages in northwind\/brain-acme \(project\)\.\n$/,
      "an answer with nothing to list says where it looked",
    );
  }));

test("kioku page list answers a window of its pages, and a part of them with --limit, --kind, --namespace, --fields and --count", () =>
  world(async (w) => {
    const all = await w.kioku(["page", "list", "--brain", "northwind/brain-acme"]);
    assert.equal(all.code, 0, all.raw);
    assert.deepEqual(
      Object.keys(all.out),
      ["pages", "total", "offset", "limit", "next"],
      "with no flag the answer still says it is a window (§6.1)",
    );
    const total = all.out.total;
    assert.equal(all.out.pages.length, total, "a small brain fits in the window");
    assert.deepEqual([all.out.offset, all.out.limit, all.out.next], [0, 20, null]);
    assert.ok(total >= 3);

    const first = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--limit", "2"]);
    assert.deepEqual([first.out.pages.length, first.out.total, first.out.offset, first.out.limit], [2, total, 0, 2]);
    const next = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--limit", "2", "--offset", "2"]);
    assert.deepEqual(
      next.out.pages.map((p: { path: string }) => p.path),
      all.out.pages.slice(2, 4).map((p: { path: string }) => p.path),
    );

    const kind = all.out.pages[0].kind as string;
    const ofKind = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--kind", kind]);
    assert.ok(ofKind.out.pages.every((p: { kind: string }) => p.kind === kind));
    assert.equal(ofKind.out.total, all.out.pages.filter((p: { kind: string }) => p.kind === kind).length);
    assert.equal(
      (await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--kind", "nothing"])).out.total,
      0,
    );

    const some = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--fields", "title,kind"]);
    assert.deepEqual(Object.keys(some.out.pages[0]).sort(), ["brain", "kind", "path", "title"]);

    const count = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--count"]);
    assert.deepEqual(count.out, { total });

    const text = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--limit", "1"], { tty: true });
    assert.match(text.raw, /… \d+ more: --offset 1/);
  }));

test("page list refuses a bad number and a field a page does not have; an offset needs no limit", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["page", "list", "--limit", "0"])).out.error.code, "usage");
    assert.equal((await w.kioku(["page", "list", "--limit", "many"])).out.error.code, "usage");
    const from = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--offset", "1"]);
    assert.deepEqual([from.out.offset, from.out.limit], [1, 20]);
    const bad = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--fields", "title,nope"]);
    assert.equal(bad.out.error.code, "fields_unknown");
    assert.match(bad.out.error.message, /nope/);
  }));

test("a brain of sixty pages is read twenty at a time, with no page lost or repeated, and the text says how to read on (§6.1)", () =>
  world(async (w) => {
    const sample = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--limit", "1"]);
    const text = readFileSync(join(w.acme, sample.out.pages[0].path), "utf8");
    mkdirSync(join(w.acme, "memory"), { recursive: true });
    for (let i = 0; i < 60; i++)
      writeFileSync(
        join(w.acme, "memory", `bulk-${String(i).padStart(2, "0")}.md`),
        text.replace(/^title: .*$/m, `title: Bulk ${i}`),
      );

    const first = await w.kioku(["page", "list", "--brain", "northwind/brain-acme"]);
    assert.deepEqual([first.out.pages.length, first.out.offset, first.out.limit], [20, 0, 20]);
    assert.ok(first.out.total >= 60);
    const seen: string[] = [];
    for (let offset = 0; offset < first.out.total; offset += 20) {
      const part = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--offset", String(offset)]);
      assert.equal(part.out.total, first.out.total);
      seen.push(...part.out.pages.map((p: { path: string }) => p.path));
    }
    assert.equal(seen.length, first.out.total);
    assert.equal(new Set(seen).size, seen.length, "no page repeated");
    assert.equal(first.out.next, 20, "next is the offset that reads on");
    assert.match(
      (await w.kioku(["page", "list", "--brain", "northwind/brain-acme"], { tty: true })).raw,
      /… \d+ more: --offset 20/,
    );
    assert.deepEqual((await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--count"])).out, {
      total: first.out.total,
    });
  }));
