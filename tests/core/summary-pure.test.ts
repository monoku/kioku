import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { parseBrainFile } from "../../src/core/brain/file.ts";
import type { BrainConfig } from "../../src/core/config/folder-config.ts";
import { composeSummaryOffering, type SummaryBrain, type SummaryInput } from "../../src/core/session/summary.ts";

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
    return composeSummaryOffering(i);
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
  const docs = Array.from({ length: 30 }, (_, i) => decision(i + 1));
  const { text, offered } = compose(input(brain(docs), 2_000));
  assert.ok(text.length <= 2_000, `${text.length}`);
  assert.match(text, /this summary shows part of them/);
  const lines = text.split("\n").filter((l) => l.startsWith("- Decision "));
  assert.ok(lines.length > 0 && lines.length < docs.length, `${lines.length} of ${docs.length}`);
  for (const l of lines) assert.match(l, /^- Decision \d+ \(knowledge\/Acme\/decisions\/d\d+\.md\)$/);
  assert.deepEqual(
    lines.map((l) => Number(/Decision (\d+)/.exec(l)![1])),
    Array.from({ length: lines.length }, (_, i) => 30 - i),
  );
  assert.equal(offered.length, lines.length, "only the lines that got in count as offered (§4.5)");
});

test("at a cap of 1,000 the first item that does not fit ends the list, whole or not at all", () => {
  const docs = Array.from({ length: 30 }, (_, i) => decision(i + 1));
  const { text, offered } = compose(input(brain(docs, { lint: 2 }), 1_000));
  assert.match(text, /this summary shows part of them/);
  assert.doesNotMatch(text, /## Decisions/, "a heading goes in with its first item, or not at all");
  assert.doesNotMatch(text, /## To review/, "nothing later jumps ahead");
  assert.deepEqual(offered, []);
});

test("one Rule too large for the cap ends the summary there: nothing later jumps ahead of it", () => {
  const { text, offered } = compose(
    input(
      brain([rule("big", "x".repeat(5_000)), skill("s"), decision(1)], {
        front: "# Acme\n\nThe front page.",
        lint: 2,
      }),
      2_000,
    ),
  );
  assert.ok(text.length <= 2_000, `${text.length}`);
  assert.match(text, /The front page\./, "what came before it stays");
  assert.doesNotMatch(text, /## Rules/, "a heading goes in with its first item, or not at all");
  for (const later of ["## Skills", "## Decisions", "## To review"]) assert.ok(!text.includes(later), later);
  assert.deepEqual(offered, []);
  assert.match(text, /this summary shows part of them/);
});
