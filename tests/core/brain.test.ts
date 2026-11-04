import { type Naming, PLAIN } from "../../src/core/errors.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendChangelog,
  appendEvidence,
  changelogOf,
  evidenceOf,
  kindOf,
  parseBrainFile,
  sectionBody,
  sectionsOf,
  serializeBrainFile,
  withoutChangelog,
  type BrainFile,
} from "../../src/core/brain/file.ts";
import { FIELD_NAMES, FIELDS, REQUIRED_FIELDS } from "../../src/core/brain/fields.ts";
import { TYPE_SPECS, folderFor, placementOf, specFor, typeOf, type PageType } from "../../src/core/brain/kinds.ts";
import { linkBetween, linksOf, pagePath, resolveLink, slugify } from "../../src/core/brain/paths.ts";
import { buildBody, createPage, template } from "../../src/core/brain/page.ts";
import { isUlid, newUlid } from "../../src/core/brain/ulid.ts";
import { readBrain, readBrainConfig } from "../../src/core/brain/brain.ts";
import { stringifyFolderConfig } from "../../src/core/config/folder-config.ts";
import { scratch as scratchIn } from "../fixtures.ts";

const scratch = scratchIn("brain");

function parsed(text: string): BrainFile {
  const r = parseBrainFile(text);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.file;
}

// The decision of §3.3, with a body that holds its required sections.
const FRONT = `---
kind: knowledge
id: 01J9QZ3M7X8K2V5B6N4P0R1S2T
namespace: acme
title: Postgres over MySQL
summary: Acme runs on Postgres; MySQL was ruled out for JSON support.
created: 2026-10-07
source: "Session 2026-10-07 in acme-api"
evidence: "let's go with Postgres, the JSON columns settle it"
---
`;
const BODY =
  "## Decision\n\nPostgres.\n\n## Why\n\nJSON support.\n\n## Consequences\n\nNo MySQL tooling.\n\n## Changelog\n";
const DECISION = FRONT + BODY;
const DECISION_PATH = "knowledge/acme/decisions/postgres-over-mysql.md";

const DECISION_TYPE: PageType = { kind: "knowledge", sub: "decision" };
const INSTINCT_TYPE: PageType = { kind: "memory", sub: "instinct" };

test("the decision of §3.3 round-trips through parse and serialise unchanged", () => {
  const file = parsed(DECISION);
  assert.equal(serializeBrainFile(file), DECISION);
  assert.equal(kindOf(file), "knowledge");
  assert.equal(file.front.getString("id"), "01J9QZ3M7X8K2V5B6N4P0R1S2T");
  assert.equal(placementOf(DECISION_PATH)?.sub, "decision");
});

test("a new decision is written with the front matter of §3.3, field for field", () => {
  const file = createPage({
    type: DECISION_TYPE,
    namespace: "acme",
    title: "Postgres over MySQL",
    summary: "Acme runs on Postgres; MySQL was ruled out for JSON support.",
    created: "2026-10-07",
    source: "Session 2026-10-07 in acme-api",
    evidence: "let's go with Postgres, the JSON columns settle it",
    id: "01J9QZ3M7X8K2V5B6N4P0R1S2T",
    body: BODY,
  });
  assert.equal(serializeBrainFile(file), DECISION);
});

test("unknown fields and field order survive an edit", () => {
  const file = parsed(DECISION);
  file.front.set("superseded_by", "../decisions/cockroach.md");
  const out = serializeBrainFile(file);
  assert.match(out, /^---\nkind: knowledge\nid: 01J9QZ3M7X8K2V5B6N4P0R1S2T\nnamespace: acme\n/);
  assert.match(out, /superseded_by: \.\.\/decisions\/cockroach\.md\n---/);
});

