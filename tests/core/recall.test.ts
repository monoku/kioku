import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { readJournal, record } from "../../src/core/session/journal.ts";
import { NOTICE_NAMES } from "../../src/core/config/machine.ts";
import { indexPath } from "../../src/core/state.ts";
import {
  asksRecall,
  RECALL_TUNING,
  recallable,
  recallText,
  sharesWord,
  standOut,
  standOutByWords,
  wordStanding,
  zScores,
  type RecallTuning,
} from "../../src/core/session/recall.ts";
import { openIndex, SCHEMA_VERSION } from "../../src/core/index/db.ts";
import { keyOf, partsOf, vectorStore } from "../../src/core/index/vectors.ts";
import { readReads } from "../../src/core/reads.ts";
import { CONTEXT, made, validPages } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { fakeSemantic, type FakeSemantic } from "../semantic.ts";
import { world, type World } from "../world.ts";

isolateGit();

/** The §2.5 machine with a page on a subject of the stand-in model's own: the office wifi. */
const PAGES = [
  ...validPages().filter((p) => !p.path.startsWith("memory/run-migrations")),
  made({
    n: 70,
    type: CONTEXT,
    title: "Office wifi password location",
    sections: {},
    summary: "Where the wifi password is.",
  }),
];
const WIFI = "knowledge/acme/context/office-wifi-password-location.md";

/** Among the few pages of a test the spec's numbers say nothing (§4.7): these let one page stand out. */
const FEW: RecallTuning = { z: 1.5, alone: 1.5, max: 3, minPages: 2, budgetMs: 10_000 };

const recallWorld = <T>(fn: (w: World, f: FakeSemantic) => Promise<T>) =>
  world(
    async (w) => {
      const f = fakeSemantic(join(w.dir, "served"));
      return fn(w, f);
    },
    { acmePages: PAGES },
  );

const prompt = (w: World, f: FakeSemantic, text: string, o: { cwd?: string; tuning?: RecallTuning } = {}) =>
  w.kioku(["hook", "user-prompt-submit"], {
    stdin: JSON.stringify({ cwd: o.cwd ?? w.repo, prompt: text, session_id: "s", hook_event_name: "UserPromptSubmit" }),
    context: { semantic: f.deps, recall: o.tuning ?? FEW },
  });
const contextOf = (r: { out: any }): string => r.out?.hookSpecificOutput?.additionalContext ?? "";
const ASK = "where is the office wifi password kept these days?";

test("a page's z is how far its score is above the mean of the session's pages, in standard deviations (§4.7)", () => {
  const page = (n: number, score: number) => ({ brain: "b", path: `p${n}.md`, score });
  const z = zScores([page(1, 1), page(2, 2), page(3, 3)]);
  assert.equal(z.get(keyOf(page(2, 0))), 0);
  assert.ok(Math.abs(z.get(keyOf(page(3, 0)))! - Math.sqrt(1.5)) < 1e-9);
  assert.deepEqual(zScores([page(1, 0.5), page(2, 0.5)]), new Map(), "all alike: none stands out");
});

test("a page stands out with a word of the prompt, or far enough without; the furthest first, three at most, none skipped (§4.7)", () => {
  const at = (n: number, z: number) => ({ brain: "b", path: `p${n}.md`, z });
  const { z, alone, max } = RECALL_TUNING;
  const tuning = { z, alone, max };
  const yes = () => true;
  const no = () => false;
  const between = (z + alone) / 2;
  assert.deepEqual(standOut([at(1, z - 0.1)], no, yes, tuning), [], "below it, nothing");
  assert.deepEqual(
    standOut([at(1, between)], no, yes, tuning).map((p) => p.path),
    ["p1.md"],
    "with a word in common",
  );
  assert.deepEqual(standOut([at(1, between)], no, no, tuning), [], "with none, it only sounds like the subject");
  assert.deepEqual(
    standOut([at(1, alone)], no, no, tuning).map((p) => p.path),
    ["p1.md"],
    "far enough, no word is needed",
  );
  assert.deepEqual(standOut([at(1, alone)], yes, yes, tuning), [], "a skipped page is not named");
  assert.deepEqual(
    standOut([at(1, z), at(2, z + 3), at(3, z + 1), at(4, z + 2)], no, yes, tuning).map((p) => p.path),
    ["p2.md", "p4.md", "p3.md"],
    "three at most, the furthest first",
  );
});

