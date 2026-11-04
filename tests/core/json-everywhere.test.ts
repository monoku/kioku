import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

// What an agent, a hook or a pipe calls (§6.1): one line of JSON, with or without `--json`, at a terminal or not.
const READING: string[][] = [
  ["doctor"],
  ["config"],
  ["config", "get", "display.color"],
  ["brain", "list"],
  ["brain", "stats"],
  ["brain", "log", "--since", "30d"],
  ["brain", "lint"],
  ["namespace", "list"],
  ["page", "list"],
  ["page", "list", "--count"],
  ["page", "search", "migrations"],
  ["sync"],
];

test("every reading verb answers one line of JSON, the same through a pipe and with --json at a terminal (§6.1)", () =>
  world(async (w) => {
    for (const argv of READING) {
      const args = argv[0] === "sync" ? [...argv, "--cwd", w.repo] : argv;
      const piped = await w.kioku(args);
      assert.equal(piped.raw.trim().split("\n").length, 1, `${argv.join(" ")} through a pipe is one line`);
      assert.doesNotThrow(() => JSON.parse(piped.raw), argv.join(" "));
      assert.ok(
        typeof piped.out === "object" && piped.out !== null && !("error" in piped.out),
        `${argv.join(" ")}: ${piped.raw.slice(0, 200)}`,
      );

      const terminal = await w.kioku([...args, "--json"], { tty: true });
      assert.equal(terminal.raw.trim().split("\n").length, 1, `${argv.join(" ")} --json at a terminal is one line`);
      assert.deepEqual(
        Object.keys(JSON.parse(terminal.raw)).sort(),
        Object.keys(piped.out).sort(),
        `${argv.join(" ")} has the same shape either way`,
      );
    }
  }));

test("an error is {error: {code, message}} on one line, for a verb the tool does not have and for a bad argument", () =>
  world(async (w) => {
    for (const argv of [
      ["nonsense"],
      ["page", "show", "no/such/page.md"],
      ["brain", "stats", "--since", "last week"],
    ]) {
      const r = await w.kioku(argv);
      assert.equal(r.raw.trim().split("\n").length, 1, argv.join(" "));
      assert.deepEqual(Object.keys(r.out), ["error"], argv.join(" "));
      assert.deepEqual(Object.keys(r.out.error).sort(), ["code", "message"], argv.join(" "));
      assert.notEqual(r.code, 0);
    }
  }));
