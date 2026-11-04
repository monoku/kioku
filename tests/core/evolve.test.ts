import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { evidenceOf, parseBrainFile, sectionBody, sectionsOf } from "../../src/core/brain/file.ts";
import { linksOf, resolveLink } from "../../src/core/brain/paths.ts";
import { isUlid } from "../../src/core/brain/ulid.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { readPending } from "../../src/core/write/pending.ts";
import { INSTINCT, made, validPages } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld as world } from "../world.ts";

isolateGit();

const commits = (root: string) => Number(sh(root, "rev-list", "--count", "HEAD"));
const SHAPE = ["status", "brain", "path", "commit", "publication"];
/** The fixture's instinct: three occasions in acme, one in the personal brain. */
const INSTINCT_PATH = "memory/instincts/run-database-tests-serially.md";
const SKILL_PATH = "skills/run-database-tests-serially.md";

test("evolve lists the chain's instincts with three Evidence lines and not those with one", () =>
  world(async (w) => {
    const r = await w.kioku(["page", "evolve"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(
      r.out,
      {
        candidates: [
          {
            brain: "github.com/northwind/brain-acme",
            path: INSTINCT_PATH,
            title: "Run database tests serially",
            when: "Tests touch the database.",
            occasions: 3,
          },
        ],
      },
      "a list is not a write: no status, so no mark",
    );

    assert.deepEqual((await w.kioku(["page", "evolve", "--brain", "sam/brain"])).out, { candidates: [] });
    const text = await w.kioku(["page", "evolve"], "", true);
    assert.equal(text.out, `${INSTINCT_PATH} in northwind/brain-acme (3 occasions): Tests touch the database.\n`);
    assert.equal(
      (await w.kioku(["page", "evolve", "--brain", "sam/brain"], "", true)).out,
      "No instinct is a candidate for a Skill.\n",
    );
  }));

test("the third occasion says the instinct is a candidate, and no answer says autoevolve (§3.6)", () =>
  world(async (w) => {
    const second = await w.kioku([
      "page",
      "update",
      INSTINCT_PATH,
      "--brain",
      "sam/brain",
      "--evidence",
      "the same deadlock in billing",
      "--source",
      "Session 2026-10-07 in acme-billing",
    ]);
    assert.equal(second.out.status, "done", second.raw);
    assert.equal(second.out.candidate, undefined, "two occasions are not enough");
    assert.deepEqual((await w.kioku(["page", "evolve", "--brain", "sam/brain"])).out, { candidates: [] });
    const third = await w.kioku([
      "page",
      "update",
      INSTINCT_PATH,
      "--brain",
      "sam/brain",
      "--evidence",
      "again in payments",
      "--source",
      "Session 2026-10-07 in acme-payments",
    ]);
    assert.equal(third.out.candidate, true);
    assert.equal("autoevolve" in third.out, false, "the agent never evolves one on its own");
    assert.deepEqual(
      (await w.kioku(["page", "evolve", "--brain", "sam/brain"])).out.candidates.map((c: { path: string }) => c.path),
      [INSTINCT_PATH],
    );

    const memory = await w.kioku([
      "page",
      "update",
      "memory/prefer-small-commits.md",
      "--summary",
      "Small commits find bugs.",
    ]);
    assert.equal(memory.out.candidate, undefined);
    const first = await w.kioku(
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
        "Rebase before pushing a shared brain",
        "--source",
        "Session 2026-10-07 in acme-api",
      ],
      "## When\n\nA push is refused.\n\n## Do\n\nRebase, then push.\n",
    );
    assert.equal(first.out.status, "done", first.raw);
    assert.equal(first.out.candidate, undefined, "one occasion is not a candidate");
  }));

test("evolve <path> writes a valid Skill and links the instinct to it in one commit, pushed; the instinct is no longer a candidate", () =>
  world(async (w) => {
    const before = commits(w.acme);
    const r = await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "northwind/brain-acme"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(Object.keys(r.out).slice(0, 5), SHAPE);
    assert.equal(r.out.status, "done");
    assert.equal(r.out.brain, "github.com/northwind/brain-acme");
    assert.equal(r.out.path, SKILL_PATH);
    assert.equal(r.out.instinct, INSTINCT_PATH);
    assert.equal(r.out.publication, "pushed");
    assert.ok(isUlid(r.out.id));

    assert.equal(commits(w.acme), before + 1);
    assert.equal(sh(w.acme, "log", "-1", "--format=%s"), "evolve: Run database tests serially");
    assert.deepEqual(sh(w.acme, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), [
      INSTINCT_PATH,
      SKILL_PATH,
    ]);
    assert.equal(sh(w.bare.acme, "rev-parse", "main"), sh(w.acme, "rev-parse", "HEAD"));
    assert.equal(sh(w.acme, "status", "--porcelain"), "");

    const skill = parseBrainFile(readFileSync(join(w.acme, SKILL_PATH), "utf8"));
    assert.ok(skill.ok);
    assert.equal(skill.file.front.getString("kind"), "skill");
    assert.equal(skill.file.front.getString("id"), r.out.id);
    assert.equal(skill.file.front.getString("title"), "Run database tests serially");
    assert.equal(skill.file.front.getString("summary"), "Run database tests serially.");
    assert.equal(skill.file.front.getString("source"), INSTINCT_PATH);
    assert.equal(skill.file.front.getString("namespace"), "acme");
    assert.deepEqual(sectionsOf(skill.file.body), ["When to use", "Steps", "Changelog"]);
    assert.equal(sectionBody(skill.file.body, "When to use"), "Tests touch the database.");
    assert.equal(sectionBody(skill.file.body, "Steps"), "Run serially.");

    const instinct = parseBrainFile(readFileSync(join(w.acme, INSTINCT_PATH), "utf8"));
    assert.ok(instinct.ok);
    assert.equal(evidenceOf(instinct.file).length, 3, "the link is not an occasion");
    assert.deepEqual(
      linksOf(instinct.file.body).map((l) => resolveLink(INSTINCT_PATH, l.target)),
      [SKILL_PATH],
    );
    assert.match(
      sectionBody(instinct.file.body, "Evidence")!,
      /\n- 2026-10-07 Evolved into the Skill \[Run database tests serially\]\(\.\.\/\.\.\/skills\/run-database-tests-serially\.md\)\.$/,
    );
    assert.deepEqual(
      validateBrain(w.acme).findings.filter((f) => f.severity === "error"),
      [],
    );

    assert.deepEqual((await w.kioku(["page", "evolve"])).out, { candidates: [] });
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].skillCandidates, []);
    const later = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", false, {
      now: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    assert.deepEqual(
      later.out.brains[0].staleInstincts,
      [],
      "an evolved instinct is never stale: its Skill carries it",
    );

    // A full rewrite of the instinct keeps the link: it lives in the record the tool keeps.
    const rewrite = await w.kioku(
      ["page", "update", INSTINCT_PATH, "--brain", "northwind/brain-acme"],
      "## When\n\nTests touch the database.\n\n## Do\n\nRun them serially, one worker.\n",
    );
    assert.equal(rewrite.out.status, "done", rewrite.raw);
    assert.equal(rewrite.out.candidate, undefined);
    assert.deepEqual((await w.kioku(["page", "evolve"])).out, { candidates: [] });
  }));

