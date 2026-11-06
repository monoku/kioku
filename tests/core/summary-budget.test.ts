import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUMMARY_CAP } from "../../src/core/session/summary.ts";
import { isolateGit } from "../remotes.ts";
import { stdinWorld } from "../world.ts";

type W = Parameters<Parameters<typeof stdinWorld>[0]>[0];

isolateGit();

/** A session's start: its two hooks, as the host runs them (§4.1). */
const start = async (w: W, args: string[] = [], env: Record<string, string> = {}) => {
  const stdin = JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" });
  const r = await w.kioku(["hook", "session-start", ...args], stdin, false, { env });
  return { ...r, holds: await w.kioku(["hook", "session-start-holds", ...args], stdin, false, { env }) };
};
/** The summary as the agent reads it: both parts, how to use the memory then what it holds. */
const summaryOf = (r: { out: any; holds?: { out: any } }): string =>
  [r.out.hookSpecificOutput?.additionalContext, r.holds?.out?.hookSpecificOutput?.additionalContext]
    .filter((p) => p !== undefined)
    .join("\n\n");
const SOURCE = ["--source", "Session 2026-10-07 in acme-api", "--evidence", "said so"];
const DECISION = (title: string) => [
  "page",
  "save",
  "--brain",
  "northwind/brain-acme",
  "--kind",
  "knowledge",
  "--sub",
  "decision",
  "--title",
  title,
  "--summary",
  `${title}.`,
  ...SOURCE,
];
const BODY = "## Decision\n\nYes.\n\n## Why\n\nBecause.\n\n## Consequences\n\nNone.\n";

test("a namespace's `## Load first` opens what the memory holds, with its pages' summaries (§4.1)", () =>
  stdinWorld(async (w) => {
    writeFileSync(
      join(w.acme, "knowledge/acme/INDEX.md"),
      "# acme\n\nWhat is true of acme.\n\n## Load first\n\n- [Postgres over MySQL](decisions/postgres-over-mysql.md)\n- [Migrate](playbooks/migrate.md)\n",
    );
    const s = summaryOf(await start(w));
    const holds = s.indexOf("# Kioku: what the brains of this session hold");
    const first = s.indexOf("## Load first");
    const skills = s.indexOf("## Skills");
    assert.ok(
      holds >= 0 && first > holds && skills > first,
      "the second part opens with Load first, before the Skills",
    );
    assert.match(
      s,
      /^- Postgres over MySQL: .* \(northwind\/brain-acme, knowledge\/acme\/decisions\/postgres-over-mysql\.md\)$/m,
    );
    assert.match(s, /^- Migrate.* \(northwind\/brain-acme, knowledge\/acme\/playbooks\/migrate\.md\)$/m);
  }));

test("more than five links, a link to a page that is not there, and a namespace with no section: the validator says, the summary lists five (§5.1)", () =>
  stdinWorld(async (w) => {
    const links = [
      "decisions/postgres-over-mysql.md",
      "decisions/mysql-for-acme.md",
      "playbooks/migrate.md",
      "context/who-is-who.md",
      "decisions/postgres-over-mysql.md",
      "decisions/mysql-for-acme.md",
      "context/gone.md",
    ];
    writeFileSync(
      join(w.acme, "knowledge/acme/INDEX.md"),
      `# acme\n\n## Load first\n\n${links.map((l) => `- [x](${l})`).join("\n")}\n`,
    );
    const r = await w.kioku(["brain", "validate", "northwind/brain-acme"]);
    const warnings = r.out.brains[0].findings
      .filter((f: { severity: string }) => f.severity === "warning")
      .map((f: { warning: string }) => f.warning);
    assert.ok(warnings.includes("load-first-long"));
    assert.ok(warnings.includes("load-first-broken"));
    const s = summaryOf(await start(w));
    const block = s.slice(s.indexOf("## Load first"), s.indexOf("## Skills"));
    assert.equal(block.split("\n").filter((l) => l.startsWith("- ")).length, 5, "five at most");
  }));

test("the summary takes the host's cap and nothing lowers it: --limit is refused, and the variables change nothing (§4.1)", () =>
  stdinWorld(async (w) => {
    const topics = [
      "routing",
      "caching",
      "billing",
      "search",
      "queues",
      "storage",
      "logging",
      "tracing",
      "alerting",
      "deploys",
      "secrets",
      "backups",
      "sessions",
      "uploads",
      "exports",
      "imports",
      "webhooks",
      "schedules",
      "payments",
      "invoices",
      "tenants",
      "quotas",
      "audits",
      "locales",
      "themes",
    ];
    for (const t of topics)
      assert.equal(
        (await w.kioku([...DECISION(`How ${t} works across the platform and who decides`), "--create"], BODY)).out
          .status,
        "done",
      );
    const whole = summaryOf(await start(w));
    assert.ok(whole.length > 2500 && whole.length <= SUMMARY_CAP, `${whole.length} characters`);
    assert.match(whole, /the moment you learn something that will still be true in months/, "when to save, whole");
    for (const env of [{ KIOKU_SUMMARY_LIMIT: "1500" }, { KIOKU_SUMMARY: "off" }] as Record<string, string>[])
      assert.equal(summaryOf(await start(w, [], env)), whole, JSON.stringify(env));
    const flag = await start(w, ["--limit", "3000"]);
    assert.notEqual(flag.code, 0, "--limit is not a flag of the hook");
    assert.equal(flag.out.error.code, "usage", flag.raw);
  }));

test("what the session is about comes first among the decisions, by the repository's folder and the project brain's name (§4.1)", () =>
  stdinWorld(async (w) => {
    await w.kioku(DECISION("Rate limits for the acme gateway"), BODY);
    await new Promise((r) => setTimeout(r, 5));
    await w.kioku(DECISION("Logging format of services"), BODY);
    const s = summaryOf(await start(w));
    const lines = s
      .slice(s.indexOf("## Decisions in northwind/brain-acme"))
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const at = (t: string) => lines.findIndex((l) => l.includes(t));
    assert.ok(
      at("Rate limits for the acme gateway") >= 0 &&
        at("Rate limits for the acme gateway") < at("Logging format of services"),
      "the one that names acme first, though it is the older",
    );
  }));

test("a machine configuration that holds `context` is refused naming it (§2.5)", () =>
  stdinWorld(async (w) => {
    const base = readFileSync(join(w.home, ".kioku/config.yaml"), "utf8");
    writeFileSync(join(w.home, ".kioku/config.yaml"), `${base}context:\n  summary:\n    limit: 4000\n`);
    const r = await w.kioku(["doctor"]);
    const config = r.out.checks.find((c: { name: string }) => c.name === "configuration");
    assert.match(config.detail, /unknown key `context`/);
  }));