test("a page shares a word with the prompt by stem, whatever form each has, in both languages (§4.7)", () => {
  const shares = (prompt: string, title: string, summary = "") => sharesWord(prompt)({ title, summary });
  assert.equal(shares("how are we deploying this", "Deploys run after the migrations"), true);
  assert.equal(shares("how do I deploy this", "Deploying to production"), true);
  assert.equal(shares("fix the billing webhook", "Retries", "Webhooks are retried three times."), true);
  assert.equal(shares("corre las migraciones ahora", "Migración antes del deploy"), true);
  assert.equal(shares("configura el linter del repo", "Configuración de Biome"), true);
  // A stopword, or nothing in common, is no word in common.
  assert.equal(shares("what is the status of this", "The deploy is on Fridays"), false);
  assert.equal(shares("rename the column please", "Deploying to production"), false);
});

test("a page's parts are its summary and each section but those the tool keeps, each under its title (§4.3)", () => {
  const body =
    "## What happened\n\nThe report locked the table.\n\n## Rule of thumb\n\nWhen checkout slows at a round hour, look for a job.\n\n## Evidence\n\n- said so\n\n## See also\n\n- [x](x.md)\n\n## Changelog\n\n- made";
  assert.deepEqual(partsOf({ title: "The nightly report", summary: "A report held a lock.", body }), [
    "The nightly report: A report held a lock.",
    "The nightly report\n\nWhat happened: The report locked the table.",
    "The nightly report\n\nRule of thumb: When checkout slows at a round hour, look for a job.",
  ]);
  assert.deepEqual(partsOf({ title: "Bare", summary: "", body: "Just text." }), [], "neither summary nor sections");
});

test("each page with parts is scored by its part nearest the prompt; a page's parts are replaced, never added to (§4.3)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-parts-"));
  const index = await openIndex(dir);
  try {
    const store = vectorStore(index, "m");
    const v = (...xs: number[]) => Float32Array.from(xs);
    const a = { brain: "b", path: "a.md" };
    const b = { brain: "b", path: "b.md" };
    store.upsertParts(a, "h", [v(1, 0), v(0.6, 0.8)]);
    store.upsertParts(b, "h", [v(0, 1)]);
    const best = store.bestParts(v(1, 0));
    assert.deepEqual(best, [
      { ...a, score: 1 },
      { ...b, score: 0 },
    ]);
    assert.deepEqual(store.bestParts(v(1, 0), [b]), [{ ...b, score: 0 }], "among the pages asked for");
    store.upsertParts(a, "h2", [v(0, 1)]);
    assert.deepEqual(store.bestParts(v(1, 0), [a]), [{ ...a, score: 0 }], "the old parts are gone");
    assert.equal(vectorStore(index, "other").bestParts(v(1, 0)).length, 0, "another model's parts are not read");
  } finally {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a command or a prompt of a word or two asks for no recall (§4.7)", () => {
  assert.equal(asksRecall("/kioku-search office wifi password"), false);
  assert.equal(asksRecall("  /compact the session now"), false);
  assert.equal(asksRecall("yes please"), false);
  assert.equal(asksRecall("where is the wifi password?"), true);
});

