import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VERB_NAMES, VERBS } from "../src/cli/verbs.ts";
import { render } from "../scripts/cli-reference.ts";

// The reference cannot silently fall behind the tool: every verb and flag the table declares is named in it.
const root = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const reference = read("docs/reference/cli.md");

test("every verb of the tool has a section in the command-line reference", () => {
  assert.ok(VERB_NAMES.length >= 40);
  for (const verb of VERB_NAMES)
    assert.match(reference, new RegExp(`^### \`kioku ${verb}\``, "m"), `kioku ${verb} is in docs/reference/cli.md`);
});

test("the licence, the security policy and how to contribute exist, and the README links them", () => {
  assert.match(read("LICENSE"), /Apache License[\s\S]*Copyright \d{4} Monoku/);
  assert.equal(JSON.parse(read("package.json")).license, "Apache-2.0");
  assert.match(read("SECURITY.md"), /threat-model\.md/);
  assert.match(read("CONTRIBUTING.md"), /AGENTS\.md/);
  for (const file of ["LICENSE", "SECURITY.md", "CONTRIBUTING.md"])
    assert.ok(read("README.md").includes(`](${file})`), file);
});

test("the README and the docs index link only to files that exist", () => {
  for (const rel of ["README.md", "docs/README.md"]) {
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
    for (const m of read(rel).matchAll(/\]\(([^)#:]+\.md)(?:#[^)]*)?\)/g)) {
      assert.doesNotThrow(() => readFileSync(join(root, dir, m[1]!)), `${rel} links to ${m[1]}`);
    }
  }
});

test("a verb's usage, as kioku help says it, is the reference's usage block, line by line (§6.1)", () => {
  for (const verb of VERB_NAMES) {
    const section = new RegExp(
      `^### \\\`kioku ${verb}\\\`\\n\\n\\\`\\\`\\\`text\\n([\\s\\S]*?)\\n\\\`\\\`\\\``,
      "m",
    ).exec(reference);
    assert.ok(section, `kioku ${verb} has a usage block in docs/reference/cli.md`);
    assert.equal(VERBS[verb].usage.join("\n"), section![1], `kioku ${verb}: help says what the reference says`);
  }
});

test("every § the code, the tests, the plugin and the scripts cite is a heading of the spec", () => {
  const spec = readdirSync(join(root, "docs/specs"))
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .map((f) => read(`docs/specs/${f}`))
    .join("\n");
  const headings = new Set<string>();
  for (const m of spec.matchAll(/^#(#?) (\d+(?:\.\d+)?)\.? /gm)) headings.add(m[2]!);
  assert.ok(headings.has("1") && headings.has("6.4"), "the spec has its parts and sections");
  const files = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? []
        : e.isDirectory()
          ? files(join(dir, e.name))
          : /\.(ts|tsx|mjs|md|json)$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
    );
  const missing = new Set<string>();
  for (const rel of ["src", "tests", "plugins", "scripts"].flatMap(files))
    for (const m of read(rel).matchAll(/(design )?§(\d+(?:\.\d+)?)/g))
      if (m[1] === undefined && !headings.has(m[2]!)) missing.add(`${rel}: §${m[2]}`);
  assert.deepEqual([...missing], []);
});

test("the verbs' part of the command-line reference is what pnpm docs:cli writes from the verbs' table (§6.1)", () => {
  assert.equal(render(reference), reference, "run pnpm docs:cli");
});
