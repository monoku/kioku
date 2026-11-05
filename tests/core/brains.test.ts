import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvidence, serializeBrainFile } from "../../src/core/brain/file.ts";
import { buildBody, createPage } from "../../src/core/brain/page.ts";
import { parseBrainReference } from "../../src/core/config/brain-ref.ts";
import { readMachineConfig } from "../../src/core/config/machine.ts";
import { conflictsPath, lintReportPath } from "../../src/core/state.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { VERSION } from "../../src/version.ts";
import { run } from "../../src/cli/run.ts";
import { pickBrain, type ChainBrain } from "../../src/cli/chain.ts";
import {
  CONTEXT,
  DECISION,
  INSTINCT,
  MEMORY,
  RULE,
  ctx,
  made,
  put,
  ulid,
  writeBrain,
  type Made,
  scratch as scratchIn,
} from "../fixtures.ts";
import { Remotes, isolateGit } from "../remotes.ts";
import { commitAll, sh } from "../world.ts";

isolateGit();

const scratch = scratchIn("brains");

async function kioku(
  argv: string[],
  home: string,
  o: { cwd?: string; tty?: boolean; terminal?: boolean; stdin?: string } = {},
) {
  let raw = "";
  const code = await run(
    argv,
    { stdout: (t) => (raw += t), isTty: o.tty ?? false },
    ctx({
      home,
      cwd: o.cwd ?? home,
      ...(o.terminal && { interactive: true }),
      ...(o.stdin !== undefined && { stdin: async () => o.stdin! }),
    }),
  );
  return { code, raw, out: o.tty ? raw : JSON.parse(raw) };
}

// §2.5, the two brains' files.
const PROJECT_8 = "format: 2\nname: northwind/brain-acme\ntier: project\nnamespaces:\n  - acme\n";
const TEAM_ONE = "format: 2\nname: northwind/brain\ntier: team\nnamespaces:\n  - northwind\n";
/** What `brain create` writes: its name, and no namespace yet (§2.2, §3.2). */
const newBrain = (name: string, tier: string): string => `format: 2\nname: ${name}\ntier: ${tier}\nnamespaces: []\n`;
const PROJECT_NEW = newBrain("northwind/brain-acme", "project");
const TEAM_NEW = newBrain("northwind/brain", "team");

test("brain create project writes the project kioku.yaml of §2.5 and a valid brain, and no workflow", () =>
  scratch(async (home) => {
    const r = await kioku(["brain", "create", "northwind/brain-acme", "--tier", "project"], home);
    assert.equal(r.code, 0, r.raw);
    const path = join(home, ".kioku/brains/northwind/brain-acme");
    assert.equal(r.out.path, path);
    assert.equal(readFileSync(join(path, "kioku.yaml"), "utf8"), PROJECT_NEW);
    assert.deepEqual(validateBrain(path).findings, []);
    assert.equal(existsSync(join(path, "knowledge")), false, "no namespace, so no knowledge folder (§3.2)");
    for (const f of [
      "BRAIN.md",
      "memory/.gitkeep",
      "rules/.gitkeep",
      "skills/.gitkeep",
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/commands/ingest.md",
    ])
      assert.ok(existsSync(join(path, f)), f);
    const agents = readFileSync(join(path, "AGENTS.md"), "utf8");
    assert.match(agents, /^# northwind\/brain-acme: a Kioku brain\n/, "the files the tool owns (§2.7)");
    assert.ok(
      agents.endsWith(`<!-- Written by kioku ${VERSION}; kioku brain refresh rewrites it. -->\n`),
      "it names the version that wrote it",
    );
    assert.equal(existsSync(join(path, ".github")), false, "Kioku writes no workflow into a brain");
    assert.equal(sh(path, "rev-list", "--count", "HEAD"), "1");
    assert.equal(sh(path, "status", "--porcelain"), "");
    assert.equal(r.out.publication, "local");
    assert.deepEqual(
      readMachineConfig(home)?.repositories ?? {},
      {},
      "a brain made here has no address to accept (§2.5)",
    );
  }));

test("a brain starts with no namespace, save writes nothing until namespace add makes the first (§2.3, §3.2)", () =>
  scratch(async (home) => {
    const r = await kioku(["brain", "create", "northwind/brain-kioku", "--tier", "project"], home);
    assert.equal(r.code, 0, r.raw);
    assert.equal(readFileSync(join(r.out.path, "kioku.yaml"), "utf8"), newBrain("northwind/brain-kioku", "project"));
    assert.deepEqual(validateBrain(r.out.path).findings, []);
    const flag = await kioku(
      ["brain", "create", "northwind/brain-other", "--tier", "project", "--namespace", "engine"],
      home,
    );
    assert.equal(flag.out.error.code, "usage", "--namespace is gone: namespace add makes each one");

    const save = [
      "page",
      "save",
      "--brain",
      "northwind/brain-kioku",
      "--kind",
      "knowledge",
      "--sub",
      "context",
      "--title",
      "Where the engine runs",
      "--source",
      "chat",
      "--summary",
      "where it runs",
      "--create",
    ];
    const body = "The engine runs on the build machines.\n";
    const none = await kioku(save, home, { cwd: r.out.path, stdin: body });
    assert.equal(none.out.error?.code, "namespace_none", none.raw);
    assert.match(none.out.error.message, /kioku namespace add <path> --summary "…" --brain northwind\/brain-kioku/);
    assert.equal(sh(r.out.path, "rev-list", "--count", "HEAD"), "1", "nothing written");
    const added = await kioku(
      [
        "namespace",
        "add",
        "engine",
        "--summary",
        "How the engine is built and where it runs",
        "--brain",
        "northwind/brain-kioku",
      ],
      home,
      { cwd: r.out.path },
    );
    assert.equal(added.code, 0, added.raw);
    const saved = await kioku(save, home, { cwd: r.out.path, stdin: body });
    assert.deepEqual(
      [saved.code, saved.out.namespace, saved.out.path],
      [0, "engine", "knowledge/engine/context/where-the-engine-runs.md"],
      saved.raw,
    );
    assert.deepEqual(
      validateBrain(r.out.path).findings.filter((f) => f.severity === "error"),
      [],
    );
  }));

test("brain create --language writes the language from the first commit; without it none is declared (§3.2)", () =>
  scratch(async (home) => {
    const r = await kioku(
      ["brain", "create", "northwind/brain-lang", "--tier", "project", "--language", "es-419"],
      home,
    );
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.language, "es-419");
    const yaml = readFileSync(join(r.out.path, "kioku.yaml"), "utf8");
    assert.match(yaml, /^format: 2$/m);
    assert.match(yaml, /^language: es-419$/m);
    assert.deepEqual(validateBrain(r.out.path).findings, []);
    assert.equal(sh(r.out.path, "rev-list", "--count", "HEAD"), "1", "the language is in the first commit");

    const plain = await kioku(["brain", "create", "northwind/brain-plain", "--tier", "project"], home);
    const text = readFileSync(join(plain.out.path, "kioku.yaml"), "utf8");
    assert.match(text, /^format: 2$/m);
    assert.doesNotMatch(text, /language/);

    const bad = await kioku(
      ["brain", "create", "northwind/brain-bad", "--tier", "project", "--language", "Spanish"],
      home,
    );
    assert.equal(bad.out.error.code, "usage");
    assert.ok(!existsSync(join(home, ".kioku/brains/northwind/brain-bad")), "nothing was made");
  }));

