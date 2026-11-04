import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatFinding, validateBrain, validatePage, type Report } from "../../src/core/validate/validate.ts";
import { findSecrets, SECRET_PATTERN_NAMES } from "../../src/core/validate/secrets.ts";
import { run } from "../../src/cli/run.ts";
import { DECISION, RULE, brainYaml, ctx, made, put, ulid, validPages, withBrain, writeBrain } from "../fixtures.ts";

const errorRules = (r: Report) =>
  [...new Set(r.findings.filter((f) => f.severity === "error").map((f) => f.rule))].sort((a, b) => a! - b!);
const warningIds = (r: Report) =>
  [...new Set(r.findings.filter((f) => f.severity === "warning").map((f) => f.warning))].sort();
const edit = (root: string, rel: string, f: (text: string) => string) =>
  put(root, rel, f(readFileSync(join(root, rel), "utf8")));

const POSTGRES = "knowledge/acme/decisions/postgres-over-mysql.md";
const RULE_PAGE = "rules/no-prod-migrations-from-a-session.md";
const INSTINCT_PAGE = "memory/instincts/run-database-tests-serially.md";
const MEMORY_PAGE = "memory/run-migrations-before-the-deploy.md";
const SKILL_PAGE = "skills/release-a-hotfix.md";
const CONTEXT_PAGE = "knowledge/acme/context/who-is-who.md";

test("a valid brain with a page of every type has no findings", () =>
  withBrain((root) => {
    assert.deepEqual(validateBrain(root).findings, []);
    assert.equal(validateBrain(root).files, 8);
  }));

