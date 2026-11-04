import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../../src/core/fs/atomic.ts";
import { acquireLock } from "../../src/core/fs/lock.ts";
import { scratch as scratchIn } from "../fixtures.ts";

const scratch = scratchIn("fs");

test("a write cut short leaves the old file whole and no temporary file", () =>
  scratch((dir) => {
    const path = join(dir, "f.md");
    writeAtomic(path, "old\n");
    for (const step of ["after-tmp", "after-fsync"] as const) {
      assert.throws(
        () =>
          writeAtomic(path, "new\n", (s) => {
            if (s === step) throw new Error("cut");
          }),
        /cut/,
      );
      assert.equal(readFileSync(path, "utf8"), "old\n");
      assert.deepEqual(readdirSync(dir), ["f.md"]);
    }
    writeAtomic(path, "new\n");
    assert.equal(readFileSync(path, "utf8"), "new\n");
  }));

test("the lock is exclusive: a second taker waits, then times out with the owner's name", () =>
  scratch(async (dir) => {
    const path = join(dir, "lock");
    const first = await acquireLock(path);
    await assert.rejects(acquireLock(path, { timeoutMs: 100 }), /locked by another kioku/);
    first.release();
    assert.equal(existsSync(path), false);
    (await acquireLock(path)).release();
  }));

test("a lock whose owner is gone is broken", () =>
  scratch(async (dir) => {
    const path = join(dir, "lock");
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 12345, host: "x", since: "then" }) + "\n");
    const lock = await acquireLock(path, { timeoutMs: 1000 });
    assert.equal(lock.broke?.pid, 2 ** 22 + 12345);
    lock.release();
  }));