test("a prompt brings the page that stands out by meaning, one line and never its text, as an entry of the journal and counted as surfaced (§4.5, §4.6, §4.7)", () =>
  recallWorld(async (w, f) => {
    assert.equal(
      contextOf(await prompt(w, f, ASK)),
      "",
      "without the search model, no recall: the hook never fetches it",
    );
    assert.deepEqual(f.calls, []);

    assert.equal((await w.kioku(["sync", "--cwd", w.repo], { context: { semantic: f.deps } })).code, 0);
    // A sync embeds each page and its parts together (§4.3).
    const index = await openIndex(w.home);
    try {
      const n = (sql: string) => (index.db.prepare(sql).get() as { n: number }).n;
      assert.ok(n("SELECT count(*) AS n FROM parts") > n("SELECT count(*) AS n FROM vectors"), "more parts than pages");
      assert.equal(
        n("SELECT count(*) AS n FROM parts WHERE path NOT IN (SELECT path FROM vectors)"),
        0,
        "no part without its page",
      );
    } finally {
      index.close();
    }
    const r = await prompt(w, f, ASK);
    assert.equal(r.code, 0);
    const text = contextOf(r);
    assert.match(text, /^## Kioku: pages that may bear on this prompt\n/);
    assert.match(text, /`kioku page show <path> --brain <brain>` before relying on it/);
    assert.match(
      text,
      /^- Office wifi password location: Where the wifi password is\. \(northwind\/brain-acme, knowledge\/acme\/context\/office-wifi-password-location\.md\)$/m,
    );
    // The person sees that the agent was given pages, under their message: the history's row (§1.2).
    assert.equal(r.out.systemMessage, "\n⬢ kioku.md ↓ recalled  by meaning · 1 page (project)");

    const recalled = readJournal(w.home, "s").filter((e) => e.what === "recalled");
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0]!.arrow, "read");
    assert.deepEqual(recalled[0]!.hits?.map((h) => h.path).includes(WIFI), true);
    const journal = readFileSync(join(w.home, ".kioku/sessions/s.jsonl"), "utf8");
    assert.ok(!journal.includes("these days"), "the prompt is kept nowhere");
    const counted = Object.values(readReads(w.home)!.brains).flatMap((b) => Object.values(b));
    assert.ok(counted.some((e) => e.surfaced === 1));

    assert.equal(contextOf(await prompt(w, f, ASK)), "", "a page already recalled in this session is not named again");
  }));

test("no recall inside a brain, for a command, among too few pages, or past the budget (§4.7)", () =>
  recallWorld(async (w, f) => {
    await w.kioku(["sync", "--cwd", w.repo], { context: { semantic: f.deps } });
    assert.equal(contextOf(await prompt(w, f, `/kioku-search ${ASK}`)), "");
    assert.equal(contextOf(await prompt(w, f, ASK, { cwd: join(w.acme, "knowledge/acme") })), "", "inside a brain");
    assert.equal(contextOf(await prompt(w, f, ASK, { tuning: { ...FEW, minPages: 10_000 } })), "", "too few pages");
    // A model that takes longer than the budget: the hook gives up and adds nothing.
    const slow = {
      ...f.deps,
      loadEmbedder: async (...a: Parameters<typeof f.deps.loadEmbedder>) => {
        const e = await f.deps.loadEmbedder(...a);
        return { ...e, embed: async (...b: Parameters<typeof e.embed>) => (await sleep(300), e.embed(...b)) };
      },
    };
    const late = await w.kioku(["hook", "user-prompt-submit"], {
      stdin: JSON.stringify({ cwd: w.repo, prompt: ASK, session_id: "s" }),
      context: { semantic: slow, recall: { ...FEW, budgetMs: 50 } },
    });
    assert.equal(contextOf(late), "", "past the budget");
    assert.equal(readJournal(w.home, "s").filter((e) => e.what === "recalled").length, 0, "and nothing in the journal");
    assert.equal(
      contextOf(await prompt(w, f, ASK, { tuning: RECALL_TUNING })),
      "",
      "the spec's numbers, on a few pages",
    );
  }));

test("a Rule, a retired page and a superseded one are never recalled (§4.7)", () => {
  assert.equal(recallable({ kind: "memory", status: null }), true);
  assert.equal(recallable({ kind: "rule", status: null }), false, "a Rule is whole in every summary");
  assert.equal(recallable({ kind: "memory", status: "deprecated" }), false, "retired");
  assert.equal(recallable({ kind: "knowledge", status: "superseded" }), false, "superseded");
});

