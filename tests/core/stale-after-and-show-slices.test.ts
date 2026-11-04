import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { sh, stdinWorld } from "../world.ts";

isolateGit();

const SAVE = [
  "page",
  "save",
  "--brain",
  "northwind/brain-acme",
  "--kind",
  "knowledge",
  "--sub",
  "context",
  "--source",
  "Session 2026-10-07 in acme-api",
  "--evidence",
  "said so",
];
const PAGE = "knowledge/acme/context/freeze-until-november.md";
const BODY =
  "## Context\n\nNo deploys on Fridays until the freeze ends.\n\n## Details\n\nThe freeze covers production only.\n\n## Contacts\n\nAsk the platform team.\n";

test("--stale-after is a date on the page; lint lists the page from that day, and page list shows it (§3.3, §4.4)", () =>
  stdinWorld(async (w) => {
    const saved = await w.kioku(
      [...SAVE, "--title", "Freeze until November", "--summary", "Deploy freeze", "--stale-after", "2026-10-07"],
      BODY,
    );
    assert.equal(saved.code, 0, saved.raw);
    assert.equal(saved.out.path, PAGE);
    const text = readFileSync(join(w.acme, PAGE), "utf8");
    assert.match(text, /^evidence: "said so"\nstale_after: 2026-10-07$/m);

    const pages = await w.kioku(["page", "list", "--brain", "northwind/brain-acme"]);
    assert.equal(pages.out.pages.find((p: { path: string }) => p.path === PAGE).stale_after, "2026-10-07");

    // Today in this world is 2026-10-07: the day itself is due.
    const lint = await w.kioku(["brain", "lint", "northwind/brain-acme"]);
    assert.deepEqual(lint.out.brains[0].expired, [{ path: PAGE, stale_after: "2026-10-07" }]);
    const human = await w.kioku(["brain", "lint", "northwind/brain-acme"], "", true);
    assert.match(
      human.raw,
      /pages past their stale_after date\n\s+knowledge\/acme\/context\/freeze-until-november\.md \(since 2026-10-07\)/,
    );

    // A later day is not reported yet; clearing it ends the report.
    const later = await w.kioku(["page", "update", PAGE, "--stale-after", "2026-11-01"]);
    assert.equal(later.code, 0, later.raw);
    assert.deepEqual((await w.kioku(["brain", "lint", "northwind/brain-acme"])).out.brains[0].expired, []);
    const again = await w.kioku(["page", "update", PAGE, "--stale-after", "2026-11-01"]);
    assert.equal(again.out.error.code, "unchanged");
    const cleared = await w.kioku(["page", "update", PAGE, "--stale-after", "none"]);
    assert.equal(cleared.code, 0, cleared.raw);
    assert.doesNotMatch(readFileSync(join(w.acme, PAGE), "utf8"), /stale_after/);
  }));

test("--stale-after takes a real day, and the page is not written otherwise", () =>
  stdinWorld(async (w) => {
    for (const bad of ["soon", "2026-13-01", "2026-02-30", "11/01/2026"]) {
      const r = await w.kioku([...SAVE, "--title", "Freeze", "--stale-after", bad], BODY);
      assert.equal(r.code, 1, bad);
      assert.equal(r.out.error.code, "usage", bad);
      assert.match(r.out.error.message, /--stale-after takes a date such as 2026-11-01/);
    }
    assert.equal(sh(w.acme, "status", "--porcelain"), "");
  }));

test("a hand-written stale_after that is no date, and a page past 500 lines, are warnings that name the page (§5.1)", () =>
  stdinWorld(async (w) => {
    await w.kioku([...SAVE, "--title", "Freeze until November", "--summary", "Deploy freeze"], BODY);
    writeFileSync(
      join(w.acme, PAGE),
      readFileSync(join(w.acme, PAGE), "utf8").replace(/^evidence: .*$/m, 'evidence: "said so"\nstale_after: soon'),
    );
    const long = await w.kioku(
      [...SAVE, "--title", "Everything about the freeze", "--summary", "Long"],
      `## Context\n\n${"A line of detail.\n".repeat(520)}`,
    );
    assert.equal(long.code, 0, long.raw);

    const r = await w.kioku(["brain", "validate", "northwind/brain-acme"]);
    const warnings = r.out.brains[0].findings.filter((f: { severity: string }) => f.severity === "warning");
    const named = (id: string) =>
      warnings.filter((f: { warning: string }) => f.warning === id).map((f: { path: string }) => f.path);
    assert.deepEqual(named("stale-after-invalid"), [PAGE]);
    assert.deepEqual(named("page-too-long"), ["knowledge/acme/context/everything-about-the-freeze.md"]);
  }));

test("kioku page show reads one slice of a long page: a section, the outline, or the first lines (§6.1)", () =>
  stdinWorld(async (w) => {
    await w.kioku([...SAVE, "--title", "Freeze until November", "--summary", "Deploy freeze"], BODY);

    const section = await w.kioku(["page", "show", PAGE, "--section", "Details"]);
    assert.equal(section.code, 0, section.raw);
    assert.equal(section.out.body, "The freeze covers production only.");
    assert.deepEqual(section.out.slice, { section: "Details" });
    assert.equal(section.out.title, "Freeze until November", "the fields stay");
    assert.ok(Array.isArray(section.out.history));

    const outline = await w.kioku(["page", "show", PAGE, "--outline"]);
    assert.deepEqual(outline.out.slice.outline, ["Context", "Details", "Contacts", "Changelog"]);
    assert.equal(outline.out.body, "## Context\n## Details\n## Contacts\n## Changelog");

    const head = await w.kioku(["page", "show", PAGE, "--head", "3"]);
    assert.equal(head.out.body.split("\n").length, 3);
    assert.equal(head.out.slice.truncated, true);
    const text = await w.kioku(["page", "show", PAGE, "--head", "3"], "", true);
    assert.match(text.raw, /\[… \d+ more lines; kioku page show --section reads one part\]/);

    const whole = await w.kioku(["page", "show", PAGE]);
    assert.equal(whole.out.slice, undefined);
    assert.match(whole.out.body, /## Contacts/);
  }));

test("kioku page show refuses a section the page lacks by listing the ones it has, and more than one slice", () =>
  stdinWorld(async (w) => {
    await w.kioku([...SAVE, "--title", "Freeze until November", "--summary", "Deploy freeze"], BODY);
    const missing = await w.kioku(["page", "show", PAGE, "--section", "Nope"]);
    assert.equal(missing.out.error.code, "section_not_found");
    assert.match(missing.out.error.message, /it has "Context", "Details", "Contacts", "Changelog"/);
    assert.equal((await w.kioku(["page", "show", PAGE, "--outline", "--head", "2"])).out.error.code, "usage");
    assert.equal((await w.kioku(["page", "show", PAGE, "--head", "0"])).out.error.code, "usage");
  }));