test("brain create team writes the team file with no namespace, ready for its own", () =>
  scratch(async (home) => {
    const r = await kioku(["brain", "create", "northwind/brain", "--tier", "team"], home);
    assert.equal(r.code, 0, r.raw);
    assert.equal(readFileSync(join(r.out.path, "kioku.yaml"), "utf8"), TEAM_NEW);
    put(r.out.path, "kioku.yaml", TEAM_ONE.replace("  - northwind\n", "  - engineering\n  - design\n  - delivery\n"));
    for (const ns of ["engineering", "design", "delivery"]) put(r.out.path, `knowledge/${ns}/INDEX.md`, `# ${ns}\n`);
    assert.deepEqual(validateBrain(r.out.path).findings, [], "more namespaces are added by hand");
    assert.equal(
      (await kioku(["brain", "create", "northwind/brain", "--tier", "team"], home)).out.error.code,
      "brain_exists",
    );
    for (const tier of ["project", "team"])
      assert.equal(
        (await kioku(["brain", "create", "northwind/other", "--tier", tier, "--team", "northwind/brain"], home)).out
          .error.code,
        "usage",
        "a brain names no other brain: the folder names its team (§2.4)",
      );
    assert.equal((await kioku(["brain", "create", "northwind/x", "--tier", "galaxy"], home)).out.error.code, "usage");
  }));

test("brain create makes the brain on this machine and asks no git host anything, whether one has it, is empty or cannot be reached (§2.3)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      remotes.publish("northwind/brain", {
        "kioku.yaml": TEAM_ONE,
        "BRAIN.md": "# northwind\n",
        "knowledge/northwind/INDEX.md": "# northwind\n",
      });
      const home = join(dir, "home");

      // The host has a brain of that name: it is not cloned, which is `brain clone`'s; a brain is made here.
      const there = await kioku(["brain", "create", "northwind/brain", "--tier", "team"], home);
      assert.equal(there.code, 0, there.raw);
      assert.deepEqual([there.out.action, there.out.publication], ["created", "local"]);
      assert.equal(sh(there.out.path, "remote"), "", "no remote, and nothing of the host's");
      const text = await kioku(["brain", "create", "northwind/brain-other", "--tier", "project"], home, { tty: true });
      assert.match(
        text.out,
        /It lives on this machine, with no remote; kioku brain publish northwind\/brain-other --remote <address> puts it in a repository you make, when you want one\./,
      );

      // An empty repository on the host is not pushed to either: only `brain publish` reaches a host.
      const bare = join(remotes.base, "northwind/brain-empty.git");
      mkdirSync(bare, { recursive: true });
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
      const empty = await kioku(["brain", "create", "northwind/brain-empty", "--tier", "project"], home);
      assert.deepEqual([empty.out.action, empty.out.publication], ["created", "local"], empty.raw);
      assert.equal(sh(bare, "rev-list", "--all", "--count"), "0");

      // A git host that cannot be reached changes nothing: the brain is made all the same.
      process.env.GIT_CONFIG_VALUE_0 = "https://github.com/";
      process.env.GIT_CONFIG_KEY_0 = "url.http://127.0.0.1:9/.insteadOf";
      const down = await kioku(["brain", "create", "northwind/brain-down", "--tier", "project"], home);
      assert.deepEqual([down.code, down.out.publication], [0, "local"], down.raw);

      // `unpublished` muted drops the hint.
      await kioku(["config", "set", "display.mute", "+unpublished"], home, { terminal: true });
      const quiet = await kioku(["brain", "create", "northwind/brain-quiet", "--tier", "project"], home, { tty: true });
      assert.doesNotMatch(quiet.out, /publish/);
    } finally {
      remotes.close();
    }
  }));

