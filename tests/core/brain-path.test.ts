import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

test("<brain> is a name, a tier, a key or a repository, among every brain of the machine, not only the folder's chain", () =>
  world(async (w) => {
    const path = async (word: string) => {
      const r = await w.kioku(["brain", "path", word], { cwd: w.dir });
      assert.equal(r.code, 0, `${word}: ${r.raw}`);
      return r.out.path;
    };
    assert.equal(await path("northwind/brain-acme"), w.acme);
    assert.equal(await path("project"), w.acme);
    assert.equal(await path("team"), w.team);
    assert.equal(await path("northwind/brain"), w.team);
    assert.equal(await path("northwind/brain-acme"), w.acme);
    assert.equal(await path("personal"), w.sam);
    assert.equal((await w.kioku(["brain", "path", "nope"])).out.error.code, "brain_unknown");
  }));

test("brain path prints the folder, as text and as JSON, and needs no terminal", () =>
  world(async (w) => {
    const json = await w.kioku(["brain", "path", "northwind/brain-acme"]);
    assert.deepEqual(json.out, { brain: "northwind/brain-acme", path: w.acme });
    const text = await w.kioku(["brain", "path", "team"], { tty: true });
    assert.equal(text.raw.trim(), w.team);
    assert.equal((await w.kioku(["brain", "path"])).out.error.code, "usage");
  }));

test("a brain that is not on the machine says to sync", () =>
  world(
    async (w) => {
      const r = await w.kioku(["brain", "path", "northwind/brain-acme"]);
      assert.equal(r.code, 1);
      assert.equal(r.out.error.code, "brain_not_cloned");
      assert.match(r.out.error.message, /run kioku sync/);
    },
    { cloned: { acme: false } },
  ));

test("a brain on disk whose kioku.yaml the tool refuses is said so, naming the key, not called not cloned (§2.5)", () =>
  world(async (w) => {
    const file = join(w.acme, "kioku.yaml");
    writeFileSync(file, `colour: blue\n${readFileSync(file, "utf8")}`);
    for (const argv of [
      ["brain", "path", "northwind/brain-acme"],
      ["brain", "validate", "brain-acme"],
    ]) {
      const r = await w.kioku(argv);
      assert.equal(r.code, 1, argv.join(" "));
      assert.equal(r.out.error.code, "brain_config_invalid", r.raw);
      assert.match(
        r.out.error.message,
        /northwind\/brain-acme is on this machine but cannot be read: .*unknown key `colour`/,
      );
    }
  }));

test("a brain this machine knows but has not cloned, named by its repository, says to sync", () =>
  world(
    async (w) => {
      const r = await w.kioku(["brain", "path", "northwind/brain-acme"]);
      assert.equal(r.out.error.code, "brain_not_cloned");
      assert.match(r.out.error.message, /northwind\/brain-acme is not on this machine yet; run kioku sync/);
    },
    { cloned: { acme: false } },
  ));

test("kioku brain open is not a verb: brain path gives the folder to cd to (§2.7)", () =>
  world(async (w) => {
    const r = await w.kioku(["brain", "open", "acme"], { context: { interactive: true } });
    assert.equal(r.out.error.code, "unknown_verb");
  }));