test("a page the session opened, one retired since, and one changed since its vector are not recalled (§4.7)", () =>
  recallWorld(async (w, f) => {
    const sync = () => w.kioku(["sync", "--cwd", w.repo], { context: { semantic: f.deps } });
    await sync();
    const recalls = async (session: string) =>
      contextOf(
        await w.kioku(["hook", "user-prompt-submit"], {
          stdin: JSON.stringify({ cwd: w.repo, prompt: ASK, session_id: session }),
          context: { semantic: f.deps, recall: FEW },
        }),
      ).includes(WIFI);
    assert.equal(await recalls("fresh"), true, "the page stands out at first");

    record(
      w.home,
      "opened",
      [{ what: "opened", arrow: "read", brain: "northwind/brain-acme", path: WIFI }],
      new Date(),
    );
    assert.equal(await recalls("opened"), false, "already opened in this session");

    // Changed since its vector was made: the index has its new text, its vector the old one.
    const index = await openIndex(w.home);
    try {
      index.db.prepare("UPDATE pages SET hash = 'changed' WHERE path = ?").run(WIFI);
    } finally {
      index.close();
    }
    assert.equal(await recalls("changed"), false, "a page waits for the vector of its current text");

    await sync();
    assert.equal((await w.kioku(["page", "retire", WIFI, "--brain", "northwind/brain-acme"])).code, 0);
    await sync();
    assert.equal(await recalls("retired"), false, "a retired page is history");
  }));

test("the recall never creates, rebuilds or writes the index: one missing or of another version waits for sync (§4.7)", () =>
  recallWorld(async (w, f) => {
    await w.kioku(["sync", "--cwd", w.repo], { context: { semantic: f.deps } });
    const versionOf = async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(indexPath(w.home));
      try {
        return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      } finally {
        db.close();
      }
    };
    const old = SCHEMA_VERSION - 1;
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(indexPath(w.home));
    db.exec(`PRAGMA user_version = ${old}`);
    db.close();
    assert.equal(contextOf(await prompt(w, f, ASK)), "", "an index of another version: nothing");
    assert.equal(await versionOf(), old, "and it is left as it was, for sync to rebuild");

    for (const suffix of ["", "-wal", "-shm"]) rmSync(indexPath(w.home) + suffix, { force: true });
    assert.equal(contextOf(await prompt(w, f, ASK)), "", "no index: nothing");
    assert.equal(existsSync(indexPath(w.home)), false, "and none is made");
  }));

test("what a prompt recalled is said whatever display.mute holds: a read, as the summary is (§1.2)", () =>
  recallWorld(async (w, f) => {
    await w.kioku(["sync", "--cwd", w.repo], { context: { semantic: f.deps } });
    const path = join(w.home, ".kioku/config.yaml");
    writeFileSync(path, `${readFileSync(path, "utf8")}display:\n  mute: [${NOTICE_NAMES.join(", ")}]\n`);
    const r = await prompt(w, f, ASK);
    assert.match(r.out.systemMessage, /⬢ kioku\.md ↓ recalled {2}by meaning · 1 page \(project\)/);
  }));

test("a page's words in common with a prompt weigh by how few pages hold each: one page alone 1, half of them nothing (§4.7)", () => {
  const page = (title: string, summary = "", aliases = "") => ({ title, summary, aliases });
  const pages = [
    page("When a refund fails", "Check the provider's dashboard first."),
    page("Deploy the app", "The steps of a deploy."),
    page("The app's environments", "", "stages"),
    page("Who works on the app"),
    page("Rounding each line", "Invoices a cent off."),
    page("Partners who call the API"),
  ];
  const standing = wordStanding("the customer's refund failed on the app, what now", pages);
  // `refund` and `failed` meet one page, by stem; `app` meets half of them and weighs nothing.
  assert.deepEqual(
    standing.map((x) => [x.page.title, x.words, Number(x.weight.toFixed(2))]),
    [["When a refund fails", 2, 2]],
  );
  // One word in common is not a subject in common, whatever it weighs.
  assert.deepEqual(wordStanding("where are the invoices kept", pages), []);
  // An alias is a name of the page as its title is.
  assert.equal(wordStanding("the stages of our environments", pages)[0]?.page.title, "The app's environments");
  // A stopword is no word, and among a page or two nothing is rare.
  assert.deepEqual(wordStanding("what is the who of this", pages), []);
  assert.deepEqual(wordStanding("refund fails", pages.slice(0, 2)), []);
});

