import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultContext, kiokuHome, run } from "../../src/cli/run.ts";
import { ctx } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";

isolateGit();

test("KIOKU_HOME is the folder that holds .kioku: absolute as given, relative to the folder, empty means the home (§2.5)", () => {
  assert.equal(kiokuHome({}, "/work"), homedir());
  assert.equal(kiokuHome({ KIOKU_HOME: "" }, "/work"), homedir());
  assert.equal(kiokuHome({ KIOKU_HOME: "   " }, "/work"), homedir());
  assert.equal(kiokuHome({ KIOKU_HOME: "/data/kioku" }, "/work"), "/data/kioku");
  assert.equal(kiokuHome({ KIOKU_HOME: "demo/.home" }, "/work"), "/work/demo/.home");
});

test("the default context keeps Kioku's state where KIOKU_HOME says and the agents' settings in the person's home", () => {
  const before = process.env.KIOKU_HOME;
  process.env.KIOKU_HOME = "/data/kioku";
  try {
    const c = defaultContext();
    assert.equal(c.home, "/data/kioku");
    assert.equal(c.hostHome, homedir());
  } finally {
    if (before === undefined) delete process.env.KIOKU_HOME;
    else process.env.KIOKU_HOME = before;
  }
});

test("setup puts the configuration under the state home, and the host's own folder is the person's home", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-home-"));
  try {
    const state = join(dir, "state");
    const host = join(dir, "person");
    mkdirSync(state);
    mkdirSync(host);
    const { ensureLauncher, installDirs } = await import("../../src/core/setup/install.ts");
    ensureLauncher(installDirs(host, {}));
    let raw = "";
    const context = ctx({
      home: state,
      hostHome: host,
      env: { PATH: "/usr/bin" },
      interactive: true,
      ask: async () => true,
    });
    const code = await run(["setup"], { stdout: (t) => (raw += t), isTty: false }, context);
    assert.equal(code, 0, raw);
    assert.ok(!existsSync(join(state, ".kioku/brains")), "setup makes no brain (§2.3)");
    assert.equal(
      await run(
        ["brain", "create", "sam/brain", "--tier", "personal"],
        { stdout: (t) => (raw += t), isTty: false },
        context,
      ),
      0,
      raw,
    );
    assert.ok(existsSync(join(state, ".kioku/config.yaml")), "the configuration is in the state home");
    assert.ok(existsSync(join(state, ".kioku/brains/sam/brain/kioku.yaml")), "so are the brains");
    assert.ok(!existsSync(join(host, ".kioku")), "nothing of Kioku's state in the person's home");
    assert.ok(!existsSync(join(state, ".claude")), "the host's folder is the person's, never the state home");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
