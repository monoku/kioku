/**
 * `pnpm eval:memory [-- --runs <n>] [--only <id,id>] [--model <m>]`: how often the agent uses the brains on its own.
 * Not a check: a measure, like `pnpm bench`, to judge a change to the summary, the skill or the hooks against.
 *
 * Each scenario is one prompt, sent with `claude -p` in the demo's code repository (`pnpm demo` makes it), with this
 * checkout's plugin and bundle against the demo's own home: the real `~/.kioku` is never touched. The prompts never
 * name the memory. What the session did is read from its journal (§4.6), never from the agent's words: a `recall`
 * scenario passes when the agent read the brains past the summary and its answer carries what only a page held; `skill`
 * when it opened the brain's Skill; `save` when it wrote; `quiet` when it wrote nothing. The demo's brains are put back
 * as they were after each run, so a save does not help the next one.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareSession } from "../dev/prepare.ts";

type Expect =
  | { kind: "recall"; answer: RegExp }
  | { kind: "skill"; page: string }
  | { kind: "save" }
  | { kind: "quiet" }
  | { kind: "unrecalled" };

interface Scenario {
  id: string;
  /** What the person types; it never names the memory. */
  prompt: string;
  expect: Expect;
}

/** Each passes only through a page the summary does not carry (a Memory, an instinct, a Skill), or by writing one. */
const SCENARIOS: Scenario[] = [
  {
    id: "recall-clock",
    prompt:
      "Staging and production disagree on yesterday's invoice totals. Where should I start looking? Answer in three lines at most, and change no code.",
    expect: { kind: "recall", answer: /clock|reloj|UTC|daylight|horario de verano|time ?zone|zona horaria/i },
  },
  {
    id: "recall-report",
    prompt:
      "Checkout got slow for about four minutes right at the top of the hour last night. What would you look at first? Three lines at most, change no code.",
    expect: { kind: "recall", answer: /replica|réplica|report|reporte|lock|bloque/i },
  },
  {
    id: "recall-refund",
    prompt: "A customer's refund just came back as failed. What should I check first? Three lines at most.",
    expect: { kind: "recall", answer: /dashboard|panel/i },
  },
  {
    id: "skill-upgrade",
    prompt:
      "I want to upgrade one of the app's dependencies to its next major version. Give me the plan in five lines at most, and change nothing in the repository yet.",
    expect: { kind: "skill", page: "skills/dependency-upgrade.md" },
  },
  {
    id: "save-preference",
    prompt:
      "Heads up: in this repo I never want `any` in TypeScript; use `unknown` and narrow it. Now, in one line: what type would you give a JSON payload whose shape we don't know?",
    expect: { kind: "save" },
  },
  {
    id: "save-decision",
    prompt:
      "FYI, the team just decided that order exports move from CSV to Parquet, because Initech's warehouse ingests Parquet natively. Nothing to code yet; just acknowledge in one line.",
    expect: { kind: "save" },
  },
  {
    id: "recall-partner",
    prompt:
      "Acme says some of their orders were created twice after a timeout on our API. Why could that happen? Three lines at most, change no code.",
    expect: { kind: "recall", answer: /retr|reintent|five seconds|cinco segundos|5 ?s/i },
  },
  {
    id: "recall-release-notes",
    prompt: "Where do release notes go in this repo? One line.",
    expect: { kind: "recall", answer: /CHANGELOG/ },
  },
  // A prompt no page bears on: the recall should bring nothing (§4.7).
  {
    id: "unrecalled-code",
    prompt: "Explain the difference between let and const in JavaScript, in two lines.",
    expect: { kind: "unrecalled" },
  },
  // The control: it names the memory, so a fail here is the harness's, not the agent's.
  {
    id: "control-explicit",
    prompt:
      "Search the project's memory for why staging and production once disagreed about a day, and tell me in two lines what it says.",
    expect: { kind: "recall", answer: /clock|reloj|UTC|daylight|horario de verano|time ?zone|zona horaria/i },
  },
  {
    id: "quiet-trivia",
    prompt: "What does `git rebase --onto` do? One short paragraph.",
    expect: { kind: "quiet" },
  },
];

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    only: { type: "string" },
    model: { type: "string", default: "haiku" },
    budget: { type: "string", default: "0.30" },
  },
  strict: true,
  args: process.argv.slice(2).filter((a) => a !== "--"),
});
const runs = Math.max(1, Number(values.runs) || 1);
const only = values.only?.split(",").map((s) => s.trim());
const scenarios = only === undefined ? SCENARIOS : SCENARIOS.filter((s) => only.includes(s.id));

const root = resolve(new URL("../..", import.meta.url).pathname);
const out = join(root, ".demo");
const app = join(out, "app");
const home = join(out, ".home");
const state = join(home, ".kioku");
if (!existsSync(join(app, "kioku.yaml"))) {
  console.error(`${out} has no demo brains yet. Run: pnpm demo`);
  process.exit(1);
}
prepareSession(root, out);

// What a run may change, kept aside and put back after each: the machine's state and brains, and the remotes a write
// pushes to. The search model and the engine are only read, and are large.
const LARGE = new Set(["models", "engine"]);
const kept = mkdtempSync(join(tmpdir(), "kioku-eval-"));
const copyState = (from: string, to: string) => {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => !LARGE.has(src.slice(from.length + 1).split("/")[0] ?? ""),
  });
};
copyState(state, join(kept, "kioku"));
cpSync(join(out, ".remotes"), join(kept, "remotes"), { recursive: true, verbatimSymlinks: true });

