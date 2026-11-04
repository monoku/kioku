import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli/run.ts";
import { VERB_NAMES } from "../src/cli/verbs.ts";
import { ctx } from "./fixtures.ts";

/**
 * What `kioku help` and `kioku completion` print, byte for byte, kept under tests/golden: a change there is a change a
 * person or a shell sees, and is made on purpose. `KIOKU_UPDATE_GOLDEN=1 pnpm test` writes the files anew. The text is
 * the plain one at 100 columns, what the tests' context gives (`PLAIN`, `NO_COLOR`): no colour, and wrapped there.
 */
const dir = join(import.meta.dirname, "golden");
const update = process.env.KIOKU_UPDATE_GOLDEN === "1";

/** The tool at a terminal (text) or piped (JSON), in a home with nothing in it. */
async function kioku(argv: string[], tty: boolean): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "kioku-golden-"));
  try {
    let raw = "";
    const code = await run(argv, { stdout: (t) => (raw += t), isTty: tty }, ctx({ home }));
    assert.equal(code, 0, `kioku ${argv.join(" ")} exits 0`);
    return raw;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function hold(name: string, actual: string): void {
  const file = join(dir, name);
  if (update || !existsSync(file)) {
    writeFileSync(file, actual);
    return;
  }
  assert.equal(
    actual,
    readFileSync(file, "utf8"),
    `${name} is what the tool prints (KIOKU_UPDATE_GOLDEN=1 rewrites it)`,
  );
}

const GROUPS = ["page", "brain", "namespace", "plugin"];
const SHELLS = ["fish", "zsh", "bash"];

/** Every call to `help`: the overview, as each way of asking for it, each group, alone too, each verb. */
const helpCalls = (): string[][] => [
  ["help"],
  [],
  ["-h"],
  ...GROUPS.map((g) => ["help", g]),
  ...GROUPS.map((g) => [g]),
  ["plugin", "claude-code"],
  ...VERB_NAMES.map((verb) => ["help", ...verb.split(" ")]),
];

test("kioku help prints, as text and as JSON, what tests/golden holds (§6.1)", async () => {
  const calls = helpCalls();
  assert.ok(calls.length > 40, "the overview, four groups and every verb");
  const text: string[] = [];
  const json: string[] = [];
  for (const argv of calls) {
    text.push(`$ kioku ${argv.join(" ")}\n${await kioku(argv, true)}`);
    json.push(`$ kioku ${argv.join(" ")}\n${await kioku(argv, false)}`);
  }
  hold("help.txt", text.join("\n"));
  hold("help.jsonl", json.join(""));
});

test("kioku completion prints, for each shell, the script tests/golden holds (§6.1)", async () => {
  const json: string[] = [];
  for (const shell of SHELLS) {
    hold(`completion.${shell}`, await kioku(["completion", shell], true));
    json.push(`$ kioku completion ${shell} --json\n${await kioku(["completion", shell, "--json"], false)}`);
  }
  hold("completion.jsonl", json.join(""));
});
