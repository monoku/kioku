import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMachineConfig } from "../../src/core/config/machine.ts";
import { isolateGit } from "../remotes.ts";
import { sh, world, type World } from "../world.ts";

isolateGit();

const ACME = "https://github.com/northwind/brain-acme.git";
const TEAM = "https://github.com/northwind/brain.git";
const NOT_KNOWN = { registered: false, cloned: { acme: false, team: false } } as const;
const start = (w: World) =>
  w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }) });
const summaryOf = (r: { out: any }): string => r.out.hookSpecificOutput?.additionalContext ?? "";
const terminal = { context: { interactive: true } };
/** The project folder's `kioku.yaml`, as the person would write it. */
const link = (w: World, text: string) => writeFileSync(join(w.repo, "kioku.yaml"), text);

test("a repository that names an address this machine does not know loads nothing from it, says so, and sync does not clone it (§2.4)", () =>
  world(async (w) => {
    const r = await start(w);
    assert.equal(r.code, 0);
    assert.match(
      r.out.systemMessage,
      /did not load northwind\/brain-acme\n.*\n  ⎿ at https:\/\/github\.com\/northwind\/brain-acme\.git, an address this machine does not know for it\n  ⎿ if you trust it, run kioku init, or kioku config set trust\.owners \+github\.com\/northwind for its owner, in a terminal, then start a new session/,
    );
    const summary = summaryOf(r);
    assert.match(
      summary,
      /does not trust it, so nothing from it is loaded\. Tell the person; `kioku init` in this folder is theirs to run in a terminal, never yours\./,
    );
    assert.doesNotMatch(summary, /No prod migrations from a session/);

    const sync = await w.kioku(["sync"]);
    assert.equal(sync.code, 0, sync.raw);
    assert.ok(!existsSync(w.acme), "nothing was cloned");
    assert.equal(readMachineConfig(w.home)!.repositories["northwind/brain-acme"], undefined, "nor recorded");
  }, NOT_KNOWN));

test("a brain on this machine at another address than the folder gives is not loaded: trust follows the address, never the name", () =>
  world(
    async (w) => {
      sh(w.acme, "remote", "set-url", "origin", "https://github.com/evil/brain-acme.git");
      const r = await start(w);
      assert.doesNotMatch(summaryOf(r), /No prod migrations from a session/);
      const list = await w.kioku(["brain", "list"]);
      assert.deepEqual(list.out.untrusted, [{ tier: "project", key: "northwind/brain-acme", address: ACME }]);
      const text = await w.kioku(["brain", "list"], { tty: true });
      assert.match(
        text.raw,
        /Not trusted, so not loaded: the project brain northwind\/brain-acme at https:\/\/github\.com\/northwind\/brain-acme\.git\. To trust it: kioku init, or kioku config set trust\.owners \+github\.com\/northwind for every brain of that owner/,
      );
    },
    { registered: false },
  ));

test("a brain this machine cloned from the address the folder gives is the person's, and loads", () =>
  world(
    async (w) => {
      const list = await w.kioku(["brain", "list"]);
      assert.deepEqual(list.out.untrusted, []);
      assert.match(summaryOf(await start(w)), /No prod migrations from a session/);
    },
    { registered: false },
  ));

test("doctor warns about the brain and says the commands to run", () =>
  world(async (w) => {
    const r = await w.kioku(["doctor"]);
    const check = r.out.checks.find((c: { name: string }) => c.name === "trusted brains");
    assert.equal(check.state, "warn");
    assert.match(
      check.detail,
      /northwind\/brain-acme as its project brain at https:\/\/github\.com\/northwind\/brain-acme\.git/,
    );
    assert.match(check.fix, /kioku init.*kioku config set trust\.owners \+github\.com\/northwind/);
  }, NOT_KNOWN));

test("kioku init alone accepts the addresses the file gives, in a terminal, and clones them (§2.4)", () =>
  world(async (w) => {
    sh(w.repo, "init", "-q");
    const file = readFileSync(join(w.repo, "kioku.yaml"), "utf8");
    const agent = await w.kioku(["init"]);
    assert.equal(agent.out.error.code, "needs_terminal", "an address new to this machine is the person's to accept");
    assert.deepEqual(readMachineConfig(w.home)!.repositories, {}, "and nothing was recorded");
    const r = await w.kioku(["init"], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.wrote, false);
    assert.equal(readFileSync(join(w.repo, "kioku.yaml"), "utf8"), file, "the file is left as it is");
    assert.deepEqual(readMachineConfig(w.home)!.repositories, {
      "northwind/brain-acme": ACME,
      "northwind/brain": TEAM,
    });
    assert.deepEqual(
      r.out.chain.map((l: { tier: string }) => l.tier),
      ["personal", "project", "team"],
    );
    assert.ok(existsSync(join(w.acme, "kioku.yaml")), "cloned");
    assert.match(summaryOf(await start(w)), /Write commit messages in English/);
  }, NOT_KNOWN));

