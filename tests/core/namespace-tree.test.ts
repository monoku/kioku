import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  descriptionOf,
  isDescribed,
  isGenericDescription,
  newIndex,
  withDescription,
} from "../../src/core/brain/namespace-index.ts";
import { placementOf } from "../../src/core/brain/kinds.ts";
import { isFrontPageAt } from "../../src/core/brain/brain.ts";
import { isolateGit } from "../remotes.ts";
import { sh, world } from "../world.ts";

isolateGit();

const MEM =
  "## What happened\n\nThe tests touched the database in parallel and failed.\n\n## Lesson\n\nRun them serially.\n\n## Rule of thumb\n\nStaging deploys wait for a green build.\n";
const DECISION =
  "## Decision\n\nUse invoices per month.\n\n## Why\n\nIt is what finance asked for.\n\n## Consequences\n\nA job runs monthly.\n";
const terminal = { context: { interactive: true } };

test("the namespace of a knowledge page is what lies between knowledge/ and the first folder of a kind (§3.2)", () => {
  assert.deepEqual(placementOf("knowledge/acme/decisions/x.md"), {
    kind: "knowledge",
    sub: "decision",
    namespace: "acme",
  });
  assert.deepEqual(placementOf("knowledge/payments/billing/decisions/x.md"), {
    kind: "knowledge",
    sub: "decision",
    namespace: "payments/billing",
  });
  assert.deepEqual(
    placementOf("knowledge/payments/billing/invoices/playbooks/sub/x.md"),
    { kind: "knowledge", sub: "playbook", namespace: "payments/billing/invoices" },
    "a subfolder under a kind's folder does not change it",
  );
  assert.equal(placementOf("knowledge/payments/INDEX.md"), undefined);
  assert.equal(placementOf("knowledge/decisions/x.md"), undefined, "a folder with no namespace");
  assert.ok(isFrontPageAt("knowledge/payments/billing/INDEX.md"));
  assert.ok(!isFrontPageAt("knowledge/payments/decisions/INDEX.md"), "under a kind's folder it is a page");
  assert.ok(isFrontPageAt("knowledge/decisions/INDEX.md"), "a namespace a brain named before the names were reserved");
});

test("a namespace's description is the paragraph under the title; the generic one says nothing (§3.2)", () => {
  const index = newIndex("payments", "What the team charges, and how.");
  assert.equal(descriptionOf(index), "What the team charges, and how.");
  assert.ok(isDescribed(index));
  const generic = "# acme\n\nWhat is true of acme: decisions, playbooks and context.\n\n## Load first\n\nThe pages.\n";
  assert.ok(isGenericDescription(descriptionOf(generic)!));
  assert.ok(!isDescribed(generic));
  assert.ok(!isDescribed("# x\n\n## Load first\n"), "no paragraph");
  assert.ok(!isDescribed(undefined));
  assert.equal(
    withDescription(generic, "Billing.\nAnd invoices."),
    "# acme\n\nBilling. And invoices.\n\n## Load first\n\nThe pages.\n",
    "only the paragraph changes",
  );
  assert.equal(
    withDescription("# x\n\n## Load first\n", "Hello."),
    "# x\n\nHello.\n\n## Load first\n",
    "added under the title",
  );
});

