import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor, type DoctorEnv } from "../../src/core/doctor.ts";
import { ensureLauncher, installDirs, launcherPath, pathLine } from "../../src/core/setup/install.ts";
import { indexPath, syncLockPath } from "../../src/core/state.ts";
import { recordForward } from "../../src/core/setup/forward.ts";
import { VERSION } from "../../src/version.ts";
import { run } from "../../src/cli/run.ts";
import { ctx } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

/** The process's environment as it is now, with nothing that moves the install folders, so a test's tool is under its own home. */
const clean = (): NodeJS.ProcessEnv => ({
  ...process.env,
  XDG_DATA_HOME: "",
  KIOKU_INSTALL_DIR: "",
  KIOKU_BIN_DIR: "",
  CLAUDE_CONFIG_DIR: "",
  PATH: "/usr/bin",
});
const dirs = (home: string) => installDirs(home, clean());

function env(home: string, o: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    home,
    node: "26.5.0",
    pathVar: `${dirs(home).bin}:/usr/bin`,
    env: clean(),
    gitVersion: () => "2.50.0",
    remoteAnswers: () => true,
    // No Homebrew but the one a test makes: what this machine has installed is not the test's.
    brewPrefixes: [],
    ...o,
  };
}

const byName = (r: ReturnType<typeof runDoctor>) => Object.fromEntries(r.checks.map((c) => [c.name, c]));

