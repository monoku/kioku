import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { parseBrainFile } from "../../src/core/brain/file.ts";
import type { BrainConfig } from "../../src/core/config/folder-config.ts";
import {
  RULES_CUT,
  composeSummaryOffering,
  type SummaryBrain,
  type SummaryInput,
} from "../../src/core/session/summary.ts";

const NOW = new Date(2026, 9, 7);

/** A page, from its text alone. */
function page(rel: string, front: Record<string, string>, body: string) {
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const parsed = parseBrainFile(`---\n${yaml}\n---\n\n${body}\n`);
  assert.ok(parsed.ok, rel);
  return { rel, file: parsed.file };
}

const rule = (name: string, body = "Short.") =>
  page(
    `rules/${name}.md`,
    { id: name, title: `Rule ${name}`, kind: "rule" },
    `## Rule\n\n${body}\n\n## Why\n\nBecause.`,
  );
const skill = (name: string) =>
  page(
    `skills/${name}.md`,
    { id: name, title: `Skill ${name}`, kind: "skill", summary: "Does it." },
    "## When\n\nNow.",
  );
const decision = (n: number) =>
  page(
    `knowledge/Acme/decisions/d${n}.md`,
    { id: `d${n}`, title: `Decision ${n}`, kind: "knowledge", created: `2026-09-${String(n).padStart(2, "0")}` },
    "## Decision\n\nThat.",
  );

const brain = (docs: SummaryBrain["docs"], extra: Partial<SummaryBrain> = {}): SummaryBrain => ({
  link: {
    tier: "project",
    key: "k",
    path: "/nowhere",
    cloned: true,
    ref: { owner: "o", repo: "brain-acme" },
  },
  isProject: true,
  config: { form: "brain", tier: "project", namespaces: [] } as unknown as BrainConfig,
  docs,
  ...extra,
});

const input = (b: SummaryBrain, cap?: number): SummaryInput => ({
  ...(cap !== undefined && { cap }),
  brains: [b],
  missing: [],
  problems: [],
  pending: {},
  syncFailures: {},
  now: NOW,
});

/** Composes with every way to the disk closed: the composer takes what was loaded and nothing else. */
function compose(i: SummaryInput) {
  const names = ["readFileSync", "readdirSync", "existsSync", "statSync", "openSync"] as const;
  const shut = fs as unknown as Record<string, unknown>;
  const saved = names.map((n) => shut[n]);
  for (const n of names)
    shut[n] = () => {
      throw new Error(`the composer called ${n}`);
    };
  syncBuiltinESMExports();
  try {
    const c = composeSummaryOffering(i);
    // Both parts, as the agent reads them (§4.1).
    return { ...c, holds: c.holds ?? "", text: `${c.usage}\n\n${c.holds ?? ""}` };
  } finally {
    names.forEach((n, k) => {
      shut[n] = saved[k];
    });
    syncBuiltinESMExports();
  }
}

test("the sections keep the order of §4.1, with no file system", () => {
  const { text } = compose(
    input(
      brain([rule("a"), skill("s"), decision(1)], {
        front: "# Acme\n\nThe front page.",
        lint: 2,
        news: [{ change: "added", path: "p.md", title: "New page" }],
      }),
    ),
  );
  const at = [
    "acme: front page",
    "## Rules",
    "## Skills",
    "## Decisions in o/brain-acme",
    "## New in o/brain-acme",
    "## To review",
  ].map((h) => text.indexOf(h));
  assert.ok(
    at.every((n) => n >= 0),
    `every section is there: ${at}`,
  );
  assert.deepEqual(
    at,
    [...at].sort((x, y) => x - y),
  );
});

test("the cut falls between items, the newest first with none skipped", () => {
  const docs = Array.from({ length: 80 }, (_, i) => decision(i + 1));
  const { holds, offered } = compose(input(brain(docs), 2_000));
  assert.ok(holds.length <= 2_000, `${holds.length}`);
  assert.match(holds, /this summary shows part of them/);
  const lines = holds.split("\n").filter((l) => l.startsWith("- Decision "));
  assert.ok(lines.length > 0 && lines.length < docs.length, `${lines.length} of ${docs.length}`);
  for (const l of lines) assert.match(l, /^- Decision \d+ \(knowledge\/Acme\/decisions\/d\d+\.md\)$/);
  assert.deepEqual(
    lines.map((l) => Number(/Decision (\d+)/.exec(l)![1])),
    Array.from({ length: lines.length }, (_, i) => 80 - i),
  );
  assert.equal(offered.length, lines.length, "only the lines that got in count as offered (§4.5)");
});

