import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { stdinWorld } from "../world.ts";

isolateGit();

const A = "knowledge/acme/decisions/postgres-over-mysql.md";
const B = "knowledge/acme/decisions/mysql-for-acme.md";
const CTX = "knowledge/acme/context/who-is-who.md";

test("link --type writes the relation after each link, from each page's side, and pages and lint report it (§3.3, §4.4)", () =>
  stdinWorld(async (w) => {
    const r = await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme", "--type", "contradicts"]);
    assert.equal(r.code, 0, r.raw);
    assert.match(
      readFileSync(join(w.acme, CTX), "utf8"),
      /^- \[Postgres over MySQL\]\(\.\.\/decisions\/postgres-over-mysql\.md\) \(contradicts\)$/m,
    );
    assert.match(
      readFileSync(join(w.acme, A), "utf8"),
      /^- \[Who is who\]\(\.\.\/context\/who-is-who\.md\) \(contradicts\)$/m,
    );

    const pages = await w.kioku(["page", "list", "--brain", "northwind/brain-acme"]);
    const ctx = pages.out.pages.find((p: { path: string }) => p.path === CTX);
    assert.deepEqual(ctx.relations, [{ type: "contradicts", path: A }]);
    assert.deepEqual(pages.out.pages.find((p: { path: string }) => p.path === B).relations, []);

    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].contradictions, [{ a: CTX, b: A }]);
    const human = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", true);
    assert.match(
      human.raw,
      /contradictions nobody has settled\n\s+knowledge\/acme\/context\/who-is-who\.md <-> knowledge\/acme\/decisions\/postgres-over-mysql\.md/,
    );
  }));

test("qualifies reads `qualified by` at the other end; typing an existing plain link upgrades it in place; the same type again is refused (§3.3)", () =>
  stdinWorld(async (w) => {
    assert.equal((await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme"])).code, 0);
    assert.doesNotMatch(readFileSync(join(w.acme, CTX), "utf8"), /\(qualifies\)/);

    const typed = await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme", "--type", "qualifies"]);
    assert.equal(typed.code, 0, typed.raw);
    assert.match(readFileSync(join(w.acme, CTX), "utf8"), /postgres-over-mysql\.md\) \(qualifies\)$/m);
    assert.match(readFileSync(join(w.acme, A), "utf8"), /who-is-who\.md\) \(qualified by\)$/m);
    assert.equal(
      readFileSync(join(w.acme, CTX), "utf8")
        .match(/postgres-over-mysql\.md/g)!
        .filter(Boolean).length,
      readFileSync(join(w.acme, CTX), "utf8").match(/postgres-over-mysql\.md/g)!.length,
    );

    const again = await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme", "--type", "qualifies"]);
    assert.equal(again.out.error.code, "already_linked");
    const bad = await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme", "--type", "agrees"]);
    assert.equal(bad.out.error.code, "usage");
    // A qualification is not a contradiction.
    assert.deepEqual((await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].contradictions, []);
  }));

test("a contradiction is settled by retiring or superseding one side, or by removing the link (§4.4)", () =>
  stdinWorld(async (w) => {
    assert.equal(
      (await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme", "--type", "contradicts"])).code,
      0,
    );
    const open = async () =>
      (await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].contradictions.length;
    assert.equal(await open(), 1);
    assert.equal((await w.kioku(["page", "retire", CTX, "--brain", "northwind/brain-acme"])).code, 0);
    assert.equal(await open(), 0, "retired");
    assert.equal((await w.kioku(["page", "retire", CTX, "--brain", "northwind/brain-acme", "--undo"])).code, 0);
    assert.equal(await open(), 1);
    const gone = await w.kioku(["page", "update", CTX, "--brain", "northwind/brain-acme", "--section", "See also"], "");
    assert.equal(gone.out.error.code, "usage");
  }));

test("a relation survives a rename and a whole-page update (§3.3)", () =>
  stdinWorld(async (w) => {
    assert.equal(
      (await w.kioku(["page", "link", CTX, A, "--brain", "northwind/brain-acme", "--type", "contradicts"])).code,
      0,
    );
    assert.equal(
      (await w.kioku(["page", "rename", A, "--brain", "northwind/brain-acme", "--title", "Postgres is the database"]))
        .code,
      0,
    );
    assert.match(
      readFileSync(join(w.acme, CTX), "utf8"),
      /^- \[Postgres is the database\]\(\.\.\/decisions\/postgres-is-the-database\.md\) \(contradicts\)$/m,
    );
    assert.equal(
      (await w.kioku(["page", "update", CTX, "--brain", "northwind/brain-acme", "--summary", "People"])).code,
      0,
    );
    assert.match(readFileSync(join(w.acme, CTX), "utf8"), /\(contradicts\)$/m);
    assert.deepEqual((await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].contradictions.length, 1);
  }));
