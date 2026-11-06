/**
 * `pnpm test:demo`: builds the demo brains into a temporary folder and checks they tell the story the demo is for.
 * It takes about a minute, so it is not part of `pnpm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerOf, contextIn, runTool } from "../tool.ts";
import { BRAINS, LOAD_FIRST, SEARCHES, plan } from "./seed.ts";

const root = join(import.meta.dirname, "../..");
const out = mkdtempSync(join(tmpdir(), "kioku-demo-"));

async function kioku(argv: string[]): Promise<any> {
  // No standard input to wait for, and no background sync to start.
  const ctx = contextIn(join(out, ".home"), join(out, "app"), {
    stdin: async () => JSON.stringify({ cwd: join(out, "app"), source: "startup", session_id: "check" }),
  });
  return answerOf((await runTool([...argv, "--json"], ctx)).raw);
}

test("the demo builds, every brain validates, and the maintenance report has a few things to say, not a hundred", async (t) => {
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const built = spawnSync("node", [join(root, "scripts/demo/make.ts"), "--out", out, "--force"], {
    encoding: "utf8",
    timeout: 5 * 60_000,
  });
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const kinds = new Set<string>();
  for (const { repo: name } of Object.values(BRAINS)) {
    const valid = await kioku(["brain", "validate", name]);
    assert.equal(valid.errors, 0, `${name} validates`);
    assert.ok(valid.warnings <= 2, `${name} has at most the warnings the seed leaves on purpose (${valid.warnings})`);

    const pages = await kioku(["page", "list", "--brain", name, "--limit", "1000"]);
    assert.ok(pages.pages.length >= 60, `${name} holds a brain's worth of pages`);
    // Namespaces are a tree (§3.2): some are under another, every one says what it is for, and the brain is format 1.
    const tree = (await kioku(["namespace", "list", "--brain", name])).brains[0].namespaces as {
      namespace: string;
      depth: number;
      summary: string | null;
    }[];
    assert.ok(
      tree.some((n) => n.depth >= 2),
      `${name} has a namespace under another`,
    );
    assert.deepEqual(
      tree.filter((n) => n.summary === null).map((n) => n.namespace),
      [],
      `${name}: every namespace says what it is for`,
    );
    const yaml = readFileSync(join(out, "brains", name, "kioku.yaml"), "utf8");
    assert.match(yaml, /^format: 2$/m);
    assert.ok(yaml.includes(`\nname: ${name}\n`), `${name}: the brain carries its name (§2.2)`);
    const lint = (await kioku(["brain", "lint", name])).brains[0];
    assert.ok(lint.count >= 5 && lint.count <= 40, `${name}: ${lint.count} things to review`);
    for (const [k, v] of Object.entries(lint)) if (Array.isArray(v) && v.length > 0) kinds.add(k);
  }
  // The project brain says where to start, and a search of it finds what each question asks for among the first five.
  for (const s of SEARCHES) {
    const hits = (await kioku(["page", "search", s.query, "--brain", BRAINS.app.repo, "--limit", "5"])).hits as {
      title: string;
    }[];
    assert.ok(
      hits.some((h) => h.title === s.expect),
      `${s.query}: ${hits.map((h) => h.title).join(" | ")}`,
    );
  }
  // What the brains hold, the summary's second part, comes from the second hook (§4.1).
  const start = await kioku(["hook", "session-start-holds"]);
  assert.ok(
    start.hookSpecificOutput.additionalContext.includes(`## Load first\n\n- ${LOAD_FIRST.app![0]}`),
    "the summary opens the project brain with what to load first",
  );
  // Every brain asks after the same spans, and the project brain's ingests left receipts that do not all agree.
  const unconfirmed = (await kioku(["brain", "lint", BRAINS.app.repo])).brains[0].unconfirmed;
  assert.ok(
    unconfirmed.every((u: { path: string; window: number }) => u.window === 270 || !u.path.includes("/context/")),
    "context is asked after 270 days",
  );
  const sources = (await kioku(["brain", "sources", "--brain", BRAINS.app.repo])).sources as {
    source: string;
    version: string | null;
    versions: string[];
  }[];
  const bySource = (s: string) => sources.find((x) => x.source === s);
  assert.equal(
    bySource("docs/architecture.md in northwind/app")?.version,
    "4d2a9e1",
    "every architecture page was read at one commit",
  );
  assert.deepEqual(bySource("docs/runbooks/deploy.md in northwind/app")?.versions, ["a91c3f0", "e5b72d4"]);
  assert.equal(
    bySource("docs/runbooks/deploy.md in northwind/app")?.version,
    null,
    "one page was read again and the rest were not",
  );
  assert.deepEqual(
    bySource("README.md in northwind/app")?.versions,
    [],
    "a source ingested before versions names none",
  );
  // Between the three, every report has something to show.
  for (const k of [
    "similar",
    "staleInstincts",
    "superseded",
    "missingSummary",
    "skillCandidates",
    "expired",
    "unconfirmed",
    "retiredLinks",
    "contradictions",
  ]) {
    assert.ok(kinds.has(k), `a report of ${k} is shown by at least one brain`);
  }
});

test("the demo is Northwind's: its brains are Northwind's and sam's, and no page cites this repository", () => {
  for (const b of Object.values(BRAINS)) assert.match(b.repo, /^(northwind|sam)\//, `${b.repo} is a demo repository`);
  const sources = plan().flatMap((p) => [
    p.source,
    ...(p.supersededBy ? [p.supersededBy.source] : []),
    ...(p.occasions ?? []).map((o) => o.source),
  ]);
  for (const source of sources) assert.doesNotMatch(source, /kioku/i, `${source} is a source of the demo's own`);
});