test("the team brain and a personal brain validate with no errors", async () => {
  for (const tier of ["team", "personal"]) {
    const root = mkdtempSync(join(tmpdir(), "kioku-tier-"));
    try {
      writeBrain(root, tier, validPages(), "acme");
      assert.deepEqual(validateBrain(root).findings, [], tier);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Break the valid brain one way and expect exactly one rule to report it, on the file that was broken. */
function breaks(name: string, rule: number, change: (root: string) => void, file?: string) {
  test(`rule ${rule}, and no other: ${name}`, () =>
    withBrain((root) => {
      assert.deepEqual(validateBrain(root).findings, [], "the fixture starts valid");
      change(root);
      const report = validateBrain(root);
      assert.deepEqual(errorRules(report), [rule], report.findings.map(formatFinding).join("\n"));
      if (file !== undefined)
        assert.ok(
          report.findings.some((f) => f.rule === rule && f.path === file),
          `${rule} is reported on ${file}`,
        );
    }));
}

breaks("front matter missing", 1, (r) => put(r, MEMORY_PAGE, "# Just text\n"), MEMORY_PAGE);
breaks("front matter not closed", 1, (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/\n---\n/, "\n")), MEMORY_PAGE);
breaks(
  "front matter not valid YAML",
  1,
  (r) => edit(r, MEMORY_PAGE, (t) => t.replace("title:", "title: [unclosed\nx:")),
  MEMORY_PAGE,
);
breaks("kioku.yaml not valid YAML", 1, (r) => put(r, "kioku.yaml", "name: [x\n"), "kioku.yaml");
breaks("a required field missing", 2, (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/^title: .*\n/m, "")), MEMORY_PAGE);
breaks("source missing", 2, (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/^source: .*\n/m, "")), MEMORY_PAGE);
breaks(
  "kind outside its list",
  2,
  (r) => edit(r, MEMORY_PAGE, (t) => t.replace("kind: memory", "kind: wiki")),
  MEMORY_PAGE,
);
breaks(
  "tier outside its list in kioku.yaml",
  2,
  (r) => edit(r, "kioku.yaml", (t) => t.replace("tier: project", "tier: galaxy")),
  "kioku.yaml",
);
breaks("id missing", 3, (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/^id: .*\n/m, "")), MEMORY_PAGE);
breaks("id malformed", 3, (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/^id: .*$/m, "id: not-a-ulid")), MEMORY_PAGE);
breaks("id duplicated", 3, (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/^id: .*$/m, `id: ${ulid(3)}`)), MEMORY_PAGE);
breaks(
  "namespace not declared",
  4,
  (r) => edit(r, MEMORY_PAGE, (t) => t.replace("namespace: acme", "namespace: other")),
  MEMORY_PAGE,
);
breaks(
  "a context page in the rules folder",
  5,
  (r) => {
    mkdirSync(join(r, "rules"), { recursive: true });
    renameSync(join(r, CONTEXT_PAGE), join(r, "rules/who-is-who.md"));
  },
  "rules/who-is-who.md",
);
breaks(
  "a memory outside any kind's folder",
  5,
  (r) => {
    mkdirSync(join(r, "stray"), { recursive: true });
    renameSync(join(r, MEMORY_PAGE), join(r, "stray/lesson.md"));
  },
  "stray/lesson.md",
);
breaks(
  "a knowledge page in another namespace's folder",
  5,
  (r) => {
    put(r, "kioku.yaml", brainYaml("project", "acme").replace("  - acme", "  - acme\n  - other"));
    put(r, "knowledge/other/INDEX.md", "# other\n");
    mkdirSync(join(r, "knowledge/other/context"), { recursive: true });
    renameSync(join(r, CONTEXT_PAGE), join(r, "knowledge/other/context/who-is-who.md"));
  },
  "knowledge/other/context/who-is-who.md",
);
breaks(
  "a required section missing",
  6,
  (r) => edit(r, POSTGRES, (t) => t.replace("## Why\n\nJSON support.\n\n", "")),
  POSTGRES,
);
breaks(
  "a section missing from an instinct",
  6,
  (r) => edit(r, INSTINCT_PAGE, (t) => t.replace("## Do\n\nRun serially.\n\n", "")),
  INSTINCT_PAGE,
);
breaks(
  "a link to a missing page",
  7,
  (r) => edit(r, POSTGRES, (t) => t.replace("../playbooks/migrate.md", "../playbooks/gone.md")),
  POSTGRES,
);
breaks(
  "supersedes pointing at a missing page",
  7,
  (r) => edit(r, POSTGRES, (t) => t.replace("./mysql-for-acme.md", "./gone.md")),
  POSTGRES,
);
breaks("superseded_by pointing at a missing page", 7, (r) =>
  edit(r, "knowledge/acme/decisions/mysql-for-acme.md", (t) =>
    t.replace("source:", "superseded_by: ./gone.md\nsource:"),
  ),
);
breaks(
  "a secret in a field",
  8,
  (r) =>
    edit(r, MEMORY_PAGE, (t) =>
      t.replace("---\n## What", 'evidence: "Authorization: Bearer abcdefghij0123456789ABCDEFGH"\n---\n## What'),
    ),
  MEMORY_PAGE,
);
breaks("BRAIN.md missing at the root", 9, (r) => rmSync(join(r, "BRAIN.md")), "BRAIN.md");
breaks(
  "INDEX.md missing in a namespace",
  9,
  (r) => rmSync(join(r, "knowledge/acme/INDEX.md")),
  "knowledge/acme/INDEX.md",
);
breaks(
  "a format newer than the tool reads",
  10,
  (r) => edit(r, "kioku.yaml", (t) => t.replace("format: 1", "format: 4")),
  "kioku.yaml",
);

test("rule 10 names both numbers", () =>
  withBrain((root) => {
    edit(root, "kioku.yaml", (t) => t.replace("format: 1", "format: 7"));
    const f = validateBrain(root).findings;
    assert.equal(f.length, 1);
    assert.match(f[0]!.message, /format 7.*newest this tool reads \(1\)/);
  }));

