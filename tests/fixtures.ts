import { PLAIN } from "../src/cli/render.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serializeBrainFile, appendEvidence } from "../src/core/brain/file.ts";
import type { PageType } from "../src/core/brain/kinds.ts";
import { buildBody, createPage } from "../src/core/brain/page.ts";
import { pagePath } from "../src/core/brain/paths.ts";
import { folderFiles } from "../src/core/brains/owned.ts";
import type { Tier } from "../src/core/config/folder-config.ts";
import type { Context } from "../src/cli/run.ts";
import type { SemanticDeps } from "../src/core/semantic/meaning.ts";

export const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

/** Git in `cwd`, what it printed trimmed. */
export const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** Runs of `fn` in a fresh temporary folder, named by `prefix` and removed after it, whether it returns or throws. */
export const scratch =
  (prefix: string) =>
  <T>(fn: (dir: string) => T | Promise<T>): Promise<T> => {
    const dir = mkdtempSync(join(tmpdir(), `kioku-${prefix}-`));
    return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
  };

/** A distinct, valid ULID for each n. */
export const ulid = (n: number): string => `01J9QZ3M7X8K2V5B6N4P0R${String(n).padStart(4, "0")}`;

/** A brain's `kioku.yaml`, with one namespace, `name` by default: a brain's name is its repository's, not the file's (§2.3). */
/** A brain's `kioku.yaml` (§2.5): `format: 2`, with the brain's name, its tier and one namespace. */
export const brainYaml = (tier: string, name = "acme", brain = "northwind/acme"): string =>
  `format: 2\nname: ${brain}\ntier: ${tier}\nnamespaces:\n  - ${name}\n`;

/** The name a brain in `root` takes: its folder's last two parts when they make one, as the managed folder lays it out (§2.5). */
const nameAt = (root: string): string => {
  const parts = root.replace(/\/+$/, "").split("/");
  const name = `${parts.at(-2)}/${parts.at(-1)}`;
  return /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(name) ? name : "northwind/acme";
};

export interface Made {
  path: string;
  text: string;
}

interface PageOptions {
  n: number;
  type: PageType;
  namespace?: string;
  title: string;
  sections?: Record<string, string>;
  summary?: string | null;
  source?: string;
  evidence?: string;
  supersedes?: string;
  noChangelog?: boolean;
  occasions?: number;
}

/** A valid page of any type, built the way the tool builds it. */
export function made(o: PageOptions): Made {
  const ns = o.namespace ?? "acme";
  const file = createPage({
    type: o.type,
    namespace: ns,
    title: o.title,
    created: "2026-10-07",
    id: ulid(o.n),
    source: o.source ?? "https://example.com/where-it-came-from",
    ...(o.summary !== null && { summary: o.summary ?? `${o.title}.` }),
    ...(o.evidence !== undefined && { evidence: o.evidence }),
    ...(o.supersedes !== undefined && { supersedes: o.supersedes }),
    body: buildBody(o.type, o.sections ?? {}),
  });
  if (o.occasions)
    for (let i = 0; i < o.occasions; i++)
      appendEvidence(file, "2026-10-07", `occasion ${i + 1}`, "https://example.com");
  let text = serializeBrainFile(file);
  if (o.noChangelog) text = text.replace(/\n?## Changelog\n$/, "");
  return { path: pagePath(o.type, ns, o.title), text };
}

export const DECISION: PageType = { kind: "knowledge", sub: "decision" };
export const PLAYBOOK: PageType = { kind: "knowledge", sub: "playbook" };
export const CONTEXT: PageType = { kind: "knowledge", sub: "context" };
export const INSTINCT: PageType = { kind: "memory", sub: "instinct" };
export const MEMORY: PageType = { kind: "memory" };
export const RULE: PageType = { kind: "rule" };
export const SKILL: PageType = { kind: "skill" };

/** One valid page per type, linked to each other the way the tool links them. */
export function validPages(): Made[] {
  const old = made({
    n: 1,
    type: DECISION,
    title: "MySQL for Acme",
    sections: { Decision: "MySQL.", Why: "It was there.", Consequences: "None." },
  });
  const current = made({
    n: 2,
    type: DECISION,
    title: "Postgres over MySQL",
    supersedes: "./mysql-for-acme.md",
    source: "Session 2026-10-07 in acme-api",
    evidence: "let's go with Postgres",
    sections: {
      Decision: "Postgres.",
      Why: "JSON support.",
      Consequences: "See [the migration playbook](../playbooks/migrate.md).",
    },
  });
  return [
    old,
    current,
    made({ n: 3, type: PLAYBOOK, title: "Migrate", sections: { When: "Before a deploy.", Steps: "1. Run them." } }),
    made({ n: 4, type: CONTEXT, title: "Who is who", sections: {} }),
    made({
      n: 5,
      type: MEMORY,
      title: "Run migrations before the deploy",
      sections: { "What happened": "x", Lesson: "x", "Rule of thumb": "x" },
    }),
    made({
      n: 6,
      type: INSTINCT,
      title: "Run database tests serially",
      sections: { When: "Tests touch the database.", Do: "Run serially." },
      occasions: 3,
    }),
    made({
      n: 7,
      type: RULE,
      title: "No prod migrations from a session",
      sections: { Rule: "Never.", Why: "Incident of 2026-09." },
    }),
    made({
      n: 8,
      type: SKILL,
      title: "Release a hotfix",
      sections: { "When to use": "Prod is down.", Steps: "1. Branch." },
    }),
  ];
}

/** A brain of `tier` holding `pages`, with its front pages. */
export function writeBrain(root: string, tier = "project", pages: Made[] = validPages(), name = "acme"): void {
  put(root, "kioku.yaml", brainYaml(tier, name, nameAt(root)));
  put(root, "BRAIN.md", `# ${name}\n`);
  for (const f of folderFiles(name, tier as Tier, "0.0.0-dev")) put(root, f.rel, f.text);
  put(root, `knowledge/${name}/INDEX.md`, `# ${name} knowledge\n`);
  for (const p of pages) put(root, p.path, p.text);
}

/** Run `fn` in a scratch folder holding a valid brain. */
export const withBrain = <T>(fn: (root: string) => T | Promise<T>, tier = "project"): Promise<T> =>
  scratch("fixture")((root) => {
    writeBrain(root, tier);
    return fn(root);
  });

/** No network and no engine: what a test gets unless it brings its own (§4.3). */
export const OFFLINE: SemanticDeps = {
  download: async (url) => {
    throw new Error(`no network in tests (${url})`);
  },
  loadEmbedder: async () => {
    throw new Error("no engine in tests");
  },
};

/** The context a verb runs in under test: a fake home, an empty environment, no network. */
export function ctx(o: Partial<Context> & { home: string }): Context {
  return {
    cwd: o.home,
    env: { NO_COLOR: "1" },
    stdin: async () => "",
    now: () => new Date(2026, 9, 7, 12, 0, 0),
    startBackground: () => {},
    semantic: OFFLINE,
    ask: async () => true,
    ui: PLAIN,
    ...o,
  };
}
