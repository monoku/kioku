import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configPath, readMachineConfig } from "../../src/core/config/machine.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

const terminal = { context: { interactive: true } };
const file = (home: string) => readFileSync(configPath(home), "utf8");

test("kioku config lists every key with its value and where it comes from, to anyone", () =>
  world(async (w) => {
    const r = await w.kioku(["config"]);
    assert.equal(r.code, 0, r.raw);
    const byKey = Object.fromEntries(r.out.keys.map((k: { key: string }) => [k.key, k]));
    assert.deepEqual(Object.keys(byKey), [
      "team",
      "display.color",
      "display.mute",
      "search.mode",
      "brain",
      "repositories",
      "trust.owners",
    ]);
    assert.deepEqual(
      [byKey.team.value, byKey.team.source, byKey.team.editable, byKey.team.whenAbsent],
      [null, "default", true, "none where a project names none"],
    );
    assert.deepEqual(
      [byKey["display.color"].value, byKey["display.color"].source, byKey["display.color"].default],
      ["auto", "default", "auto"],
    );
    assert.deepEqual(
      [byKey["display.mute"].value, byKey["display.mute"].source, byKey["display.mute"].default],
      [[], "default", []],
    );
    assert.match(
      byKey["display.mute"].allowed,
      /^not-set-up, update-available, .*unpublished$/,
      "the JSON names the notices",
    );
    assert.equal(byKey.brain.editable, false);
    assert.equal(byKey.brain.value, "github.com/sam/brain");

    const text = await w.kioku(["config"], { tty: true });
    assert.match(text.raw, /^display\.color\s+auto\s+default$/m);
    assert.match(text.raw, /^brain\s+github\.com\/sam\/brain\s+read only here$/m);
    assert.match(text.raw, /^team\s+\(not set\)\s+none where a project names none$/m);
    assert.match(text.raw, /^display\.mute\s+\(none\)\s+default$/m, "the list has no room for the names (§6.1)");
  }));

test("config get answers one key, a read only key too, and display.mute names what it takes", () =>
  world(async (w) => {
    assert.equal((await w.kioku(["config", "get", "display.color"])).out.value, "auto");
    assert.equal((await w.kioku(["config", "get", "brain"])).out.value, "github.com/sam/brain");
    assert.deepEqual((await w.kioku(["config", "get", "repositories"])).out.value, [
      "github.com/northwind/brain-acme",
      "github.com/northwind/brain",
    ]);
    assert.equal((await w.kioku(["config", "get", "display.color"], { tty: true })).raw.trim(), "auto");
    assert.match(
      (await w.kioku(["config", "get", "display.mute"], { tty: true })).raw,
      /^\(none\)\nthe names: not-set-up, update-available,/,
    );
    const unknown = await w.kioku(["config", "get", "nope"]);
    assert.equal(unknown.out.error.code, "config_key_unknown");
    assert.match(unknown.out.error.message, /search\.mode/);
  }));

test("config set writes each key with a value that is valid, and the file reads back in the groups of §2.5", () =>
  world(async (w) => {
    const set = async (key: string, value: string) => {
      const r = await w.kioku(["config", "set", key, value], terminal);
      assert.equal(r.code, 0, r.raw);
      return r;
    };
    await set("display.color", "never");
    const r = await set("search.mode", "full-text");
    assert.deepEqual([r.out.key, r.out.value, r.out.source], ["search.mode", "full-text", "file"]);
    const c = readMachineConfig(w.home)!;
    assert.deepEqual(c.search, { mode: "full-text" });
    assert.deepEqual(c.display, { color: "never" });
    assert.deepEqual(
      Object.keys(c.repositories),
      ["github.com/northwind/brain-acme", "github.com/northwind/brain"],
      "what it does not own is kept",
    );
    assert.match(file(w.home), /^brain: \S+\ndisplay:\n  color: never\nsearch:/m, "the keys keep the order of §2.5");
  }));

