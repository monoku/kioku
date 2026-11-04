import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isInside, linksIn } from "../../src/core/brain/inside.ts";
import { readFolderConfig } from "../../src/core/config/folder-config.ts";
import { validateBrain } from "../../src/core/validate/validate.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const SECRET = "aws_secret_access_key = a-value-from-outside-the-brain";
const start = (w: World) =>
  w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }) });

/** A file of the machine's, outside every brain, that a link in a brain points at. */
function secretOutside(w: World): string {
  const file = join(w.home, ".aws", "credentials");
  mkdirSync(join(w.home, ".aws"), { recursive: true });
  writeFileSync(file, `[default]\n${SECRET}\n`);
  return file;
}

test("a brain's BRAIN.md that is a symbolic link is read as missing: a file of the machine's does not reach the summary (§3.1)", () =>
  world(async (w) => {
    const secret = secretOutside(w);
    rmSync(join(w.acme, "BRAIN.md"));
    symlinkSync(secret, join(w.acme, "BRAIN.md"));
    const r = await start(w);
    assert.equal(r.code, 0, r.raw);
    assert.ok(!r.raw.includes("a-value-from-outside-the-brain"), "the linked file is not read");
    const report = validateBrain(w.acme);
    assert.ok(
      report.findings.some((f) => f.rule === 12 && f.path === "BRAIN.md"),
      "the validator names the link",
    );
  }));

test("a namespace whose path leaves the brain, or an INDEX.md that is a link, is not read (§3.1)", () =>
  world(async (w) => {
    const secret = secretOutside(w);
    // An INDEX.md outside the brain, which `knowledge/../../INDEX.md` would reach.
    writeFileSync(join(w.acme, "..", "INDEX.md"), `# Outside\n\n${SECRET}\n`);
    const config = join(w.acme, "kioku.yaml");
    writeFileSync(config, "format: 1\ntier: project\nnamespaces:\n  - ../..\n  - linked\n");
    mkdirSync(join(w.acme, "knowledge", "linked"), { recursive: true });
    symlinkSync(secret, join(w.acme, "knowledge", "linked", "INDEX.md"));
    const r = await start(w);
    assert.equal(r.code, 0, r.raw);
    assert.ok(!r.raw.includes("a-value-from-outside-the-brain"), "neither is read");
  }));

test("a kioku.yaml that is a symbolic link is not read, and isInside holds a path to the brain's own files (§3.1)", () =>
  world(async (w) => {
    const secret = secretOutside(w);
    const linked = join(w.dir, "linked-config");
    mkdirSync(linked, { recursive: true });
    symlinkSync(secret, join(linked, "kioku.yaml"));
    const found = readFolderConfig(join(linked, "kioku.yaml"));
    assert.equal(found.ok, false);
    assert.ok(!found.ok && !found.reason.includes("a-value-from-outside-the-brain"), "its target is not quoted");

    assert.equal(isInside(w.acme, "BRAIN.md"), true);
    for (const rel of ["../brain/BRAIN.md", "/etc/hosts", "knowledge/../BRAIN.md", "", "knowledge\\x"])
      assert.equal(isInside(w.acme, rel), false, rel);
    symlinkSync(join(w.acme, "rules"), join(w.acme, "elsewhere"));
    assert.deepEqual(linksIn(w.acme), ["elsewhere"]);
    assert.equal(isInside(w.acme, "elsewhere/x.md"), false, "nor under a link to a folder");
  }));
