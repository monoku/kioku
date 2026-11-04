import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMachineConfig } from "../../src/core/config/machine.ts";
import { isolateGit } from "../remotes.ts";
import { sh, world, type World } from "../world.ts";

isolateGit();

const NOT_KNOWN = { registered: false, cloned: { acme: false, team: false } } as const;
const start = (w: World) =>
  w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }) });
const summaryOf = (r: { out: any }): string => r.out.hookSpecificOutput?.additionalContext ?? "";
const terminal = { context: { interactive: true } };

test("a repository that names a brain this machine does not know loads nothing from it, says so, and sync does not clone it (§2.4)", () =>
  world(async (w) => {
    const r = await start(w);
    assert.equal(r.code, 0);
    assert.match(
      r.out.systemMessage,
      /did not load github\.com\/northwind\/brain-acme\n.*\n  ⎿ this machine does not trust it\n  ⎿ if you trust it, run kioku brain trust github\.com\/northwind\/brain-acme in a terminal, then start a new session/,
    );
    const summary = summaryOf(r);
    assert.match(
      summary,
      /does not trust it, so nothing from it is loaded\. Tell the person; `kioku brain trust github\.com\/northwind\/brain-acme` is theirs to run in a terminal, never yours\./,
    );
    assert.doesNotMatch(summary, /No prod migrations from a session/);

    const sync = await w.kioku(["sync"]);
    assert.equal(sync.code, 0, sync.raw);
    assert.ok(!existsSync(w.acme), "nothing was cloned");
    assert.equal(
      readMachineConfig(w.home)!.repositories["github.com/northwind/brain-acme"],
      undefined,
      "and nothing was registered",
    );
  }, NOT_KNOWN));

test("a brain on disk but unknown to the machine is not loaded either: its Rules do not reach the agent", () =>
  world(
    async (w) => {
      const r = await start(w);
      assert.doesNotMatch(summaryOf(r), /No prod migrations from a session|Write commit messages in English/);
      const list = await w.kioku(["brain", "list"]);
      assert.deepEqual(list.out.untrusted, [
        { tier: "project", key: "github.com/northwind/brain-acme" },
        { tier: "team", key: "github.com/northwind/brain" },
      ]);
      assert.deepEqual(
        list.out.chain.map((l: { tier: string }) => l.tier),
        ["personal"],
      );
      const text = await w.kioku(["brain", "list"], { tty: true });
      assert.match(
        text.raw,
        /Not trusted, so not loaded: the project brain github\.com\/northwind\/brain-acme\. To trust it: kioku brain trust github\.com\/northwind\/brain-acme/,
      );
    },
    { registered: false },
  ));

test("doctor warns about the brain and says the command to run", () =>
  world(
    async (w) => {
      const r = await w.kioku(["doctor"]);
      const check = r.out.checks.find((c: { name: string }) => c.name === "trusted brains");
      assert.equal(check.state, "warn");
      assert.match(check.detail, /github\.com\/northwind\/brain-acme.*does not trust/);
      assert.match(check.fix, /kioku brain trust github\.com\/northwind\/brain-acme/);
    },
    { registered: false },
  ));

test("kioku brain trust is refused outside a terminal, and changes nothing", () =>
  world(
    async (w) => {
      const r = await w.kioku(["brain", "trust", "github.com/northwind/brain-acme"]);
      assert.equal(r.code, 1);
      assert.equal(r.out.error.code, "needs_terminal");
      assert.match(r.out.error.message, /for you to run in a terminal/);
      assert.deepEqual(readMachineConfig(w.home)!.repositories, {});
      assert.deepEqual(readMachineConfig(w.home)!.trust.owners, []);
    },
    { registered: false, cloned: { acme: false, team: false } },
  ));

test("kioku brain trust <brain> registers it and clones it; the next session loads it, and the folder's team is trusted on its own (§2.4)", () =>
  world(async (w) => {
    const r = await w.kioku(["brain", "trust", "github.com/northwind/brain-acme"], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.trusted, r.out.kind, r.out.added], ["github.com/northwind/brain-acme", "brain", true]);
    assert.deepEqual(
      r.out.cloned.map((c: { key: string; status: string }) => [c.key, c.status]),
      [["github.com/northwind/brain-acme", "cloned"]],
    );
    assert.ok(existsSync(join(w.acme, "kioku.yaml")));
    assert.ok(readMachineConfig(w.home)!.repositories["github.com/northwind/brain-acme"] !== undefined);

    const again = await w.kioku(["brain", "trust", "northwind/brain-acme"], terminal);
    assert.equal(again.out.added, false, "short form, already trusted");

    const session = await start(w);
    assert.match(summaryOf(session), /No prod migrations from a session/);
    assert.match(
      summaryOf(session),
      /names github\.com\/northwind\/brain as its team brain, but this machine does not trust it/,
    );
    assert.doesNotMatch(summaryOf(session), /Write commit messages in English/, "the team is not loaded yet");

    const team = await w.kioku(["brain", "trust", "northwind/brain"], terminal);
    assert.deepEqual(
      team.out.cloned.map((c: { key: string; status: string }) => [c.key, c.status]),
      [["github.com/northwind/brain", "cloned"]],
    );
    const next = await start(w);
    assert.match(summaryOf(next), /Write commit messages in English/);
    assert.doesNotMatch(summaryOf(next), /does not trust/);
  }, NOT_KNOWN));

