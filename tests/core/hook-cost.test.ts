import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";
import { writeSemanticState } from "../../src/core/semantic/status.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

/** How many times each file is read while `body` runs: a shim on the file system, as a hook sees it. */
async function readsDuring(body: () => Promise<unknown>): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const original = fs.readFileSync;
  fs.readFileSync = ((path: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    const key = String(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return (original as (...a: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  try {
    await body();
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  }
  return counts;
}

const named = (counts: Map<string, number>, name: string) =>
  [...counts].filter(([path]) => basename(path) === name).map(([path, n]) => [dirname(path), n] as const);

test("one session start reads the machine configuration once, each brain's once, and no page or index twice (§4.1)", () =>
  world(async (w) => {
    // The search model said to be on its way is the longest path: the start then also looks at the model's state.
    writeSemanticState(w.home, (state) => ({ ...state, announced: "2026-10-07T00:00:00.000Z" }));
    const counts = await readsDuring(() =>
      w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ session_id: "s1", cwd: w.repo }) }),
    );
    const machine = named(counts, "config.yaml");
    assert.equal(machine.length, 1);
    assert.equal(machine[0]![1], 1, "the machine configuration");
    const configs = named(counts, "kioku.yaml");
    assert.ok(configs.length >= 3, "the project folder's and two brains'");
    for (const [folder, n] of configs) assert.equal(n, 1, `the kioku.yaml of ${folder}`);
    for (const [path, n] of counts) if (path.endsWith(".md")) assert.equal(n, 1, path);
  }));

test("a hook after a tool call reads the machine configuration once (§6.2)", () =>
  world(async (w) => {
    const counts = await readsDuring(() =>
      w.kioku(["hook", "post-tool-use"], {
        stdin: JSON.stringify({
          session_id: "s1",
          cwd: w.repo,
          tool_name: "Bash",
          tool_input: { command: "kioku page show p.md" },
          tool_response: {
            stdout: `${JSON.stringify({ brain: "github.com/northwind/brain-acme", path: "p.md", title: "Pool" })}\n`,
          },
        }),
      }),
    );
    assert.equal(named(counts, "config.yaml")[0]![1], 1);
    for (const [folder, n] of named(counts, "kioku.yaml")) assert.equal(n, 1, `the kioku.yaml of ${folder}`);
  }));

test("a hook whose input throws exits 0 and prints nothing (§6.2)", () =>
  world(async (w) => {
    const stdin = async (): Promise<string> => {
      throw new Error("the input broke");
    };
    for (const verb of ["post-tool-use", "pre-tool-use", "user-prompt-submit"]) {
      const r = await w.kioku(["hook", verb], { context: { stdin } });
      assert.equal(r.code, 0, verb);
      assert.equal(r.out, "", verb);
    }
  }));

test("the session start says what went wrong in its own answer, when its input throws (§6.2)", () =>
  world(async (w) => {
    const r = await w.kioku(["hook", "session-start"], {
      context: {
        stdin: async () => {
          throw new Error("the input broke");
        },
      },
    });
    assert.equal(r.code, 0);
    assert.match(r.out.systemMessage, /could not start/);
  }));
