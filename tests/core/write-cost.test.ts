import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { CONTEXT, made, put } from "../fixtures.ts";
import { gitCalls } from "../git-shim.ts";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld as world } from "../world.ts";

isolateGit();

const SAVE = (brain: string, title: string) => [
  "page",
  "save",
  "--brain",
  brain,
  "--kind",
  "knowledge",
  "--sub",
  "context",
  "--title",
  title,
  "--source",
  "https://x.io",
  "--summary",
  `${title}.`,
];
const BODY = "Ask the office manager; it is never written down.\n";

/** The git verb of a call: the first argument that is not `-C <dir>` or `-c <key=value>`. */
function verbOf(call: string): string {
  const args = call.split("\u001f");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" || args[i] === "-c") i++;
    else return args[i]!;
  }
  return "";
}
const verbs = (calls: string[]) => calls.map(verbOf);
const count = (calls: string[], verb: string) => verbs(calls).filter((v) => v === verb).length;

// The plan's measure of what one write costs: the git processes it spawns, counted with a `git` shim on the PATH.
test("a save in a brain with no remote spawns at most 8 git processes, and never a fetch (batch 2)", () =>
  world(async (w) => {
    let r: { out: { status: string; publication: string } } | undefined;
    const calls = await gitCalls(w.dir, async () => {
      r = await w.kioku(SAVE("sam/brain", "Office wifi password location"), BODY);
    });
    assert.deepEqual([r!.out.status, r!.out.publication], ["done", "local"]);
    assert.ok(calls.length <= 8, `${calls.length} git processes:\n${calls.join("\n")}`);
    assert.equal(count(calls, "fetch"), 0);
    assert.equal(count(calls, "commit"), 1);
  }));

test("a save in a brain with a remote and nothing behind spawns one fetch, no rebase, and at most 15 git processes (§1.6)", () =>
  world(async (w) => {
    let r: { out: { status: string; publication: string } } | undefined;
    const calls = await gitCalls(w.dir, async () => {
      r = await w.kioku(SAVE("northwind/brain-acme", "Office wifi password location"), BODY);
    });
    assert.deepEqual([r!.out.status, r!.out.publication], ["done", "pushed"]);
    assert.ok(calls.length <= 15, `${calls.length} git processes:\n${calls.join("\n")}`);
    assert.equal(count(calls, "fetch"), 1, verbs(calls).join(" "));
    assert.equal(count(calls, "rebase"), 0, verbs(calls).join(" "));
    assert.equal(count(calls, "push"), 1);
    assert.equal(count(calls, "commit"), 1);
    // The identity is not asked for on a machine that has one.
    assert.equal(count(calls, "config"), 0, verbs(calls).join(" "));
  }));

test("a push that someone beat between the write's fetch and its push fetches, rebases and pushes again, and loses nothing (§1.6)", () =>
  world(async (w) => {
    // Another machine's clone, with a commit it has not pushed yet: it pushes the moment this write pushes.
    const other = join(w.dir, "other");
    execFileSync("git", ["clone", "-q", w.bare.acme, other]);
    const page = made({ n: 95, type: CONTEXT, title: "Pushed by the other machine", sections: {} });
    put(other, page.path, page.text);
    sh(other, "add", "-A");
    sh(other, "commit", "-q", "-m", "save: Pushed by the other machine");
    const theirs = sh(other, "rev-parse", "HEAD");

    let r: { out: { status: string; publication: string; path: string; commit: string } } | undefined;
    const calls = await gitCalls(
      w.dir,
      async () => {
        r = await w.kioku(SAVE("northwind/brain-acme", "Office wifi password location"), BODY);
      },
      other,
    );
    assert.equal(r!.out.status, "done", JSON.stringify(r!.out));
    assert.equal(r!.out.publication, "pushed");
    assert.equal(count(calls, "push"), 2, verbs(calls).join(" "));
    assert.equal(count(calls, "fetch"), 2, "the write's, and the one after the push was beaten");
    assert.equal(count(calls, "rebase"), 1);
    // Both commits are on the remote, this machine's on top of theirs, and this machine holds both.
    const remoteLog = sh(w.bare.acme, "log", "--format=%H %s", "-3", "main").split("\n");
    assert.equal(remoteLog[0]!.split(" ").slice(1).join(" "), "save: Office wifi password location");
    assert.equal(remoteLog[1]!.split(" ")[0], theirs);
    assert.equal(sh(w.acme, "rev-parse", "HEAD"), remoteLog[0]!.split(" ")[0]);
    assert.ok(existsSync(join(w.acme, page.path)), "their page is here");
    assert.ok(existsSync(join(w.acme, r!.out.path)), "and this one");
    assert.equal(sh(w.acme, "status", "--porcelain"), "");
  }));

// The write verbs' imports never reach the model's code (§4.3): a save loads no engine, whatever the machine has.
test("the write verbs' imports never reach the model's code", () => {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export)(?! type)[^;]*? from "(\.[^"]+)"/gm))
      walk(resolve(dirname(file), m[1]!));
  };
  walk(resolve(import.meta.dirname, "../../src/core/write/verbs.ts"));
  const reached = [...seen].map((f) => f.slice(resolve(import.meta.dirname, "../..").length + 1));
  assert.ok(reached.includes("src/core/index/similar.ts"), "the walk found the similar pages");
  // The pins are names and sizes, read by the configuration; the engine, its install and its loader are not reached.
  assert.deepEqual(
    reached.filter(
      (f) => /semantic\/(embedder|install|tar|refresh|meaning|status)\.ts$/.test(f) || f === "src/core/index/hybrid.ts",
    ),
    [],
  );
});
