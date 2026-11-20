import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const ACME = "northwind/brain-acme";
const saveRule = (w: World, title: string, rule: string, applies?: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      ACME,
      "--kind",
      "rule",
      "--title",
      title,
      "--summary",
      `${title}.`,
      "--source",
      "Session 2026-10-07 in acme-api",
      "--evidence",
      "always",
      "--create",
      "--see-also",
      "none",
      ...(applies === undefined ? [] : ["--applies-to", applies]),
    ],
    { stdin: `## Rule\n\n${rule}\n\n## Why\n\nIt went wrong once.\n` },
  );
const start = (w: World, source = "startup") =>
  w.kioku(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, session_id: "s", source }) });
const touch = (w: World, file: string, session = "s", agent?: string) =>
  w.kioku(["hook", "pre-tool-path"], {
    stdin: JSON.stringify({
      cwd: w.repo,
      session_id: session,
      ...(agent !== undefined && { agent_id: agent, agent_type: "Explore" }),
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(w.repo, file) },
    }),
  });
const contextOf = (r: { out: any }): string => r.out?.hookSpecificOutput?.additionalContext ?? "";

test("a project Rule about some files is not in the summary and is given whole when one is read or changed, once, and again after a compaction (§3.4, §4.1, §4.7)", () =>
  world(async (w) => {
    const always = await saveRule(w, "Name the unit of every amount", "Every amount says its unit.");
    const scoped = await saveRule(
      w,
      "Round money once, on the total",
      "In billing, round once, on the total.",
      "src/billing/**",
    );
    assert.equal(scoped.out.status, "done", JSON.stringify(scoped.out));
    // It takes none of the Rules' room: the answer counts the Rules that are always on.
    assert.equal(scoped.out.rules.rules, always.out.rules.rules);
    assert.equal(scoped.out.rules.characters, always.out.rules.characters);

    // The index has a page from the next sync, search or save (§4.3).
    await w.kioku(["page", "search", "billing"]);
    const summary = contextOf(await start(w));
    assert.match(summary, /### Name the unit of every amount/);
    assert.doesNotMatch(summary, /Round money once|round once, on the total/);
    assert.match(summary, /## Rules about some files\n\n1 Rule of the project brain is about some files only/);

    // Another file: nothing. One of its files: the Rule, whole, before any page.
    assert.equal(contextOf(await touch(w, "src/checkout/cart.ts")), "");
    const given = contextOf(await touch(w, "src/billing/invoice.ts"));
    assert.match(given, /^## Kioku: Rules about this file\n/);
    assert.match(given, /They hold from now on/);
    assert.match(
      given,
      new RegExp(
        `### Round money once, on the total \\(${ACME}, ${scoped.out.path}\\)\\n\\nIn billing, round once, on the total\\.\\n\\nWhy: It went wrong once\\.`,
      ),
    );
    assert.doesNotMatch(given, /Name the unit/, "a Rule that is always on is the summary's");

    // Once a session; a compaction took its text, so it is given again; and another session has its own.
    assert.equal(contextOf(await touch(w, "src/billing/tax.ts")), "");
    await start(w, "compact");
    assert.match(contextOf(await touch(w, "src/billing/tax.ts")), /Round money once, on the total/);
    assert.equal(contextOf(await touch(w, "src/billing/invoice.ts")), "");
    assert.match(contextOf(await touch(w, "src/billing/invoice.ts", "other")), /Round money once/);

    // A subagent has a context of its own: it is given the Rule the session already has, once, and what a subagent
    // was given first the session is still given.
    assert.match(contextOf(await touch(w, "src/billing/invoice.ts", "s", "a1")), /Round money once/);
    assert.equal(contextOf(await touch(w, "src/billing/tax.ts", "s", "a1")), "");
    assert.match(contextOf(await touch(w, "src/billing/invoice.ts", "s", "a2")), /Round money once/);
    assert.match(contextOf(await touch(w, "src/billing/invoice.ts", "fresh", "a1")), /Round money once/);
    assert.match(
      contextOf(await touch(w, "src/billing/invoice.ts", "fresh")),
      /Round money once/,
      "the session after its subagent",
    );

    // A prompt never recalls a Rule, and a page about the file comes after the Rules, on its line.
    const page = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        ACME,
        "--kind",
        "memory",
        "--title",
        "Billing rounds each line",
        "--summary",
        "What to know there.",
        "--source",
        "Session 2026-10-07 in acme-api",
        "--evidence",
        "x",
        "--applies-to",
        "src/billing/**",
        "--create",
      ],
      { stdin: "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n" },
    );
    assert.equal(page.out.status, "done", JSON.stringify(page.out));
    await w.kioku(["page", "search", "billing"]);
    const both = contextOf(await touch(w, "src/billing/invoice.ts", "third"));
    assert.ok(both.indexOf("## Kioku: Rules about this file") < both.indexOf("## Kioku: pages about this file"));
    assert.match(both, /^- Billing rounds each line: What to know there\./m);
  }));