test("a machine with nothing configured lists every missing item with its fix, and fails", () => {
  const home = mkdtempSync(join(tmpdir(), "kioku-doctor-"));
  try {
    const r = runDoctor(env(home, { node: "22.4.0", gitVersion: () => undefined, pathVar: "/usr/bin" }));
    assert.equal(r.ok, false);
    const c = byName(r);
    assert.equal(c["personal brain"], undefined, "with no configuration, only the configuration is missing");
    for (const name of ["node", "git", "configuration"]) {
      assert.equal(c[name]!.state, "missing", name);
      assert.ok(c[name]!.fix && c[name]!.fix.length > 0, name);
    }
    assert.match(c.node!.fix!, /Node 24 or later/);
    assert.match(c.configuration!.fix!, /kioku setup/);
    for (const name of ["search index", "embedding model", "kioku launcher"])
      assert.equal(c[name]!.state, "warn", name);
    assert.match(c["embedding model"]!.fix!, /full text only/);
    assert.equal(c.gh, undefined, "doctor does not report gh");
    assert.doesNotMatch(JSON.stringify(r.checks), /\bgh\b/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("while a sync is running, doctor says the search model is being fetched, not that nothing has happened (§4.3)", () => {
  const home = mkdtempSync(join(tmpdir(), "kioku-doctor-"));
  try {
    mkdirSync(join(home, ".kioku"), { recursive: true });
    const lock = (pid: number) =>
      writeFileSync(syncLockPath(home), JSON.stringify({ pid, host: "test", since: new Date().toISOString() }));
    lock(process.pid);
    const running = byName(runDoctor(env(home)))["embedding model"]!;
    assert.equal(running.state, "warn");
    assert.match(running.detail, /not on this machine yet; a sync running now is fetching it \(about \d+ MB, once\)/);
    assert.match(running.fix!, /run kioku doctor again in a few minutes/);
    lock(999_999);
    assert.match(
      byName(runDoctor(env(home)))["embedding model"]!.detail,
      /not on this machine yet; the next sync fetches it/,
      "a dead owner's lock is not a sync",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("on a configured machine with the §2.5 brains every item is fine and the exit code is zero", () =>
  world(async (w) => {
    await w.kioku(["sync", "--cwd", w.repo]);
    ensureLauncher(dirs(w.home));
    // Brought forward to this version, as a session's sync, setup or update leaves it (§6.4).
    recordForward(w.home, VERSION);
    // Claude Code's own record of what it has installed: the Kioku plugin is there.
    mkdirSync(join(w.home, ".claude/plugins"), { recursive: true });
    writeFileSync(
      join(w.home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "kioku@kioku": [{ scope: "user" }] } }),
    );
    const r = runDoctor(env(w.home));
    const notOk = r.checks.filter(
      (c) => c.state !== "ok" && c.name !== "embedding model" && c.name !== "brain sam/brain",
    );
    assert.deepEqual(notOk, [], JSON.stringify(notOk, null, 1));
    assert.equal(
      byName(r)["brain sam/brain"]!.state,
      "warn",
      "a personal brain with no remote is said so, without failing",
    );
    assert.equal(r.ok, true);
    assert.match(byName(r)["search index"]!.detail, /\d+ pages, 0 of them indexed by meaning$/);

    // Through the verb: zero exit, every check with name, state and fix.
    let raw = "";
    const code = await run(
      ["doctor"],
      { stdout: (t) => (raw += t), isTty: false },
      ctx({ home: w.home, env: { ...clean(), PATH: `${dirs(w.home).bin}:/usr/bin` } }),
    );
    const out = JSON.parse(raw);
    assert.equal(code, 0, raw);
    for (const c of out.checks) {
      assert.ok(typeof c.name === "string" && ["ok", "warn", "missing"].includes(c.state));
      if (c.state !== "ok") assert.ok(typeof c.fix === "string", c.name);
    }
  }));

test("a pending publication and an unreachable remote are reported, and the exit code stays zero", () =>
  world(async (w) => {
    renameSync(w.bare.acme, `${w.bare.acme}.away`);
    await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Staging URL",
        "--source",
        "https://x.io",
      ],
      { stdin: "Behind the VPN.\n" },
    );
    await w.kioku(["sync", "--cwd", w.repo]);
    const r = runDoctor(env(w.home, { remoteAnswers: (clone) => !clone.endsWith("brain-acme") }));
    const c = byName(r);
    assert.equal(c["pending publications"]!.state, "warn");
    assert.match(c["pending publications"]!.detail, /^1: northwind\/brain-acme since /);
    assert.equal(c["brain northwind/brain-acme"]!.state, "warn");
    assert.match(c["brain northwind/brain-acme"]!.detail, /does not answer/);
    assert.equal(r.ok, true);
  }));

test("a brain in a format newer than the tool reads is a warning with the command that fixes it, and the exit code stays zero (§5.1)", () =>
  world(async (w) => {
    const yaml = join(w.acme, "kioku.yaml");
    writeFileSync(yaml, readFileSync(yaml, "utf8").replace(/format: \d+/, "format: 99"));
    const r = runDoctor(env(w.home));
    const c = byName(r)["brain northwind/brain-acme format"]!;
    assert.equal(c.state, "warn");
    assert.match(c.detail, /format 99, newer than the newest this tool reads \(2\): it is read, never written/);
    assert.match(c.fix!, /kioku update/);
    assert.equal(r.ok, true);
  }));

test("with the index removed doctor says it will be rebuilt, and does not rebuild it", () =>
  world(async (w) => {
    await w.kioku(["sync", "--cwd", w.repo]);
    rmSync(indexPath(w.home));
    for (const s of ["-wal", "-shm"]) rmSync(indexPath(w.home) + s, { force: true });
    const r = runDoctor(env(w.home));
    assert.equal(byName(r)["search index"]!.state, "warn");
    assert.match(byName(r)["search index"]!.fix!, /rebuilt at the next sync/);
    assert.equal(r.ok, true);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(indexPath(w.home)), false);
  }));

test("under Homebrew there is no installer's launcher to ask for: kioku is the formula's (§6.3)", () =>
  world(async (w) => {
    const c = byName(runDoctor(env(w.home, { pathVar: "/usr/bin", origin: "homebrew" })))["kioku launcher"]!;
    assert.equal(c.state, "ok");
    assert.equal(c.detail, "Homebrew's");
    // The installer's folder, there from an earlier install, is not this tool's.
    ensureLauncher(dirs(w.home));
    const version = byName(runDoctor(env(w.home, { origin: "homebrew" })))["kioku version"]!;
    assert.equal(version.state, "ok");
    assert.match(version.detail, /Homebrew's$/);
  }));

test("a machine where both the installer and Homebrew installed Kioku is told which one runs, and how to keep one (§6.3)", () =>
  world(async (w) => {
    const d = dirs(w.home);
    ensureLauncher(d);
    const brew = join(w.dir, "homebrew");
    const keg = join(brew, "Cellar/kioku/0.5.0/bin");
    mkdirSync(keg, { recursive: true });
    writeFileSync(join(keg, "kioku"), "#!/bin/sh\n");
    mkdirSync(join(brew, "bin"));
    symlinkSync(join(keg, "kioku"), join(brew, "bin/kioku"));
    const installs = (pathVar: string, prefixes = [brew]) =>
      byName(runDoctor(env(w.home, { pathVar, brewPrefixes: prefixes })))["kioku installs"];

    const first = installs(`${d.bin}:${brew}/bin:/usr/bin`)!;
    assert.equal(first.state, "warn");
    assert.match(
      first.detail,
      /installed twice, by its installer .* and by Homebrew .*; kioku on this PATH runs the installer's/,
    );
    assert.match(first.fix!, /^keep one: brew uninstall kioku; or rm -rf .* then kioku plugin claude-code install$/);
    assert.match(installs(`${brew}/bin:${d.bin}`)!.detail, /runs Homebrew's/);
    assert.equal(installs(`${d.bin}`, []), undefined, "one install: nothing to say");
  }));

test("with the launcher off PATH, the fix is the command that puts it there, and the line for the shell", () =>
  world(async (w) => {
    ensureLauncher(dirs(w.home));
    const c = byName(runDoctor(env(w.home, { pathVar: "/usr/bin" })))["kioku launcher"]!;
    assert.equal(c.state, "warn");
    assert.match(c.fix!, /\/kioku setup, which links it/);
    assert.match(
      c.fix!,
      new RegExp(pathLine(dirs(w.home)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "bash's line when the shell is not known",
    );
    let raw = "";
    await run(
      ["setup"],
      { stdout: (t) => (raw += t), isTty: true },
      ctx({ home: w.home, env: { PATH: "/usr/bin" }, interactive: true }),
    );
    assert.ok(
      raw.includes(pathLine(dirs(w.home))) || /Added the line to/.test(raw),
      `setup puts it on the PATH or says the line: ${raw}`,
    );
    assert.ok(launcherPath(dirs(w.home)));
  }));

test("a git identity is what commits carry, whoever it names; none at all is missing", () =>
  world(async (w) => {
    const c = byName(runDoctor(env(w.home)))["git identity"]!;
    assert.equal(c.state, "ok", c.detail);
    const saved = { name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL };
    try {
      process.env.GIT_AUTHOR_NAME = "Ana";
      process.env.GIT_AUTHOR_EMAIL = "ana@example.com";
      const other = byName(runDoctor(env(w.home)))["git identity"]!;
      assert.deepEqual([other.state, other.detail], ["ok", "Ana <ana@example.com>"]);
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
      const none = runDoctor(env(w.home));
      assert.equal(byName(none)["git identity"]!.state, "missing");
    } finally {
      process.env.GIT_AUTHOR_NAME = saved.name;
      process.env.GIT_AUTHOR_EMAIL = saved.email;
    }
  }));
