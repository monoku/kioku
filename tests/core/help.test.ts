import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/run.ts";
import { CLI_REFERENCE_URL } from "../../src/product.ts";
import { ctx } from "../fixtures.ts";

/** The tool at a terminal (text), or piped (JSON), in a home with nothing in it. */
async function kioku(argv: string[], tty = true): Promise<{ code: number; raw: string; out: any }> {
  const home = mkdtempSync(join(tmpdir(), "kioku-help-"));
  try {
    let raw = "";
    const code = await run(argv, { stdout: (t) => (raw += t), isTty: tty }, ctx({ home }));
    return { code, raw, out: tty || raw.trim() === "" ? raw : JSON.parse(raw) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("--help after a verb is kioku help with that verb, wherever it comes; kioku help help is kioku help (§6.1)", async () => {
  const overview = (await kioku([])).raw;
  assert.equal((await kioku(["--help"])).raw, overview);
  assert.equal((await kioku(["help", "help"])).raw, overview);
  assert.equal((await kioku(["setup", "--help"])).raw, (await kioku(["help", "setup"])).raw);
  assert.equal((await kioku(["page", "save", "--help"])).raw, (await kioku(["help", "page", "save"])).raw);
  assert.equal(
    (await kioku(["page", "list", "--brain", "sam/brain", "--help"])).raw,
    (await kioku(["help", "page", "list"])).raw,
    "the flags before it are not the verb",
  );
  assert.equal((await kioku(["brain", "validate", "--help"])).raw, (await kioku(["help", "brain", "validate"])).raw);
  assert.match((await kioku(["page", "save", "--help"])).raw, /^kioku page save --brain <b>/);
});

test("help sends to the reference by its address, not by a path of the repository (§6.1)", async () => {
  assert.ok((await kioku([])).raw.includes(CLI_REFERENCE_URL), "the overview names it");
  const one = (await kioku(["help", "page", "save"])).raw;
  assert.ok(one.includes(`${CLI_REFERENCE_URL}#kioku-page-save`), "a verb names its section");
  assert.ok(
    !one.replaceAll(CLI_REFERENCE_URL, "").includes("docs/reference"),
    "no path of the repository, only the address",
  );
});

test("-h is --help, after a verb too, and -v and -V are --version (§6.1)", async () => {
  const overview = (await kioku([])).raw;
  assert.equal((await kioku(["-h"])).raw, overview);
  assert.equal((await kioku(["brain", "-h"])).raw, (await kioku(["help", "brain"])).raw);
  assert.equal((await kioku(["brain", "create", "-h"])).raw, (await kioku(["help", "brain", "create"])).raw);
  for (const flag of ["-v", "-V"]) {
    assert.equal((await kioku([flag])).raw, (await kioku(["--version"])).raw, flag);
    assert.deepEqual((await kioku([flag], false)).out, (await kioku(["--version"], false)).out, flag);
  }
});

test("a verb that does not exist is told the one it resembles, group words and all", async () => {
  assert.match((await kioku(["help", "foo", "bar"], false)).out.error.message, /^unknown verb "foo bar"/);
  assert.match((await kioku(["help", "page", "foo"], false)).out.error.message, /^unknown verb "foo" in kioku page/);
  assert.match((await kioku(["search"], false)).out.error.message, /did you mean kioku page search\?/);
});

test("the overview is short: what Kioku is, the verbs of one word, a line per group, no hook, and how to see more (§6.1)", async () => {
  const text = (await kioku([])).raw;
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[0], "kioku.md · memory for coding agents", "it opens with the mark and what Kioku is");
  assert.ok(lines.length < 27, `${lines.length} lines`);
  assert.ok(
    lines.every((l) => l.length <= 100),
    "no line wider than the terminal",
  );
  for (const word of [
    "setup",
    "doctor",
    "update",
    "completion",
    "config",
    "init",
    "sync",
    "brain",
    "page",
    "namespace",
    "plugin",
  ])
    assert.equal(lines.filter((l) => l.startsWith(`  ${word} `)).length, 1, word);
  assert.doesNotMatch(text, /^ {2}hook /m, "hook is the host's");
  assert.doesNotMatch(text, /brain create|page save/, "a group's verbs are the group's to list");
  assert.match(text, /^ {2}brain\s+.+ \(16 verbs\)$/m);
  assert.match(
    text,
    /kioku <group> lists a group's verbs; kioku help <verb>, or kioku <verb> --help, one verb's usage;\s+the reference/,
  );
  const json = (await kioku([], false)).out;
  assert.ok(
    json.verbs.some((v: { verb: string }) => v.verb === "hook"),
    "JSON still answers every verb",
  );
});

test("at a terminal the overview fits its width, its titles bold in lavender and its verbs and groups bold in orange (§6.1)", async () => {
  let raw = "";
  const home = mkdtempSync(join(tmpdir(), "kioku-help-"));
  try {
    await run([], { stdout: (t) => (raw += t), isTty: true }, ctx({ home, ui: { color: true, columns: 60, home } }));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const plain = raw.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(
    plain.split("\n").every((l) => l.length <= 60 || !l.includes(" ")),
    "a line wider than 60 is one word, the reference's address",
  );
  assert.match(raw, /\x1b\[1m\x1b\[38;2;124;135;224mMachine\x1b\[39m\x1b\[22m/);
  assert.match(raw, /\x1b\[1m\x1b\[38;2;245;162;75mbrain\x1b\[39m\x1b\[22m/);
  assert.match(plain, /^ {2}setup {7}once per machine:.*\n {14}\S/m, "a sentence goes on under its first word");
});

test("a group alone lists its verbs and exits 0, as help does; kioku plugin <host> lists the host's (§6.1)", async () => {
  for (const group of ["brain", "page", "namespace", "plugin"]) {
    const alone = await kioku([group]);
    assert.equal(alone.code, 0, group);
    assert.equal(alone.raw, (await kioku(["help", group])).raw, group);
    assert.deepEqual((await kioku([group], false)).out, (await kioku(["help", group], false)).out, group);
  }
  assert.match((await kioku(["brain"])).raw, /^kioku brain <verb>\n\nMake, clone, .*\.\n\n {2}create /);
  const host = await kioku(["plugin", "claude-code"]);
  assert.equal(host.code, 0);
  assert.match(host.raw, /^kioku plugin claude-code <verb>\n/);
  assert.match(host.raw, /\n {2}install\s+adds .*\n {2}uninstall\s+removes /);
  assert.equal(host.raw, (await kioku(["help", "plugin", "claude-code"])).raw);
  assert.deepEqual(
    (await kioku(["plugin", "claude-code"], false)).out.verbs.map((v: { verb: string }) => v.verb),
    ["plugin claude-code install", "plugin claude-code uninstall"],
  );
});

/** What a call writes to standard error, at a terminal. */
async function stderrOf(argv: string[]): Promise<{ code: number; said: string }> {
  let said = "";
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => (
    (said += String(chunk)), true
  )) as typeof process.stderr.write;
  try {
    const { code } = await kioku(argv);
    return { code, said };
  } finally {
    process.stderr.write = write;
  }
}

test("a verb misused is told in the tool's words, then its usage and where help says more; in JSON one line (§6.1)", async () => {
  const cases: [string[], string][] = [
    [["page", "search", "--nope"], "unknown flag --nope"],
    [["page", "show", "--brain"], "--brain needs a value"],
    [["brain", "sync", "--all=x"], "--all takes no value"],
    [["brain", "list", "x"], "brain list takes no arguments"],
    [["page", "search"], "page search needs the words to look for"],
    [["brain", "path"], "brain path takes one brain"],
    [["config", "set", "x"], "config set takes a key and its value"],
  ];
  for (const [argv, what] of cases) {
    const verb = argv.slice(0, argv[0] === "config" ? 1 : 2).join(" ");
    const { code, said } = await stderrOf(argv);
    assert.equal(code, 1, argv.join(" "));
    const lines = said.trimEnd().split("\n");
    assert.equal(lines[0], `kioku: ${what}`, argv.join(" "));
    assert.ok(lines[1]!.startsWith(`kioku ${verb}`), `${argv.join(" ")}: ${lines[1]}`);
    assert.equal(lines.at(-1), `kioku help ${verb} says more`, argv.join(" "));
    const json = (await kioku(argv, false)).out.error;
    assert.equal(json.code, "usage", argv.join(" "));
    assert.ok(json.message.startsWith(`${what}; kioku ${verb}`), json.message);
    assert.ok(!json.message.includes("\n"), "one line");
  }
  // A writing verb answers its refusal in its own shape, with the usage in it too.
  const save = (await kioku(["page", "save", "--nope"], false)).out;
  assert.equal(save.status, "error");
  assert.match(save.error.message, /^unknown flag --nope; kioku page save --brain <b> .* < body$/);
  assert.match(
    (await kioku(["page", "save", "--nope"])).raw,
    /^Not written: unknown flag --nope\nkioku page save .*\nkioku help page save says more\n$/s,
  );
});

/**
 * The review of 2026-11-01 found usage lines typed again by hand beside the table. A usage line is declared once, in
 * verbs.ts: no other file of the command line holds a text that begins with the tool's name and has a placeholder.
 */
test("no file of the command line but verbs.ts holds a usage line of its own (§6.1)", () => {
  const dir = join(import.meta.dirname, "../../src/cli");
  const placeholder = /<[a-z][a-z |-]*>|\[(?:--|<)/;
  const found: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "verbs.ts")) {
    const code = readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
      .join("\n");
    for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const literal = m[1] ?? m[2]!;
      if (literal.startsWith("kioku ") && placeholder.test(literal)) found.push(`${file}: ${literal}`);
    }
  }
  assert.deepEqual(found, []);
});

test("a hook this version does not know, as a newer plugin may call, answers nothing and ends with success (§6.2)", async () => {
  for (const argv of [["hook", "foo"], ["hook"], ["hook", "stop", "--host", "claude-code"]]) {
    const r = await kioku(argv, false);
    assert.deepEqual([r.code, r.raw], [0, ""], argv.join(" "));
  }
});