test("kioku brain trust --owner <owner> accepts every brain that owner publishes", () =>
  world(async (w) => {
    const r = await w.kioku(["brain", "trust", "--owner", "northwind"], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.trusted, r.out.kind], ["github.com/northwind", "owner"]);
    assert.deepEqual(readMachineConfig(w.home)!.trust.owners, ["github.com/northwind"]);
    assert.deepEqual(
      r.out.cloned.map((c: { status: string }) => c.status),
      ["cloned", "cloned"],
    );
    const text = await w.kioku(["brain", "trust", "--owner", "github.com/northwind"], {
      tty: true,
      context: { interactive: true },
    });
    assert.match(text.raw, /already trusted every brain of github\.com\/northwind/);
  }, NOT_KNOWN));

test("an owner is named by --owner and a brain is not: the wrong one is refused and the message says the command meant", () =>
  world(async (w) => {
    const before = readMachineConfig(w.home)!;
    const owner = await w.kioku(["brain", "trust", "northwind"], terminal);
    assert.equal(owner.out.error.code, "usage");
    assert.match(owner.out.error.message, /names an owner.*kioku brain trust --owner northwind/);
    const hostOwner = await w.kioku(["brain", "trust", "github.com/northwind"], terminal);
    assert.match(hostOwner.out.error.message, /kioku brain trust --owner github\.com\/northwind/);
    const brain = await w.kioku(["brain", "trust", "--owner", "github.com/northwind/brain-acme"], terminal);
    assert.equal(brain.out.error.code, "usage");
    assert.match(brain.out.error.message, /not an owner/);
    assert.deepEqual(readMachineConfig(w.home), before, "nothing was written");
  }, NOT_KNOWN));

test("kioku brain trust takes one brain or owner, nothing else", () =>
  world(async (w) => {
    for (const argv of [
      ["brain", "trust"],
      ["brain", "trust", "a", "b"],
      ["brain", "trust", "--all"],
      ["brain", "trust", "not a brain"],
    ]) {
      const r = await w.kioku(argv, terminal);
      assert.equal(r.code, 1, argv.join(" "));
      assert.equal(r.out.error.code, "usage", argv.join(" "));
    }
  }));

test("kioku init <brain> --team <brain> is the person's act: it registers the brains it names and clones them (§2.4)", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    const r = await w.kioku(
      ["init", "github.com/northwind/brain-acme", "--team", "github.com/northwind/brain"],
      terminal,
    );
    assert.equal(r.code, 0, r.raw);
    for (const key of ["github.com/northwind/brain-acme", "github.com/northwind/brain"])
      assert.ok(readMachineConfig(w.home)!.repositories[key] !== undefined, key);
    assert.deepEqual(
      r.out.chain.map((l: { tier: string }) => l.tier),
      ["personal", "project", "team"],
    );
    assert.ok(readFileSync(join(w.acme, "kioku.yaml"), "utf8").includes("tier: project"));
  }, NOT_KNOWN));

test("kioku init with no brain takes the ones the repository's kioku.yaml names: a teammate's first step after cloning the code (§2.4)", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    const file = readFileSync(join(w.repo, "kioku.yaml"), "utf8");
    const agent = await w.kioku(["init"]);
    assert.equal(agent.out.error.code, "needs_terminal", "a brain new to this machine is the person's to trust");
    const r = await w.kioku(["init"], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.wrote, false);
    assert.equal(readFileSync(join(w.repo, "kioku.yaml"), "utf8"), file, "the file is left as it is");
    assert.ok(readMachineConfig(w.home)!.repositories["github.com/northwind/brain-acme"] !== undefined);
    assert.deepEqual(
      r.out.chain.map((l: { tier: string }) => l.tier),
      ["personal", "project", "team"],
    );
    assert.ok(existsSync(join(w.acme, "kioku.yaml")), "cloned");
  }, NOT_KNOWN));

test("kioku init with no brain and no kioku.yaml says how to name one, and how to make one", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    rmSync(join(w.repo, "kioku.yaml"));
    const r = await w.kioku(["init"], terminal);
    assert.deepEqual([r.code, r.out.error.code], [1, "usage"]);
    assert.match(
      r.out.error.message,
      /has no kioku\.yaml yet: name its project brain, kioku init <owner>\/<repo>.*kioku init <owner>\/<repo> --create/,
    );
    assert.ok(!existsSync(join(w.repo, "kioku.yaml")));
  }));