test("namespace add makes a path under a parent that exists, and describe changes one paragraph (§3.2)", () =>
  world(async (w) => {
    const k = (...a: string[]) => w.kioku(["namespace", ...a, "--brain", "northwind/brain-acme"], terminal);
    const before = Number(sh(w.acme, "rev-list", "--count", "HEAD"));
    const flat = await k("add", "billing", "--summary", "What is charged.");
    assert.equal(flat.out.status, "done", flat.raw);
    assert.equal(flat.out.format, undefined, "nothing raises the format");
    assert.match(readFileSync(join(w.acme, "kioku.yaml"), "utf8"), /format: 2/);

    const orphan = await k("add", "ops/oncall", "--summary", "Who answers.");
    assert.equal(orphan.out.error.code, "not_found", "the parent must exist");
    assert.equal(
      (await k("add", "billing/decisions", "--summary", "x")).out.error.code,
      "usage",
      "a part that is reserved",
    );
    assert.equal((await k("add", "a/b/c/d", "--summary", "x")).out.error.code, "usage", "too deep");
    assert.equal((await k("add", "billing", "--summary", "again")).out.error.code, "path_exists");

    const nested = await k("add", "billing/invoices", "--summary", "How an invoice is made.");
    assert.equal(nested.out.status, "done", nested.raw);
    assert.equal(nested.out.format, undefined, "a path is a namespace in format 2 (§3.2)");
    const yaml = readFileSync(join(w.acme, "kioku.yaml"), "utf8");
    assert.match(yaml, /format: 2/);
    assert.match(yaml, /- billing\/invoices/);
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), before + 2, "one commit each");
    assert.equal(
      readFileSync(join(w.acme, "knowledge/billing/invoices/INDEX.md"), "utf8").split("\n")[2],
      "How an invoice is made.",
    );
    assert.equal((await w.kioku(["brain", "validate", "northwind/brain-acme"])).out.errors, 0, "the brain validates");

    const described = await k("describe", "billing", "--summary", "Charging, and what follows.");
    assert.equal(described.out.status, "done", described.raw);
    assert.match(
      readFileSync(join(w.acme, "knowledge/billing/INDEX.md"), "utf8"),
      /^# billing\n\nCharging, and what follows\.\n\n## Load first/,
    );
    assert.equal(
      (await k("describe", "billing", "--summary", "Charging, and what follows.")).out.error.code,
      "unchanged",
    );
    assert.equal((await k("describe", "nope", "--summary", "x")).out.error.code, "not_found");
  }));

test("a page saved under a path namespace lives in its folder, and rename takes the subtree along, ids and links staying (§3.2)", () =>
  world(async (w) => {
    const k = (...a: string[]) => w.kioku(a, terminal);
    await k("namespace", "add", "billing", "--summary", "What is charged.", "--brain", "northwind/brain-acme");
    await k(
      "namespace",
      "add",
      "billing/invoices",
      "--summary",
      "How an invoice is made.",
      "--brain",
      "northwind/brain-acme",
    );
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "decision",
        "--title",
        "Invoices per month",
        "--summary",
        "Monthly.",
        "--source",
        "https://x.io",
        "--namespace",
        "billing/invoices",
      ],
      { stdin: DECISION },
    );
    assert.equal(saved.out.status, "done", saved.raw);
    assert.equal(saved.out.path, "knowledge/billing/invoices/decisions/invoices-per-month.md");
    const id = saved.out.id;
    const memory = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "memory",
        "--title",
        "Invoices run at night",
        "--summary",
        "Night.",
        "--source",
        "https://x.io",
        "--namespace",
        "billing/invoices",
      ],
      { stdin: MEM },
    );
    assert.equal(memory.out.status, "done", memory.raw);

    const moved = await k("namespace", "rename", "billing", "charges", "--brain", "northwind/brain-acme");
    assert.equal(moved.out.status, "done", moved.raw);
    assert.ok(existsSync(join(w.acme, "knowledge/charges/invoices/decisions/invoices-per-month.md")));
    assert.ok(!existsSync(join(w.acme, "knowledge/billing")));
    const text = readFileSync(join(w.acme, "knowledge/charges/invoices/decisions/invoices-per-month.md"), "utf8");
    assert.match(text, /^namespace: charges\/invoices$/m);
    assert.match(text, new RegExp(`^id: ${id}$`, "m"));
    assert.match(
      readFileSync(join(w.acme, memory.out.path), "utf8"),
      /^namespace: charges\/invoices$/m,
      "a page at the root carries the path too",
    );
    assert.match(readFileSync(join(w.acme, "knowledge/charges/invoices/INDEX.md"), "utf8"), /^# charges\/invoices$/m);
    const yaml = readFileSync(join(w.acme, "kioku.yaml"), "utf8");
    assert.match(yaml, /- charges\n/);
    assert.match(yaml, /- charges\/invoices/);
    assert.equal((await w.kioku(["brain", "validate", "northwind/brain-acme"])).out.errors, 0);

    assert.equal(
      (await k("namespace", "rename", "charges", "charges/inner", "--brain", "northwind/brain-acme")).out.error.code,
      "usage",
      "not into itself",
    );
    const reparented = await k(
      "namespace",
      "rename",
      "charges/invoices",
      "invoices",
      "--brain",
      "northwind/brain-acme",
    );
    assert.equal(reparented.out.status, "done", reparented.raw);
    assert.ok(
      existsSync(join(w.acme, "knowledge/invoices/decisions/invoices-per-month.md")),
      "a new parent is a rename to a new path",
    );
  }));

