import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMachineConfig, configPath } from "../../src/core/config/machine.ts";
import { readSemanticState } from "../../src/core/semantic/status.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import {
  activate,
  currentVersion,
  ensureLauncher,
  installDirs,
  installedVersions,
  installVersion,
  launcherPath,
  onPath,
  pathLine,
} from "../../src/core/setup/install.ts";
import { findUser } from "../../src/core/setup/personal.ts";
import { run, type Context } from "../../src/cli/run.ts";
import { ctx, OFFLINE, scratch as scratchIn } from "../fixtures.ts";
import { Remotes, isolateGit } from "../remotes.ts";

isolateGit();

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const scratch = scratchIn("setup");

interface Result {
  code: number;
  out: any;
  raw: string;
}

/** Run a verb as the person at a terminal, unless the context says otherwise: `setup` is theirs (§6.3). */
async function kioku(argv: string[], context: Context, tty = false): Promise<Result> {
  let raw = "";
  const code = await run(argv, { stdout: (t) => (raw += t), isTty: tty }, { interactive: true, ...context });
  let out: unknown = raw;
  if (!tty && raw.trim() !== "") out = JSON.parse(raw);
  return { code, out, raw };
}

const BRAIN = (home: string, user = "sam") => join(home, ".kioku/brains", user, "brain");

/** The files of a folder and git's view of them, to tell that nothing changed. */
function snapshot(dir: string): string {
  return execFileSync("find", [dir, "-not", "-path", "*/.git/*", "-type", "f", "-exec", "shasum", "{}", "+"], {
    encoding: "utf8",
  })
    .split("\n")
    .sort()
    .join("\n");
}

test("setup refuses a configuration from 3.x, naming the key, and leaves it as it was (§2.5)", () =>
  scratch(async (home) => {
    mkdirSync(join(home, ".kioku"), { recursive: true });
    const text = "evolve: manual\nrepositories: {}\n";
    writeFileSync(join(home, ".kioku/config.yaml"), text);
    const r = await kioku(["setup"], ctx({ home }));
    assert.equal(r.out.error.code, "config_invalid", r.raw);
    assert.match(r.out.error.message, /unknown key `evolve`/);
    assert.equal(readFileSync(join(home, ".kioku/config.yaml"), "utf8"), text);
  }));

test("setup on a machine with no ~/.kioku writes the configuration, makes no brain, says how to make or bring one, and starts the sync that fetches the search model", () =>
  scratch(async (home) => {
    const calls: string[][] = [];
    const r = await kioku(
      ["setup"],
      ctx({ home, startBackground: (a) => calls.push(a), semantic: { ...OFFLINE, platform: "darwin-arm64" } }),
    );
    assert.equal(r.code, 0);
    assert.deepEqual([r.out.configuration, r.out.personal], ["created", null]);
    assert.ok(!("user" in r.out), "who the person is is git's (§2.5)");
    // The search model (§4.3): the sync that fetches it, started once in the background, and said once.
    assert.deepEqual(calls, [["sync", "--cwd", home, "--background"]]);
    assert.deepEqual([r.out.model.action, typeof r.out.model.mb], ["fetching", "number"]);
    assert.ok(readSemanticState(home).announced !== undefined, "the session hook will not say it again");

    // No brain: which repository holds the personal one is the person's to say (§2.3).
    assert.equal(existsSync(join(home, ".kioku/brains")), false);
    assert.deepEqual(readMachineConfig(home), { repositories: {}, trust: { owners: [] } });

    const text = await kioku(["setup"], ctx({ home }), true);
    assert.match(text.raw, /You have no personal brain on this machine yet/);
    assert.match(text.raw, /\n {2}kioku brain create\nmakes yours, sam\/brain, on this machine/);
    assert.match(text.raw, /\n {2}kioku brain clone sam\/brain\nbrings it from its repository/);
    assert.match((await kioku(["setup", "--user", "sam"], ctx({ home }))).out.error.message, /^unknown flag --user/);
  }));

test("running setup twice changes nothing and says so", () =>
  scratch(async (home) => {
    const bundle = join(home, "some-kioku.mjs");
    writeFileSync(bundle, "console.log('x')\n");
    const context = ctx({ home, bundle });
    await kioku(["setup"], context);
    await kioku(["brain", "create", "sam/brain", "--tier", "personal"], context);
    const before = snapshot(join(home, ".kioku"));
    const again = await kioku(["setup"], context, true);
    assert.equal(again.code, 0);
    assert.match(again.raw, /Already set up\. Nothing to do\./);
    assert.doesNotMatch(again.raw, /no personal brain/, "with a personal brain, nothing is said about one");
    assert.equal(snapshot(join(home, ".kioku")), before);
    const third = await kioku(["setup"], context);
    assert.deepEqual(
      [third.out.configuration, third.out.personal, third.out.model.action],
      ["nothing", "github.com/sam/brain", "pending"],
      "the fetch was started by the first run; sync owns it since",
    );
  }));