test("trusting an owner with kioku config lets the folder's brains load and clone without kioku init (§2.4, §2.5)", () =>
  world(async (w) => {
    const agent = await w.kioku(["config", "set", "trust.owners", "+github.com/northwind"]);
    assert.equal(agent.out.error.code, "needs_terminal");
    const r = await w.kioku(["config", "set", "trust.owners", "+github.com/northwind"], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(readMachineConfig(w.home)!.trust.owners, ["github.com/northwind"]);
    assert.deepEqual((await w.kioku(["brain", "list"])).out.untrusted, []);
    const sync = await w.kioku(["sync"]);
    assert.deepEqual(
      sync.out.outcomes.filter((o: { status: string }) => o.status === "cloned").map((o: { key: string }) => o.key),
      ["northwind/brain-acme", "northwind/brain"],
    );
    const init = await w.kioku(["init", "github.com/northwind/brain-acme"]);
    assert.equal(init.code, 0, `${init.raw}: an owner trusted needs no terminal`);
  }, NOT_KNOWN));

test("a trusted owner's brain at an address the machine knows for another is not trusted: the recorded address wins (§2.4)", () =>
  world(async (w) => {
    const elsewhere = join(w.dir, "elsewhere", "brain-acme.git");
    execFileSync("git", ["clone", "-q", "--bare", "--no-local", w.bare.acme, elsewhere]);
    writeFileSync(
      join(w.home, ".kioku/config.yaml"),
      `brain: sam/brain\nrepositories:\n  northwind/brain-acme: ${ACME}\ntrust:\n  owners:\n    - github.com/northwind\n`,
    );
    link(w, `brain: { name: northwind/brain-acme, url: "file://${elsewhere}" }\n`);
    const list = await w.kioku(["brain", "list"]);
    assert.deepEqual(list.out.untrusted, [
      { tier: "project", key: "northwind/brain-acme", address: `file://${elsewhere}` },
    ]);
    const sync = await w.kioku(["sync"]);
    assert.equal(sync.code, 0, sync.raw);
    assert.ok(!existsSync(w.acme), "nothing was cloned from the folder's address");
    assert.equal(readMachineConfig(w.home)!.repositories["northwind/brain-acme"], ACME, "nor recorded");
  }, NOT_KNOWN));

test("the https and ssh forms of one repository are one address (§2.4)", () =>
  world(
    async (w) => {
      for (const url of ["git@github.com:northwind/brain-acme.git", ACME]) {
        link(w, `brain: { name: northwind/brain-acme, url: "${url}" }\n`);
        assert.deepEqual((await w.kioku(["brain", "list"])).out.untrusted, [], url);
      }
      link(w, `brain: { name: northwind/brain-acme, url: "git@elsewhere.example:northwind/brain-acme.git" }\n`);
      const list = await w.kioku(["brain", "list"]);
      assert.equal(list.out.untrusted[0].address, "git@elsewhere.example:northwind/brain-acme.git");
    },
    { cloned: { team: false } },
  ));

test("a name with no address is a brain of this machine: it loads when it is here, and says how to share it (§2.4)", () =>
  world(async (w) => {
    link(w, "brain: northwind/brain-acme\n");
    const r = await start(w);
    assert.match(summaryOf(r), /No prod migrations from a session/, "the brain here loads");
    assert.match(
      r.out.systemMessage,
      /northwind\/brain-acme is linked without its address\n.*\n  ⎿ a teammate cannot clone it from this file\n  ⎿ run kioku init here, which writes its address/,
    );
    const init = await w.kioku(["init"], terminal);
    assert.equal(init.code, 0, init.raw);
    assert.deepEqual(init.out.addressed, ["northwind/brain-acme"]);
    assert.equal(
      readFileSync(join(w.repo, "kioku.yaml"), "utf8"),
      `brain: { name: northwind/brain-acme, url: ${ACME} }\n`,
      "the link a teammate can clone",
    );
    assert.doesNotMatch((await start(w)).out.systemMessage ?? "", /linked without its address/);
  }));

test("a name with no address that this machine does not have is never cloned, and the session says how to get it (§2.4)", () =>
  world(async (w) => {
    link(w, "brain: northwind/brain-other\n");
    const r = await start(w);
    assert.match(
      r.out.systemMessage,
      /did not load northwind\/brain-other\n.*named without an address\n  ⎿ this machine does not have it\n  ⎿ a teammate who has it gives its address; then kioku init <address>/,
    );
    assert.match(
      summaryOf(r),
      /names northwind\/brain-other as its project brain by name alone, and this machine does not have it/,
    );
    const sync = await w.kioku(["sync"]);
    assert.equal(sync.code, 0, sync.raw);
    assert.ok(!existsSync(join(w.home, ".kioku/brains/northwind/brain-other")), "nothing to clone it from");
    const init = await w.kioku(["init"], terminal);
    assert.deepEqual(init.out.notHere, ["northwind/brain-other"]);
  }));

test("a brain of another tier than its link takes is not loaded, and init refuses to write it (§2.1)", () =>
  world(async (w) => {
    link(w, `brain: { name: northwind/brain, url: ${TEAM} }\n`);
    const chain = (await w.kioku(["brain", "list"])).out.chain;
    assert.deepEqual(
      chain.map((l: { tier: string; key: string }) => [l.tier, l.key]),
      [["personal", "sam/brain"]],
      "the team brain is not the project's",
    );
    assert.match(
      summaryOf(await start(w)),
      /northwind\/brain is a team brain, and a project link takes only a project brain/,
    );
    rmSync(join(w.repo, "kioku.yaml"));
    const init = await w.kioku(["init", "northwind/brain"], terminal);
    assert.equal(init.out.error.code, "brain_other_tier");
    link(w, "brain: sam/brain\n");
    assert.match(
      summaryOf(await start(w)),
      /sam\/brain is a personal brain, and a project link takes only a project brain/,
      "the personal brain loads everywhere, never as a project",
    );
  }));