test("display.mute is set to a list, or changed one name at a time with + and -, and refuses a name it does not know (§1.2, §6.1)", () =>
  world(async (w) => {
    const set = async (value: string) => (await w.kioku(["config", "set", "display.mute", value], terminal)).out;
    assert.deepEqual(
      (await set("unpublished,update-available")).value,
      ["update-available", "unpublished"],
      "kept in the order of §1.2",
    );
    assert.deepEqual((await set("+cloning")).value, ["update-available", "cloning", "unpublished"]);
    assert.deepEqual((await set("+cloning")).value, ["update-available", "cloning", "unpublished"], "twice is once");
    assert.deepEqual((await set("-update-available")).value, ["cloning", "unpublished"]);
    assert.match(file(w.home), /^display:\n  mute:\n    - cloning\n    - unpublished$/m);
    const bad = await set("+marks");
    assert.equal(bad.error.code, "config_value_invalid");
    assert.match(bad.error.message, /not-set-up, update-available, .*unpublished, or one of them after \+ or -/);
    assert.deepEqual(readMachineConfig(w.home)!.display?.mute, ["cloning", "unpublished"], "nothing written");
    await set("-cloning");
    await set("-unpublished");
    assert.doesNotMatch(file(w.home), /display/, "an empty list leaves no group behind");
  }));

test("a value that is not allowed is refused with what is allowed and the default, and nothing is written", () =>
  world(async (w) => {
    const before = file(w.home);
    const cases: [string, string, RegExp][] = [
      ["search.mode", "semantic", /hybrid or full-text.*default is hybrid/],
      ["display.color", "yes", /auto, always or never.*default is auto/],
    ];
    for (const [key, value, message] of cases) {
      const r = await w.kioku(["config", "set", key, value], terminal);
      assert.equal(r.code, 1, `${key}=${value}`);
      assert.equal(r.out.error.code, "config_value_invalid");
      assert.match(r.out.error.message, message);
    }
    assert.equal(file(w.home), before);
  }));

test("a key of an older version is an unknown key to set, and a file holding one is refused", () =>
  world(async (w) => {
    for (const key of ["updates", "autoupdate", "session.marks", "display.messages"]) {
      const r = await w.kioku(["config", "set", key, "x"], terminal);
      assert.equal(r.out.error.code, "config_key_unknown", key);
      assert.match(r.out.error.message, /^unknown key/, key);
    }
    const path = join(w.home, ".kioku/config.yaml");
    writeFileSync(path, `${readFileSync(path, "utf8")}session:\n  marks: none\n`);
    assert.throws(() => readMachineConfig(w.home), /unknown key `session`/);
  }));

test("brain, repositories and trust.owners are not set with kioku config, and the refusal names the verb that owns them", () =>
  world(async (w) => {
    const before = file(w.home);
    for (const [key, owner] of [
      ["brain", /kioku brain create or kioku brain clone/],
      ["repositories", /kioku brain trust/],
      ["trust.owners", /kioku brain trust --owner/],
    ] as const) {
      for (const argv of [
        ["config", "set", key, "github.com/evil/brain"],
        ["config", "unset", key],
      ]) {
        const r = await w.kioku(argv, terminal);
        assert.equal(r.code, 1);
        assert.equal(r.out.error.code, "config_key_readonly");
        assert.match(r.out.error.message, owner);
      }
    }
    assert.equal(file(w.home), before);
  }));

test("config set team takes a team brain this machine has, by name or repository; unset forgets it (§2.5)", () =>
  world(async (w) => {
    const before = file(w.home);
    const agent = await w.kioku(["config", "set", "team", "northwind/brain"]);
    assert.equal(agent.out.error.code, "needs_terminal", "the person's act, not the agent's");

    const unknown = await w.kioku(["config", "set", "team", "org/brain-team"], terminal);
    assert.equal(unknown.out.error.code, "brain_unknown");
    assert.match(unknown.out.error.message, /kioku brain clone org\/brain-team/);
    const project = await w.kioku(["config", "set", "team", "northwind/brain-acme"], terminal);
    assert.equal(project.out.error.code, "config_value_invalid");
    assert.match(project.out.error.message, /`team` is a team brain, and northwind\/brain-acme is a project brain/);
    assert.equal(file(w.home), before, "nothing written");

    for (const name of ["northwind/brain", "github.com/northwind/brain"]) {
      const r = await w.kioku(["config", "set", "team", name], terminal);
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual([r.out.value, r.out.source], ["github.com/northwind/brain", "file"], name);
    }
    assert.match(file(w.home), /^brain: github\.com\/sam\/brain\nteam: github\.com\/northwind\/brain\nrepositories:/m);
    assert.equal((await w.kioku(["config", "get", "team"])).out.value, "github.com/northwind/brain");

    const unset = await w.kioku(["config", "unset", "team"], terminal);
    assert.equal(unset.code, 0, unset.raw);
    assert.equal(readMachineConfig(w.home)!.team, undefined);
    assert.doesNotMatch(file(w.home), /^team:/m);
  }));