test("evolve refuses what is not an instinct, an instinct already evolved, and a Skill that exists, and writes nothing", () =>
  world(
    async (w) => {
      const head = sh(w.acme, "rev-parse", "HEAD");
      const notInstinct = await w.kioku(["page", "evolve", "knowledge/acme/playbooks/migrate.md"]);
      assert.equal(notInstinct.code, 1);
      assert.deepEqual(Object.keys(notInstinct.out).slice(0, 5), SHAPE);
      assert.equal(notInstinct.out.status, "error");
      assert.equal(notInstinct.out.error.code, "not_instinct");
      assert.equal(
        (await w.kioku(["page", "evolve", "memory/instincts/nothing.md", "--brain", "northwind/brain-acme"])).out.error
          .code,
        "not_found",
      );
      assert.equal((await w.kioku(["page", "evolve", "a.md", "b.md"])).out.error.code, "usage");

      const taken = await w.kioku(["page", "evolve", "memory/instincts/release-a-hotfix.md"]);
      assert.equal(taken.out.error.code, "path_exists");
      assert.equal(sh(w.acme, "rev-parse", "HEAD"), head);
      assert.equal(sh(w.acme, "status", "--porcelain"), "");

      await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "northwind/brain-acme"]);
      const again = await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "northwind/brain-acme"]);
      assert.equal(again.out.error.code, "already_evolved");
    },
    {
      acmePages: [
        ...validPages().filter((p) => !p.path.startsWith("memory/run-migrations")),
        made({
          n: 40,
          type: INSTINCT,
          title: "Release a hotfix",
          sections: { When: "Prod is down.", Do: "Branch from the tag." },
          occasions: 3,
        }),
      ],
    },
  ));

test("an instinct whose See also points at a Skill is a neighbour, not evolved: it stays a candidate and evolves (§3.3, §3.6)", () =>
  world(async (w) => {
    const linked = await w.kioku([
      "page",
      "link",
      INSTINCT_PATH,
      "skills/release-a-hotfix.md",
      "--brain",
      "northwind/brain-acme",
    ]);
    assert.equal(linked.out.status, "done", linked.raw);
    assert.deepEqual(
      (await w.kioku(["page", "evolve"])).out.candidates.map((c: { path: string }) => c.path),
      [INSTINCT_PATH],
    );
    assert.deepEqual(
      (await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].skillCandidates.map(
        (c: { path: string }) => c.path,
      ),
      [INSTINCT_PATH],
    );
    const evolved = await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "northwind/brain-acme"]);
    assert.equal(evolved.out.status, "done", evolved.raw);
    assert.equal(
      (await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "northwind/brain-acme"])).out.error.code,
      "already_evolved",
    );
  }));

test("with the remote unreachable evolve commits and is pending; in the personal brain it is local; the text is one line", () =>
  world(async (w) => {
    const away = `${w.bare.acme}.away`;
    renameSync(w.bare.acme, away);
    const r = await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "northwind/brain-acme"]);
    assert.equal(r.out.status, "done", r.raw);
    assert.equal(r.out.publication, "pending");
    assert.ok(existsSync(join(w.acme, SKILL_PATH)));
    assert.deepEqual(Object.keys(readPending(w.home)), ["github.com/northwind/brain-acme"]);
    renameSync(away, w.bare.acme);

    await w.kioku([
      "page",
      "update",
      INSTINCT_PATH,
      "--brain",
      "sam/brain",
      "--evidence",
      "again",
      "--source",
      "Session 2026-10-07 in acme-billing",
    ]);
    const text = await w.kioku(["page", "evolve", INSTINCT_PATH, "--brain", "sam/brain"], "", true);
    assert.match(
      text.out,
      /^Wrote skills\/run-database-tests-serially\.md in sam\/brain \(commit [0-9a-f]+, local; sync pushes it\)\.\n$/,
    );
  }));