test("the front matter has exactly the fields of §3.3: no state, approval or confidence", () => {
  assert.deepEqual(
    [...FIELD_NAMES],
    [
      "kind",
      "id",
      "namespace",
      "title",
      "summary",
      "aliases",
      "created",
      "source",
      "source_version",
      "evidence",
      "stale_after",
      "status",
      "verified",
      "supersedes",
      "superseded_by",
    ],
  );
  assert.deepEqual([...REQUIRED_FIELDS], ["kind", "id", "namespace", "title", "created", "source"]);
  for (const gone of ["state", "approved", "approved_by", "confidence"]) assert.ok(!FIELD_NAMES.includes(gone), gone);
  assert.deepEqual(
    FIELDS.filter((f) => f.decisionsOnly).map((f) => f.name),
    ["supersedes", "superseded_by"],
  );
});

test("no kind has an inbox or a capture folder", () => {
  for (const folder of ["inbox", "data", "tools", "outputs"])
    assert.equal(placementOf(`${folder}/x.md`), undefined, folder);
  assert.ok(!TYPE_SPECS.some((t) => ["capture", "data", "tool", "output"].includes(t.kind)));
});

// One test per row of the table in §3.4.
const TABLE: { type: PageType; path: string; sections: string[]; changelog: boolean; extra: string[] }[] = [
  {
    type: { kind: "memory" },
    path: "memory/x.md",
    sections: ["What happened", "Lesson", "Rule of thumb"],
    changelog: false,
    extra: [],
  },
  {
    type: INSTINCT_TYPE,
    path: "memory/instincts/x.md",
    sections: ["When", "Do", "Evidence"],
    changelog: false,
    extra: [],
  },
  {
    type: DECISION_TYPE,
    path: "knowledge/acme/decisions/x.md",
    sections: ["Decision", "Why", "Consequences"],
    changelog: true,
    extra: ["supersedes", "superseded_by"],
  },
  {
    type: { kind: "knowledge", sub: "playbook" },
    path: "knowledge/acme/playbooks/x.md",
    sections: ["When", "Steps"],
    changelog: true,
    extra: [],
  },
  {
    type: { kind: "knowledge", sub: "context" },
    path: "knowledge/acme/context/x.md",
    sections: [],
    changelog: true,
    extra: [],
  },
  { type: { kind: "rule" }, path: "rules/x.md", sections: ["Rule", "Why"], changelog: true, extra: [] },
  { type: { kind: "skill" }, path: "skills/x.md", sections: ["When to use", "Steps"], changelog: true, extra: [] },
];

for (const row of TABLE) {
  const name = `${row.type.kind}${row.type.sub ? `/${row.type.sub}` : ""}`;
  test(`§3.4 row ${name}: folder, sections, extra fields, Changelog`, () => {
    assert.equal(pagePath(row.type, "acme", "X"), row.path);
    assert.deepEqual(placementOf(row.path), {
      ...row.type,
      ...(row.type.kind === "knowledge" && { namespace: "acme" }),
    });
    const spec = specFor(row.type);
    assert.deepEqual([...spec.sections], row.sections);
    assert.equal(spec.changelog, row.changelog);
    assert.deepEqual([...spec.extraFields], row.extra);
    const headings = sectionsOf(template(row.type));
    assert.deepEqual(headings, [...row.sections, ...(row.changelog ? ["Changelog"] : [])]);
    assert.equal(spec.evidence, row.type.sub === "instinct");
  });
}

test("the table has one row per type, and nothing else", () => {
  assert.equal(TYPE_SPECS.length, TABLE.length);
});

test("typeOf accepts the subkinds of §3.1 and refuses the rest with a reason", () => {
  assert.deepEqual(typeOf("memory", "instinct"), INSTINCT_TYPE);
  assert.deepEqual(typeOf("rule"), { kind: "rule" });
  const refused = (t: ReturnType<typeof typeOf>) => (t as { error: (n: Naming) => string }).error;
  assert.match(refused(typeOf("knowledge"))(PLAIN), /needs sub decision, playbook, context/);
  assert.match(refused(typeOf("knowledge"))({ field: (f) => `--${f}`, cli: (w) => w }), /--sub decision, playbook/);
  assert.match(refused(typeOf("rule", "decision"))(PLAIN), /no subkind/);
  assert.match(refused(typeOf("memory", "decision"))(PLAIN), /no subkind/);
});