test("config set team refuses a brain the machine knows but has not cloned, with the command that brings it", () =>
  world(
    async (w) => {
      const r = await w.kioku(["config", "set", "team", "github.com/northwind/brain"], terminal);
      assert.equal(r.out.error.code, "brain_not_cloned");
      assert.match(r.out.error.message, /kioku brain clone github\.com\/northwind\/brain brings it/);
    },
    { cloned: { team: false } },
  ));

test("config unset puts the default back and drops the key", () =>
  world(async (w) => {
    await w.kioku(["config", "set", "search.mode", "full-text"], terminal);
    await w.kioku(["config", "set", "display.color", "never"], terminal);
    assert.match(file(w.home), /search:\n  mode: full-text/);
    const r = await w.kioku(["config", "unset", "search.mode"], terminal);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.value, r.out.source], ["hybrid", "default"]);
    assert.doesNotMatch(file(w.home), /search:/);
    await w.kioku(["config", "unset", "display.color"], terminal);
    assert.doesNotMatch(file(w.home), /color/);
  }));

test("writing the configuration asks for a terminal and writes nothing; reading does not", () =>
  world(async (w) => {
    const before = file(w.home);
    for (const argv of [
      ["config", "set", "search.mode", "full-text"],
      ["config", "unset", "display.color"],
      ["config", "set", "display.color", "never"],
    ]) {
      const r = await w.kioku(argv);
      assert.equal(r.code, 1, argv.join(" "));
      assert.equal(r.out.error.code, "needs_terminal");
      assert.match(r.out.error.message, /for you to run in a terminal/);
    }
    assert.equal(file(w.home), before);
    assert.equal((await w.kioku(["config"])).code, 0);
  }));

test("Kioku has no switch of its own: enabled is an unknown key, and on and off are unknown verbs (§2.3)", () =>
  world(async (w) => {
    const before = file(w.home);
    for (const argv of [
      ["config", "set", "enabled", "false"],
      ["config", "get", "enabled"],
      ["config", "set", "user", "alex"],
    ]) {
      const r = await w.kioku(argv, terminal);
      assert.equal(r.out.error?.code, "config_key_unknown", argv.join(" "));
    }
    for (const old of ["on", "off"]) assert.equal((await w.kioku([old])).out.error.code, "unknown_verb", old);
    assert.equal(file(w.home), before);
  }));

test("a machine with no file lists the defaults, and set creates the file", () =>
  world(async (w) => {
    const { rmSync } = await import("node:fs");
    rmSync(configPath(w.home));
    const r = await w.kioku(["config"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.keys.find((k: { key: string }) => k.key === "display.color").value, "auto");
    await w.kioku(["config", "set", "display.color", "never"], terminal);
    assert.deepEqual(readMachineConfig(w.home)!.display, { color: "never" });
  }));

test("a file with a key the tool does not have, harness among them, is refused by name", () =>
  world(async (w) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(configPath(w.home), "harness: claude-code\nrepositories: {}\n");
    const r = await w.kioku(["config"]);
    assert.equal(r.out.error.code, "config_invalid");
    assert.match(r.out.error.message, /unknown key `harness`/);
  }));

test("a key is the default until it is set, and unset puts the default back", () =>
  world(async (w) => {
    const source = async (key: string) => (await w.kioku(["config", "get", key])).out.source;
    assert.equal(await source("display.color"), "default");
    await w.kioku(["config", "set", "display.color", "never"], terminal);
    assert.equal(await source("display.color"), "file");
    const r = await w.kioku(["config", "unset", "display.color"], terminal);
    assert.deepEqual([r.out.value, r.out.source], ["auto", "default"]);
    assert.doesNotMatch(file(w.home), /color/);
  }));

test("an agent that is refused learns nothing about which keys and values are valid", () =>
  world(async (w) => {
    for (const argv of [
      ["config", "set", "nope", "x"],
      ["config", "set", "display.color", "sometimes"],
      ["config", "unset", "personal"],
    ]) {
      const r = await w.kioku(argv);
      assert.equal(r.out.error.code, "needs_terminal", argv.join(" "));
    }
  }));