test("by words a page stands out when heavy enough and near the heaviest; three at most, none skipped (§4.7)", () => {
  const standing = [3, 2.5, 1.9, 1.6, 1.4].map((weight, i) => ({ id: i, weight }));
  const ids = (skip: number[], t = { weight: 1.5, near: 0, max: 3 }) =>
    standOutByWords(standing, (x) => skip.includes(x.id), t).map((x) => x.id);
  assert.deepEqual(ids([]), [0, 1, 2], "three at most, the heaviest first");
  assert.deepEqual(ids([0, 1]), [2, 3], "not the ones skipped, nor one too light");
  assert.deepEqual(ids([], { weight: 1.5, near: 2 / 3, max: 3 }), [0, 1], "only those near the heaviest");
  assert.deepEqual(ids([0], { weight: 1.5, near: 2 / 3, max: 3 }), [1], "near the heaviest, skipped or not");
  assert.deepEqual(
    standOutByWords([], () => false, { weight: 1.5, near: 0.5, max: 3 }),
    [],
  );
});

test("where meaning cannot run, a prompt brings the pages that stand out by its words, and the row and the journal say so (§4.6, §4.7)", () =>
  recallWorld(async (w, f) => {
    await w.kioku(["sync", "--cwd", w.repo], { context: { semantic: f.deps } });
    // The index is there and the engine does not load: what a machine kept to full text, or still fetching, has.
    const noModel = {
      ...f.deps,
      loadEmbedder: async () => {
        throw new Error("no engine here");
      },
    };
    const ask = (text: string, session: string, tuning: RecallTuning = FEW) =>
      w.kioku(["hook", "user-prompt-submit"], {
        stdin: JSON.stringify({ cwd: w.repo, prompt: text, session_id: session }),
        context: { semantic: noModel, recall: tuning },
      });
    const r = await ask(ASK, "words");
    assert.equal(r.code, 0);
    const text = contextOf(r);
    assert.match(text, /^Found by the words of this prompt in the brains of this session\./m);
    assert.match(
      text,
      /^- Office wifi password location: Where the wifi password is\. \(northwind\/brain-acme, knowledge\/acme\/context\/office-wifi-password-location\.md\)$/m,
    );
    assert.match(r.out.systemMessage, /^\n⬢ kioku\.md ↓ recalled {2}by words · \d pages? \(/);
    const entry = readJournal(w.home, "words").find((e) => e.what === "recalled")!;
    assert.equal(entry.by, "words");
    assert.ok(entry.hits?.some((h) => h.path === WIFI));
    assert.ok(!readFileSync(join(w.home, ".kioku/sessions/words.jsonl"), "utf8").includes("these days"));

    assert.equal(contextOf(await ask(ASK, "words")), "", "a page already recalled in this session is not named again");
    assert.equal(
      contextOf(await ask("please rename this variable to camelCase", "none")),
      "",
      "no page holds its words",
    );
    assert.equal(
      contextOf(await ask(ASK, "few", { ...FEW, minPages: 10_000 })),
      "",
      "too few pages: the summary names them",
    );
  }));

test("a recalled page's line is one line whatever its title holds: a page cannot add a line or a heading (§4.7)", () => {
  const text = recallText([
    { brain: "northwind/brain-acme", path: "a.md", id: null, title: "One\n## Two\n\nThree", summary: "Its\nsummary." },
  ]);
  const lines = text.split("\n");
  assert.equal(lines.at(-1), "- One ## Two Three: Its summary. (northwind/brain-acme, a.md)");
  assert.equal(lines.filter((l) => l.startsWith("#")).length, 1, "the hook's own heading alone");
});
