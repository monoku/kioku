import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  depthOf,
  isReservedNamespace,
  namespaceBreaksPaths,
  namespaceProblem,
  parentOf,
  RESERVED_NAMESPACES,
} from "../../src/core/brain/namespace-name.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

test("a namespace is a path of folders' names, at most three deep, and a few names are reserved in any case (§3.2)", () => {
  for (const ok of ["acme", "payments", "team-2", "api.v2", "A_b", "9lives", "payments/billing", "a/b/c"])
    assert.equal(namespaceProblem(ok), undefined, ok);
  for (const bad of ["", " a", "a b", "-x", ".hidden", "..", "ñandú", "a//b", "a/", "/a"])
    assert.match(namespaceProblem(bad) ?? "", /letters, digits, dots, dashes and underscores/, bad);
  for (const name of RESERVED_NAMESPACES)
    assert.match(namespaceProblem(name) ?? "", /a name a brain already uses/, name);
  assert.match(namespaceProblem("payments/decisions") ?? "", /a name a brain already uses/, "a part of the path");
  assert.match(namespaceProblem("a/b/c/d") ?? "", /at most 3 deep/);
  assert.ok(isReservedNamespace("Decisions") && isReservedNamespace("INDEX"), "in any case");
  assert.ok(!isReservedNamespace("decisions-2") && !isReservedNamespace("general"), "only the names themselves");
  assert.equal(parentOf("a/b/c"), "a/b");
  assert.equal(parentOf("a"), undefined);
  assert.deepEqual([depthOf("a"), depthOf("a/b")], [1, 2]);
});

test("only what cannot be a folder at all breaks paths; a path is a namespace (§5.1 rule 11)", () => {
  for (const bad of [".", "..", "a/../b", "a\\b", "a//b"]) assert.ok(namespaceBreaksPaths(bad) !== undefined, bad);
  for (const fine of ["a b", "decisions", "-x", "ok", "a/b"]) assert.equal(namespaceBreaksPaths(fine), undefined, fine);
  assert.equal(namespaceBreaksPaths("a/b"), undefined, "a path is a namespace in format 1 (§3.2)");
});

const declare = (root: string, ...names: string[]) => {
  const path = join(root, "kioku.yaml");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /namespaces:\n((?:  - .*\n)+)/,
      (m) => `${m}${names.map((n) => `  - ${JSON.stringify(n)}\n`).join("")}`,
    ),
  );
  for (const n of names) {
    if (n.includes("/") || n === "." || n === "..") continue;
    mkdirSync(join(root, "knowledge", n), { recursive: true });
    appendFileSync(join(root, "knowledge", n, "INDEX.md"), `# ${n}\n\nSomething.\n`);
  }
};

test("the validator errors on a name that cannot be a folder's and warns of one that is odd or reserved (§5.1)", () =>
  world(async (w) => {
    const clean = await w.kioku(["brain", "validate", "northwind/brain-acme"]);
    assert.equal(clean.code, 0, clean.raw);
    declare(w.acme, "decisions", "two words");
    const warned = await w.kioku(["brain", "validate", "northwind/brain-acme"]);
    assert.equal(warned.code, 0, "a warning does not fail");
    const names = warned.out.brains[0].findings
      .filter((f: { warning?: string }) => f.warning?.startsWith("namespace-name"))
      .map((f: { warning: string }) => f.warning)
      .sort();
    assert.deepEqual(names, ["namespace-name-invalid", "namespace-name-reserved"]);
    declare(w.acme, "a//b");
    const broken = await w.kioku(["brain", "validate", "northwind/brain-acme"]);
    assert.equal(broken.code, 1, broken.raw);
    assert.ok(
      broken.out.brains[0].findings.some((f: { rule?: number }) => f.rule === 11),
      "rule 11",
    );
  }));

test("creating or renaming a namespace refuses a name the brain already uses (§3.2)", () =>
  world(async (w) => {
    const rename = await w.kioku(["namespace", "rename", "acme", "decisions", "--brain", "northwind/brain-acme"]);
    assert.equal(rename.out.error.code, "usage");
    assert.match(rename.out.error.message, /a name a brain already uses/);
    const add = await w.kioku(["namespace", "add", "Rules", "--summary", "x", "--brain", "northwind/brain-acme"]);
    assert.equal(add.out.error?.code, "usage", add.raw);
    assert.match(add.out.error.message, /a name a brain already uses/);
  }));

test("namespace add and brain language always name the brain they write to, as page save does (§6.1)", () =>
  world(async (w) => {
    const add = await w.kioku(["namespace", "add", "billing", "--summary", "What is charged."]);
    assert.equal(add.out.error?.code, "usage", add.raw);
    assert.match(add.out.error.message, /--brain is required/);
    const language = await w.kioku(["brain", "language", "es"]);
    assert.equal(language.out.error?.code, "usage", language.raw);
    assert.match(language.out.error.message, /--brain is required/);
    const named = await w.kioku(["namespace", "add", "billing", "--summary", "What is charged.", "--brain", "project"]);
    assert.equal(named.out.error, undefined, named.raw);
  }));
