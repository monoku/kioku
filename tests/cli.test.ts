import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli/run.ts";
import pkg from "../package.json" with { type: "json" };
import { ctx } from "./fixtures.ts";

// Every call runs against a throwaway home: a test never reads or writes the person's own ~/.kioku.
const home = mkdtempSync(join(tmpdir(), "kioku-cli-"));
test.after(() => rmSync(home, { recursive: true, force: true }));

async function call(argv: string[], isTty = false) {
  let out = "";
  const code = await run(argv, { stdout: (t) => (out += t), isTty }, ctx({ home }));
  return { code, out };
}

test("--version prints the version as JSON when piped", async () => {
  const { code, out } = await call(["--version"]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { version: "0.0.0-dev", contract: 2, formats: [1, 2] });
});

test("--version prints plain text on a terminal", async () => {
  assert.equal((await call(["--version"], true)).out, "0.0.0-dev\n");
});

test("hook subcommands exit zero in a home with no configuration; with no input post-tool-use prints nothing", async () => {
  assert.equal((await call(["hook", "session-start"])).code, 0);
  assert.deepEqual(await call(["hook", "post-tool-use"]), { code: 0, out: "" });
});

test("errors carry a code and a message and a non-zero exit", async () => {
  const { code, out } = await call(["nope", "--json"], true);
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(out), {
    error: { code: "unknown_verb", message: 'unknown verb "nope" (kioku help lists the verbs)' },
  });
});

test("the bundle carries the version of package.json", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("node", [new URL("../lib/kioku.mjs", import.meta.url).pathname, "--version", "--json"], {
    encoding: "utf8",
  });
  assert.equal(JSON.parse(out).version, pkg.version);
});