test("a path declared by hand is a namespace like any other: what it lacks is its INDEX.md, rule 9, not rule 11 (§3.2, §5.1)", () =>
  world(async (w) => {
    await w.kioku(["namespace", "add", "billing", "--summary", "x.", "--brain", "northwind/brain-acme"], terminal);
    const yaml = join(w.acme, "kioku.yaml");
    const { readFileSync: read, writeFileSync: write } = await import("node:fs");
    write(yaml, read(yaml, "utf8").replace(/namespaces:\n/, "namespaces:\n  - billing/inner\n"));
    const report = await w.kioku(["brain", "validate", "northwind/brain-acme"]);
    const rules = report.out.brains[0].findings.map((f: { rule?: number }) => f.rule);
    assert.ok(rules.includes(9) && !rules.includes(11), report.raw);
  }));

test("page move gives a page another namespace: the file moves, the id stays, links in and out follow (§3.2)", () =>
  world(async (w) => {
    const k = (...a: string[]) => w.kioku(a, terminal);
    await k("namespace", "add", "billing", "--summary", "What is charged.", "--brain", "northwind/brain-acme");
    const first = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "decision",
        "--title",
        "Invoices per month",
        "--summary",
        "Monthly.",
        "--source",
        "https://x.io",
        "--namespace",
        "acme",
      ],
      { stdin: DECISION },
    );
    assert.equal(first.out.status, "done", first.raw);
    const linkedBody = `${DECISION}\n## See also\n\n- [Invoices per month](../decisions/invoices-per-month.md)\n`;
    const second = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "decision",
        "--title",
        "Credit notes",
        "--summary",
        "Notes.",
        "--source",
        "https://x.io",
        "--namespace",
        "acme",
        "--create",
      ],
      { stdin: linkedBody },
    );
    assert.equal(second.out.status, "done", second.raw);
    const before = Number(sh(w.acme, "rev-list", "--count", "HEAD"));

    const moved = await w.kioku(
      ["page", "move", first.out.path, "--namespace", "billing", "--brain", "northwind/brain-acme"],
      terminal,
    );
    assert.equal(moved.out.status, "done", moved.raw);
    assert.equal(moved.out.path, "knowledge/billing/decisions/invoices-per-month.md");
    assert.equal(moved.out.from, first.out.path);
    assert.equal(moved.out.id, first.out.id, "the id stays");
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), before + 1, "one commit");
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "move: Invoices per month");
    assert.ok(!existsSync(join(w.acme, first.out.path)));
    const text = readFileSync(join(w.acme, moved.out.path), "utf8");
    assert.match(text, /^namespace: billing$/m);
    assert.match(
      readFileSync(join(w.acme, second.out.path), "utf8"),
      /\(\.\.\/\.\.\/\.\.\/billing\/decisions\/invoices-per-month\.md\)|\(\.\.\/\.\.\/billing\/decisions\/invoices-per-month\.md\)/,
      "a page that linked to it links to the new path",
    );
    assert.equal(
      (await w.kioku(["brain", "validate", "northwind/brain-acme"])).out.errors,
      0,
      "the brain still validates",
    );
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].brokenLinks, []);

    assert.equal(
      (
        await w.kioku(
          ["page", "move", moved.out.path, "--namespace", "billing", "--brain", "northwind/brain-acme"],
          terminal,
        )
      ).out.error.code,
      "unchanged",
    );
    assert.equal(
      (
        await w.kioku(
          ["page", "move", moved.out.path, "--namespace", "nowhere", "--brain", "northwind/brain-acme"],
          terminal,
        )
      ).out.error.code,
      "not_found",
    );

    const memory = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "memory",
        "--title",
        "Night runs",
        "--summary",
        "Night.",
        "--source",
        "https://x.io",
        "--namespace",
        "acme",
      ],
      { stdin: MEM },
    );
    const mm = await w.kioku(
      ["page", "move", memory.out.path, "--namespace", "billing", "--brain", "northwind/brain-acme"],
      terminal,
    );
    assert.equal(mm.out.status, "done", mm.raw);
    assert.equal(mm.out.path, memory.out.path, "a memory keeps its folder");
    assert.match(readFileSync(join(w.acme, memory.out.path), "utf8"), /^namespace: billing$/m);
  }));

