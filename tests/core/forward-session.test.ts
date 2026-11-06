import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../../src/core/doctor.ts";
import { readForwardState, recordForward, recordForwardFailed } from "../../src/core/setup/forward.ts";
import { setupPendingPath } from "../../src/core/state.ts";
import { run } from "../../src/cli/run.ts";
import { VERSION } from "../../src/version.ts";
import { ctx } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { commitAll, world, type World } from "../world.ts";

isolateGit();

const start = async (w: World, version: string): Promise<string> => {
  const r = await w.kioku(["hook", "session-start"], {
    stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }),
    context: { version, env: { NO_COLOR: "1" } },
  });
  assert.equal(r.code, 0, r.raw);
  return (r.out.systemMessage ?? "") as string;
};

const doctorOf = (home: string, name: string) =>
  runDoctor({
    home,
    node: "26.5.0",
    pathVar: "/usr/bin",
    env: {},
    gitVersion: () => "2.50.0",
    remoteAnswers: () => true,
  }).checks.find((c) => c.name === name);

test("the first session of a version has its sync bring the machine forward, and the next session says it once (§6.4)", () =>
  world(async (w) => {
    // A file the tool owns, missing from the person's brain: what a refresh writes back.
    unlinkSync(join(w.sam, "AGENTS.md"));
    commitAll(w.sam);
    assert.equal(readForwardState(w.home).version, undefined, "a machine an earlier version left records nothing");

    assert.doesNotMatch(await start(w, "0.9.0"), /brought this machine forward/, "the hook leaves the brains to sync");
    assert.ok(!existsSync(join(w.sam, "AGENTS.md")), "the hook commits nothing");

    const synced = await w.kioku(["sync", "--cwd", w.repo, "--background"], { context: { version: "0.9.0" } });
    assert.equal(synced.code, 0, synced.raw);
    assert.equal(readForwardState(w.home).version, "0.9.0", "done whole, the version is recorded");
    assert.ok(existsSync(join(w.sam, "AGENTS.md")), "the person's brain was refreshed");

    const said = await start(w, "0.9.0");
    assert.match(said, /brought this machine forward to 0\.9\.0/);
    assert.match(said, /Refreshed the files Kioku owns in sam\/brain: AGENTS\.md/);
    assert.doesNotMatch(await start(w, "0.9.0"), /brought this machine forward/, "once");

    // The same version again does nothing; a sync by hand never brings forward.
    unlinkSync(join(w.sam, "AGENTS.md"));
    commitAll(w.sam);
    await w.kioku(["sync", "--cwd", w.repo, "--background"], { context: { version: "0.9.0" } });
    assert.ok(!existsSync(join(w.sam, "AGENTS.md")), "already brought forward to this version");
    await w.kioku(["sync", "--cwd", w.repo], { context: { version: "0.9.1" } });
    assert.equal(readForwardState(w.home).version, "0.9.0", "only a session's sync does it");
  }));

test("a session that brought forward with nothing to change says nothing, and the notice can be muted (§1.2, §6.4)", () =>
  world(async (w) => {
    await w.kioku(["sync", "--cwd", w.repo, "--background"], { context: { version: "0.9.0" } });
    await start(w, "0.9.0");
    unlinkSync(join(w.sam, "AGENTS.md"));
    commitAll(w.sam);
    await w.kioku(["sync", "--cwd", w.repo, "--background"], { context: { version: "0.9.1" } });
    await w.kioku(["config", "set", "display.mute", "+brought-forward"], { context: { interactive: true } });
    assert.doesNotMatch(await start(w, "0.9.1"), /brought this machine forward/, "muted");
    assert.equal(readForwardState(w.home).said, undefined, "and taken all the same");
  }));

test("a step that failed is said with its reason, never muted, and the next sync tries again (§6.4)", () =>
  world(async (w) => {
    recordForwardFailed(w.home, "0.9.0", "the brain sam/brain is locked");
    await w.kioku(["config", "set", "display.mute", "+brought-forward"], { context: { interactive: true } });
    const said = await start(w, "0.9.0");
    assert.match(said, /could not bring this machine forward to 0\.9\.0/);
    assert.match(said, /the brain sam\/brain is locked/);
    assert.equal(readForwardState(w.home).version, undefined, "not recorded: still due");
    await w.kioku(["sync", "--cwd", w.repo, "--background"], { context: { version: "0.9.0" } });
    assert.equal(readForwardState(w.home).version, "0.9.0");
  }));

test("doctor says whether the machine was brought forward to the version it runs (§6.4)", () =>
  world(async (w) => {
    assert.equal(doctorOf(w.home, "brought forward")?.state, "warn");
    assert.match(doctorOf(w.home, "brought forward")!.fix!, /the next session does it; or run `kioku setup`/);
    recordForward(w.home, VERSION);
    assert.equal(doctorOf(w.home, "brought forward")?.state, "ok");
  }));

test("update --finish and setup bring forward at once and record the version, for no session to do it again (§6.3, §6.4)", () =>
  world(async (w) => {
    const finish = await w.kioku(["update", "--finish"], { context: { version: "0.9.0" } });
    assert.equal(finish.code, 0, finish.raw);
    assert.equal(readForwardState(w.home).version, "0.9.0");
    assert.equal(readForwardState(w.home).said, undefined, "update says it itself");
  }));

test("a verb that writes the configuration before setup leaves the machine not set up, and the session works and says so (§6.3)", async () => {
  const home = mkdtempSync(join(tmpdir(), "kioku-unset-"));
  try {
    let raw = "";
    const kioku = async (argv: string[], interactive = true) => {
      raw = "";
      const code = await run(argv, { stdout: (t) => (raw += t), isTty: false }, ctx({ home, interactive }));
      return { code, out: raw.trim() === "" ? raw : JSON.parse(raw) };
    };
    assert.equal((await kioku(["brain", "create", "sam/memory"])).code, 0, raw);
    assert.ok(existsSync(setupPendingPath(home)), "brain create wrote the configuration, setup did not run");
    assert.equal(doctorOf(home, "configuration")?.state, "warn");

    const session = await kioku(["hook", "session-start"]);
    assert.match(session.out.systemMessage, /kioku setup has not run on this machine/);
    assert.match(session.out.hookSpecificOutput.additionalContext, /personal/, "the summary comes all the same");

    assert.equal((await kioku(["setup", "--no-model"])).code, 0, raw);
    assert.ok(!existsSync(setupPendingPath(home)), "setup took the record away");
    assert.equal(doctorOf(home, "configuration")?.state, "ok");
    assert.equal(readForwardState(home).version !== undefined, true, "setup brought forward, and recorded it");
    assert.doesNotMatch((await kioku(["hook", "session-start"])).out.systemMessage ?? "", /setup has not run/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a configuration an earlier version wrote, with no record, counts as set up (§6.3)", () =>
  world(async (w) => {
    assert.doesNotMatch(await start(w, "0.9.0"), /setup has not run/);
    assert.equal(doctorOf(w.home, "configuration")?.state, "ok");
  }));