test("a folder that is no brain is an environment error, not a finding", () => {
  const root = mkdtempSync(join(tmpdir(), "kioku-nobrain-"));
  try {
    assert.throws(() => validateBrain(root), /no kioku\.yaml/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Rule 8: a secret of each family in a different kind and place, the pattern named and the secret never echoed.
const TOKEN = "Bearer abcdefghij0123456789ABCDEFGH";
const CONNECTION = "postgres://admin:hunter2hunter2@db.internal:5432/app";
const ID_NUMBER = "cédula de ciudadanía 1.020.304.050";

for (const [name, kindFile, change, what] of [
  [
    "a bearer token in a Memory's evidence",
    MEMORY_PAGE,
    (t: string) => t.replace("---\n## What", `evidence: "${TOKEN}"\n---\n## What`),
    "a bearer token",
  ],
  [
    "a connection string in a Skill's Steps",
    SKILL_PAGE,
    (t: string) => t.replace("1. Branch.", `1. Connect with ${CONNECTION}`),
    "a connection string with credentials",
  ],
  [
    "a government identifier in a context page's body",
    CONTEXT_PAGE,
    (t: string) => t.replace("## Changelog", `Sam's ${ID_NUMBER}.\n\n## Changelog`),
    "a national identity number",
  ],
] as const) {
  test(`rule 8: ${name}`, () =>
    withBrain((root) => {
      edit(root, kindFile, change);
      const report = validateBrain(root);
      assert.deepEqual(errorRules(report), [8]);
      const f = report.findings.find((x) => x.rule === 8)!;
      assert.equal(f.path, kindFile);
      assert.match(f.message, new RegExp(what));
      assert.ok(typeof f.line === "number");
      for (const secret of [TOKEN, CONNECTION, ID_NUMBER, "hunter2hunter2", "1.020.304.050"]) {
        assert.ok(!JSON.stringify(report).includes(secret), "the report never echoes the secret");
      }
    }));
}

test("secret patterns: what matches and what does not", () => {
  const hits = (s: string) => findSecrets(s).map((h) => h.what);
  assert.deepEqual(hits("-----BEGIN RSA PRIVATE KEY-----"), ["a private key"]);
  assert.deepEqual(hits("key AKIAIOSFODNN7EXAMPLE"), ["an AWS access key"]);
  assert.deepEqual(hits(`ghp_${"a".repeat(36)}`), ["a GitHub token"]);
  assert.deepEqual(hits("xoxb-1234567890-abcdef"), ["a Slack token"]);
  assert.deepEqual(hits("password = 'abcdefghijklmnopqrstuvwxyz'"), ["a password or token assignment"]);
  assert.deepEqual(hits("123-45-6789"), ["a US social security number"]);
  assert.deepEqual(hits("4111 1111 1111 1111"), ["a payment card number"]);
  assert.deepEqual(hits("pay to GB82 WEST 1234 5698 7654 32 please"), ["an IBAN"]);
  assert.deepEqual(hits("cuenta de ahorros número 1234567890"), []);
  assert.deepEqual(hits("cuenta número 1234567890"), ["a bank account number"]);
  assert.deepEqual(hits("C.C. 1020304050"), ["a national identity number"]);
  // Things that look close and are not secrets.
  assert.deepEqual(hits("4111 1111 1111 1112"), [], "a number that fails the Luhn check");
  assert.deepEqual(hits("GB00 WEST 1234 5698 7654 32"), [], "an IBAN whose check digits are wrong");
  assert.deepEqual(hits("id: 01J9QZ3M7X8K2V5B6N4P0R1S2T"), []);
  assert.deepEqual(hits("created: 2026-10-07 14:02:33 and 2026-10-07"), []);
  assert.deepEqual(hits("see https://github.com/northwind/brain-acme and git@github.com:northwind/brain.git"), []);
  assert.deepEqual(hits("The token is stored in the keychain; the password lives in 1Password."), []);
  assert.equal(new Set(SECRET_PATTERN_NAMES).size, SECRET_PATTERN_NAMES.length);
});

// The warnings: one page changed per warning, each reports it and no error.
function warns(name: string, id: string, change: (root: string) => void, file: string) {
  test(`warning ${id}: ${name}`, () =>
    withBrain((root) => {
      change(root);
      const report = validateBrain(root);
      assert.deepEqual(errorRules(report), []);
      assert.deepEqual(warningIds(report), [id]);
      assert.equal(report.warnings, 1);
      assert.equal(report.findings[0]!.path, file);
    }));
}

warns(
  "summary missing",
  "summary-missing",
  (r) => edit(r, MEMORY_PAGE, (t) => t.replace(/^summary: .*\n/m, "")),
  MEMORY_PAGE,
);
warns(
  "Changelog missing on a kind that has one",
  "changelog-missing",
  (r) => edit(r, POSTGRES, (t) => t.replace("\n## Changelog\n", "")),
  POSTGRES,
);
warns(
  "a session source with no evidence",
  "evidence-missing",
  (r) => edit(r, POSTGRES, (t) => t.replace(/^evidence: .*\n/m, "")),
  POSTGRES,
);
warns("AGENTS.md missing at the root (§2.7)", "agents-md-missing", (r) => rmSync(join(r, "AGENTS.md")), "AGENTS.md");
warns("an agent host's pointer missing (§2.7)", "host-file-missing", (r) => rmSync(join(r, "CLAUDE.md")), "CLAUDE.md");
warns(
  "the /ingest command missing (§1.7)",
  "host-file-missing",
  (r) => rmSync(join(r, ".claude/commands/ingest.md")),
  ".claude/commands/ingest.md",
);
warns(
  "a Rule over 600 characters",
  "rule-too-long",
  (r) =>
    put(
      r,
      RULE_PAGE,
      made({
        n: 7,
        type: RULE,
        title: "No prod migrations from a session",
        sections: { Rule: "x".repeat(700), Why: "y" },
      }).text,
    ),
  RULE_PAGE,
);

test("a page of a kind with no Changelog does not warn about one; a URL source does not warn about evidence", () =>
  withBrain((root) => {
    assert.deepEqual(validateBrain(root).findings, []);
  }));

test("a Rule of 600 characters does not warn and one of 601 does", () =>
  withBrain((root) => {
    // The length counted is the body after the front matter, without the Changelog, trimmed.
    const rule = (n: number) =>
      made({
        n: 7,
        type: RULE,
        title: "No prod migrations from a session",
        sections: { Rule: "x".repeat(n), Why: "y" },
      }).text;
    const lengthOf = (t: string) =>
      t
        .slice(t.indexOf("---\n", 4) + 4)
        .replace(/\n## Changelog\n$/, "")
        .trim().length;
    const n600 = 1 + (600 - lengthOf(rule(1)));
    assert.equal(lengthOf(rule(n600)), 600);
    put(root, RULE_PAGE, rule(n600));
    assert.deepEqual(warningIds(validateBrain(root)), []);
    assert.equal(lengthOf(rule(n600 + 1)), 601);
    put(root, RULE_PAGE, rule(n600 + 1));
    assert.deepEqual(warningIds(validateBrain(root)), ["rule-too-long"]);
  }));

test("warnings alone exit zero; errors exit non-zero; errors come before warnings", async () =>
  withBrain(async (root) => {
    edit(root, MEMORY_PAGE, (t) => t.replace(/^summary: .*\n/m, ""));
    const out: string[] = [];
    const io = { stdout: (t: string) => out.push(t), isTty: false };
    assert.equal(await run(["brain", "validate", root], io, ctx({ home: root, cwd: "/" })), 0);
    const ok = JSON.parse(out.pop()!);
    assert.deepEqual([ok.ok, ok.errors, ok.warnings], [true, 0, 1]);

    edit(root, SKILL_PAGE, (t) => t.replace("1. Branch.", "1. Use AKIAIOSFODNN7EXAMPLE"));
    assert.equal(await run(["brain", "validate", root], io, ctx({ home: root, cwd: "/" })), 1);
    const bad = JSON.parse(out.pop()!);
    assert.deepEqual([bad.ok, bad.errors, bad.warnings], [false, 1, 1]);
    assert.deepEqual(
      bad.brains[0].findings.map((f: { severity: string }) => f.severity),
      ["error", "warning"],
    );

    const text = { stdout: (t: string) => out.push(t), isTty: true };
    assert.equal(await run(["brain", "validate", root], text, ctx({ home: root, cwd: "/" })), 1);
    const lines = out.pop()!.trim().split("\n");
    assert.match(lines[0]!, new RegExp(`^${SKILL_PAGE}:\\d+: error \\[rule 8\\] looks like an AWS access key`));
    assert.match(lines[1]!, /^memory\/.*: warning \[summary-missing\]/);
    assert.match(lines[2]!, /: 1 error, 1 warning, 8 pages read$/);
  }));

test("brain validate with no argument: the brain the folder is in, else the chain", async () =>
  withBrain(async (root) => {
    const out: string[] = [];
    const io = { stdout: (t: string) => out.push(t), isTty: false };
    const sub = join(root, "memory");
    assert.equal(await run(["brain", "validate"], io, ctx({ home: root, cwd: sub })), 0);
    assert.equal(JSON.parse(out.pop()!).brains[0].root, root);
    assert.equal(await run(["brain", "validate", "nope"], io, ctx({ home: root, cwd: "/" })), 1);
    assert.equal(JSON.parse(out.pop()!).error.code, "brain_unknown");
  }));

test("brain validate with no argument in a linked repository validates the chain's brains on disk", async () => {
  const home = mkdtempSync(join(tmpdir(), "kioku-home-"));
  try {
    const acme = join(home, ".kioku/brains/northwind/brain-acme");
    const team = join(home, ".kioku/brains/northwind/brain");
    writeBrain(acme, "project", validPages(), "acme");
    writeBrain(team, "team", [], "northwind");
    put(
      home,
      ".kioku/config.yaml",
      "repositories:\n  github.com/northwind/brain-acme: {}\n  github.com/northwind/brain: {}\n",
    );
    put(home, "work/acme-api/kioku.yaml", "brain: github.com/northwind/brain-acme\nteam: github.com/northwind/brain\n");
    const out: string[] = [];
    const code = await run(
      ["brain", "validate"],
      { stdout: (t) => out.push(t), isTty: false },
      ctx({ home, cwd: join(home, "work/acme-api") }),
    );
    const result = JSON.parse(out.pop()!);
    assert.equal(code, 0, JSON.stringify(result));
    assert.deepEqual(
      result.brains.map((b: { name: string }) => b.name),
      ["northwind/brain-acme", "northwind/brain"],
    );
    // A name picks one brain of the chain.
    await run(
      ["brain", "validate", "brain-acme"],
      { stdout: (t) => out.push(t), isTty: false },
      ctx({ home, cwd: join(home, "work/acme-api") }),
    );
    assert.deepEqual(
      JSON.parse(out.pop()!).brains.map((b: { name: string }) => b.name),
      ["northwind/brain-acme"],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The single-page function that save, update and supersede call before they commit.
test("validatePage: a duplicate id against the rest of the brain, and an undeclared namespace", () =>
  withBrain((root) => {
    const fresh = made({
      n: 40,
      type: DECISION,
      title: "Use Redis",
      sections: { Decision: "d", Why: "w", Consequences: "c" },
    });
    assert.deepEqual(validatePage(root, fresh.path, fresh.text).findings, []);

    const dup = fresh.text.replace(ulid(40), ulid(2));
    const r = validatePage(root, fresh.path, dup);
    assert.deepEqual(errorRules(r), [3]);
    assert.match(r.findings[0]!.message, /postgres-over-mysql\.md/);

    const rule = made({ n: 41, type: RULE, title: "Use Redis for queues", sections: { Rule: "r", Why: "w" } });
    assert.deepEqual(validatePage(root, rule.path, rule.text).findings, []);
    const wrongNs = validatePage(root, rule.path, rule.text.replace("namespace: acme", "namespace: other"));
    assert.deepEqual(errorRules(wrongNs), [4]);
    assert.match(wrongNs.findings[0]!.message, /"other" is not declared/);
  }));

test("validatePage: a page already on disk does not clash with itself, and brain-wide rules are not run", () =>
  withBrain((root) => {
    const text = readFileSync(join(root, POSTGRES), "utf8");
    assert.deepEqual(validatePage(root, POSTGRES, text).findings, []);
    rmSync(join(root, "BRAIN.md"));
    assert.deepEqual(validatePage(root, POSTGRES, text).findings, []);
    assert.deepEqual(
      errorRules(validatePage(root, POSTGRES, text.replace("../playbooks/migrate.md", "../playbooks/gone.md"))),
      [7],
    );
  }));

test("validatePage reports on the brain's kioku.yaml when it cannot be used", () =>
  withBrain((root) => {
    writeFileSync(join(root, "kioku.yaml"), "format: 9\ntier: project\nnamespaces:\n  - acme\n");
    const r = validatePage(root, POSTGRES, "x");
    assert.deepEqual(errorRules(r), [10]);
  }));