/** Waits for the `sync` a session start set off in the background, so that putting the brains back does not race it. */
function waitForSync(): void {
  for (let i = 0; i < 60; i++) {
    const r = spawnSync("pgrep", ["-f", `${join(out, "bin", "kioku")}.*sync|lib/kioku.mjs sync`]);
    if (r.status !== 0) return;
    spawnSync("sleep", ["0.5"]);
  }
}

function restore(): void {
  waitForSync();
  for (const name of ["brains", "sessions", "index.sqlite", "reads.json", "views.json", "pending.json", "lint.json"]) {
    rmSync(join(state, name), { recursive: true, force: true });
  }
  copyState(join(kept, "kioku"), state);
  rmSync(join(out, ".remotes"), { recursive: true, force: true });
  cpSync(join(kept, "remotes"), join(out, ".remotes"), { recursive: true, verbatimSymlinks: true });
}

interface Entry {
  what: string;
  arrow?: "read" | "write";
  path?: string;
  words?: string;
}

interface Result {
  id: string;
  run: number;
  pass: boolean;
  reads: string[];
  writes: string[];
  answer: string;
  cost: number;
  seconds: number;
  error?: string;
}

function journal(sessionId: string): Entry[] {
  const file = join(state, "sessions", `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        const e = JSON.parse(line) as Entry;
        return e.arrow === undefined ? [] : [e];
      } catch {
        return [];
      }
    });
}

function judge(s: Scenario, entries: Entry[], answer: string): boolean {
  // The summary is read by every session; the agent's own reads are the rest.
  const reads = entries.filter((e) => e.arrow === "read" && e.what !== "summary");
  const writes = entries.filter((e) => e.arrow === "write");
  switch (s.expect.kind) {
    case "recall":
      // The page reached the agent, by its own search or by the prompt's recall (§4.7), and the answer carries it.
      return (
        reads.some((e) => e.what === "searched" || e.what === "opened" || e.what === "recalled") &&
        s.expect.answer.test(answer)
      );
    case "skill": {
      const page = s.expect.page;
      return reads.some((e) => e.what === "opened" && e.path === page);
    }
    case "save":
      return writes.length > 0;
    case "unrecalled":
      return !entries.some((e) => e.what === "recalled");
    case "quiet":
      return writes.length === 0;
  }
}

const describe = (e: Entry): string =>
  [e.what, e.path ?? (e.words === undefined ? "" : `"${e.words}"`)].join(" ").trim();

function runOnce(s: Scenario, run: number): Result {
  const started = Date.now();
  const r = spawnSync(
    "claude",
    [
      "-p",
      s.prompt,
      "--model",
      values.model!,
      "--output-format",
      "json",
      "--max-budget-usd",
      values.budget!,
      "--strict-mcp-config",
      // This checkout's plugin, in place of an installed one: the settings' CLAUDE_CODE_PLUGIN_DIRS is not enough.
      "--plugin-dir",
      join(root, "plugins", "claude-code"),
      "--allowedTools",
      "Bash(kioku *)",
      "Skill",
    ],
    {
      cwd: app,
      env: { ...process.env, KIOKU_HOME: home },
      encoding: "utf8",
      timeout: 240_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const seconds = (Date.now() - started) / 1000;
  let parsed: { session_id?: string; result?: string; total_cost_usd?: number; is_error?: boolean } = {};
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* reported below */
  }
  const answer = parsed.result ?? "";
  const entries = parsed.session_id === undefined ? [] : journal(parsed.session_id);
  const result: Result = {
    id: s.id,
    run,
    pass: parsed.session_id !== undefined && judge(s, entries, answer),
    reads: entries.filter((e) => e.arrow === "read" && e.what !== "summary").map(describe),
    writes: entries.filter((e) => e.arrow === "write").map(describe),
    answer,
    cost: parsed.total_cost_usd ?? 0,
    seconds,
  };
  if (parsed.session_id === undefined) result.error = (r.stderr || r.stdout || String(r.error)).trim().slice(0, 300);
  return result;
}

const results: Result[] = [];
try {
  for (const s of scenarios) {
    for (let run = 1; run <= runs; run++) {
      process.stdout.write(`${s.id} #${run} … `);
      const r = runOnce(s, run);
      results.push(r);
      restore();
      console.log(`${r.pass ? "pass" : "FAIL"}  ${r.seconds.toFixed(0)}s  $${r.cost.toFixed(3)}`);
      if (r.error !== undefined) console.log(`  error: ${r.error}`);
      if (r.reads.length > 0) console.log(`  reads:  ${r.reads.join("; ")}`);
      if (r.writes.length > 0) console.log(`  writes: ${r.writes.join("; ")}`);
      console.log(`  answer: ${r.answer.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
} finally {
  restore();
  rmSync(kept, { recursive: true, force: true });
}

const byKind = new Map<string, { pass: number; all: number }>();
for (const r of results) {
  // By the id's first word, so the control is counted apart from the recalls it checks.
  const kind = r.id.split("-")[0]!;
  const k = byKind.get(kind) ?? { pass: 0, all: 0 };
  k.all++;
  if (r.pass) k.pass++;
  byKind.set(kind, k);
}
console.log("");
for (const [kind, k] of byKind) console.log(`${kind.padEnd(7)} ${k.pass}/${k.all}`);
const cost = results.reduce((a, r) => a + r.cost, 0);
console.log(`model ${values.model}, ${results.length} runs, $${cost.toFixed(3)}`);

const report = join(out, "eval");
mkdirSync(report, { recursive: true });
const file = join(report, `memory-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify({ model: values.model, results }, null, 2)}\n`);
console.log(`report: ${file}`);