test("placement: a file outside every kind's folder has none", () => {
  for (const p of [
    "x.md",
    "knowledge/acme/x.md",
    "knowledge/acme/notes/x.md",
    "memory/other/x.md",
    "memory/instincts/a/b.md",
    "elsewhere/x.md",
  ]) {
    assert.equal(placementOf(p), undefined, p);
  }
  assert.throws(() => folderFor({ kind: "knowledge", sub: "decision" }));
});

test("ULIDs: valid, immutable on parse, and distinct in the same millisecond", () => {
  const id = newUlid();
  assert.ok(isUlid(id));
  assert.ok(isUlid("01J9QZ3M7X8K2V5B6N4P0R1S2T"));
  for (const bad of ["", "01J9QZ3M7X8K2V5B6N4P0R1S2", "81J9QZ3M7X8K2V5B6N4P0R1S2T", "01J9QZ3M7X8K2V5B6N4P0R1S2I"])
    assert.equal(isUlid(bad), false, bad);
  const now = 1_760_000_000_000;
  const ids = Array.from({ length: 2000 }, () => newUlid(now));
  assert.equal(new Set(ids).size, 2000);
  assert.deepEqual([...ids].sort(), ids, "ids made in order sort in order");
  assert.ok(newUlid(now + 1) > ids[1999]!);
  assert.equal(parsed(DECISION).front.getString("id"), "01J9QZ3M7X8K2V5B6N4P0R1S2T");
  assert.ok(
    isUlid(
      createPage({
        type: DECISION_TYPE,
        namespace: "acme",
        title: "T",
        created: "2026-10-07",
        source: "s",
      }).front.getString("id")!,
    ),
  );
});

test("an all-digit id stays a string through a write", () => {
  const file = createPage({
    type: { kind: "rule" },
    namespace: "acme",
    title: "T",
    created: "2026-10-07",
    source: "s",
    id: "01234567890123456789012345",
  });
  assert.match(serializeBrainFile(file), /id: "01234567890123456789012345"/);
});

test("paths: slugs of titles with accents and punctuation", () => {
  assert.equal(pagePath(DECISION_TYPE, "acme", "Postgres over MySQL"), DECISION_PATH);
  assert.equal(slugify("Migración: ¿antes o después del deploy?"), "migracion-antes-o-despues-del-deploy");
  assert.equal(slugify("  Run `pnpm test` --serially!  "), "run-pnpm-test-serially");
  assert.equal(slugify("Ñandú & café"), "nandu-cafe");
  assert.equal(slugify("a".repeat(120)).length, 80);
  assert.equal(slugify("word ".repeat(40)).endsWith("-"), false);
  assert.throws(() => pagePath({ kind: "rule" }, "acme", "???"), /no letters or digits/);
});

test("links are relative and resolve to a path inside the brain", () => {
  const from = "knowledge/acme/decisions/postgres-over-mysql.md";
  assert.equal(resolveLink(from, "mysql-for-acme.md"), "knowledge/acme/decisions/mysql-for-acme.md");
  assert.equal(resolveLink(from, "../playbooks/migrate.md#steps"), "knowledge/acme/playbooks/migrate.md");
  assert.equal(resolveLink(from, "../../../memory/run-migrations.md"), "memory/run-migrations.md");
  assert.equal(resolveLink(from, "../../../../outside.md"), undefined);
  for (const href of ["https://example.com/x.md", "#section", "/abs.md", "mailto:a@b.c"])
    assert.equal(resolveLink(from, href), undefined, href);
  assert.equal(linkBetween(from, "knowledge/acme/decisions/new.md"), "./new.md");
  assert.equal(linkBetween("memory/instincts/a.md", "skills/b.md"), "../../skills/b.md");
  assert.equal(resolveLink(from, linkBetween(from, "memory/x.md")), "memory/x.md");
  assert.deepEqual(
    linksOf(
      'See [a](../memory/a.md), ![img](x.png), [web](https://x.io), `[c](code.md)`.\n```\n[f](fence.md)\n```\n[g](<sp ace.md> "t")',
    ),
    [
      { target: "../memory/a.md", line: 1 },
      { target: "x.png", line: 1 },
      { target: "sp ace.md", line: 5 },
    ],
  );
});