test("brain create always takes the name, which Kioku never chooses nor asks of git; personal unless --tier says (§2.3)", () =>
  scratch(async (home) => {
    const none = await kioku(["brain", "create"], home);
    assert.equal(none.out.error.code, "usage", none.raw);
    assert.match(none.out.error.message, /the brain's name, <owner>\/<repo>.*Kioku chooses none/);
    assert.equal(readMachineConfig(home)?.brain, undefined, "nothing was made");

    const text = await kioku(["brain", "create", "sam/memoria"], home, { tty: true });
    assert.equal(text.code, 0, text.out);
    assert.match(text.out, /Created the personal brain sam\/memoria at /);
    assert.doesNotMatch(text.out, /git config|github\.user|Named it/);
    const config = readMachineConfig(home)!;
    assert.equal(config.brain, "sam/memoria");
    assert.ok(!("user" in config), "who the person is stays git's");
    assert.match(readFileSync(join(home, ".kioku/brains/sam/memoria/kioku.yaml"), "utf8"), /^name: sam\/memoria$/m);

    const again = await kioku(["brain", "create", "sam/other"], home);
    assert.equal(again.out.error.code, "personal_exists", again.raw);
    assert.match(again.out.error.message, /this machine has your personal brain, sam\/memoria/);
    for (const [argv, why] of [
      [["brain", "create", "--tier", "project"], "a shared brain is named too"],
      [["brain", "create", "memoria"], "a name has an owner"],
      [["brain", "create", "github.com/sam/memoria"], "an address is publish's"],
      [["brain", "create", "sam/my.brain", "--tier", "project"], "a dot belongs to hosts"],
    ] as const) {
      const r = await kioku([...argv], join(home, "other"));
      assert.equal(r.out.error.code, "usage", `${why}: ${r.raw}`);
    }
    const address = await kioku(["brain", "create", "github.com/sam/memoria"], join(home, "other"));
    assert.match(address.out.error.message, /brain publish --remote gives it an address/);
    const taken = await kioku(["brain", "create", "sam/memoria", "--tier", "project"], home);
    assert.equal(taken.out.error.code, "brain_exists", "another name is another brain");
    const flag = await kioku(["brain", "create", "sam/x", "--dir", "/tmp/x"], join(home, "fourth"));
    assert.match(flag.out.error.message, /^unknown flag --dir/, "every brain lives in the managed folder (§2.5)");
  }));

test("a brain that could not be made leaves nothing it made, so making it again works", () =>
  scratch(async (home) => {
    const count = process.env.GIT_CONFIG_COUNT;
    // A config entry with no value makes every git command fail, as a broken environment does.
    Object.assign(process.env, { GIT_CONFIG_COUNT: String(Number(count) + 1), [`GIT_CONFIG_KEY_${count}`]: "core.x" });
    let failed;
    try {
      failed = await kioku(["brain", "create", "sam/brain", "--tier", "personal"], home);
    } finally {
      process.env.GIT_CONFIG_COUNT = count;
      delete process.env[`GIT_CONFIG_KEY_${count}`];
    }
    assert.equal(failed.code, 1, failed.raw);
    assert.ok(!existsSync(join(home, ".kioku/brains/sam/brain")), "nothing of it is left");
    assert.equal(readMachineConfig(home)?.brain, undefined);
    const again = await kioku(["brain", "create", "sam/brain", "--tier", "personal"], home);
    assert.equal(again.code, 0, again.raw);
  }));

test("a brain's kioku.yaml holds its name, and create answers it (§2.2, §5.1 rule 13)", () =>
  scratch(async (home) => {
    const r = await kioku(["brain", "create", "northwind/brain-x", "--tier", "personal"], home);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.brain, r.out.userFrom], ["northwind/brain-x", undefined]);
    assert.match(readFileSync(join(r.out.path, "kioku.yaml"), "utf8"), /^format: 2\nname: northwind\/brain-x\n/);
  }));

test("an address that begins with - is refused wherever one is taken, since git would read it as an option (§2.2)", () =>
  scratch(async (home) => {
    const evil = "--upload-pack=touch pwned";
    const clone = await kioku(["brain", "clone", evil], home, { terminal: true });
    assert.deepEqual([clone.code, clone.out.error.code], [1, "usage"], clone.raw);
    await kioku(["brain", "create", "sam/brain", "--tier", "personal"], home);
    const publish = await kioku(["brain", "publish", "sam/brain", "--remote", evil], home, { terminal: true });
    assert.deepEqual([publish.code, publish.out.error.code], [1, "usage"], publish.raw);
    const ref = parseBrainReference({ name: "northwind/brain-acme", url: evil }, "brain");
    assert.equal(ref.ok, false);
    assert.match(ref.ok ? "" : ref.reason, /begins with -/);
    const path = join(home, ".kioku/config.yaml");
    writeFileSync(path, `${readFileSync(path, "utf8")}repositories:\n  northwind/brain-acme: "${evil}"\n`);
    assert.throws(() => readMachineConfig(home), /begins with -/);
    assert.equal(existsSync(join(home, "pwned")), false);
  }));

