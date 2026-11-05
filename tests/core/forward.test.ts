import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMachineConfig } from "../../src/core/config/machine.ts";
import { bringForward } from "../../src/core/setup/forward.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { run } from "../../src/cli/run.ts";
import { ctx, put, scratch as scratchIn } from "../fixtures.ts";
import { Remotes, isolateGit } from "../remotes.ts";

isolateGit();

const scratch = scratchIn("forward");
const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** A brain as 0.1.0 made it: `format: 1`, no name (§3.2), committed. */
function oldBrain(folder: string, tier: string, origin?: string): void {
  put(folder, "kioku.yaml", `format: 1\ntier: ${tier}\nnamespaces: []\n`);
  put(folder, "BRAIN.md", "# a brain\n");
  sh(folder, "init", "-q", "-b", "main");
  sh(folder, "add", "-A");
  sh(folder, "commit", "-q", "-m", "init");
  if (origin !== undefined) sh(folder, "remote", "add", "origin", origin);
}

async function kioku(argv: string[], home: string, terminal = true) {
  let raw = "";
  const code = await run(argv, { stdout: (t) => (raw += t), isTty: false }, ctx({ home, interactive: terminal }));
  return { code, raw, out: JSON.parse(raw) };
}

/** A machine as 0.1.0 left it: the personal brain in a `path` of the person's, with no remote; a project brain from GitHub, under 0.1.0's folder, with one. */
function oldMachine(home: string): void {
  oldBrain(join(home, "code/sam/brain"), "personal");
  oldBrain(join(home, ".kioku/brains/northwind/brain-acme"), "project", "https://github.com/northwind/brain-acme.git");
  put(
    home,
    ".kioku/config.yaml",
    [
      "brain: github.com/sam/brain",
      "repositories:",
      "  github.com/sam/brain:",
      "    path: ~/code/sam/brain",
      "  github.com/northwind/brain-acme: {}",
      "",
    ].join("\n"),
  );
}

/** What bringing `oldMachine` forward leaves: the configuration by name, no address guessed, the personal brain moved and raised. */
function assertForward(home: string): void {
  const brains = join(home, ".kioku/brains");
  const config = readMachineConfig(home)!;
  assert.deepEqual([config.brain, config.legacy], ["sam/brain", undefined]);
  assert.deepEqual(
    config.repositories,
    { "northwind/brain-acme": "https://github.com/northwind/brain-acme.git" },
    "the clone's own address, and none for the personal brain, which had no remote",
  );
  assert.equal(existsSync(join(home, "code/sam/brain")), false, "moved from its path");
  assert.match(readFileSync(join(brains, "sam/brain/kioku.yaml"), "utf8"), /^format: 2\nname: sam\/brain\n/);
  assert.match(readFileSync(join(brains, "northwind/brain-acme/kioku.yaml"), "utf8"), /^format: 1$/m);
}

