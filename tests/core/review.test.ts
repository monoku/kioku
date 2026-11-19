import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { recallText } from "../../src/core/session/recall.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";

isolateGit();

const ACME = "northwind/brain-acme";
/** A day by which every page of the world, written in 2026, is past its kind's window (§4.4). */
const LATER = { now: () => new Date(2028, 0, 15, 12, 0, 0) };

const save = (w: World, kind: string[], title: string, extra: string[], body: string) =>
  w.kioku(
    [
      "page",
      "save",
      "--brain",
      ACME,
      ...kind,
      "--title",
      title,
      "--summary",
      `About ${title.toLowerCase()}.`,
      "--source",
      "Session 2026-10-07 in acme-api",
      "--evidence",
      "said so",
      "--create",
      ...extra,
    ],
    { stdin: body },
  );
const CONTEXT = ["--kind", "knowledge", "--sub", "context"];
const MEMORY = ["--kind", "memory"];
const LESSON = "## What happened\n\nIt broke.\n\n## Lesson\n\nMind it.\n\n## Rule of thumb\n\nCheck first.\n";

const show = async (w: World, path: string, context = {}) =>
  (await w.kioku(["page", "show", path, "--brain", ACME], { context })).out;

test("a page past its date, or not changed or confirmed for longer than its kind lasts, says so in show, list and a search hit (§4.3, §4.4)", () =>
  world(async (w) => {
    const dated = await save(w, CONTEXT, "Harbour freeze", ["--stale-after", "2026-10-07"], "No deploys.\n");
    const plain = await save(w, CONTEXT, "Harbour pilots", [], "Who steers.\n");
    const decision = await save(
      w,
      ["--kind", "knowledge", "--sub", "decision"],
      "Harbour dredging",
      [],
      "## Decision\n\nDredge.\n\n## Why\n\nSilt.\n\n## Consequences\n\nCost.\n",
    );
    for (const r of [dated, plain, decision]) assert.equal(r.out.status, "done", JSON.stringify(r.out));

    // Today, in this world: the dated page is due, the day itself included; the other two say nothing.
    assert.deepEqual((await show(w, dated.out.path)).review, { reason: "expired", since: "2026-10-07" });
    assert.equal((await show(w, plain.out.path)).review, null);

    const found = (await w.kioku(["page", "search", "harbour"])).out.hits as { path: string; review?: unknown }[];
    assert.deepEqual(found.find((h) => h.path === dated.out.path)!.review, { reason: "expired", since: "2026-10-07" });
    assert.ok(!("review" in found.find((h) => h.path === plain.out.path)!), "a hit with nothing to say has no field");
    const text = (await w.kioku(["page", "search", "harbour"], { tty: true })).raw;
    assert.match(text, /past its date, 2026-10-07/);
    assert.match(text, /Due a look: check a page marked as due a look before relying on it; `kioku page confirm/);
    assert.match(
      (await w.kioku(["page", "show", dated.out.path, "--brain", ACME], { tty: true })).raw,
      /^review: past its date, 2026-10-07; check a page/m,
    );

    // More than a year on: a context page nobody touched is asked about, since its last touch; a decision never is.
    const old = await show(w, plain.out.path, LATER);
    assert.deepEqual(old.review, { reason: "unconfirmed", since: old.touched });
    assert.equal((await show(w, decision.out.path, LATER)).review, null);
    assert.equal((await show(w, dated.out.path, LATER)).review.reason, "expired", "the writer's own date comes first");
    const listed = (await w.kioku(["page", "list", "--brain", ACME, "--limit", "100"], { context: LATER })).out.pages;
    assert.equal(listed.find((p: { path: string }) => p.path === plain.out.path).review.reason, "unconfirmed");

    // The mark hides nothing and orders nothing: the hits are the same, in the same order.
    const later = (await w.kioku(["page", "search", "harbour"], { context: LATER })).out.hits as { path: string }[];
    assert.deepEqual(
      later.map((h) => h.path),
      found.map((h) => h.path),
    );
    assert.equal(later.filter((h) => "review" in h).length, 2);

    // Confirming a page ends its mark at once, with no sync between.
    const confirmed = await w.kioku(["page", "confirm", plain.out.path, "--brain", ACME], { context: LATER });
    assert.equal(confirmed.out.status, "done", JSON.stringify(confirmed.out));
    assert.equal((await show(w, plain.out.path, LATER)).review, null);

    // A retired page is history: no mark.
    await w.kioku(["page", "retire", dated.out.path, "--brain", ACME]);
    assert.equal((await show(w, dated.out.path)).review, null);
  }));

const touch = (w: World, file: string, session: string, context = {}) =>
  w.kioku(["hook", "pre-tool-path"], {
    stdin: JSON.stringify({
      cwd: w.repo,
      session_id: session,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: join(w.repo, file) },
    }),
    context,
  });
const contextOf = (r: { out: any }): string => r.out?.hookSpecificOutput?.additionalContext ?? "";

test("the line a recall names a page by ends with why it is due a look; not confirmed comes from the recorded report, asked of the page as it is (§4.7)", () =>
  world(async (w) => {
    const dated = await save(
      w,
      MEMORY,
      "Billing rounds each line",
      ["--applies-to", "src/billing/**", "--stale-after", "2026-10-07"],
      LESSON,
    );
    const plain = await save(w, MEMORY, "Checkout holds the cart", ["--applies-to", "src/checkout/**"], LESSON);
    assert.equal(plain.out.status, "done", JSON.stringify(plain.out));
    await w.kioku(["page", "search", "billing"]);

    const due = contextOf(await touch(w, "src/billing/invoice.ts", "a"));
    assert.match(
      due,
      new RegExp(
        `^- Billing rounds each line: .*\\(${ACME}, ${dated.out.path}\\) \\[past its date, 2026-10-07\\]$`,
        "m",
      ),
    );
    assert.match(
      due,
      /A line that ends in brackets is due a second look: .*`kioku page confirm <path> --brain <brain>`/,
    );

    // A page with nothing to say: its line as ever, and no word of marks above it.
    const fresh = contextOf(await touch(w, "src/checkout/cart.ts", "b"));
    assert.match(fresh, new RegExp(`\\(${ACME}, ${plain.out.path}\\)$`, "m"));
    assert.doesNotMatch(fresh, /brackets/);

    // A year on, with no report recorded on this machine: the hook does not read the history, so no mark, and no error.
    const unreported = await touch(w, "src/checkout/cart.ts", "c", LATER);
    assert.equal(unreported.code, 0);
    assert.doesNotMatch(contextOf(unreported), /\[/);

    // Once lint recorded its report, the page is marked, since its last touch.
    assert.equal((await w.kioku(["brain", "lint", ACME], { context: LATER })).code, 0);
    const since = (await show(w, plain.out.path, LATER)).touched;
    assert.match(
      contextOf(await touch(w, "src/checkout/cart.ts", "d", LATER)),
      new RegExp(`\\(${ACME}, ${plain.out.path}\\) \\[not changed or confirmed since ${since}\\]$`, "m"),
    );

    // Confirmed since the report: the report still lists it, and the page as it is says otherwise.
    await w.kioku(["page", "confirm", plain.out.path, "--brain", ACME], { context: LATER });
    const after = contextOf(await touch(w, "src/checkout/cart.ts", "e", LATER));
    assert.match(after, /Checkout holds the cart/);
    assert.doesNotMatch(after, /\[/);
  }));

test("a recall's mark is part of its line, for a prompt as for a file (§4.7)", () => {
  const page = { brain: ACME, path: "memory/acme/a.md", id: null, title: "A", summary: "About a." };
  const text = recallText([{ ...page, review: { reason: "unconfirmed", since: "2025-01-02" } }], "meaning");
  assert.match(
    text,
    /^- A: About a\. \(northwind\/brain-acme, memory\/acme\/a\.md\) \[not changed or confirmed since 2025-01-02\]$/m,
  );
  assert.match(text, /due a second look/);
  assert.doesNotMatch(recallText([page], "meaning"), /due a second look|\[/);
});