test("setup --no-model keeps search full text and starts no fetch; a machine already set to full text starts none either", () =>
  scratch(async (home) => {
    const calls: string[][] = [];
    const context = () =>
      ctx({ home, startBackground: (a) => calls.push(a), semantic: { ...OFFLINE, platform: "darwin-arm64" } });
    const r = await kioku(["setup", "--no-model"], context(), true);
    assert.equal(r.code, 0, r.raw);
    assert.match(
      r.raw,
      /✓ Kept search on full text \(search\.mode: full-text\); kioku config set search\.mode hybrid, then kioku sync, fetches the model later$/m,
    );
    assert.equal(readMachineConfig(home)?.search?.mode, "full-text");
    assert.deepEqual(calls, [], "nothing started");
    const again = await kioku(["setup", "--no-model"], context());
    assert.deepEqual(
      [again.out.configuration, again.out.model],
      ["nothing", { action: "full-text", detail: "already" }],
    );
    const plain = await kioku(["setup"], context(), true);
    assert.match(plain.raw, /Already set up.*Nothing to do/);
    assert.deepEqual(calls, []);
  }));

test("the name the person goes by comes from git, github.user first, else the system user, all of it on this machine (§2.3)", () =>
  scratch(async (dir) => {
    const gitconfig = join(dir, "gitconfig");
    const saved = { global: process.env.GIT_CONFIG_GLOBAL, count: process.env.GIT_CONFIG_COUNT };
    process.env.GIT_CONFIG_GLOBAL = gitconfig;
    // The tests' own `github.user` is the last of git's variables (`isolateGit`): left out here.
    process.env.GIT_CONFIG_COUNT = String(Number(saved.count) - 1);
    try {
      writeFileSync(gitconfig, "[user]\n\tname = Ana María Pérez\n\temail = ana@example.com\n");
      assert.deepEqual(findUser(), { name: "ana-maria-perez", from: "git" });
      writeFileSync(gitconfig, "[github]\n\tuser = anap\n[user]\n\tname = Ana\n");
      assert.deepEqual(findUser(), { name: "anap", from: "git" });
      writeFileSync(gitconfig, "[user]\n\temail = ana.p@example.com\n");
      assert.equal(findUser().name, "ana.p");
      writeFileSync(gitconfig, "");
      assert.equal(findUser().from, "system");
    } finally {
      process.env.GIT_CONFIG_GLOBAL = saved.global;
      process.env.GIT_CONFIG_COUNT = saved.count;
    }
  }));

// The personal brain: made or brought by the person (§2.3).
test("brain create personal makes the brain in the repository named, after its repository, with one commit and no remote", () =>
  scratch(async (home) => {
    await kioku(["setup"], ctx({ home }));
    const r = await kioku(["brain", "create", "northwind/brain-sam", "--tier", "personal"], ctx({ home }));
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(
      [r.out.brain, r.out.tier, r.out.publication],
      ["github.com/northwind/brain-sam", "personal", "local"],
    );
    const path = join(home, ".kioku/brains/northwind/brain-sam");
    assert.equal(r.out.path, path);
    for (const f of [
      "kioku.yaml",
      "BRAIN.md",
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/commands/ingest.md",
      "memory/.gitkeep",
      "rules/.gitkeep",
      "skills/.gitkeep",
    ])
      assert.ok(existsSync(join(path, f)), f);
    assert.match(
      readFileSync(join(path, "kioku.yaml"), "utf8"),
      /^namespaces: \[\]$/m,
      "no namespace until the first page needs one (§3.2)",
    );
    assert.doesNotMatch(
      readFileSync(join(path, "kioku.yaml"), "utf8"),
      /^name:/m,
      "a brain's name is its repository's",
    );
    assert.match(readFileSync(join(path, "BRAIN.md"), "utf8"), /^The personal brain of sam:/m);
    assert.deepEqual(
      validateBrain(path).findings.filter((f) => f.severity === "error"),
      [],
    );
    assert.equal(sh(path, "rev-list", "--count", "HEAD"), "1");
    assert.equal(sh(path, "remote"), "");
    assert.equal(sh(path, "status", "--porcelain"), "");
    assert.equal(sh(path, "branch", "--show-current"), "main");
    assert.deepEqual(readMachineConfig(home), {
      brain: "github.com/northwind/brain-sam",
      repositories: { "github.com/northwind/brain-sam": {} },
      trust: { owners: [] },
    });

    const second = await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
    assert.deepEqual([second.code, second.out.error.code], [1, "personal_exists"]);
  }));

test("with no network and no gh, creation still succeeds and the brain is usable", () =>
  scratch(async (home) => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      GIT_TERMINAL_PROMPT: "0",
      HTTPS_PROXY: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
    });
    try {
      const r = await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual(
        validateBrain(BRAIN(home)).findings.filter((f) => f.severity === "error"),
        [],
      );
      assert.ok(
        !("user" in readMachineConfig(home)!),
        "a brain made before setup records no user, and gh is never asked",
      );
    } finally {
      for (const k of ["GIT_TERMINAL_PROMPT", "HTTPS_PROXY", "https_proxy"]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }));