test("the hand-over of update brings a 0.1.0 machine forward: the configuration by name, each brain in its folder, the personal brain raised (§2.5, §3.2, §6.4)", () =>
  scratch(async (home) => {
    const brains = join(home, ".kioku/brains");
    // 0.1.0's machine: the personal brain in a folder of the person's, a team on another host under its host's
    // folder, a project brain from GitHub where 0.1.0 kept it.
    oldBrain(join(home, "code/sam/brain"), "personal");
    oldBrain(join(brains, "git.example.com/northwind/brain"), "team", "git@git.example.com:northwind/brain.git");
    oldBrain(join(brains, "northwind/brain-acme"), "project", "https://github.com/northwind/brain-acme.git");
    put(
      home,
      ".kioku/config.yaml",
      [
        "brain: github.com/sam/brain",
        "team: git.example.com/northwind/brain",
        "repositories:",
        "  github.com/sam/brain:",
        "    path: ~/code/sam/brain",
        "  git.example.com/northwind/brain: {}",
        "  github.com/northwind/brain-acme: {}",
        "",
      ].join("\n"),
    );

    const f = await bringForward(home, new Date());
    assert.equal(f.rewrote, true);
    assert.deepEqual(
      f.moved.map((m) => [m.brain, m.to]),
      [
        ["sam/brain", join(brains, "sam/brain")],
        ["northwind/brain", join(brains, "northwind/brain")],
      ],
    );
    assert.deepEqual(f.kept, []);
    assert.equal(existsSync(join(home, "code/sam/brain")), false, "moved, files unchanged");
    assert.equal(existsSync(join(brains, "git.example.com")), false, "the host's folder left empty is gone");
    const config = readMachineConfig(home)!;
    assert.deepEqual([config.brain, config.team, config.legacy], ["sam/brain", "northwind/brain", undefined]);
    assert.deepEqual(
      config.repositories,
      {
        "northwind/brain": "git@git.example.com:northwind/brain.git",
        "northwind/brain-acme": "https://github.com/northwind/brain-acme.git",
      },
      "the address of each brain with a remote, from its clone; none for the personal brain, which had none",
    );
    assert.doesNotMatch(readFileSync(join(home, ".kioku/config.yaml"), "utf8"), /github\.com\/sam|path:/);

    // The person's own brain is raised; the shared ones are left for the person, once teammates have updated.
    assert.deepEqual([f.raised?.brain, f.raised?.from, f.raised?.to], ["sam/brain", 1, 2]);
    const raised = readFileSync(join(brains, "sam/brain/kioku.yaml"), "utf8");
    assert.match(raised, /^format: 2\nname: sam\/brain\ntier: personal\n/);
    assert.equal(sh(join(brains, "sam/brain"), "rev-list", "--count", "HEAD"), "2", "one commit");
    assert.deepEqual(
      validateBrain(join(brains, "sam/brain")).findings.filter((x) => x.severity === "error"),
      [],
    );
    assert.deepEqual(f.behind.sort(), ["northwind/brain", "northwind/brain-acme"]);
    assert.match(readFileSync(join(brains, "northwind/brain-acme/kioku.yaml"), "utf8"), /^format: 1$/m);

    // Again: nothing to do.
    const again = await bringForward(home, new Date());
    assert.deepEqual([again.rewrote, again.moved, again.raised], [false, [], undefined]);
  }));

test("two 0.1.0 keys that give one name are left where they were, and said (§2.5)", () =>
  scratch(async (home) => {
    const brains = join(home, ".kioku/brains");
    oldBrain(join(brains, "northwind/brain"), "team", "https://github.com/northwind/brain.git");
    oldBrain(join(brains, "gitlab.com/northwind/brain"), "team", "https://gitlab.com/northwind/brain.git");
    put(
      home,
      ".kioku/config.yaml",
      "repositories:\n  github.com/northwind/brain: {}\n  gitlab.com/northwind/brain: {}\n",
    );
    const f = await bringForward(home, new Date());
    assert.deepEqual(
      f.kept.map((k) => k.brain),
      ["github.com/northwind/brain", "gitlab.com/northwind/brain"],
    );
    assert.match(f.kept[0]!.why, /another brain's key gives the same name, northwind\/brain; remove one/);
    assert.ok(existsSync(join(brains, "gitlab.com/northwind/brain/kioku.yaml")), "not moved");
    assert.deepEqual(readMachineConfig(home)!.repositories, {});
  }));

test("brain upgrade raises a brain of format 1 in one commit with the name it has here, and pushes it; a brain of format 2 is left (§3.2)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      remotes.publish("northwind/brain-acme", {
        "kioku.yaml": "format: 1\ntier: project\nnamespaces: []\n",
        "BRAIN.md": "# acme\n",
      });
      const home = join(dir, "home");
      mkdirSync(join(home, ".kioku"), { recursive: true });
      writeFileSync(
        join(home, ".kioku/config.yaml"),
        "repositories:\n  northwind/brain-acme: https://github.com/northwind/brain-acme.git\n",
      );
      const folder = join(home, ".kioku/brains/northwind/brain-acme");
      execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain-acme.git", folder]);

      const agent = await kioku(["brain", "upgrade", "northwind/brain-acme"], home, false);
      assert.equal(agent.out.error.code, "needs_terminal", "teammates on an older version are the person's to weigh");
      const r = await kioku(["brain", "upgrade", "northwind/brain-acme"], home);
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual([r.out.from, r.out.to, r.out.published], [1, 2, "pushed"]);
      assert.match(readFileSync(join(folder, "kioku.yaml"), "utf8"), /^format: 2\nname: northwind\/brain-acme\n/);
      assert.equal(
        sh(join(remotes.base, "northwind/brain-acme.git"), "rev-parse", "main"),
        sh(folder, "rev-parse", "HEAD"),
        "published",
      );
      const again = await kioku(["brain", "upgrade", "northwind/brain-acme"], home);
      assert.deepEqual([again.code, again.out.from, again.out.to, again.out.commit], [0, 2, 2, undefined]);
    } finally {
      remotes.close();
    }
  }));

