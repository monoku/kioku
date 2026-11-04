import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { commas, isDoneWrite, jsonLines, listWords, plural, readJson } from "../../src/core/util.ts";

const root = join(import.meta.dirname, "..", "..");

test("the utilities say what they did where they were copied", () => {
  assert.equal(plural(1, "page"), "1 page");
  assert.equal(plural(0, "page"), "0 pages");
  assert.equal(listWords([]), "");
  assert.equal(listWords(["a"]), "a");
  assert.equal(listWords(["a", "b"]), "a and b");
  assert.equal(listWords(["a", "b", "c"]), "a, b and c");
  assert.equal(listWords(["a", "b", "c"], "or"), "a, b or c");
  assert.equal(commas(["a", "b", "a"]), "a, b");
  assert.deepEqual(jsonLines('text\n{"a":1}\n[1]\n{broken\n  {"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  assert.equal(isDoneWrite({ status: "done", publication: "local" }), true);
  assert.equal(isDoneWrite({ status: "done" }), false);
  assert.equal(isDoneWrite({ status: "similar", publication: "local" }), false);
  // An error met after the commit was made carries it, and is a write that exists (§1.6).
  assert.equal(isDoneWrite({ status: "error", commit: "abc1234", publication: "pushed" }), true);
  assert.equal(isDoneWrite({ status: "error", commit: "abc1234", publication: null }), true);
  assert.equal(isDoneWrite({ status: "error", commit: null, publication: null }), false);
  const dir = mkdtempSync(join(tmpdir(), "kioku-util-"));
  try {
    const file = join(dir, "x.json");
    assert.equal(readJson(file), undefined, "not there");
    writeFileSync(file, "{broken");
    assert.equal(readJson(file), undefined, "does not parse");
    writeFileSync(file, '{"a":1}');
    assert.deepEqual(readJson(file), { a: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no copy of a shared helper is left in the core", () => {
  const copies: [string, RegExp][] = [
    ["a private jsonLines", /function jsonLines/],
    ["a private readJson", /const readJson\b|function readJson\b/],
    ["a JSON file read by hand", /JSON\.parse\(readFileSync/],
    ["a list joined by hand", /slice\(0, -1\)\.join/],
    ["a plural by hand", /=== 1 \? "" : "s"/],
    ["a plural spelled out", /=== 1 \? "1 /],
    ["the done write by hand", /"pushed", "pending", "local"\]\.includes/],
  ];
  // Reads that must tell a missing file from a broken one, as `readJson` does not.
  const own = new Set(["src/core/util.ts", "src/core/fs/lock.ts"]);
  const files = (readdirSync(join(root, "src/core"), { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(root, "src/core", f));
  for (const file of files) {
    const name = relative(root, file);
    if (own.has(name)) continue;
    const text = readFileSync(file, "utf8");
    for (const [what, pattern] of copies) assert.doesNotMatch(text, pattern, `${what} in ${name}`);
  }
});