test("kioku init refuses outside a terminal for a brain the machine does not know, and writes nothing", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    rmSync(join(w.repo, "kioku.yaml"));
    for (const argv of [
      ["init", "github.com/evil/brain"],
      ["init", "--team", "github.com/evil/brain"],
    ]) {
      const r = await w.kioku(argv);
      assert.equal(r.code, 1, argv.join(" "));
      assert.equal(r.out.error.code, "needs_terminal");
      assert.match(r.out.error.message, /terminal.*github\.com\/evil\/brain/);
    }
    assert.ok(!existsSync(join(w.repo, "kioku.yaml")), "no kioku.yaml");
    assert.equal(readMachineConfig(w.home)!.repositories["github.com/evil/brain"], undefined, "not registered");
    // One unknown brain among known ones is enough to refuse.
    const mixed = await w.kioku(["init", "github.com/northwind/brain-acme", "--team", "github.com/evil/brain"]);
    assert.equal(mixed.out.error.code, "needs_terminal");
    assert.ok(!existsSync(join(w.repo, "kioku.yaml")));
  }, NOT_KNOWN));

test("kioku init works outside a terminal for a registered brain", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    rmSync(join(w.repo, "kioku.yaml"));
    const registered = await w.kioku(["init", "github.com/northwind/brain-acme"]);
    assert.equal(registered.code, 0, registered.raw);
    assert.ok(existsSync(join(w.repo, "kioku.yaml")));
  }));

test("kioku init works outside a terminal once the owner is trusted", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    rmSync(join(w.repo, "kioku.yaml"));
    assert.equal((await w.kioku(["brain", "trust", "--owner", "github.com/northwind"], terminal)).code, 0);
    const r = await w.kioku(["init", "github.com/northwind/brain-acme"]);
    assert.equal(r.code, 0, r.raw);
  }, NOT_KNOWN));

/** A machine that trusts the owner `northwind` and knows none of its repositories, and a code repository naming its project brain at `url`. */
function ownerTrustedFolderAddress(w: World, url: string): void {
  writeFileSync(
    join(w.home, ".kioku/config.yaml"),
    "brain: github.com/sam/brain\nrepositories: {}\ntrust:\n  owners:\n    - github.com/northwind\n",
  );
  writeFileSync(
    join(w.repo, "kioku.yaml"),
    `brain:\n  repo: github.com/northwind/brain-acme\n  url: ${url}\nteam: github.com/northwind/brain\n`,
  );
}

test("a trusted owner's brain at an address the folder gives and the machine does not know is not cloned, not recorded and not loaded (§2.4)", () =>
  world(
    async (w) => {
      // Another server, with a brain that passes for the project brain.
      const elsewhere = join(w.dir, "elsewhere", "brain-acme.git");
      execFileSync("git", ["clone", "-q", "--bare", "--no-local", w.bare.acme, elsewhere]);
      const address = `file://${elsewhere}`;
      ownerTrustedFolderAddress(w, address);

      const sync = await w.kioku(["sync"]);
      assert.equal(sync.code, 0, sync.raw);
      assert.ok(!existsSync(w.acme), "nothing was cloned from the folder's address");
      assert.equal(
        readMachineConfig(w.home)!.repositories["github.com/northwind/brain-acme"],
        undefined,
        "and the address was not recorded",
      );

      const r = await start(w);
      assert.match(r.out.systemMessage, /did not load github\.com\/northwind\/brain-acme/);
      assert.ok(
        r.out.systemMessage.includes(`kioku brain clone github.com/northwind/brain-acme --url ${address}`),
        "the command records the address, in a terminal",
      );
      assert.doesNotMatch(summaryOf(r), /No prod migrations from a session/);
      const list = await w.kioku(["brain", "list"]);
      assert.deepEqual(list.out.untrusted, [{ tier: "project", key: "github.com/northwind/brain-acme", address }]);

      // The person's act: the address is recorded, and the folder's link is trusted at it.
      const clone = await w.kioku(["brain", "clone", "github.com/northwind/brain-acme", "--url", address], terminal);
      assert.equal(clone.code, 0, clone.raw);
      assert.equal(readMachineConfig(w.home)!.repositories["github.com/northwind/brain-acme"]!.url, address);
      assert.deepEqual((await w.kioku(["brain", "list"])).out.untrusted, []);
    },
    { registered: false, cloned: { acme: false, team: false } },
  ));

test("a folder's ssh address of the same repository, or the address its key says, is one the machine knows (§2.4)", () =>
  world(
    async (w) => {
      for (const url of ["git@github.com:northwind/brain-acme.git", "https://github.com/northwind/brain-acme.git"]) {
        ownerTrustedFolderAddress(w, url);
        const list = await w.kioku(["brain", "list"]);
        assert.deepEqual(list.out.untrusted, [], url);
      }
      ownerTrustedFolderAddress(w, "git@elsewhere.example:northwind/brain-acme.git");
      const list = await w.kioku(["brain", "list"]);
      assert.equal(list.out.untrusted[0].address, "git@elsewhere.example:northwind/brain-acme.git");
    },
    { registered: false, cloned: { acme: false, team: false } },
  ));