test("doctor says a brain of an older format can be raised: the personal one by brain upgrade, a shared one once teammates have updated (§3.2)", () =>
  scratch(async (home) => {
    oldBrain(
      join(home, ".kioku/brains/northwind/brain-acme"),
      "project",
      "https://github.com/northwind/brain-acme.git",
    );
    put(
      home,
      ".kioku/config.yaml",
      "repositories:\n  northwind/brain-acme: https://github.com/northwind/brain-acme.git\n",
    );
    const r = await kioku(["doctor"], home);
    const check = r.out.checks.find((c: { name: string }) => c.name === "brain northwind/brain-acme format");
    assert.equal(check.state, "warn");
    assert.match(check.detail, /format 1; this version writes 2/);
    assert.match(
      check.fix,
      /once your teammates run a version that reads format 2, `kioku brain upgrade northwind\/brain-acme` raises it/,
    );
  }));

test("setup brings a 0.1.0 machine forward as the hand-over of update does, and says so; run again, it does nothing (§2.5, §3.2, §6.3)", () =>
  scratch(async (home) => {
    oldMachine(home);
    const r = await kioku(["setup", "--no-model"], home);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.forwarded.rewrote, true);
    assert.deepEqual(
      r.out.forwarded.moved.map((m: { brain: string }) => m.brain),
      ["sam/brain"],
    );
    assert.deepEqual([r.out.forwarded.raised?.brain, r.out.forwarded.raised?.to], ["sam/brain", 2]);
    assert.deepEqual(r.out.forwarded.behind, ["northwind/brain-acme"]);
    assert.equal(r.out.personal, "sam/brain");
    assertForward(home);
    assert.ok(r.out.agents !== undefined, "the rest of setup ran");
    // Every brain's own files refreshed, as the hand-over does (§2.7): the personal brain, which 0.1.0 left without them.
    const own = r.out.refreshed.brains.find((b: { brain: string }) => b.brain === "sam/brain");
    assert.ok(own.written.includes("AGENTS.md"), r.raw);
    assert.ok(existsSync(join(home, ".kioku/brains/sam/brain/AGENTS.md")));

    const again = await kioku(["setup", "--no-model"], home);
    assert.equal(again.code, 0, again.raw);
    assert.deepEqual(
      [again.out.forwarded.rewrote, again.out.forwarded.moved, again.out.forwarded.raised],
      [false, [], undefined],
    );
    assert.deepEqual(
      again.out.refreshed.brains.flatMap((b: { written: string[] }) => b.written),
      [],
      "the files are current",
    );
    let text = "";
    await run(["setup", "--no-model"], { stdout: (t) => (text += t), isTty: true }, ctx({ home, interactive: true }));
    assert.match(text, /Already set up/, "a shared brain left behind is doctor's to say, not every setup's");
  }));

test("a configuration written before the hand-over keeps what 0.1.0 wrote for it to bring forward, and guesses no address (§2.5)", () =>
  scratch(async (home) => {
    oldMachine(home);
    const set = await kioku(["config", "set", "display.color", "never"], home);
    assert.equal(set.code, 0, set.raw);
    const text = readFileSync(join(home, ".kioku/config.yaml"), "utf8");
    assert.doesNotMatch(
      text,
      /https:\/\/github\.com\/sam\/brain\.git/,
      "no address guessed for a brain with no remote",
    );
    assert.match(text, /path: ~\/code\/sam\/brain/, "the path kept for the hand-over");

    await bringForward(home, new Date());
    assertForward(home);
    assert.equal(readMachineConfig(home)!.display?.color, "never");
  }));
