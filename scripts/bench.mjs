/**
 * `pnpm bench [--runs <n>] [--big <n>] [--save] [--compare]`: how fast Kioku answers and how much it costs an agent in tokens.
 *
 * Builds the bundle (`lib/kioku.mjs`, what a person runs) and the demo brains of `scripts/demo/make.ts` into a
 * temporary folder, then runs a fixed set of commands against them, each `--runs` times (7 by default; one more is run
 * first and thrown away, since the first call after a build is the slow one). Per command it prints the median time and
 * the size of the answer, in bytes and in rough tokens (bytes / 4). Bytes are deterministic, so they are the measure
 * that can be compared exactly; milliseconds depend on the machine and are only worth comparing on the same one.
 * `--save` writes both to `benchmarks/times.local.json`, which git ignores; `--compare` shows the change against it, so
 * save on `main` and compare on the branch.
 *
 * It measures no search quality, and it measures hybrid search never: the bench runs on a
 * clean home with no embedding model, so search is full text. The real `~/.kioku` is not touched.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { answerOf, contextIn, runTool } from "./tool.ts";

const root = new URL("..", import.meta.url).pathname;
const { values } = parseArgs({
  options: {
    runs: { type: "string" },
    big: { type: "string" },
    save: { type: "boolean" },
    compare: { type: "boolean" },
  },
  strict: true,
});
const runs = Number(values.runs ?? 7);
if (!Number.isInteger(runs) || runs < 1) {
  console.error("--runs is a whole number, 1 or more");
  process.exit(1);
}
const savedFile = join(root, "benchmarks/times.local.json");

const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: root, ...o });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r;
};

const tmp = mkdtempSync(join(tmpdir(), "kioku-bench-"));
try {
  console.error("Building the bundle and the demo brains...");
  sh("node", ["scripts/build.mjs"]);
  sh("node", ["scripts/demo/make.ts", "--out", tmp, "--force"], { timeout: 5 * 60_000 });

  const home = join(tmp, ".home");
  const app = join(tmp, "kioku-app");
  // Full text always, and no daily look for a new version: the same run on any machine.
  appendFileSync(
    join(home, ".kioku/config.yaml"),
    "display:\n  mute:\n    - update-available\nsearch:\n  mode: full-text\n",
  );
  const env = {
    ...process.env,
    KIOKU_HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  delete env.CLAUDECODE;
  const bundle = join(root, "lib/kioku.mjs");

  /** One call of the built tool as a real one is made: a new process, so Node's own start counts. */
  const call = (args, input = "") => {
    const t0 = performance.now();
    const r = spawnSync("node", [bundle, ...args], { cwd: app, env, input, maxBuffer: 64 * 1024 * 1024 });
    return { ms: performance.now() - t0, bytes: r.stdout.length, out: r.stdout.toString("utf8"), status: r.status };
  };

  // The index and the clones are the machine's, made once, not what is measured: here, in this process.
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
  const context = contextIn(home, app, { env });
  await runTool(["sync", "--json"], context);

  const first = answerOf((await runTool(["page", "list", "--brain", "kioku", "--json"], context)).raw).pages[0];
  // A page is pointed to once per session, so each call is a session of its own.
  let sessions = 0;
  const hookInput = (extra) => () => JSON.stringify({ cwd: app, session_id: `bench-${sessions++}`, ...extra });
  const commands = [
    {
      name: "node -e 0 (Node's own start)",
      run: () => {
        const t0 = performance.now();
        spawnSync("node", ["-e", "0"], { env });
        return { ms: performance.now() - t0, bytes: 0, status: 0 };
      },
    },
    { name: "--version", args: ["--version", "--json"] },
    { name: "brain list", args: ["brain", "list", "--json"] },
    { name: "brain stats", args: ["brain", "stats", "--json"] },
    { name: "brain lint", args: ["brain", "lint", "--json"] },
    { name: "brain log --since 90d", args: ["brain", "log", "--since", "90d", "--json"] },
    { name: "namespace list", args: ["namespace", "list", "--json"] },
    { name: "page list", args: ["page", "list", "--json"] },
    { name: "page list --limit 10", args: ["page", "list", "--limit", "10", "--json"] },
    { name: "page search release", args: ["page", "search", "release", "--json"] },
    { name: "page search release --limit 5", args: ["page", "search", "release", "--limit", "5", "--json"] },
    { name: "page show", args: ["page", "show", first.path, "--brain", "kioku", "--json"] },
    { name: "doctor", args: ["doctor", "--json"] },
    {
      name: "hook session-start",
      args: ["hook", "session-start"],
      input: hookInput({ source: "startup" }),
      session: true,
    },
  ];

  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const results = [];
  const measure = (list) => {
    for (const c of list) {
      const once = () => (c.run ? c.run() : call(c.args, typeof c.input === "function" ? c.input() : c.input));
      once(); // the first call is thrown away
      const samples = Array.from({ length: runs }, once);
      const sizes = new Set(samples.map((s) => s.bytes));
      results.push({
        name: c.name,
        ms: Math.round(median(samples.map((s) => s.ms))),
        bytes: samples[0].bytes,
        stable: sizes.size === 1,
        failed: samples.some((s) => s.status === null || (s.bytes === 0 && !c.run && !c.args.includes("hook"))),
        session: c.session === true,
      });
    }
  };
  measure(commands);

  // A brain of thousands of pages, which the demo's few hundred do not show (§6.1, bounded answers): the pages of the
  // `kioku` brain copied under a namespace of its own, after the commands above so that their answers stay the demo's.
  // (`brain lint` is not measured on copies: they would all be findings.)
  // `--big <n>` sets how many (2000 by default); the commands below are measured on it.
  const bigCount = Number(values.big ?? 2000);
  const folder = join(tmp, "kioku");
  const sample = readFileSync(join(folder, first.path), "utf8");
  mkdirSync(join(folder, "memory/bench"), { recursive: true });
  for (let i = 0; i < bigCount; i++)
    writeFileSync(
      join(folder, "memory/bench", `page-${i}.md`),
      sample.replace(/^title: .*$/m, `title: Bench page ${i}`),
    );
  sh("git", ["-C", folder, "add", "-A"]);
  sh("git", [
    "-C",
    folder,
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@example.com",
    "commit",
    "-q",
    "-m",
    "Bench pages",
  ]);
  const big = `(${bigCount + 1}+ pages)`;
  const bigCommands = [
    { name: `page list ${big}`, args: ["page", "list", "--brain", "kioku", "--json"] },
    { name: `page list --limit 100 ${big}`, args: ["page", "list", "--brain", "kioku", "--limit", "100", "--json"] },
    { name: `page list --count ${big}`, args: ["page", "list", "--brain", "kioku", "--count", "--json"] },
    { name: `page search release ${big}`, args: ["page", "search", "release", "--brain", "kioku", "--json"] },
    { name: `brain log --since 90d ${big}`, args: ["brain", "log", "--since", "90d", "--brain", "kioku", "--json"] },
  ];
  measure(bigCommands);

  const skill = readFileSync(join(root, "plugins/claude-code/skills/kioku/SKILL.md"), "utf8");
  const skillWords = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(skill)[1].split(/\s+/).filter(Boolean).length;
  const sessionBytes = results.find((r) => r.session).bytes;

  const saved = values.compare && existsSync(savedFile) ? JSON.parse(readFileSync(savedFile, "utf8")) : undefined;
  if (values.compare && saved === undefined) console.error("Nothing saved yet: run `pnpm bench --save` first.");
  const before = (name) => saved?.commands.find((b) => b.name === name);
  const change = (now, was, unit) =>
    was === undefined
      ? ""
      : was === 0
        ? ""
        : `${now >= was ? "+" : "-"}${Math.abs(Math.round(((now - was) / was) * 100))}%${unit}`;

  const head = ["COMMAND", "MS", "BYTES", "~TOKENS", ...(saved ? ["Δ MS", "Δ BYTES"] : [])];
  const rows = results.map((r) => {
    const b = before(r.name);
    return [
      r.name + (r.failed ? " (no answer)" : "") + (r.stable ? "" : " (size varies)"),
      String(r.ms),
      r.bytes === 0 ? "-" : String(r.bytes),
      r.bytes === 0 ? "-" : String(Math.round(r.bytes / 4)),
      ...(saved ? [change(r.ms, b?.ms, ""), change(r.bytes, b?.bytes, "")] : []),
    ];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log([line(head), ...rows.map(line)].join("\n"));
  console.log(
    `\nA session starts with ${sessionBytes} bytes (~${Math.round(sessionBytes / 4)} tokens) of summary and ${skillWords} words of skill (the limit is under 1,500).`,
  );
  console.log(
    `Median of ${runs} runs after one thrown away; Node ${process.version}, ${process.platform} ${process.arch}. Search is full text: hybrid is not measured (no embedding model on the clean home).`,
  );

  if (values.save) {
    mkdirSync(join(root, "benchmarks"), { recursive: true });
    const data = {
      runs,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      session: { bytes: sessionBytes, skill_words: skillWords },
      commands: results.map(({ name, ms, bytes }) => ({ name, ms, bytes })),
    };
    writeFileSync(savedFile, `${JSON.stringify(data, null, 2)}\n`);
    console.log("Saved in benchmarks/times.local.json: this machine's, ignored by git.");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