/** The configuration `setup` leaves, and the personal brain the person then makes (§2.3). */
async function setUp(home: string): Promise<void> {
  await kioku(["setup"], home, { terminal: true });
  await kioku(["brain", "create", "sam/brain", "--tier", "personal"], home, { terminal: true });
}

/** Bare remotes for the project and team brains of §2.5. */
function publishBrains(dir: string): Remotes {
  const remotes = new Remotes(dir);
  remotes.publish("northwind/brain-acme", {
    "kioku.yaml": PROJECT_8,
    "BRAIN.md": "# acme\n",
    "knowledge/acme/INDEX.md": "# acme\n",
  });
  remotes.publish("northwind/brain", {
    "kioku.yaml": TEAM_ONE,
    "BRAIN.md": "# northwind\n",
    "knowledge/northwind/INDEX.md": "# northwind\n",
  });
  return remotes;
}

const ACME_URL = "https://github.com/northwind/brain-acme.git";
const TEAM_URL = "https://github.com/northwind/brain.git";

test("init <address> clones the project brain and writes its name and address; init alone takes a team written by hand (§2.4)", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const repo = join(dir, "acme-api");
      mkdirSync(join(repo, "src"), { recursive: true });
      sh(repo, "init", "-q", "-b", "main");
      const agent = await kioku(["init", "github.com/northwind/brain-acme"], home, { cwd: repo });
      assert.equal(agent.out.error.code, "needs_terminal", "an address new to this machine is the person's");
      const r = await kioku(["init", "github.com/northwind/brain-acme"], home, {
        cwd: join(repo, "src"),
        terminal: true,
      });
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual([r.out.brought.brain, r.out.brought.url], ["northwind/brain-acme", ACME_URL]);
      const project = `brain: { name: northwind/brain-acme, url: ${ACME_URL} }\n`;
      assert.equal(readFileSync(join(repo, "kioku.yaml"), "utf8"), project);
      assert.equal(sh(repo, "status", "--porcelain"), "?? kioku.yaml", "written, not committed");
      assert.ok(existsSync(join(home, ".kioku/brains/northwind/brain-acme/kioku.yaml")));
      assert.deepEqual(readMachineConfig(home)!.repositories, { "northwind/brain-acme": ACME_URL });

      // The team is written by hand, once, and `init` alone accepts and clones it.
      const both = `${project}team: { name: northwind/brain, url: ${TEAM_URL} }\n`;
      writeFileSync(join(repo, "kioku.yaml"), both);
      const team = await kioku(["init"], home, { cwd: repo, terminal: true });
      assert.equal(team.code, 0, team.raw);
      assert.equal(team.out.wrote, false);
      assert.deepEqual(
        team.out.cloned.map((o: { tier: string; status: string }) => [o.tier, o.status]),
        [["team", "cloned"]],
      );
      assert.deepEqual(
        team.out.chain.map((l: { tier: string; key: string }) => [l.tier, l.key]),
        [
          ["personal", "sam/brain"],
          ["project", "northwind/brain-acme"],
          ["team", "northwind/brain"],
        ],
      );

      // Again, with the same brain: nothing to write. With another: refused.
      const again = await kioku(["init", "github.com/northwind/brain-acme"], home, { cwd: repo });
      assert.equal(again.out.wrote, false, again.raw);
      const other = await kioku(["init", "northwind/brain-other"], home, { cwd: repo, terminal: true });
      assert.equal(other.out.error.code, "kioku_yaml_exists");
      assert.equal(readFileSync(join(repo, "kioku.yaml"), "utf8"), both);
      assert.equal(existsSync(join(home, ".kioku/brains/northwind/brain-other")), false, "nothing was made");

      const list = await kioku(["brain", "list"], home, { cwd: repo });
      assert.deepEqual(
        list.out.brains.map((b: { key: string; tier: string; onDisk: boolean }) => [b.key, b.tier, b.onDisk]),
        [
          ["sam/brain", "personal", true],
          ["northwind/brain-acme", "project", true],
          ["northwind/brain", "team", true],
        ],
      );
      const text = await kioku(["brain", "list"], home, { cwd: repo, tty: true });
      assert.match(
        text.out,
        /^Chain here: personal sam\/brain → project northwind\/brain-acme → team northwind\/brain$/m,
      );
      assert.equal((await kioku(["init", "--team", "northwind/brain"], home, { cwd: repo })).out.error.code, "usage");
    } finally {
      remotes.close();
    }
  }));

