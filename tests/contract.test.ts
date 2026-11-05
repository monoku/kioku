import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_CONTRACT } from "../src/version.ts";
import { commands } from "../src/cli/run.ts";
import { isolateGit } from "./remotes.ts";
import { stdinWorld } from "./world.ts";

isolateGit();

/**
 * The JSON of the verbs is an API for programs that call the tool (§6.1): this pins the fields they may rely on.
 * A field added does not break it; one removed or renamed does, and then `CLI_CONTRACT` moves and the reference says so.
 */
const answers = readFileSync(join(import.meta.dirname, "../docs/reference/answers.md"), "utf8");
/** The part of docs/reference/answers.md that begins with `anchor`, up to the next verb or heading. */
const docOf = (anchor: string): string => {
  const at = answers.indexOf(anchor);
  assert.ok(at >= 0, `docs/reference/answers.md has ${anchor}`);
  const rest = answers.slice(at + anchor.length);
  const end = rest.search(/\n(\*\*`kioku |## )/);
  return end < 0 ? rest : rest.slice(0, end);
};
/** The answer keeps these fields, and docs/reference/answers.md names them where `anchor` begins. */
const has = (value: Record<string, unknown>, keys: string[], what: string, anchor: string): void => {
  const doc = docOf(anchor);
  for (const k of keys) {
    assert.ok(k in value, `${what} keeps \`${k}\` (contract ${CLI_CONTRACT})`);
    assert.ok(doc.includes(`\`${k}\``), `docs/reference/answers.md names \`${k}\` of ${what}, under ${anchor}`);
  }
};

test("the verbs are data a program can list or mount, and the contract has a number", () => {
  assert.equal(CLI_CONTRACT, 2);
  assert.deepEqual(Object.keys(commands).sort(), [
    "brain",
    "completion",
    "config",
    "doctor",
    "help",
    "hook",
    "init",
    "namespace",
    "page",
    "plugin",
    "setup",
    "sync",
    "update",
  ]);
  for (const handler of Object.values(commands)) assert.equal(typeof handler, "function");
});

test("version, doctor and brain list keep the fields programs read", () =>
  stdinWorld(async (w) => {
    const version = await w.kioku(["--version"]);
    has(version.out, ["version", "contract", "formats"], "--version", "**`kioku --version`**");

    const doctor = await w.kioku(["doctor"]);
    has(doctor.out, ["part", "version", "contract", "ok", "checks"], "doctor", "**`kioku doctor`**");
    assert.equal(doctor.out.part, "kioku");
    for (const c of doctor.out.checks) {
      has(c, ["name", "state", "detail"], `doctor check ${c.name}`, "**`kioku doctor`**");
      assert.ok(["ok", "warn", "missing"].includes(c.state));
    }

    const list = await w.kioku(["brain", "list"]);
    has(list.out, ["brains", "chain", "inside", "untrusted"], "brain list", "**`kioku brain list`**");
    has(list.out.brains[0], ["key", "folder", "onDisk", "personal"], "a known brain", "**`kioku brain list`**");
    has(list.out.chain[0], ["tier", "key", "folder", "onDisk"], "a chain link", "**`kioku brain list`**");
  }));

test("every refusal carries error.code and error.message at the top, whatever the verb, and no answer does (§6.1)", () =>
  stdinWorld(async (w) => {
    const refused: string[][] = [
      ["page", "show", "../outside.md"],
      ["page", "show", "knowledge/nope.md"],
      ["page", "save"],
      ["page", "forget", "knowledge/nope.md"],
      ["brain", "path", "nope"],
      ["brain", "lint", "--nope"],
      ["brain", "conflicts", "--nope"],
      ["brain", "refresh", "--nope"],
      ["config", "set", "nope", "1"],
      ["config", "set", "updates", "false"],
      ["namespace", "add"],
      ["plugin", "nope", "install"],
      ["init", "--nope"],
      ["sync", "--nope"],
      ["doctor", "--nope"],
      ["setup", "--nope"],
    ];
    for (const argv of refused) {
      const r = await w.kioku(argv);
      const what = argv.join(" ");
      assert.notEqual(r.code, 0, `${what} refuses`);
      assert.equal(typeof r.out?.error?.code, "string", `${what} answers error.code: ${r.raw}`);
      assert.equal(typeof r.out?.error?.message, "string", `${what} answers error.message`);
    }
    // A verb that writes keeps its own shape beside the error; a report with findings has none, since nothing was refused.
    assert.equal((await w.kioku(["page", "save"])).out.status, "error");
    for (const argv of [
      ["--version"],
      ["brain", "list"],
      ["doctor"],
      ["page", "list", "--brain", "northwind/brain-acme"],
      ["brain", "validate"],
    ]) {
      const r = await w.kioku(argv);
      assert.equal("error" in r.out, false, `${argv.join(" ")} answers no error`);
    }
  }));