test("Changelog: a line under an existing or new section, in the shape the summary reads back", () => {
  const decision = parsed(DECISION);
  appendChangelog(decision, "2026-10-08", "Added the migration tooling to the consequences.");
  assert.ok(decision.body.endsWith("## Changelog\n\n- 2026-10-08 Added the migration tooling to the consequences.\n"));
  appendChangelog(decision, "2026-10-09", "Reworded.");
  assert.deepEqual(changelogOf(decision), [
    { date: "2026-10-08", text: "Added the migration tooling to the consequences." },
    { date: "2026-10-09", text: "Reworded." },
  ]);

  const without = parsed(FRONT + "## Decision\n\nx\n");
  appendChangelog(without, "2026-10-08", "x");
  assert.equal(without.body, "## Decision\n\nx\n\n## Changelog\n\n- 2026-10-08 x\n");

  const middle = parsed("---\nkind: rule\n---\n## Changelog\n\n- 2026-01-01 a\n\n## Later\n\nz\n");
  appendChangelog(middle, "2026-01-02", "b");
  assert.equal(middle.body, "## Changelog\n\n- 2026-01-01 a\n- 2026-01-02 b\n\n## Later\n\nz\n");
  assert.throws(() => appendChangelog(parsed(DECISION), "2026-10-08", "two\nlines"), /one line/);
  assert.equal(withoutChangelog(decision.body).includes("Changelog"), false);
});

test("Evidence: dated lines with their source, on an instinct", () => {
  const instinct = createPage({
    type: INSTINCT_TYPE,
    namespace: "sam",
    title: "Run database tests serially",
    created: "2026-10-07",
    source: "Session 2026-10-07 in acme-api",
    body: buildBody(INSTINCT_TYPE, { When: "Tests touch the database.", Do: "Run them serially." }),
  });
  assert.deepEqual(evidenceOf(instinct), []);
  appendEvidence(instinct, "2026-10-07", "parallel run deadlocked", "Session 2026-10-07 in acme-api");
  appendEvidence(instinct, "2026-10-12", "same deadlock in billing", "Session 2026-10-12 in acme-billing");
  assert.deepEqual(evidenceOf(instinct), [
    { date: "2026-10-07", text: "parallel run deadlocked", source: "Session 2026-10-07 in acme-api" },
    { date: "2026-10-12", text: "same deadlock in billing", source: "Session 2026-10-12 in acme-billing" },
  ]);
  assert.equal(sectionBody(instinct.body, "Do"), "Run them serially.");
  assert.equal(sectionsOf(instinct.body).filter((h) => h === "Evidence").length, 1);
  assert.equal(sectionsOf(instinct.body).includes("Changelog"), false);
});

test("a Memory that is not an instinct has neither Changelog nor Evidence", () => {
  const memory = sectionsOf(template({ kind: "memory" }));
  assert.deepEqual(memory, ["What happened", "Lesson", "Rule of thumb"]);
  assert.equal(specFor({ kind: "memory" }).changelog, false);
  assert.equal(specFor({ kind: "memory" }).evidence, false);
});