test("a machine with no git identity still commits", () =>
  scratch(async (home) => {
    const saved = { ...process.env };
    for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"])
      delete process.env[k];
    try {
      await kioku(["setup"], ctx({ home }));
      const r = await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
      assert.equal(r.code, 0, r.raw);
      assert.equal(sh(BRAIN(home), "log", "-1", "--format=%an <%ae>"), "sam <sam@localhost>");
    } finally {
      Object.assign(process.env, saved);
    }
  }));

test("brain create makes a personal brain here even when the git host has one; publish then makes it that one when it has no page (§2.3)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const a = join(dir, "machine-a");
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home: a }));
      remotes.empty("sam/brain");
      await kioku(["brain", "publish"], ctx({ home: a }));
      const b = join(dir, "machine-b");
      const r = await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home: b }));
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual(
        [r.out.action, r.out.publication],
        ["created", "local"],
        "brain clone is the verb that brings it",
      );
      assert.equal(sh(BRAIN(b), "remote"), "", "made here, with nothing of the host's");
      const published = await kioku(["brain", "publish"], ctx({ home: b }));
      assert.deepEqual([published.code, published.out.status], [0, "connected"], published.raw);
      assert.equal(
        sh(BRAIN(b), "rev-parse", "HEAD"),
        sh(BRAIN(a), "rev-parse", "HEAD"),
        "the copy with no page became the published brain",
      );
      assert.deepEqual(
        [readMachineConfig(b)!.brain, readMachineConfig(b)!.repositories],
        [readMachineConfig(a)!.brain, readMachineConfig(a)!.repositories],
      );
    } finally {
      remotes.close();
    }
  }));

test("brain clone on a second machine brings the personal brain as it is, writes the same configuration, and makes no commit", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const a = join(dir, "machine-a");
      await kioku(["setup"], ctx({ home: a }));
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home: a }));
      remotes.empty("sam/brain");
      await kioku(["brain", "publish"], ctx({ home: a }));

      const b = join(dir, "machine-b");
      const r = await kioku(["brain", "clone", "github.com/sam/brain"], ctx({ home: b }));
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual([r.out.action, r.out.tier], ["cloned", "personal"]);
      assert.deepEqual(readMachineConfig(b), readMachineConfig(a), "the same configuration, nothing about the person");
      assert.equal(sh(BRAIN(b), "rev-parse", "HEAD"), sh(BRAIN(a), "rev-parse", "HEAD"));
      assert.equal(sh(BRAIN(b), "status", "--porcelain"), "");

      // A machine that has a personal brain does not take another, and keeps nothing of it.
      remotes.publish("sam/notes", {
        "kioku.yaml": "format: 1\ntier: personal\nnamespaces:\n  - sam\n",
        "BRAIN.md": "# sam\n",
      });
      const refused = await kioku(["brain", "clone", "sam/notes"], ctx({ home: b }));
      assert.deepEqual([refused.code, refused.out.error.code], [1, "personal_exists"]);
      assert.equal(existsSync(join(b, ".kioku/brains/sam/notes")), false);
    } finally {
      remotes.close();
    }
  }));

test("brain clone registers a shared brain as trusted, refuses what is not a brain and leaves nothing behind, and is the person's", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      remotes.publish("northwind/brain", {
        "kioku.yaml": "format: 1\ntier: team\nnamespaces:\n  - northwind\n",
        "BRAIN.md": "# x\n",
      });
      remotes.publish("northwind/api", { "README.md": "# api\n" });
      const home = join(dir, "home");
      const team = await kioku(["brain", "clone", "northwind/brain"], ctx({ home }));
      assert.equal(team.code, 0, team.raw);
      assert.deepEqual(
        [
          team.out.tier,
          readMachineConfig(home)!.repositories["github.com/northwind/brain"],
          readMachineConfig(home)!.brain,
        ],
        ["team", {}, undefined],
      );

      const code = await kioku(["brain", "clone", "northwind/api"], ctx({ home }));
      assert.deepEqual([code.code, code.out.error.code], [1, "not_a_brain"]);
      assert.equal(existsSync(join(home, ".kioku/brains/northwind/api")), false);
      assert.equal((await kioku(["brain", "clone", "not a url"], ctx({ home }))).out.error.code, "brain_url_invalid");
      assert.equal(
        (await kioku(["brain", "clone", "northwind/brain"], ctx({ home, interactive: false }))).out.error.code,
        "needs_terminal",
      );
    } finally {
      remotes.close();
    }
  }));