test("init with an address that cannot be cloned leaves nothing behind", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const repo = join(dir, "acme-api");
      mkdirSync(repo, { recursive: true });
      sh(repo, "init", "-q", "-b", "main");
      const before = readMachineConfig(home);
      const r = await kioku(["init", "github.com/northwind/brain-nope"], home, { cwd: repo, terminal: true });
      assert.deepEqual([r.code, r.out.error.code], [3, "clone_failed"], r.raw);
      assert.equal(existsSync(join(repo, "kioku.yaml")), false, "no file");
      assert.deepEqual(readMachineConfig(home), before, "not recorded");
      assert.deepEqual(readdirSync(join(home, ".kioku/staging")), [], "nothing staged is left");
      const team = await kioku(["init", "github.com/northwind/brain"], home, { cwd: repo, terminal: true });
      assert.equal(team.out.error.code, "brain_other_tier", "a project folder's brain is a project brain (§2.1)");
      assert.equal(existsSync(join(home, ".kioku/brains/northwind/brain")), false);
    } finally {
      remotes.close();
    }
  }));

test("init <name> makes the project brain when this machine has none, and links it by name, on this machine alone (§2.4)", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const repo = join(dir, "new-api");
      mkdirSync(repo, { recursive: true });
      sh(repo, "init", "-q", "-b", "main");
      const agent = await kioku(["init", "northwind/brain-new"], home, { cwd: repo });
      assert.equal(agent.out.error.code, "needs_terminal", "making a brain is the person's");
      assert.equal(existsSync(join(home, ".kioku/brains/northwind/brain-new")), false);
      const r = await kioku(["init", "northwind/brain-new"], home, { cwd: repo, terminal: true });
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual(
        r.out.created.map((c: { tier: string; brain: string; publication: string }) => [
          c.tier,
          c.brain,
          c.publication,
        ]),
        [["project", "northwind/brain-new", "local"]],
      );
      assert.equal(readFileSync(join(repo, "kioku.yaml"), "utf8"), "brain: northwind/brain-new\n");
      assert.deepEqual(
        r.out.chain.map((l: { tier: string; key: string }) => [l.tier, l.key]),
        [
          ["personal", "sam/brain"],
          ["project", "northwind/brain-new"],
        ],
      );
      assert.deepEqual(r.out.cloned, []);

      const other = join(dir, "other-api");
      mkdirSync(other, { recursive: true });
      sh(other, "init", "-q", "-b", "main");
      const local = await kioku(["init", "northwind/brain-local"], home, { cwd: other, terminal: true, tty: true });
      assert.match(
        local.out,
        /Made the project brain northwind\/brain-local at .* on this machine; kioku brain publish northwind\/brain-local --remote <address> puts it in a repository you make$/m,
      );
      assert.match(local.out, /northwind\/brain-local has no remote, so the file links it on this machine alone/);
      const personal = await kioku(["init", "sam/brain"], home, { cwd: join(dir, "third"), terminal: true });
      assert.equal(
        personal.out.error.code,
        "brain_other_tier",
        "the personal brain loads everywhere, never as a project",
      );
    } finally {
      remotes.close();
    }
  }));

test("a brain linked by name and published since: init alone writes its address, and a teammate's init clones it from there (§2.4)", () =>
  scratch(async (dir) => {
    const home = join(dir, "home");
    await setUp(home);
    const repo = join(dir, "acme-api");
    mkdirSync(repo, { recursive: true });
    sh(repo, "init", "-q", "-b", "main");
    const made = await kioku(["init", "northwind/brain-acme"], home, { cwd: repo, terminal: true });
    assert.equal(made.code, 0, made.raw);
    const shared = join(dir, "shared/acme.git");
    mkdirSync(shared, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", shared]);
    const published = await kioku(["brain", "publish", "northwind/brain-acme", "--remote", shared], home, {
      terminal: true,
      tty: true,
    });
    assert.equal(published.code, 0, published.out);
    assert.match(
      published.out,
      /names northwind\/brain-acme without its address: run kioku init there, which writes it/,
    );

    const r = await kioku(["init"], home, { cwd: repo, terminal: true });
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(r.out.addressed, ["northwind/brain-acme"]);
    assert.equal(
      readFileSync(join(repo, "kioku.yaml"), "utf8"),
      `brain: { name: northwind/brain-acme, url: ${shared} }\n`,
    );

    const mate = join(dir, "mate");
    await kioku(["setup"], mate, { terminal: true });
    const theirs = await kioku(["init"], mate, { cwd: repo, terminal: true });
    assert.equal(theirs.code, 0, theirs.raw);
    assert.deepEqual(
      theirs.out.cloned.map((o: { tier: string; status: string }) => [o.tier, o.status]),
      [["project", "cloned"]],
    );
    assert.equal(readMachineConfig(mate)!.repositories["northwind/brain-acme"], shared, "the address is recorded");
    assert.equal(
      sh(join(mate, ".kioku/brains/northwind/brain-acme"), "rev-parse", "HEAD"),
      sh(made.out.created[0].path, "rev-parse", "HEAD"),
    );
  }));

test("init refuses inside a brain, from any of its folders", () =>
  scratch(async (home) => {
    writeBrain(join(home, "b"), "team", [], "northwind");
    commitAll(join(home, "b"));
    assert.equal(
      (await kioku(["init", "northwind/brain-acme"], home, { cwd: join(home, "b") })).out.error.code,
      "is_a_brain",
    );
    mkdirSync(join(home, "b/deep/er"), { recursive: true });
    assert.equal(
      (await kioku(["init", "northwind/brain-acme"], home, { cwd: join(home, "b/deep/er") })).out.error.code,
      "is_a_brain",
    );
  }));

test("in a folder with no git, init writes kioku.yaml there and the session loads the brain, from below it too (§2.4)", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const plain = join(dir, "plain");
      mkdirSync(join(plain, "notes/deep"), { recursive: true });
      const r = await kioku(["init", "northwind/brain-acme"], home, { cwd: plain, terminal: true });
      assert.equal(r.code, 0, JSON.stringify(r.out));
      assert.equal(r.out.file, join(plain, "kioku.yaml"));
      assert.equal(r.out.inRepository, false);
      assert.doesNotMatch((await kioku(["init"], home, { cwd: plain, terminal: true })).out.file, /notes/);
      assert.equal(existsSync(join(plain, "notes/kioku.yaml")), false);

      const list = await kioku(["brain", "list"], home, { cwd: join(plain, "notes/deep") });
      assert.match(JSON.stringify(list.out), /northwind\/brain-acme/);
      const session = await kioku(["hook", "session-start"], home, { cwd: join(plain, "notes/deep") });
      assert.match(session.raw, /kioku|acme/);
      assert.match(JSON.stringify(session.raw), /acme/, "the summary names the brain the folder above links");

      // With no brain named below a linked folder: the file above. Naming one links this folder, and the nearest wins.
      const below = await kioku(["init"], home, { cwd: join(plain, "notes/deep") });
      assert.equal(below.out.file, join(plain, "kioku.yaml"));
      assert.equal(below.out.wrote, false);
      const nested = await kioku(["init", "northwind/brain-acme"], home, { cwd: join(plain, "notes") });
      assert.equal(nested.out.file, join(plain, "notes/kioku.yaml"));

      // With no file anywhere and no brain named, it says how.
      const empty = join(dir, "empty");
      mkdirSync(empty);
      const none = await kioku(["init"], home, { cwd: empty });
      assert.equal(none.out.error.code, "usage");
      assert.equal(existsSync(join(empty, "kioku.yaml")), false);
    } finally {
      remotes.close();
    }
  }));

