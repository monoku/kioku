import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld } from "../world.ts";

isolateGit();

const INSTINCT = "memory/instincts/run-database-tests-serially.md";

test("evolve --to rule writes a Rule that reads as one sentence, links the instinct to it and ends its candidacy (§3.6)", () =>
  stdinWorld(async (w) => {
    const r = await w.kioku(["page", "evolve", INSTINCT, "--brain", "sam/brain", "--to", "rule"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.evolvedAs, "rule");
    assert.equal(r.out.path, "rules/run-database-tests-serially.md");
    const rule = readFileSync(join(w.sam, r.out.path), "utf8");
    assert.match(rule, /^kind: rule$/m);
    assert.match(rule, /## Rule\n\nWhen tests touch the database, run them serially\./);
    assert.match(rule, /## Why\n\nSeen on 1 occasion; the latest: /);
    assert.match(rule, new RegExp(`^source: "${INSTINCT}"$`, "m"));
    assert.equal(sh(w.sam, "log", "-1", "--format=%s"), "evolve: Run database tests serially");

    const instinct = readFileSync(join(w.sam, INSTINCT), "utf8");
    assert.match(
      instinct,
      /Evolved into the Rule \[Run database tests serially\]\(\.\.\/\.\.\/rules\/run-database-tests-serially\.md\)/,
    );
    const again = await w.kioku(["page", "evolve", INSTINCT, "--brain", "sam/brain", "--to", "playbook"]);
    assert.equal(again.out.error.code, "already_evolved");
    // It is no longer a candidate.
    assert.deepEqual((await w.kioku(["page", "evolve", "--brain", "sam/brain"])).out.candidates, []);
  }));

test("evolve --to playbook keeps When and takes Do as the first step, in the instinct's namespace", () =>
  stdinWorld(async (w) => {
    const r = await w.kioku(["page", "evolve", INSTINCT, "--brain", "sam/brain", "--to", "playbook"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.path, "knowledge/sam/playbooks/run-database-tests-serially.md");
    const playbook = readFileSync(join(w.sam, r.out.path), "utf8");
    assert.match(playbook, /## When\n\nTests touch the database\./);
    assert.match(playbook, /## Steps\n\n1\. Run them serially\./);
    assert.match(readFileSync(join(w.sam, INSTINCT), "utf8"), /Evolved into the playbook/);
  }));

test("evolve with no --to is a Skill, as before; --to needs an instinct and one of three words (§3.6)", () =>
  stdinWorld(async (w) => {
    const r = await w.kioku(["page", "evolve", INSTINCT, "--brain", "sam/brain"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.path, "skills/run-database-tests-serially.md");
    assert.equal(r.out.evolvedAs, undefined);
    assert.equal((await w.kioku(["page", "evolve", "--brain", "sam/brain", "--to", "rule"])).out.error.code, "usage");
    assert.equal(
      (await w.kioku(["page", "evolve", INSTINCT, "--brain", "sam/brain", "--to", "command"])).out.error.code,
      "usage",
    );
  }));

test("a Rule that would not fit what a Rule may be is refused with the way out, and nothing is written (§3.6, §5.1)", () =>
  stdinWorld(async (w) => {
    const long = "Do this carefully: " + "run them serially and check the logs for the pool. ".repeat(14);
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "sam/brain",
        "--kind",
        "memory",
        "--sub",
        "instinct",
        "--title",
        "Check pools between runs",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "said so",
      ],
      `## When\n\nTests share a pool.\n\n## Do\n\n${long}\n`,
    );
    assert.equal(saved.code, 0, saved.raw);
    const r = await w.kioku(["page", "evolve", saved.out.path, "--brain", "sam/brain", "--to", "rule"]);
    assert.equal(r.out.error.code, "rule_too_long");
    assert.match(r.out.error.message, /--to playbook/);
    assert.ok(!existsSync(join(w.sam, "rules/check-pools-between-runs.md")));
    assert.equal(
      (await w.kioku(["page", "evolve", saved.out.path, "--brain", "sam/brain", "--to", "playbook"])).code,
      0,
    );
  }));