test("brain sync pulls and pushes a brain wherever the person is, or every brain with --all", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const a = join(dir, "machine-a");
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home: a }));
      remotes.empty("sam/brain");
      await kioku(["brain", "publish"], ctx({ home: a }));
      const b = join(dir, "machine-b");
      await kioku(["brain", "clone", "sam/brain"], ctx({ home: b }));
      writeFileSync(join(BRAIN(a), "note.md"), "x\n");
      sh(BRAIN(a), "add", "note.md");
      sh(BRAIN(a), "-c", "user.name=sam", "-c", "user.email=sam@x", "commit", "-q", "-m", "A note");
      sh(BRAIN(a), "push", "-q");

      const somewhere = join(dir, "elsewhere");
      mkdirSync(somewhere);
      const r = await kioku(["brain", "sync", "sam/brain"], ctx({ home: b, cwd: somewhere }));
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual(
        r.out.outcomes.map((o: { key: string; status: string }) => [o.key, o.status]),
        [["github.com/sam/brain", "pulled"]],
      );
      assert.ok(existsSync(join(BRAIN(b), "note.md")));
      assert.equal(
        (await kioku(["brain", "sync", "--all"], ctx({ home: b, cwd: somewhere }))).out.outcomes[0].status,
        "up-to-date",
      );
      // Every brain verb finds a brain of the machine by name or repository, wherever the person is (§6.1).
      for (const name of ["sam/brain", "github.com/sam/brain", "personal"]) {
        const found = await kioku(["brain", "validate", name], ctx({ home: b, cwd: somewhere }));
        assert.equal(found.out.error, undefined, name);
        assert.match(found.raw, new RegExp(BRAIN(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), name);
      }
      assert.equal(
        (await kioku(["brain", "lint", "sam/brain"], ctx({ home: b, cwd: somewhere }))).out.error,
        undefined,
      );
      assert.equal(
        (await kioku(["brain", "validate", "nope"], ctx({ home: b, cwd: somewhere }))).out.error.code,
        "brain_unknown",
      );
      for (const argv of [
        ["brain", "sync"],
        ["brain", "sync", "sam/brain", "--all"],
        ["brain", "sync", "a", "b"],
      ]) {
        assert.equal((await kioku(argv, ctx({ home: b }))).out.error.code, "usage", argv.join(" "));
      }
    } finally {
      remotes.close();
    }
  }));

test("brain publish with no brain named takes the brain the folder is inside, and the personal one elsewhere (§6.1)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const home = join(dir, "home");
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
      const repo = join(dir, "api");
      mkdirSync(repo, { recursive: true });
      sh(repo, "init", "-q", "-b", "main");
      const made = await kioku(["init", "northwind/brain-local", "--create"], ctx({ home, cwd: repo }));
      assert.equal(made.code, 0, made.raw);

      remotes.empty("northwind/brain-local");
      remotes.empty("sam/brain");
      const inside = await kioku(
        ["brain", "publish"],
        ctx({ home, cwd: join(home, ".kioku/brains/northwind/brain-local") }),
      );
      assert.deepEqual(
        [inside.code, inside.out.brain, inside.out.status],
        [0, "github.com/northwind/brain-local", "pushed"],
        inside.raw,
      );
      const local = join(home, ".kioku/brains/northwind/brain-local");
      assert.equal(existsSync(join(local, ".github")), false, "publishing writes no workflow into the brain");
      assert.equal(sh(local, "status", "--porcelain"), "");
      assert.equal(
        sh(join(remotes.base, "northwind/brain-local.git"), "rev-parse", "main"),
        sh(local, "rev-parse", "HEAD"),
        "and it is pushed",
      );
      assert.equal(sh(BRAIN(home), "remote"), "", "only the brain the folder is inside");

      const elsewhere = await kioku(["brain", "publish"], ctx({ home, cwd: dir }));
      assert.deepEqual(
        [elsewhere.out.brain, elsewhere.out.status],
        ["github.com/sam/brain", "pushed"],
        "outside any brain it is the personal one",
      );
    } finally {
      remotes.close();
    }
  }));

/** Runs `body` with a `gh` first on the PATH that leaves a mark when anything runs it, and says whether anything did. */
async function ghRan(dir: string, body: () => Promise<void>): Promise<boolean> {
  const bin = join(dir, "gh-bin");
  const mark = join(dir, "gh-ran");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ntouch "${mark}"\nexit 1\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await body();
  } finally {
    process.env.PATH = path;
  }
  return existsSync(mark);
}

test("brain publish pushes to the empty repository the name says, once, and when nothing is there names both ways and changes nothing; gh runs in neither (§2.3, §6.3)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const home = join(dir, "home");
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
      const ran = await ghRan(dir, async () => {
        const none = await kioku(["brain", "publish"], ctx({ home }));
        assert.deepEqual([none.code, none.out.error.code], [1, "remote_absent"], none.raw);
        assert.match(none.out.error.message, /git says: /, "git's own words");
        assert.match(none.out.error.message, /create an empty private repository sam\/brain on github\.com/);
        assert.match(none.out.error.message, /kioku brain publish github\.com\/sam\/brain --to <url>/);
        assert.equal(sh(BRAIN(home), "remote"), "");
        assert.equal(readMachineConfig(home)!.repositories["github.com/sam/brain"]?.url, undefined);
        assert.equal(
          (await kioku(["brain", "publish"], ctx({ home, interactive: false }))).out.error.code,
          "needs_terminal",
        );

        const bare = remotes.empty("sam/brain");
        const r = await kioku(["brain", "publish"], ctx({ home }));
        assert.equal(r.code, 0, r.raw);
        assert.deepEqual([r.out.status, r.out.brain], ["pushed", "github.com/sam/brain"]);
        assert.equal(sh(bare, "rev-parse", "main"), sh(BRAIN(home), "rev-parse", "HEAD"));
        assert.equal((await kioku(["brain", "publish", "sam/brain"], ctx({ home }))).out.status, "exists");
      });
      assert.equal(ran, false, "gh never ran");
    } finally {
      remotes.close();
    }
  }));