// The maintenance report.
const NOW = new Date(2026, 9, 7, 12);
const daysAgo = (n: number): string => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function instinct(n: number, title: string, dates: string[]): Made {
  const file = createPage({
    type: INSTINCT,
    namespace: "acme",
    title,
    summary: `${title}.`,
    created: dates[0] ?? "2026-01-01",
    source: "https://x.io",
    id: ulid(n),
    body: buildBody(INSTINCT, { When: "w", Do: "d" }),
  });
  for (const d of dates) appendEvidence(file, d, "seen", "https://x.io");
  return {
    path: `memory/instincts/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    text: serializeBrainFile(file),
  };
}

function lintFixture(root: string): void {
  writeBrain(
    root,
    "project",
    [
      made({
        n: 1,
        type: MEMORY,
        title: "Run migrations before the deploy",
        sections: { "What happened": "x", Lesson: "y", "Rule of thumb": "z" },
      }),
      made({
        n: 2,
        type: MEMORY,
        title: "Run migrations before deploying",
        sections: { "What happened": "x", Lesson: "y", "Rule of thumb": "z" },
      }),
      instinct(3, "Rebase before pushing", [daysAgo(181)]),
      instinct(4, "Run database tests serially", [daysAgo(20), daysAgo(10), daysAgo(1)]),
      made({ n: 5, type: DECISION, title: "MySQL for Acme", sections: { Decision: "d", Why: "w", Consequences: "c" } }),
      made({
        n: 6,
        type: DECISION,
        title: "Postgres over MySQL",
        supersedes: "./mysql-for-acme.md",
        sections: { Decision: "d", Why: "w", Consequences: "c" },
      }),
      made({ n: 7, type: CONTEXT, title: "Who is who", sections: {} }),
      made({ n: 8, type: RULE, title: "Never deploy on Fridays", summary: null, sections: { Rule: "r", Why: "w" } }),
    ],
    "acme",
  );
  put(
    root,
    "knowledge/acme/context/who-is-who.md",
    readFileSync(join(root, "knowledge/acme/context/who-is-who.md"), "utf8").replace(
      "## Changelog",
      "See [the rota](./gone.md).\n\n## Changelog",
    ),
  );
  commitAll(root);
}

test("brain lint reports one case per category, changes nothing in the brain, and keeps the count for the summary", () =>
  scratch(async (home) => {
    const root = join(home, ".kioku/brains/northwind/brain-acme");
    lintFixture(root);
    put(home, ".kioku/config.yaml", "repositories:\n  github.com/northwind/brain-acme: {}\n");
    put(home, "work/acme-api/kioku.yaml", "brain: github.com/northwind/brain-acme\n");
    const r = await kioku(["brain", "lint"], home, { cwd: join(home, "work/acme-api") });
    assert.equal(r.code, 0, r.raw);
    const report = r.out.brains[0];
    assert.deepEqual(report.similar, [
      { a: "memory/run-migrations-before-deploying.md", b: "memory/run-migrations-before-the-deploy.md" },
    ]);
    assert.deepEqual(report.staleInstincts, [
      { path: "memory/instincts/rebase-before-pushing.md", last: daysAgo(181) },
    ]);
    assert.deepEqual(report.superseded, [
      { path: "knowledge/acme/decisions/mysql-for-acme.md", by: "knowledge/acme/decisions/postgres-over-mysql.md" },
    ]);
    assert.deepEqual(report.brokenLinks, [{ path: "knowledge/acme/context/who-is-who.md", target: "./gone.md" }]);
    assert.deepEqual(report.missingSummary, ["rules/never-deploy-on-fridays.md"]);
    assert.deepEqual(report.skillCandidates, [
      { path: "memory/instincts/run-database-tests-serially.md", occasions: 3 },
    ]);
    assert.equal(report.count, 6);
    assert.equal(sh(root, "status", "--porcelain", "--ignored"), "", "nothing written in the brain");

    const counts = JSON.parse(readFileSync(lintReportPath(home), "utf8"));
    assert.equal(counts["northwind/brain-acme"].count, 6);
    const text = await kioku(["brain", "lint", "northwind/brain-acme"], home, {
      cwd: join(home, "work/acme-api"),
      tty: true,
    });
    assert.match(
      text.out,
      /^northwind\/brain-acme {2}6 things to review\n  similar pages\n    memory\/run-migrations-before-deploying\.md ~ memory\/run-migrations-before-the-deploy\.md\n/,
    );
    assert.match(text.out, /Skill candidates\n    memory\/instincts\/run-database-tests-serially\.md \(3 occasions\)/);

    // The summary carries the count.
    const s = await kioku(["hook", "session-start"], home, { cwd: join(home, "work/acme-api") });
    assert.match(
      s.out.hookSpecificOutput.additionalContext,
      /## To review\n\n- northwind\/brain-acme: 6 things for `kioku brain lint northwind\/brain-acme`/,
    );
  }));

test("an instinct whose latest occasion is 181 days old is stale; at 179 days it is not", () =>
  scratch(async (home) => {
    const root = join(home, "b");
    writeBrain(
      root,
      "project",
      [instinct(1, "Old habit", [daysAgo(400), daysAgo(181)]), instinct(2, "Recent habit", [daysAgo(179)])],
      "acme",
    );
    commitAll(root);
    const r = await kioku(["brain", "lint", root], home);
    assert.deepEqual(
      r.out.brains[0].staleInstincts.map((s: { path: string }) => s.path),
      ["memory/instincts/old-habit.md"],
    );
  }));

test("sync refreshes the lint counts of the chain", () =>
  scratch(async (home) => {
    const root = join(home, ".kioku/brains/northwind/brain-acme");
    lintFixture(root);
    put(home, ".kioku/config.yaml", "repositories:\n  github.com/northwind/brain-acme: {}\n");
    put(home, "work/acme-api/kioku.yaml", "brain: github.com/northwind/brain-acme\n");
    await kioku(["sync", "--cwd", join(home, "work/acme-api")], home);
    assert.equal(JSON.parse(readFileSync(lintReportPath(home), "utf8"))["northwind/brain-acme"].count, 6);
  }));

test("--brain refuses a word two brains of the chain answer, and names their keys; the tier or the key still picks one", () => {
  const chain: ChainBrain[] = [
    { tier: "personal", key: "sam/brain", root: "/b/sam/brain", cloned: true },
    { tier: "team", key: "northwind/brain", root: "/b/northwind/brain", cloned: true },
  ];
  assert.throws(
    () => pickBrain(chain, "brain"),
    (e: Error & { code?: string }) => {
      assert.equal(e.code, "brain_ambiguous");
      assert.match(
        e.message,
        /"brain" names more than one brain here: sam\/brain \(personal\), northwind\/brain \(team\); use the key/,
      );
      return true;
    },
  );
  assert.equal(pickBrain(chain, "personal").key, "sam/brain");
  assert.equal(pickBrain(chain, "northwind/brain").tier, "team");
  assert.equal(pickBrain(chain, "northwind/brain").tier, "team");
});

test("brain remove deletes the clone and forgets the brain on this machine, leaves the repository, and brain clone brings it back", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const clone = join(home, ".kioku/brains/northwind/brain-acme");
      assert.equal(
        (await kioku(["brain", "clone", "github.com/northwind/brain-acme"], home, { terminal: true })).code,
        0,
      );
      assert.ok(existsSync(clone));

      const agent = await kioku(["brain", "remove", "northwind/brain-acme"], home);
      assert.equal(agent.out.error.code, "needs_terminal");
      assert.ok(existsSync(clone), "nothing deleted outside a terminal");

      const dry = await kioku(["brain", "remove", "northwind/brain-acme", "--dry-run"], home, { terminal: true });
      assert.deepEqual([dry.code, dry.out.dryRun, dry.out.removed], [0, true, "folder"]);
      assert.ok(existsSync(clone), "--dry-run changes nothing");
      assert.ok("northwind/brain-acme" in readMachineConfig(home)!.repositories);

      const r = await kioku(["brain", "remove", "northwind/brain-acme"], home, { terminal: true });
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual([r.out.brain, r.out.removed, r.out.personal], ["northwind/brain-acme", "folder", false]);
      assert.equal(existsSync(clone), false, "the clone is gone");
      assert.equal(existsSync(join(home, ".kioku/brains/northwind")), false, "and the owner's empty folder with it");
      assert.deepEqual(Object.keys(readMachineConfig(home)!.repositories), [], "its address is forgotten");
      assert.ok(existsSync(join(remotes.base, "northwind/brain-acme.git")), "the repository on the host is untouched");

      const again = await kioku(["brain", "clone", "github.com/northwind/brain-acme"], home, { terminal: true });
      assert.equal(again.code, 0, "it comes back from the host");
      assert.ok(existsSync(join(clone, "kioku.yaml")));
    } finally {
      remotes.close();
    }
  }));

test("brain remove refuses what would lose work, the personal brain, the machine's team and a brain with no remote, unless --force", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const clone = join(home, ".kioku/brains/northwind/brain-acme");
      await kioku(["brain", "clone", "github.com/northwind/brain-acme"], home, { terminal: true });
      const code = async (...argv: string[]) =>
        (await kioku(["brain", "remove", ...argv], home, { terminal: true })).out.error?.code;

      put(clone, "scratch.md", "not committed\n");
      assert.equal(await code("northwind/brain-acme"), "brain_unsaved");
      sh(clone, "add", "-A");
      sh(clone, "commit", "-q", "-m", "local");
      assert.equal(await code("northwind/brain-acme"), "brain_unsaved", "a commit no remote has");
      assert.ok(existsSync(clone), "refused, so nothing deleted");

      assert.equal(await code("sam/brain"), "brain_personal");
      await kioku(["brain", "create", "northwind/brain-local", "--tier", "project"], home);
      assert.equal(await code("northwind/brain-local"), "brain_no_remote");

      const forced = await kioku(["brain", "remove", "northwind/brain-acme", "--force"], home, { terminal: true });
      assert.equal(forced.code, 0, forced.raw);
      assert.equal(existsSync(clone), false);

      const personal = await kioku(["brain", "remove", "sam/brain", "--force"], home, { terminal: true });
      assert.deepEqual([personal.code, personal.out.personal], [0, true]);
      assert.equal(readMachineConfig(home)!.brain, undefined, "no personal brain on this machine now");

      // The machine's team is the person's own, like the personal brain: kept unless --force, which forgets it (§2.5).
      await kioku(["brain", "clone", "github.com/northwind/brain"], home, { terminal: true });
      assert.equal((await kioku(["config", "set", "team", "northwind/brain"], home, { terminal: true })).code, 0);
      const team = await kioku(["brain", "remove", "northwind/brain"], home, { terminal: true });
      assert.equal(team.out.error.code, "brain_team");
      assert.match(team.out.error.message, /this machine's team.*kioku config unset team/);
      assert.equal(readMachineConfig(home)!.team, "northwind/brain", "refused, so nothing forgotten");
      const forcedTeam = await kioku(["brain", "remove", "northwind/brain", "--force"], home, { terminal: true });
      assert.deepEqual([forcedTeam.code, forcedTeam.out.team], [0, true]);
      assert.equal(readMachineConfig(home)!.team, undefined, "no team on this machine now");
    } finally {
      remotes.close();
    }
  }));

test("brain remove refuses a clone git cannot read, rather than taking it for one with nothing to lose (§2.5)", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      const clone = join(home, ".kioku/brains/northwind/brain-acme");
      await kioku(["brain", "clone", "github.com/northwind/brain-acme"], home, { terminal: true });
      put(clone, ".git/refs/heads/main", "not a commit\n");
      const r = await kioku(["brain", "remove", "northwind/brain-acme"], home, { terminal: true });
      assert.equal(r.out.error?.code, "brain_unsaved", r.raw);
      assert.ok(existsSync(clone), "refused, so nothing deleted");
    } finally {
      remotes.close();
    }
  }));

test("brain remove clears the conflict folders a brain had (§2.5)", () =>
  scratch(async (dir) => {
    const remotes = publishBrains(dir);
    try {
      const home = join(dir, "home");
      await setUp(home);
      assert.equal(
        (await kioku(["brain", "clone", "github.com/northwind/brain-acme"], home, { terminal: true })).code,
        0,
      );
      put(join(conflictsPath(home), "northwind", "brain-acme"), "kioku-conflict/x/note.md", "left over\n");
      const r = await kioku(["brain", "remove", "northwind/brain-acme"], home, { terminal: true });
      assert.deepEqual(
        [r.code, r.out.removed, r.out.remote],
        [0, "folder", "https://github.com/northwind/brain-acme.git"],
        r.raw,
      );
      assert.equal(
        existsSync(join(conflictsPath(home), "northwind", "brain-acme")),
        false,
        "its conflict folders point at a clone that is gone",
      );
      assert.ok(!("northwind/brain-acme" in readMachineConfig(home)!.repositories));
    } finally {
      remotes.close();
    }
  }));

test("brain export is no verb: an unknown verb, and the help no longer lists it", () =>
  scratch(async (home) => {
    const r = await kioku(["brain", "export", "--to", "out"], home);
    assert.equal(r.out.error.code, "unknown_verb");
    assert.match(r.out.error.message, /unknown verb "export" in kioku brain/);
    assert.equal((await kioku(["help", "brain", "export"], home)).out.error.code, "unknown_verb");
  }));