test("search, pages, show and log keep the fields programs read", () =>
  stdinWorld(async (w) => {
    await w.kioku(["sync"]);
    const search = await w.kioku(["page", "search", "postgres"]);
    has(search.out, ["mode", "hits"], "search", "**`kioku page search`**");
    has(
      search.out.hits[0],
      ["brain", "path", "id", "title", "kind", "subkind", "namespace", "summary", "snippet", "created", "touched"],
      "a search hit",
      "**`kioku page search`**",
    );

    const pages = await w.kioku(["page", "list", "--brain", "northwind/brain-acme"]);
    has(
      pages.out.pages[0],
      [
        "brain",
        "path",
        "id",
        "kind",
        "subkind",
        "namespace",
        "title",
        "summary",
        "aliases",
        "created",
        "source",
        "evidence",
        "stale_after",
        "supersedes",
        "superseded_by",
        "status",
        "verified",
        "touched",
        "occasions",
        "change",
        "links",
        "linkedFrom",
        "relations",
      ],
      "a page record",
      "**`kioku page list`**",
    );

    const show = await w.kioku(["page", "show", "knowledge/acme/decisions/postgres-over-mysql.md"]);
    has(show.out, ["body", "history"], "show", "**`kioku page show`**");
    has(show.out, ["path", "title", "links", "linkedFrom"], "show", "**`kioku page list`**");
    has(
      show.out.history[0] ?? { commit: 0, date: 0, author: 0, message: 0 },
      ["commit", "date", "author", "message"],
      "a history entry",
      "**`kioku page show`**",
    );

    await w.kioku(
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
        "Where staging lives",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "said so",
      ],
      "## Context\n\nIn the staging bucket.\n",
    );
    const log = await w.kioku(["brain", "log", "--brain", "northwind/brain-acme"]);
    has(log.out, ["since", "writes"], "log", "**`kioku brain log`**");
    has(
      log.out.writes[0],
      ["verb", "title", "path", "date", "author", "commit", "brain"],
      "a write",
      "**`kioku brain log`**",
    );
  }));

test("brain lint keeps the fields programs read", () =>
  stdinWorld(async (w) => {
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    has(
      lint.out.brains[0],
      [
        "brain",
        "similar",
        "staleInstincts",
        "superseded",
        "brokenLinks",
        "missingSummary",
        "skillCandidates",
        "expired",
        "unconfirmed",
        "retiredLinks",
        "contradictions",
        "count",
      ],
      "a lint report",
      "**`kioku brain lint`**",
    );
  }));

test("a writing verb answers one shape: done, similar or error", () =>
  stdinWorld(async (w) => {
    const SOURCE = ["--source", "Session 2026-10-07 in acme-api", "--evidence", "said so"];
    const saved = await w.kioku(
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
        "Where staging lives",
        ...SOURCE,
      ],
      "## Context\n\nIn the staging bucket.\n",
    );
    has(saved.out, ["status", "brain", "path", "commit", "publication", "id"], "a done result", "## Writing verbs");
    assert.equal(saved.out.status, "done");

    const similar = await w.kioku(
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
        "Where staging lives now",
        ...SOURCE,
      ],
      "## Context\n\nElsewhere.\n",
    );
    has(
      similar.out,
      ["status", "brain", "path", "commit", "publication", "similar"],
      "a similar result",
      "## Writing verbs",
    );
    assert.equal(similar.out.status, "similar");
    has(
      similar.out.similar[0],
      ["brain", "path", "title", "kind", "subkind", "summary", "touched"],
      "a similar page",
      "## Writing verbs",
    );

    const error = await w.kioku(["page", "forget", "knowledge/acme/context/nope.md"]);
    has(
      error.out,
      ["status", "brain", "path", "commit", "publication", "error"],
      "an error result",
      "## Writing verbs",
    );
    assert.equal(error.out.status, "error");
    has(error.out.error, ["code", "message"], "the error", "## Writing verbs");

    const outside = await w.kioku(["nope"]);
    has(outside.out.error, ["code", "message"], "an error of a verb that is not a writing one", "## Every verb");
  }));