test("--dir puts a brain made or cloned in the folder named and records it, so every verb finds it there (§2.5)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const a = join(dir, "machine-a");
      const mine = join(a, "code/sam/brain");
      const r = await kioku(
        ["brain", "create", "sam/brain", "--tier", "personal", "--dir", "~/code/sam/brain"],
        ctx({ home: a }),
      );
      assert.equal(r.code, 0, r.raw);
      remotes.empty("sam/brain");
      assert.equal((await kioku(["brain", "publish"], ctx({ home: a }))).out.status, "pushed");
      assert.equal(r.out.path, mine);
      assert.ok(existsSync(join(mine, "kioku.yaml")));
      assert.equal(existsSync(BRAIN(a)), false, "nothing in the managed folder");
      assert.deepEqual(readMachineConfig(a)!.repositories, { "github.com/sam/brain": { path: mine } });
      assert.equal((await kioku(["brain", "path", "sam/brain"], ctx({ home: a }))).out.path, mine);
      const again = await kioku(
        ["brain", "create", "sam/brain", "--tier", "project", "--dir", join(dir, "elsewhere")],
        ctx({ home: a }),
      );
      assert.equal(again.out.error.code, "usage", "a repository already placed is not moved");

      // A second machine clones it where it is told, relative to where the person is.
      const b = join(dir, "machine-b");
      mkdirSync(join(b, "work"), { recursive: true });
      const cloned = await kioku(
        ["brain", "clone", "sam/brain", "--dir", "notes"],
        ctx({ home: b, cwd: join(b, "work") }),
      );
      assert.equal(cloned.code, 0, cloned.raw);
      assert.equal(cloned.out.path, join(b, "work/notes"));
      assert.equal(readMachineConfig(b)!.repositories["github.com/sam/brain"]!.path, join(b, "work/notes"));
      assert.equal(
        (await kioku(["brain", "sync", "sam/brain"], ctx({ home: b }))).out.outcomes[0].status,
        "up-to-date",
      );
    } finally {
      remotes.close();
    }
  }));

test("brain sync never looks for the repository of a brain with no remote; brain publish connects one made since, and never merges two (§2.3)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const somewhere = join(dir, "elsewhere");
      mkdirSync(somewhere);

      const a = join(dir, "machine-a");
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home: a }));
      // A second machine makes its own brain too, while there is no repository: it has no page.
      await kioku(
        ["brain", "create", "sam/brain", "--tier", "personal", "--dir", join(dir, "b-brain")],
        ctx({ home: join(dir, "offline") }),
      );

      // An empty repository made by hand on the host: sync does not look for it.
      const bare = join(remotes.base, "sam/brain.git");
      mkdirSync(bare, { recursive: true });
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
      const none = await kioku(["brain", "sync", "sam/brain"], ctx({ home: a, cwd: somewhere }));
      assert.deepEqual(
        [none.code, none.out.outcomes[0].status, none.out.outcomes[0].message],
        [0, "no-remote", undefined],
      );
      assert.equal(sh(BRAIN(a), "remote"), "");
      assert.equal(sh(bare, "rev-list", "--all", "--count"), "0", "nothing pushed");

      // brain publish connects it: the empty repository takes this brain.
      const pushed = await kioku(["brain", "publish"], ctx({ home: a, cwd: somewhere }));
      assert.deepEqual([pushed.code, pushed.out.status], [0, "pushed"], pushed.raw);
      assert.equal(sh(bare, "rev-parse", "main"), sh(BRAIN(a), "rev-parse", "HEAD"));
      writeFileSync(join(BRAIN(a), "memory/lesson.md"), "x\n");
      sh(BRAIN(a), "add", "-A");
      sh(BRAIN(a), "commit", "-q", "-m", "A page");
      sh(BRAIN(a), "push", "-q");

      // A second machine made its own brain before the repository was there, and has no page: publishing takes the host's.
      const b = join(dir, "machine-b");
      const bConfig = join(b, ".kioku");
      mkdirSync(bConfig, { recursive: true });
      writeFileSync(
        join(bConfig, "config.yaml"),
        `brain: github.com/sam/brain\nrepositories:\n  github.com/sam/brain:\n    path: ${join(dir, "b-brain")}\n`,
      );
      assert.equal(
        (await kioku(["brain", "sync", "sam/brain"], ctx({ home: b, cwd: somewhere }))).out.outcomes[0].status,
        "no-remote",
      );
      const adopted = await kioku(["brain", "publish"], ctx({ home: b, cwd: somewhere }));
      assert.deepEqual([adopted.code, adopted.out.status], [0, "connected"], adopted.raw);
      assert.equal(sh(join(dir, "b-brain"), "rev-parse", "HEAD"), sh(BRAIN(a), "rev-parse", "HEAD"));
      assert.ok(existsSync(join(dir, "b-brain/memory/lesson.md")));

      // A third copy with pages of its own: two brains under one name, never merged here.
      const c = join(dir, "c-brain");
      execFileSync("git", ["clone", "-q", bare, c]);
      sh(c, "remote", "remove", "origin");
      sh(c, "checkout", "-q", "--orphan", "other");
      sh(c, "rm", "-rq", "--cached", ".");
      writeFileSync(join(c, "kioku.yaml"), "format: 1\ntier: personal\nnamespaces:\n  - sam\n");
      mkdirSync(join(c, "memory"), { recursive: true });
      writeFileSync(join(c, "memory/mine.md"), "y\n");
      sh(c, "add", "kioku.yaml", "memory/mine.md");
      sh(c, "commit", "-q", "-m", "Mine");
      const cHome = join(dir, "machine-c");
      mkdirSync(join(cHome, ".kioku"), { recursive: true });
      writeFileSync(
        join(cHome, ".kioku/config.yaml"),
        `brain: github.com/sam/brain\nrepositories:\n  github.com/sam/brain:\n    path: ${c}\n`,
      );
      const refused = await kioku(["brain", "publish"], ctx({ home: cHome, cwd: somewhere }));
      assert.equal(refused.out.error.code, "remote_diverged");
      assert.match(
        refused.out.error.message,
        /two brains under one name\. Kioku never merges them on its own; nothing was changed/,
      );
      assert.equal(sh(c, "remote"), "", "nothing was changed");
    } finally {
      remotes.close();
    }
  }));

