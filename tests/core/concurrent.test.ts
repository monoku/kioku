import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/run.ts";
import { useSteps, type StepWords } from "../../src/core/steps.ts";
import { linkOf, syncBrains } from "../../src/core/sync.ts";
import { freshen, pushBrain } from "../../src/core/write/publish.ts";
import { ctx } from "../fixtures.ts";
import { gitCalls } from "../git-shim.ts";
import { Remotes, isolateGit } from "../remotes.ts";

isolateGit();

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

interface Machine {
  home: string;
  brain: string;
  repo: string;
  kioku: (argv: string[], stdin?: string) => Promise<{ code: number; out: any; raw: string }>;
  /** Cut the machine off from the remote, and put it back. */
  offline: () => void;
  online: () => void;
}

/** One person's machine: its own home, a project folder linked to the shared brain `northwind/brain-acme`. */
async function machine(dir: string, who: string): Promise<Machine> {
  const home = join(dir, who);
  const repo = join(dir, `${who}-app`);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  const kioku: Machine["kioku"] = async (argv, stdin = "") => {
    let raw = "";
    const code = await run(
      argv,
      { stdout: (t) => (raw += t), isTty: false },
      ctx({ home, cwd: repo, interactive: true, stdin: async () => stdin, startBackground: () => {} }),
    );
    return { code, raw, out: JSON.parse(raw.trim().split("\n").at(-1)!) };
  };
  await kioku(["setup"]);
  const init = await kioku(["init", "github.com/northwind/brain-acme"]);
  assert.equal(init.code, 0, init.raw);
  const brain = join(home, ".kioku/brains/northwind/brain-acme");
  const url = git(brain, "remote", "get-url", "origin");
  return {
    home,
    brain,
    repo,
    kioku,
    offline: () => git(brain, "remote", "set-url", "origin", join(dir, "nowhere.git")),
    online: () => git(brain, "remote", "set-url", "origin", url),
  };
}

const SAVE = (title: string) => [
  "page",
  "save",
  "--brain",
  "northwind/brain-acme",
  "--kind",
  "knowledge",
  "--sub",
  "playbook",
  "--title",
  title,
  "--summary",
  `${title}.`,
  "--source",
  "docs/run.md",
];
const body = (step: string) => `## When\n\nA deploy.\n\n## Steps\n\n${step}\n`;
const UPDATE = (path: string) => ["page", "update", path, "--brain", "northwind/brain-acme", "--section", "Steps"];