test("a file with no front matter, an unclosed fence or bad YAML is a reason, not a throw", () => {
  assert.deepEqual(parseBrainFile("# just text\n"), { ok: false, reason: "the file has no front matter" });
  assert.deepEqual(parseBrainFile("---\nkind: memory\n"), { ok: false, reason: "the front matter is never closed" });
  assert.equal(parseBrainFile("---\nkind: [unclosed\n---\nbody\n").ok, false);
  assert.equal(parseBrainFile("---\n- a\n- b\n---\n").ok, false);
  assert.equal(kindOf(parsed("---\nkind: wiki\n---\n")), undefined);
});

test("sections ignore headings inside code fences and find a section's body", () => {
  const body = "## A\n\ntext\n\n```md\n## Not a heading\n```\n\n## B\n\nlast\n";
  assert.deepEqual(sectionsOf(body), ["A", "B"]);
  assert.equal(sectionBody(body, "B"), "last");
  assert.equal(sectionBody(body, "C"), undefined);
});

/** The project brain of §2.5 on disk, with pages of several kinds. */
function projectBrain(root: string): void {
  const put = (rel: string, text: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("kioku.yaml", "format: 1\ntier: project\nnamespaces:\n  - acme\n");
  put("BRAIN.md", "# acme\n");
  put("knowledge/acme/INDEX.md", "# acme knowledge\n");
  put(DECISION_PATH, DECISION);
  put(
    "memory/run-migrations.md",
    `---\nkind: memory\nid: 01J9QZ3M7X8K2V5B6N4P0R1S2U\nnamespace: acme\ntitle: Run migrations first\ncreated: 2026-10-07\nsource: s\n---\n${buildBody({ kind: "memory" })}`,
  );
  put(
    "memory/instincts/serial-db-tests.md",
    `---\nkind: memory\nid: 01J9QZ3M7X8K2V5B6N4P0R1S2V\nnamespace: acme\ntitle: Serial db tests\ncreated: 2026-10-07\nsource: s\n---\n${template(INSTINCT_TYPE)}`,
  );
  put("rules/no-prod-migrations.md", "---\nkind: rule\n---\n## Rule\n");
  put("stray/notes.md", "not a page");
  put(".github/workflows/validate.yml", "x");
}

test("reading a brain: configuration, front pages, and each page's kind from its folder", () =>
  scratch((root) => {
    projectBrain(root);
    const brain = readBrain(root);
    assert.equal(brain.config.tier, "project");
    assert.equal(brain.index, "# acme\n");
    assert.deepEqual(brain.namespaceIndexes, { acme: "# acme knowledge\n" });
    assert.deepEqual(
      brain.pages.map((p) => [p.path, p.placement?.kind, p.placement?.sub, p.parsed.ok]),
      [
        [DECISION_PATH, "knowledge", "decision", true],
        ["memory/instincts/serial-db-tests.md", "memory", "instinct", true],
        ["memory/run-migrations.md", "memory", undefined, true],
        ["rules/no-prod-migrations.md", "rule", undefined, true],
        ["stray/notes.md", undefined, undefined, false],
      ],
    );
  }));

test("the §2.5 project and team kioku.yaml files read into the brain model and write back identical", () =>
  scratch((root) => {
    const files = [
      "format: 1\ntier: project\nnamespaces:\n  - acme\n",
      "format: 1\ntier: team\nnamespaces:\n  - engineering\n  - design\n  - delivery\n",
    ];
    for (const text of files) {
      writeFileSync(join(root, "kioku.yaml"), text);
      assert.equal(stringifyFolderConfig(readBrainConfig(root)), text);
    }
  }));

test("a folder that is not a brain, or whose kioku.yaml is a project folder's, is refused", () =>
  scratch((root) => {
    assert.throws(() => readBrain(root), /no kioku\.yaml/);
    writeFileSync(join(root, "kioku.yaml"), "brain: github.com/northwind/brain-acme\n");
    assert.throws(() => readBrain(root), /project folder's file/);
  }));