test("save in a brain with more than one namespace and none named writes nothing and says what each is for (§3.2, §6.1)", () =>
  world(async (w) => {
    const args = [
      "page",
      "save",
      "--brain",
      "northwind/brain-acme",
      "--kind",
      "knowledge",
      "--sub",
      "decision",
      "--title",
      "Invoices per month",
      "--summary",
      "Monthly.",
      "--source",
      "https://x.io",
    ];
    const one = await w.kioku(args, { stdin: DECISION });
    assert.equal(one.out.status, "done", "one namespace: nothing to choose");
    assert.equal(one.out.namespace, "acme", "the answer says where it went");

    await w.kioku(
      ["namespace", "add", "billing", "--summary", "What is charged, and when.", "--brain", "northwind/brain-acme"],
      terminal,
    );
    const commits = Number(sh(w.acme, "rev-list", "--count", "HEAD"));
    const asked = await w.kioku(
      [
        "page",
        "save",
        ...args.slice(2).map((a) => (a === "Invoices per month" ? "Credit notes" : a)),
        "--create",
      ].slice(0),
      { stdin: DECISION },
    );
    assert.equal(asked.out.status, "namespace", asked.raw);
    assert.equal(asked.out.path, null);
    assert.deepEqual(
      asked.out.namespaces.map((n: { namespace: string }) => n.namespace),
      ["acme", "billing"],
    );
    assert.equal(asked.out.namespaces[1].summary, "What is charged, and when.");
    assert.equal(asked.out.namespaces[0].summary, null, "the generic paragraph says nothing");
    assert.equal(Number(sh(w.acme, "rev-list", "--count", "HEAD")), commits, "nothing was written");

    const chosen = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "decision",
        "--title",
        "Credit notes",
        "--summary",
        "Notes.",
        "--source",
        "https://x.io",
        "--namespace",
        "billing",
        "--create",
      ],
      { stdin: DECISION },
    );
    assert.equal(chosen.out.status, "done", chosen.raw);
    assert.equal(chosen.out.namespace, "billing");
    assert.equal(chosen.out.path, "knowledge/billing/decisions/credit-notes.md");

    const unknown = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "decision",
        "--title",
        "Other",
        "--summary",
        "x.",
        "--source",
        "https://x.io",
        "--namespace",
        "nowhere",
      ],
      { stdin: DECISION },
    );
    assert.equal(unknown.out.error.code, "namespace_unknown");
    assert.match(unknown.out.error.message, /it has acme, billing/);

    // The similar pages come first: nothing is asked about a page that would only be updated.
    const similar = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "decision",
        "--title",
        "Invoices per month",
        "--summary",
        "Again.",
        "--source",
        "https://x.io",
      ],
      { stdin: DECISION },
    );
    assert.equal(similar.out.status, "similar");
  }));

test("the session summary lists each brain's namespaces as a tree, and lint asks the ones that say nothing (§3.2, §4.1, §4.4)", () =>
  world(async (w) => {
    const k = (...a: string[]) => w.kioku(a, terminal);
    await k(
      "namespace",
      "add",
      "billing",
      "--summary",
      "What is charged, and when.",
      "--brain",
      "northwind/brain-acme",
    );
    await k(
      "namespace",
      "add",
      "billing/invoices",
      "--summary",
      "How an invoice is made.",
      "--brain",
      "northwind/brain-acme",
    );
    const start = await w.kioku(["hook", "session-start"], {
      stdin: JSON.stringify({ cwd: w.repo, source: "startup", hook_event_name: "SessionStart" }),
    });
    const text: string = start.out.hookSpecificOutput.additionalContext;
    assert.match(
      text,
      /^- project: northwind\/brain-acme\n {2}- acme: not described \(\d+ pages?\)\n {2}- billing: What is charged, and when\. \(0 pages, 0 more under it\)|^- project: northwind\/brain-acme\n {2}- acme: not described/m,
    );
    assert.match(text, /^ {4}- billing\/invoices: How an invoice is made\. \(0 pages\)$/m, "indented by depth");
    assert.match(text, /Pass `--namespace <path>` to `kioku page save`/, "the line that says how to choose");

    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].undescribed, ["acme"], "the one the tool wrote is not a description");
    const text2 = await w.kioku(["brain", "lint", "northwind/brain-acme"], { tty: true });
    assert.match(text2.raw, /namespaces that do not say what they are for \(kioku namespace describe\)\n {4}acme/);
    await k("namespace", "describe", "acme", "--summary", "The default area.", "--brain", "northwind/brain-acme");
    assert.deepEqual((await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].undescribed, []);
  }));