test("at a cap of 1,000 the first item that does not fit ends the list, whole or not at all", () => {
  const docs = Array.from({ length: 30 }, (_, i) => decision(i + 1));
  const { holds, offered } = compose(input(brain(docs, { lint: 2 }), 1_000));
  assert.ok(holds.length <= 1_000, `${holds.length}`);
  assert.match(holds, /this summary shows part of them/);
  const lines = holds.split("\n").filter((l) => l.startsWith("- Decision "));
  assert.ok(lines.length < docs.length, "the decisions are cut");
  assert.equal(
    holds.includes("## Decisions"),
    lines.length > 0,
    "a heading goes in with its first item, or not at all",
  );
  assert.doesNotMatch(holds, /## To review/, "nothing later jumps ahead");
  assert.equal(offered.length, lines.length);
});

test("one Rule too large for the cap ends the first part there and says so; the second part is whole (§4.1)", () => {
  const { usage, holds, offered } = compose(
    input(
      brain([rule("big", "x".repeat(5_000)), skill("s"), decision(1)], {
        front: "# Acme\n\nThe front page.",
        lint: 2,
      }),
      2_000,
    ),
  );
  assert.ok(usage.length <= 2_000, `${usage.length}`);
  assert.match(usage, /The front page\./, "what came before it stays");
  assert.doesNotMatch(usage, /## Rules/, "a heading goes in with its first item, or not at all");
  assert.ok(usage.trimEnd().endsWith(RULES_CUT), "the first part says the Rules were cut, and how to list them");
  for (const later of ["## Skills", "## Decisions", "## To review"]) assert.ok(holds.includes(later), later);
  assert.equal(offered.length, 2, "the Skill and the decision, offered by the second part");
  assert.doesNotMatch(holds, /this summary shows part of them/);
});

test("a Rule is its Rule and its Why: never its See also, Evidence or Changelog (§4.1)", () => {
  const withKept = page(
    "rules/kept.md",
    { id: "kept", title: "Rule kept", kind: "rule" },
    "## Rule\n\nDo it.\n\n## Why\n\nBecause.\n\n## Evidence\n\n- 2026-09-01: said so\n\n## See also\n\n- [Other](other.md)\n\n## Changelog\n\n- 2026-09-01: made",
  );
  const bare = page(
    "rules/bare.md",
    { id: "bare", title: "Rule bare", kind: "rule" },
    "Just this.\n\n## See also\n\n- [x](x.md)",
  );
  const { usage } = compose(input(brain([withKept, bare])));
  assert.match(usage, /### Rule kept \(o\/brain-acme, rules\/kept\.md\)\n\nDo it\.\n\nWhy: Because\./);
  assert.match(
    usage,
    /### Rule bare \(o\/brain-acme, rules\/bare\.md\)\n\nJust this\./,
    "one written without the sections, its body",
  );
  for (const kept of ["See also", "Evidence", "Changelog", "said so", "other.md", "x.md"])
    assert.ok(!usage.includes(kept), kept);
});

test("what lint has to review is the first thing the second part's cap cuts; its last line never is (§4.1)", () => {
  const docs = Array.from({ length: 30 }, (_, i) => decision(i + 1));
  const whole = compose(input(brain(docs, { lint: 2 }))).holds;
  assert.match(whole, /## To review/);
  const cut = compose(input(brain(docs, { lint: 2 }), whole.length - 5)).holds;
  assert.doesNotMatch(cut, /## To review/, "lint goes first");
  assert.ok(whole.length > 1_000, "past the least cap, so the cap given is the one used");
  for (let n = 1; n <= 30; n++) assert.ok(cut.includes(`- Decision ${n} `), `every decision stays: ${n}`);
  assert.match(cut, /this summary shows part of them\. `kioku page search <words>` finds them/, "the last line stays");
});

test("the first part says Rules were cut only when one was: a front page too long with no Rules says nothing of them (§4.1)", () => {
  const { usage } = compose(input(brain([decision(1)], { front: `# Acme\n\n${"x".repeat(5_000)}` }), 1_500));
  assert.ok(!usage.includes(RULES_CUT), "no Rule, nothing said of Rules");
  const ruled = compose(input(brain([rule("big", "x".repeat(5_000))]), 1_500)).usage;
  assert.ok(ruled.trimEnd().endsWith(RULES_CUT), "a Rule that did not fit is said");
});