async function team<T>(fn: (a: Machine, b: Machine, deploy: string, bare: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kioku-conc-"));
  const remotes = new Remotes(dir);
  try {
    remotes.publish("northwind/brain-acme", {
      "kioku.yaml": "format: 1\ntier: project\nnamespaces:\n  - acme\n",
      "BRAIN.md": "# acme\n",
      "knowledge/acme/INDEX.md": "# acme\n",
    });
    const a = await machine(dir, "ana");
    const b = await machine(dir, "ben");
    const deploy = await a.kioku(SAVE("Deploy"), body("1. First."));
    assert.equal(deploy.out.publication, "pushed");
    assert.equal((await b.kioku(["sync"])).code, 0);
    return await fn(a, b, deploy.out.path as string, join(remotes.base, "northwind/brain-acme.git"));
  } finally {
    remotes.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("two people saving different pages at once both publish", () =>
  team(async (a, b) => {
    const alpha = await a.kioku(SAVE("Alpha rollout"), body("1. Alpha."));
    const beta = await b.kioku(SAVE("Beta rollout"), body("1. Beta."));
    assert.deepEqual([alpha.out.publication, beta.out.publication], ["pushed", "pushed"]);
    assert.ok(existsSync(join(a.brain, beta.out.path)) === false, "Ana has not synced yet");
    assert.equal((await a.kioku(["sync"])).code, 0);
    assert.ok(existsSync(join(a.brain, beta.out.path)));
  }));

test("a write pushes with the brain's lock released, so another write is not refused while it waits on the network (§1.6)", () =>
  team(async (a, _b, _deploy, bare) => {
    // The remote refuses a push while the writer still holds the lock: it would make any other write wait on the network.
    const lock = join(a.brain, ".git", "kioku.lock");
    const hook = join(bare, "hooks", "pre-receive");
    writeFileSync(
      hook,
      `#!/bin/sh\nif [ -e "${lock}" ]; then echo "pushed under the brain's lock" >&2; exit 1; fi\ncat >/dev/null\n`,
    );
    chmodSync(hook, 0o755);
    const saved = await a.kioku(SAVE("Pushed unlocked"), body("1. Push."));
    assert.equal(saved.out.publication, "pushed", saved.raw);
    const update = await a.kioku([...UPDATE(saved.out.path), "--note", "again"], "1. Again.\n");
    assert.equal(update.out.publication, "pushed", "and so does a write that rebases first");
    a.offline();
    await a.kioku(SAVE("Waiting"), body("1. Wait."));
    a.online();
    const s = await a.kioku(["sync"]);
    assert.equal(s.out.outcomes.find((o: { tier: string }) => o.tier === "project").status, "pushed", s.raw);
    assert.equal(existsSync(lock), false);
  }));

test("the verbs that wait name their steps: a write's bring-in and publication, sync's fetch, and a remote it cannot reach as failed (§6.1)", () =>
  team(async (a) => {
    const seen: string[] = [];
    const say = <T>(w: StepWords<T>, r: T) =>
      seen.push(
        `${w.direction} ${w.doing} → ${typeof w.done === "function" ? w.done(r) : w.done}${w.failed?.(r) === true ? " ✕" : ""}`,
      );
    const restore = useSteps({
      run: (w, work) => {
        const r = work();
        say(w, r);
        return r;
      },
      runAsync: async (w, work) => {
        const r = await work();
        say(w, r);
        return r;
      },
    });
    try {
      await freshen(a.brain);
      await pushBrain(a.brain);
      await syncBrains(a.home, [linkOf("project", "github.com/northwind/brain-acme", a.brain)], new Date());
      a.offline();
      await freshen(a.brain);
    } finally {
      restore();
      a.online();
    }
    assert.deepEqual(seen, [
      "down Bringing in what others published to northwind/brain-acme → Brought in what others published to northwind/brain-acme",
      "up Publishing to northwind/brain-acme → Published to northwind/brain-acme",
      "down Fetching northwind/brain-acme → Fetched northwind/brain-acme",
      "down Indexing the pages → Indexed the pages",
      "down Bringing in what others published to northwind/brain-acme → Could not reach northwind/brain-acme's remote; writing on what this machine has ✕",
    ]);
  }));

test("a write brings in what others published first, so an update lands on their version, not over it", () =>
  team(async (a, b, deploy) => {
    assert.equal(
      (await a.kioku([...UPDATE(deploy), "--note", "Ana's steps"], "1. Ana's way.\n")).out.publication,
      "pushed",
    );
    const r = await b.kioku([...UPDATE(deploy), "--note", "Ben's steps"], "1. Ben's way.\n");
    assert.equal(r.out.status, "done", r.raw);
    assert.equal(r.out.publication, "pushed", "Ben had not synced and still did not conflict");
    const text = readFileSync(join(b.brain, deploy), "utf8");
    assert.match(text, /1\. Ben's way\./);
    assert.match(text, /Ana's steps/, "the Changelog keeps what Ana wrote");
    assert.match(text, /Ben's steps/);
  }));

test("a commit made offline and rebased onto what others published keeps its Kioku-Via trailer (§1.6)", () =>
  team(async (a, b) => {
    b.offline();
    const mine = await b.kioku(SAVE("Ben only"), body("1. Ben."));
    assert.equal(mine.out.publication, "pending");
    await a.kioku(SAVE("Ana only"), body("1. Ana."));
    b.online();
    assert.equal((await b.kioku(["sync"])).code, 0);
    assert.equal(git(b.brain, "rev-parse", "HEAD"), git(b.brain, "rev-parse", "origin/main"));
    assert.equal(
      git(b.brain, "log", "--format=%s|%(trailers:key=Kioku-Via,valueonly,unfold)", "--grep=save: Ben only")
        .trim()
        .replace(/\n+/g, ""),
      "save: Ben only|terminal",
    );
  }));

test("changes made offline that overlap with what others published are kept on a branch, and sync goes on receiving", () =>
  team(async (a, b, deploy) => {
    b.offline();
    const mine = await b.kioku(UPDATE(deploy), "1. Ben's way.\n");
    assert.equal(mine.out.status, "done");
    assert.equal(mine.out.publication, "pending", "no network: committed, not published");
    assert.equal((await a.kioku(UPDATE(deploy), "1. Ana's way.\n")).out.publication, "pushed");
    const gamma = await a.kioku(SAVE("Gamma rollout"), body("1. Gamma."));
    b.online();

    const s = await b.kioku(["sync"]);
    const outcome = s.out.outcomes.find((o: { tier: string }) => o.tier === "project");
    assert.equal(outcome.status, "conflict", s.raw);
    assert.match(outcome.message, /knowledge\/acme\/playbooks\/deploy\.md.*kioku\/conflict-/);
    const branch = git(b.brain, "branch", "--list", "kioku/conflict-*", "--format=%(refname:short)");
    assert.match(branch, /^kioku\/conflict-[0-9a-f]{7}$/);
    assert.match(git(b.brain, "show", `${branch}:${deploy}`), /Ben's way\./, "what Ben wrote is kept as it was");
    assert.match(readFileSync(join(b.brain, deploy), "utf8"), /Ana's way\./, "the page says what the team wrote");
    assert.ok(existsSync(join(b.brain, gamma.out.path)), "and the brain is not stuck: what others published arrives");
    assert.equal(git(b.brain, "status", "--porcelain"), "");
    assert.equal(
      git(b.brain, "rev-parse", "HEAD"),
      git(b.brain, "rev-parse", "origin/main"),
      "nothing left waiting to publish",
    );

    const next = await b.kioku(["sync"]);
    assert.equal(next.out.outcomes.find((o: { tier: string }) => o.tier === "project").status, "up-to-date");

    const start = await b.kioku(
      ["hook", "session-start"],
      JSON.stringify({ cwd: b.repo, source: "startup", session_id: "s" }),
    );
    assert.match(
      start.out.systemMessage,
      /⬢ kioku\.md · ⚠ your changes conflicted with what others published\n  ⎿ brain-acme\n/,
    );
    assert.match(
      start.out.hookSpecificOutput.additionalContext,
      new RegExp(`holds changes of the person's that conflicted.*${branch.replace("/", "\\/")}`),
    );
    git(b.brain, "branch", "-D", branch);
    const after = await b.kioku(
      ["hook", "session-start"],
      JSON.stringify({ cwd: b.repo, source: "startup", session_id: "s2" }),
    );
    assert.doesNotMatch(JSON.stringify(after.out), /conflicted/, "deleting the branch ends the notice");
  }));

test("a conflict sets every unpublished commit aside, the one that would apply too, after one rebase and no cherry-pick (§1.6)", () =>
  team(async (a, b, deploy) => {
    b.offline();
    assert.equal((await b.kioku(UPDATE(deploy), "1. Ben's way.\n")).out.publication, "pending");
    const solo = await b.kioku(SAVE("Ben solo"), body("1. Ben alone."));
    assert.equal(solo.out.publication, "pending");
    await a.kioku(UPDATE(deploy), "1. Ana's way.\n");
    b.online();

    const scratch = mkdtempSync(join(tmpdir(), "kioku-conflict-calls-"));
    let s: { out: any; raw: string } | undefined;
    try {
      const calls = await gitCalls(scratch, async () => {
        s = await b.kioku(["sync"]);
      });
      const rebases = calls.filter((c) => c.includes("rebase") && !c.includes("--abort"));
      assert.equal(rebases.length, 1, rebases.join("\n"));
      assert.equal(calls.filter((c) => c.includes("cherry-pick")).length, 0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    const outcome = s!.out.outcomes.find((o: { tier: string }) => o.tier === "project");
    assert.equal(outcome.status, "conflict", s!.raw);
    const branch = git(b.brain, "branch", "--list", "kioku/conflict-*", "--format=%(refname:short)");
    assert.equal(git(b.brain, "rev-list", "--count", `origin/main..${branch}`), "2", "both of Ben's commits are kept");
    assert.equal(
      existsSync(join(b.brain, solo.out.path)),
      false,
      "the one that would apply is set aside with the rest",
    );
    assert.equal(git(b.brain, "rev-parse", "HEAD"), git(b.brain, "rev-parse", "origin/main"));
  }));

test("a write that finds unpublished changes in conflict says so, writes nothing, and names the branch", () =>
  team(async (a, b, deploy) => {
    b.offline();
    assert.equal((await b.kioku(UPDATE(deploy), "1. Ben's way.\n")).out.publication, "pending");
    assert.equal((await a.kioku(UPDATE(deploy), "1. Ana's way.\n")).out.publication, "pushed");
    b.online();

    const r = await b.kioku(SAVE("Delta rollout"), body("1. Delta."));
    assert.equal(r.code, 1);
    assert.equal(r.out.status, "error");
    assert.equal(r.out.error.code, "conflict");
    assert.match(r.out.error.message, /nothing was written.*kioku\/conflict-.*kioku page update/);
    assert.deepEqual(r.out.error.conflict.pages, [deploy]);
    assert.match(r.out.error.conflict.branch, /^kioku\/conflict-/);
    assert.ok(!existsSync(join(b.brain, "knowledge/acme/playbooks/delta-rollout.md")));
    const again = await b.kioku(SAVE("Delta rollout"), body("1. Delta."));
    assert.equal(again.out.publication, "pushed", "once set aside, the next write goes through");
  }));

test("brain conflicts lists what was set aside, shows both versions, opens one as a folder and resolves it", () =>
  team(async (a, b, deploy) => {
    b.offline();
    await b.kioku(UPDATE(deploy), "1. Ben's way.\n");
    await a.kioku(UPDATE(deploy), "1. Ana's way.\n");
    b.online();
    assert.equal(
      (await b.kioku(["sync"])).out.outcomes.find((o: { tier: string }) => o.tier === "project").status,
      "conflict",
    );

    const none = await a.kioku(["brain", "conflicts", "northwind/brain-acme"]);
    assert.deepEqual(none.out.brains[0].conflicts, [], "Ana has none: they are Ben's, on his machine");

    const list = await b.kioku(["brain", "conflicts", "northwind/brain-acme"]);
    const [c] = list.out.brains[0].conflicts;
    assert.match(c.branch, /^kioku\/conflict-[0-9a-f]{7}$/);
    assert.deepEqual(c.pages, [deploy]);
    assert.deepEqual(
      c.commits.map((x: { message: string }) => x.message),
      ["update: Deploy"],
    );
    assert.equal(c.worktree, undefined);
    const text = await run0(b, ["brain", "conflicts", "northwind/brain-acme"]);
    assert.match(text, new RegExp(`acme: 1 conflict\\n  ${c.branch} \\(\\d{4}-\\d\\d-\\d\\d\\): ${deploy}`));

    const lint = await b.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(
      lint.out.brains[0].conflicts,
      [{ branch: c.branch, pages: [deploy] }],
      "the lint report carries it, so the web lists it",
    );

    const shown = await b.kioku(["brain", "conflicts", "northwind/brain-acme", "--branch", c.branch]);
    const [p] = shown.out.pages;
    assert.equal(p.page, deploy);
    assert.match(p.mine, /Ben's way\./);
    assert.match(p.theirs, /Ana's way\./);
    assert.match(p.base, /First\./);

    const opened = await b.kioku(["brain", "conflicts", "northwind/brain-acme", "--open", c.branch]);
    assert.equal(opened.code, 0, opened.raw);
    assert.match(opened.out.worktree, /\.kioku\/conflicts\/northwind\/brain-acme\/conflict-[0-9a-f]{7}$/);
    assert.match(
      readFileSync(join(opened.out.worktree, deploy), "utf8"),
      /Ben's way\./,
      "the other version, as a folder",
    );
    assert.equal(git(b.brain, "branch", "--show-current"), "main", "the brain itself never leaves main");
    assert.equal(git(b.brain, "status", "--porcelain"), "");
    assert.equal(
      realpathSync((await b.kioku(["brain", "conflicts", "northwind/brain-acme"])).out.brains[0].conflicts[0].worktree),
      realpathSync(opened.out.worktree),
    );

    const done = await b.kioku(["brain", "conflicts", "northwind/brain-acme", "--resolve", c.branch]);
    assert.deepEqual([done.out.branch, done.out.removedWorktree], [c.branch, true]);
    assert.ok(!existsSync(opened.out.worktree));
    assert.deepEqual((await b.kioku(["brain", "conflicts", "northwind/brain-acme"])).out.brains[0].conflicts, []);
    assert.equal(
      (await b.kioku(["brain", "conflicts", "northwind/brain-acme", "--resolve", c.branch])).out.error.code,
      "conflict_unknown",
    );
    assert.equal(
      (await b.kioku(["brain", "conflicts", "northwind/brain-acme", "--page", "x"])).out.error.code,
      "usage",
    );
  }));

async function run0(m: Machine, argv: string[]): Promise<string> {
  let raw = "";
  await run(
    argv,
    { stdout: (t) => (raw += t), isTty: true },
    ctx({ home: m.home, cwd: m.repo, interactive: true, stdin: async () => "", startBackground: () => {} }),
  );
  return raw;
}