test("brain publish --to pushes a brain to an empty repository anywhere, records the address, and brain clone --url brings it to another machine (§2.2)", () =>
  scratch(async (dir) => {
    const home = join(dir, "home");
    await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
    const shared = join(dir, "shared/sam.git");

    const absent = await kioku(["brain", "publish", "--to", shared], ctx({ home }));
    assert.deepEqual([absent.code, absent.out.error.code], [1, "remote_absent"]);
    assert.match(absent.out.error.message, /make an empty one there first \(git init --bare /);
    assert.equal(sh(BRAIN(home), "remote"), "", "nothing changed");

    mkdirSync(shared, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", shared]);
    const r = await kioku(["brain", "publish", "--to", "../shared/sam.git"], ctx({ home, cwd: join(dir, "shared") }));
    assert.deepEqual([r.code, r.out.status, r.out.remote], [0, "pushed", shared], r.raw);
    assert.equal(sh(shared, "rev-parse", "main"), sh(BRAIN(home), "rev-parse", "HEAD"));
    assert.deepEqual(readMachineConfig(home)!.repositories, { "github.com/sam/brain": { url: shared } });

    const b = join(dir, "machine-b");
    const bare = await kioku(["brain", "clone", shared], ctx({ home: b }));
    assert.equal(bare.out.error.code, "brain_url_invalid");
    assert.match(bare.out.error.message, /kioku brain clone <owner>\/<repo> --url /);
    const cloned = await kioku(["brain", "clone", "sam/brain", "--url", shared], ctx({ home: b }));
    assert.deepEqual([cloned.code, cloned.out.tier, cloned.out.action], [0, "personal", "cloned"], cloned.raw);
    assert.deepEqual(readMachineConfig(b)!.repositories, readMachineConfig(home)!.repositories);
    assert.equal(sh(BRAIN(b), "rev-parse", "HEAD"), sh(BRAIN(home), "rev-parse", "HEAD"));
    assert.equal((await kioku(["brain", "sync", "sam/brain"], ctx({ home: b }))).out.outcomes[0].status, "up-to-date");
  }));

test("doctor asks no git host about a brain with no remote, and says it lives only here: a warning, or ok with unpublished muted (§2.3)", () =>
  scratch(async (dir) => {
    const remotes = new Remotes(dir);
    try {
      const home = join(dir, "home");
      await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
      const bare = join(remotes.base, "sam/brain.git");
      mkdirSync(bare, { recursive: true });
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
      const check = async () =>
        (await kioku(["doctor"], ctx({ home }))).out.checks.find((x: { name: string }) => x.name === "brain sam/brain");
      const warned = await check();
      assert.deepEqual(
        [warned.state, warned.detail],
        ["warn", `${BRAIN(home)}, no remote: it lives only on this machine`],
      );
      assert.match(warned.fix, /^kioku brain publish puts it in an empty repository you make/);
      await kioku(["config", "set", "display.mute", "+unpublished"], ctx({ home }));
      const quiet = await check();
      assert.deepEqual([quiet.state, quiet.fix], ["ok", undefined]);
    } finally {
      remotes.close();
    }
  }));

test("a brain verb for a brain not on this machine says how to bring it", () =>
  scratch(async (home) => {
    await kioku(["brain", "create", "sam/brain", "--tier", "personal"], ctx({ home }));
    const repo = await kioku(["brain", "sync", "northwind/brain-acme"], ctx({ home }));
    assert.equal(repo.out.error.code, "brain_unknown");
    assert.match(
      repo.out.error.message,
      /To bring it: kioku brain clone northwind\/brain-acme, or, to make it when it does not exist, kioku brain create northwind\/brain-acme --tier personal\|project\|team/,
    );
    const word = await kioku(["brain", "path", "northwind/brain-acme"], ctx({ home }));
    assert.match(
      word.out.error.message,
      /no brain called "northwind\/brain-acme" on this machine \(sam\/brain\)\. To bring it: kioku brain clone northwind\/brain-acme/,
    );
  }));

// The SessionStart hook.
test("the hook makes no brain: with no personal brain it says so once a week, and on a machine never set up it says to run setup", () =>
  scratch(async (home) => {
    const never = await kioku(["hook", "session-start"], ctx({ home }));
    assert.equal(never.code, 0);
    assert.match(
      never.out.systemMessage,
      /⬢ kioku\.md · ⚠ not set up on this machine\n  ⎿ run kioku setup in a terminal/,
    );
    assert.equal(existsSync(join(home, ".kioku")), false, "nothing written");

    await kioku(["setup"], ctx({ home }));
    const context = ctx({ home });
    const first = await kioku(["hook", "session-start"], context);
    assert.equal(first.code, 0);
    assert.match(
      first.out.systemMessage,
      /⬢ kioku\.md · ⚠ no personal brain on this machine\n  ⎿ nothing personal is saved/,
    );
    assert.match(
      first.out.systemMessage,
      /  ⎿ run kioku brain create to make one here, or kioku brain clone sam\/brain to bring yours/,
    );
    assert.equal(existsSync(join(home, ".kioku/brains")), false, "no brain was made");

    const second = await kioku(["hook", "session-start"], context);
    assert.doesNotMatch(second.out.systemMessage ?? "", /no personal brain/, "not again the same week");
    const week = await kioku(["hook", "session-start"], { ...context, now: () => new Date(2026, 9, 14, 12, 0, 0) });
    assert.match(
      week.out.systemMessage ?? "",
      /⚠ no personal brain on this machine/,
      "again a week later, until there is one",
    );
  }));

test("doctor warns, and does not fail, when the machine has no personal brain", () =>
  scratch(async (home) => {
    await kioku(["setup"], ctx({ home }));
    const r = await kioku(["doctor"], ctx({ home }));
    const check = r.out.checks.find((c: { name: string }) => c.name === "personal brain");
    assert.equal(check.state, "warn");
    assert.match(
      check.fix,
      /`kioku brain create` makes yours, sam\/brain, on this machine; `kioku brain clone sam\/brain` brings it from its repository/,
    );
  }));

test("the hook never fails the session: a configuration it cannot read is one sentence for the person", () =>
  scratch(async (home) => {
    mkdirSync(join(home, ".kioku"), { recursive: true });
    writeFileSync(configPath(home), "brain: [oops\n");
    const broken = await kioku(["hook", "session-start"], ctx({ home }));
    assert.equal(broken.code, 0);
    assert.match(broken.out.systemMessage, /⬢ kioku\.md · ✕ could not start\n  ⎿ .*not valid YAML/);
  }));

test("the hook puts the launcher's folder on the Bash tool's PATH once, through the host's environment file", () =>
  scratch(async (home) => {
    const envFile = join(home, "claude-env");
    const dirs = installDirs(home, {});
    const context = ctx({ home, env: { CLAUDE_ENV_FILE: envFile, PATH: "/usr/bin" } });
    await kioku(["hook", "session-start"], context);
    await kioku(["hook", "session-start"], context);
    assert.equal(readFileSync(envFile, "utf8"), `${pathLine(dirs)}\n`);

    // Already reachable: nothing is added.
    const other = join(home, "other-env");
    await kioku(
      ["hook", "session-start"],
      ctx({ home, env: { CLAUDE_ENV_FILE: other, PATH: `${dirs.bin}:/usr/bin` } }),
    );
    assert.equal(existsSync(other), false);
  }));

// The install layout (§6.3).
/** The launcher run as a person runs it, without the `KIOKU_BIN` a developer's shell may carry (§6.3): these tests are about the version it made current. */
const { KIOKU_BIN: _devBuild, ...LAUNCHER_ENV } = process.env;

test("a version installed under versions/ and made current is what the launcher runs; a new version takes over at the next call", () =>
  scratch((home) => {
    const dirs = installDirs(home, {});
    const v1 = join(home, "v1.mjs");
    writeFileSync(v1, "console.log('v1', process.argv.slice(2).join(' '));\n");
    assert.equal(installVersion(dirs, "1.0.0", v1), true);
    assert.equal(activate(dirs, "1.0.0"), true);
    assert.equal(ensureLauncher(dirs).status, "installed");
    assert.ok((statSync(launcherPath(dirs)).mode & 0o111) !== 0, "executable");
    assert.equal(
      execFileSync(launcherPath(dirs), ["--version"], { encoding: "utf8", env: LAUNCHER_ENV }),
      "v1 --version\n",
    );
    assert.equal(ensureLauncher(dirs).status, "current");
    assert.equal(installVersion(dirs, "1.0.0", v1), false, "the same bytes are not written again");
    rmSync(v1);
    assert.equal(
      execFileSync(launcherPath(dirs), ["a", "b"], { encoding: "utf8", env: LAUNCHER_ENV }),
      "v1 a b\n",
      "the copy under versions/ is what runs",
    );

    const v2 = join(home, "v2.mjs");
    writeFileSync(v2, "console.log('v2');\n");
    installVersion(dirs, "1.1.0", v2);
    assert.equal(activate(dirs, "1.1.0"), true);
    assert.equal(activate(dirs, "1.1.0"), false, "already current");
    assert.equal(execFileSync(launcherPath(dirs), [], { encoding: "utf8", env: LAUNCHER_ENV }), "v2\n");
    assert.equal(currentVersion(dirs), "1.1.0");
    assert.deepEqual(installedVersions(dirs), ["1.1.0", "1.0.0"], "newest first");
  }));

test("the launcher runs the build KIOKU_BIN names when it is set, and the active version when it is not or is empty (§6.3)", () =>
  scratch((home) => {
    const dirs = installDirs(home, {});
    const v1 = join(home, "v1.mjs");
    writeFileSync(v1, "console.log('active', process.argv.slice(2).join(' '));\n");
    installVersion(dirs, "1.0.0", v1);
    activate(dirs, "1.0.0");
    ensureLauncher(dirs);
    const dev = join(home, "dev");
    writeFileSync(dev, '#!/bin/sh\necho dev "$@"\n');
    chmodSync(dev, 0o755);
    const run = (env: Record<string, string>): string =>
      execFileSync(launcherPath(dirs), ["a", "b"], {
        encoding: "utf8",
        env: { ...process.env, KIOKU_BIN: "", ...env },
      });
    assert.equal(run({ KIOKU_BIN: dev }), "dev a b\n");
    assert.equal(run({}), "active a b\n", "empty is not set");
    const without = { ...process.env };
    delete without.KIOKU_BIN;
    assert.equal(execFileSync(launcherPath(dirs), ["a", "b"], { encoding: "utf8", env: without }), "active a b\n");
  }));

test("a launcher that does not run, or is another text, is rewritten", () =>
  scratch((home) => {
    const dirs = installDirs(home, {});
    ensureLauncher(dirs);
    chmodSync(launcherPath(dirs), 0o644);
    assert.equal(ensureLauncher(dirs).status, "updated");
    assert.ok((statSync(launcherPath(dirs)).mode & 0o111) !== 0);
    writeFileSync(launcherPath(dirs), "#!/bin/sh\necho old\n");
    assert.equal(ensureLauncher(dirs).status, "updated");
    assert.equal(ensureLauncher(dirs).status, "current");
  }));

test("setup puts the launcher on the PATH when it is not reachable, by the shell's profile when no folder takes a link, and says so; not when it is", () =>
  scratch(async (home) => {
    const dirs = installDirs(home, {});
    ensureLauncher(dirs);
    const first = await kioku(["setup"], ctx({ home, env: { PATH: "/usr/bin", SHELL: "/bin/zsh" } }), true);
    assert.match(first.raw, /Added the line to .*\/\.zshrc; open a new terminal/);
    assert.match(
      readFileSync(join(home, ".zshrc"), "utf8"),
      new RegExp(
        `# kioku\n${pathLine(dirs).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n# kioku completion\n[^\n]+ completion zsh\\)"\n$`,
      ),
      "the PATH line, then the completion line",
    );
    const reachable = await kioku(["setup"], ctx({ home, env: { PATH: `${dirs.bin}:/usr/bin` } }), true);
    assert.doesNotMatch(reachable.raw, /PATH|zshrc/);
    assert.equal(onPath(dirs, "/usr/bin"), false);
    assert.equal(onPath(dirs, `/x:${dirs.bin}`), true);
    const none = await kioku(["setup"], ctx({ home: join(home, "other"), env: { PATH: "/usr/bin" } }), true);
    assert.match(none.raw, /launcher .* is not installed: run the installer/);
  }));

test("the launcher runs the real bundle's --version from outside a session", () =>
  scratch((home) => {
    const dirs = installDirs(home, {});
    const real = join(import.meta.dirname, "../../lib/kioku.mjs");
    installVersion(dirs, "real", real);
    activate(dirs, "real");
    ensureLauncher(dirs);
    const out = execFileSync(launcherPath(dirs), ["--version"], {
      encoding: "utf8",
      env: { ...LAUNCHER_ENV, KIOKU_IGNORED: "1" },
    });
    assert.deepEqual(JSON.parse(out), JSON.parse(execFileSync("node", [real, "--version"], { encoding: "utf8" })));
  }));

test("a session never nags about allow rules: the plugin's skill and hook do what they were for", () =>
  scratch(async (home) => {
    const project = join(home, "work/app");
    mkdirSync(project, { recursive: true });
    ensureLauncher(installDirs(home, {}));
    await kioku(["setup"], ctx({ home }));
    const said =
      (
        await kioku(
          ["hook", "session-start"],
          ctx({ home, stdin: async () => JSON.stringify({ cwd: project, source: "startup" }) }),
        )
      ).out.systemMessage ?? "";
    assert.doesNotMatch(said, /allow|without asking|agent add/);
  }));
