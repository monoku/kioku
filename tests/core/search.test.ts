import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openIndex, indexPath, SCHEMA_VERSION } from "../../src/core/index/db.ts";
import { updateIndex, type IndexedBrain } from "../../src/core/index/indexer.ts";
import { search } from "../../src/core/index/search.ts";
import { similarPages, SIMILAR_LIMIT } from "../../src/core/index/similar.ts";
import { significantWords, stemOf, wordsOf } from "../../src/core/index/text.ts";
import { run } from "../../src/cli/run.ts";
import {
  CONTEXT,
  DECISION,
  MEMORY,
  ctx,
  made,
  put,
  validPages,
  writeBrain,
  type Made,
  scratch as scratchIn,
} from "../fixtures.ts";

const scratch = scratchIn("search");

const MEM = { "What happened": "x", Lesson: "x", "Rule of thumb": "x" };

/** A machine with the §2.5 chain on disk: the personal brain `sam`, the project brain `acme`, the team brain `northwind`, and the project folder. */
function machine(home: string, extra: { acme?: Made[]; sam?: Made[] } = {}) {
  const acme = join(home, ".kioku/brains/northwind/brain-acme");
  writeBrain(
    acme,
    "project",
    [
      ...validPages(),
      made({
        n: 20,
        type: MEMORY,
        title: "Migraciones antes del deploy",
        sections: { ...MEM, Lesson: "Corre las migraciones antes de desplegar." },
      }),
      ...(extra.acme ?? []),
    ],
    "acme",
  );
  const sam = join(home, ".kioku/brains/sam/brain");
  writeBrain(
    sam,
    "personal",
    [
      made({
        n: 30,
        type: MEMORY,
        title: "Prefiero pruebas pequeñas",
        namespace: "sam",
        sections: { ...MEM, Lesson: "Las migraciones largas se parten en pasos." },
      }),
      ...(extra.sam ?? []),
    ],
    "sam",
  );
  const team = join(home, ".kioku/brains/northwind/brain");
  writeBrain(team, "team", [], "northwind");
  writeFileSync(join(acme, "kioku.yaml"), "format: 1\ntier: project\nnamespaces:\n  - acme\n");
  put(
    home,
    ".kioku/config.yaml",
    "brain: github.com/sam/brain\nrepositories:\n  github.com/northwind/brain-acme: {}\n  github.com/northwind/brain: {}\n",
  );
  put(home, "work/acme-api/kioku.yaml", "brain: github.com/northwind/brain-acme\nteam: github.com/northwind/brain\n");
  return { acme, sam, team, repo: join(home, "work/acme-api") };
}

async function kioku(argv: string[], home: string, cwd: string) {
  let raw = "";
  const code = await run(argv, { stdout: (t) => (raw += t), isTty: false }, ctx({ home, cwd }));
  return { code, raw, out: JSON.parse(raw) };
}

const paths = (r: { out: { hits: { path: string }[] } }) => r.out.hits.map((h) => h.path);
const MIGRACIONES = "memory/migraciones-antes-del-deploy.md";

test("`migración`, `migracion`, `MIGRACION` and the prefix `migr` all find `Migraciones antes del deploy`", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    for (const q of ["migración", "migracion", "MIGRACION", "migr"]) {
      const r = await kioku(["page", "search", q], home, repo);
      assert.equal(r.code, 0, q);
      assert.ok(paths(r).includes(MIGRACIONES), q);
    }
  }));

test("a match in the title comes before one only in the body", () =>
  scratch(async (home) => {
    const { repo, acme } = machine(home, {
      acme: [
        made({ n: 21, type: CONTEXT, title: "Notas del cliente", sections: {}, summary: "Notas." }),
        made({ n: 22, type: CONTEXT, title: "Calendario de lanzamientos", sections: {}, summary: "Fechas." }),
      ],
    });
    const notes = "knowledge/acme/context/notas-del-cliente.md";
    put(
      acme,
      notes,
      readFileSync(join(acme, notes), "utf8").replace(
        "## Changelog",
        "Los lanzamientos salen los jueves.\n\n## Changelog",
      ),
    );
    const r = await kioku(["page", "search", "lanzamientos", "--brain", "northwind/brain-acme"], home, repo);
    assert.deepEqual(paths(r), ["knowledge/acme/context/calendario-de-lanzamientos.md", notes]);
  }));

test("a match in an alias outranks one in the summary, which outranks the body", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    const acme = join(home, ".kioku/brains/northwind/brain-acme");
    const page = (n: number, title: string, summary: string, aliases: string[], body: string) => {
      const m = made({ n, type: CONTEXT, title, summary, sections: {} });
      return m.text
        .replace(/^(summary: .*)$/m, `$1${aliases.length ? `\naliases: [${aliases.join(", ")}]` : ""}`)
        .replace("## Changelog", `${body}\n\n## Changelog`);
    };
    put(acme, "knowledge/acme/context/in-alias.md", page(50, "Uno", "Nada.", ["zafiro"], ""));
    put(acme, "knowledge/acme/context/in-summary.md", page(51, "Dos", "Habla del zafiro.", [], ""));
    put(acme, "knowledge/acme/context/in-body.md", page(52, "Tres", "Nada.", [], "Aquí aparece el zafiro."));
    const r = await kioku(["page", "search", "zafiro"], home, repo);
    assert.deepEqual(paths(r), [
      "knowledge/acme/context/in-alias.md",
      "knowledge/acme/context/in-summary.md",
      "knowledge/acme/context/in-body.md",
    ]);
  }));

test("--brain returns that brain's pages alone; without it, the chain's pages, each labelled with its brain", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    const only = await kioku(["page", "search", "migraciones", "--brain", "northwind/brain-acme"], home, repo);
    assert.deepEqual([...new Set(only.out.hits.map((h: { brain: string }) => h.brain))], ["northwind/brain-acme"]);
    const sam = await kioku(["page", "search", "migraciones", "--brain", "sam/brain"], home, repo);
    assert.deepEqual(paths(sam), ["memory/prefiero-pruebas-pequenas.md"]);
    const all = await kioku(["page", "search", "migraciones"], home, repo);
    assert.deepEqual(
      new Set(all.out.hits.map((h: { brain: string }) => h.brain)),
      new Set(["northwind/brain-acme", "sam/brain"]),
    );
    const unknown = await kioku(["page", "search", "x", "--brain", "nope"], home, repo);
    assert.equal(unknown.code, 1);
    assert.equal(unknown.out.error.code, "brain_unknown");
  }));

test("outside a linked repository the personal brain is searched alone", () =>
  scratch(async (home) => {
    machine(home);
    const r = await kioku(["page", "search", "migraciones"], home, home);
    assert.deepEqual([...new Set(r.out.hits.map((h: { brain: string }) => h.brain))], ["sam/brain"]);
  }));

test("deleting the index rebuilds it and answers the same; edits and removals show", () =>
  scratch(async (home) => {
    const { repo, acme } = machine(home);
    const first = await kioku(["page", "search", "migraciones"], home, repo);
    assert.ok(existsSync(indexPath(home)));
    rmSync(indexPath(home));
    for (const f of readdirSync(join(home, ".kioku")))
      if (f.startsWith("index.sqlite")) rmSync(join(home, ".kioku", f));
    const again = await kioku(["page", "search", "migraciones"], home, repo);
    assert.deepEqual(again.out, first.out);

    writeFileSync(
      join(acme, MIGRACIONES),
      readFileSync(join(acme, MIGRACIONES), "utf8").replace(
        "Corre las migraciones",
        "Corre las migraciones y los zafiros",
      ),
    );
    assert.ok(
      paths(await kioku(["page", "search", "zafiros"], home, repo)).includes(MIGRACIONES),
      "an edit is reflected",
    );

    rmSync(join(acme, MIGRACIONES));
    assert.ok(
      !paths(await kioku(["page", "search", "migraciones", "--brain", "northwind/brain-acme"], home, repo)).includes(
        MIGRACIONES,
      ),
      "a removed page is gone",
    );
    put(
      acme,
      "memory/nueva.md",
      made({ n: 60, type: MEMORY, title: "Nueva lección de migraciones", sections: MEM }).text,
    );
    assert.ok(
      paths(await kioku(["page", "search", "migraciones", "--brain", "northwind/brain-acme"], home, repo)).includes(
        "memory/nueva.md",
      ),
      "a page saved a moment ago is found",
    );
  }));

test("a corrupt index, and one of another schema version, are rebuilt without a word", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    const first = await kioku(["page", "search", "migraciones"], home, repo);

    writeFileSync(indexPath(home), "this is not a database");
    const afterCorrupt = await kioku(["page", "search", "migraciones"], home, repo);
    assert.equal(afterCorrupt.code, 0);
    assert.deepEqual(afterCorrupt.out, first.out);

    const db = new DatabaseSync(indexPath(home));
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    db.close();
    const afterOld = await kioku(["page", "search", "migraciones"], home, repo);
    assert.deepEqual(afterOld.out, first.out);
    const check = new DatabaseSync(indexPath(home));
    assert.equal((check.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
    check.close();
  }));

test("a --json result holds the mode and the hits, each with brain, path, title, kind, subkind and snippet; nothing else is printed", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    const r = await kioku(["page", "search", "migraciones", "--brain", "northwind/brain-acme"], home, repo);
    assert.deepEqual(Object.keys(r.out), ["mode", "reason", "hits", "limit", "more"]);
    assert.equal(r.out.mode, "full-text");
    assert.match(
      r.out.reason,
      /the search model is not on this machine yet; the next sync fetches it \(about \d+ MB\)/,
    );
    assert.ok(Array.isArray(r.out.hits));
    assert.equal(r.raw.trim().split("\n").length, 1, "one JSON value and nothing else");
    const hit = r.out.hits.find((h: { path: string }) => h.path === MIGRACIONES);
    assert.equal(hit.brain, "northwind/brain-acme");
    assert.equal(hit.title, "Migraciones antes del deploy");
    assert.equal(hit.kind, "memory");
    assert.equal(hit.subkind, null);
    assert.match(hit.snippet, /\[migraciones\]/i);
    const decision = r.out.hits.find((h: { path: string }) => h.path.includes("decisions"));
    if (decision) assert.equal(decision.subkind, "decision");
    assert.deepEqual((await kioku(["page", "search", "zzzzqqq"], home, repo)).out.hits, []);
  }));

test("text output names the brain, the path, the kind, the title and the snippet", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    let raw = "";
    await run(
      ["page", "search", "migraciones", "--brain", "northwind/brain-acme"],
      { stdout: (t) => (raw += t), isTty: true },
      ctx({ home, cwd: repo }),
    );
    assert.match(
      raw,
      /^Migraciones antes del deploy +northwind\/brain-acme · memory\n  memory\/migraciones-antes-del-deploy\.md\n  \[Migraciones\] antes del deploy/m,
    );
    assert.match(
      raw,
      /\nFull text only: the search model is not on this machine yet; the next sync fetches it \(about \d+ MB\)\.\n$/,
    );
    raw = "";
    await run(["page", "search", "zzzzqqq"], { stdout: (t) => (raw += t), isTty: true }, ctx({ home, cwd: repo }));
    assert.match(
      raw,
      /^Nothing found for "zzzzqqq" in sam\/brain \(personal\), northwind\/brain-acme \(project\), northwind\/brain \(team\)\.\nFull text only: /,
    );
  }));

test("search with several words wants them all, and falls back to any of them; odd characters are harmless", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    const both = await kioku(["page", "search", "migraciones deploy", "--brain", "northwind/brain-acme"], home, repo);
    assert.deepEqual(paths(both), [MIGRACIONES]);
    const some = await kioku(["page", "search", "migraciones zafiro", "--brain", "northwind/brain-acme"], home, repo);
    assert.ok(paths(some).includes(MIGRACIONES), "the pages with some of the words, when none has them all");
    for (const q of ['"migraciones" OR (deploy', "migr*", "NEAR(a b)", "a:b", "'; DROP TABLE pages;--"])
      assert.equal((await kioku(["page", "search", q], home, repo)).code, 0, q);
    assert.equal((await kioku(["page", "search", "***"], home, repo)).out.hits.length, 0);
    const none = await kioku(["page", "search"], home, repo);
    assert.equal(none.out.error.code, "usage");
    assert.equal((await kioku(["page", "search", "x", "--limit", "0"], home, repo)).out.error.code, "usage");
    assert.equal((await kioku(["page", "search", "migraciones", "--limit", "1"], home, repo)).out.hits.length, 1);
  }));

test("indexing is by hash: unchanged pages are left alone and a page that cannot be read is left out", () =>
  scratch(async (home) => {
    const { acme } = machine(home);
    put(acme, "memory/broken.md", "# no front matter\n");
    const brains: IndexedBrain[] = [{ key: "northwind/brain-acme", root: acme }];
    const index = await openIndex(home);
    try {
      const first = updateIndex(index, brains);
      assert.equal(first.removed, 0);
      assert.ok(first.indexed >= 9);
      const second = updateIndex(index, brains);
      assert.deepEqual([second.indexed, second.removed], [0, 0]);
      assert.equal(second.unchanged, first.indexed);
      writeFileSync(join(acme, MIGRACIONES), readFileSync(join(acme, MIGRACIONES), "utf8") + "\nmás\n");
      rmSync(join(acme, "memory/run-migrations-before-the-deploy.md"));
      const third = updateIndex(index, brains);
      assert.deepEqual([third.indexed, third.removed], [1, 1]);
      assert.equal(search(index, "broken", [brains[0]!.key]).length, 0);
    } finally {
      index.close();
    }
  }));

test("similar pages come from full text alone: a title holding every word of the new title first, then by the share of its words (§4.3)", () =>
  scratch(async (home) => {
    // Three pages holding every word of the new page, title and alias, in their summary; one whose title holds every word
    // of the new title but not its alias, so that by overlap alone it would come last.
    const party = [80, 81, 82].map((n) =>
      made({
        n,
        type: CONTEXT,
        title: `Party ${n} at the office`,
        sections: {},
        summary: "The office wifi router during the weekend party, a fiesta.",
      }),
    );
    const strong = made({ n: 83, type: CONTEXT, title: "Office wifi router", sections: {}, summary: "The router." });
    const { acme } = machine(home, { acme: [...party, strong] });
    const key = "northwind/brain-acme";
    const index = await openIndex(home);
    try {
      updateIndex(index, [{ key, root: acme }]);
      const found = similarPages(index, key, { title: "Office wifi router", aliases: ["fiesta"] });
      assert.equal(found[0]!.path, strong.path, "the title that holds every word comes first");
      assert.deepEqual(
        new Set(found.map((h) => h.path)),
        new Set([...party, strong].map((p) => p.path)),
        "among the same pages",
      );
    } finally {
      index.close();
    }
  }));

// The similar-pages query for the writing verbs (§1.4).
test("similar pages: the decision of §2.5 for `Run migrations before deploying`, nothing for `Office wifi password location`", () =>
  scratch(async (home) => {
    const { acme } = machine(home, {
      acme: [
        made({
          n: 70,
          type: DECISION,
          title: "Run migrations before the deploy",
          sections: { Decision: "Before, not after.", Why: "It broke once.", Consequences: "None." },
        }),
      ],
    });
    const key = "northwind/brain-acme";
    const index = await openIndex(home);
    try {
      updateIndex(index, [{ key, root: acme }]);
      const similar = similarPages(index, key, { title: "Run migrations before deploying" });
      assert.ok(
        similar.some((h) => h.path === "knowledge/acme/decisions/run-migrations-before-the-deploy.md"),
        "the decision is found",
      );
      assert.ok(
        similar.every((h) => h.path.includes("run-migrations-before-the-deploy")),
        "and only pages on that subject",
      );
      assert.ok(similar.length <= SIMILAR_LIMIT);
      assert.ok(!similar.some((h) => h.path.includes("no-prod-migrations")), "one shared word is not the same subject");
      assert.deepEqual(similarPages(index, key, { title: "Office wifi password location" }), []);
      assert.deepEqual(similarPages(index, key, { title: "the of and" }), []);
      // Aliases carry the subject across languages.
      const viaAlias = similarPages(index, key, {
        title: "Antes de desplegar",
        aliases: ["Migraciones antes del deploy"],
      });
      assert.ok(viaAlias.some((h) => h.path === MIGRACIONES));
      // A title too short to tell is helped by the body.
      const viaBody = similarPages(index, key, { title: "Deploy", body: "migraciones antes del deploy siempre" });
      assert.ok(viaBody.some((h) => h.path === MIGRACIONES));
      // Another brain's pages are never similar.
      assert.deepEqual(similarPages(index, "sam/brain", { title: "Run migrations before deploying" }), []);
    } finally {
      index.close();
    }
  }));

test("words: folded, significant, and stems that meet across forms", () => {
  assert.deepEqual(wordsOf("Migración, ¡DEPLOY! año 2026"), ["migracion", "deploy", "ano", "2026"]);
  assert.deepEqual(significantWords("The Run of the migrations, la migración y el run"), [
    "run",
    "migrations",
    "migracion",
  ]);
  assert.equal(stemOf("deploying"), "deploy");
  assert.equal(stemOf("run"), "run");
  assert.ok(stemOf("migrations").startsWith(stemOf("migrate")) || stemOf("migrate").startsWith(stemOf("migrations")));
  assert.ok(
    stemOf("migraciones").startsWith(stemOf("migración")) || stemOf("migración").startsWith(stemOf("migraciones")),
  );
});

// No code the hooks import opens the index or fetches or runs the model (§4.3): the SessionStart summary and the
// journal read files only. The prompt's recall (§4.7) is imported by its hook when it runs, never at the start.
test("the hooks' imports never reach the index or the model's code, and running SessionStart creates no index file", () =>
  scratch(async (home) => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      // `import type` is erased: it reaches nothing at run time.
      for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export)(?! type)[^;]*? from "(\.[^"]+)"/gm))
        walk(resolve(dirname(file), m[1]!));
    };
    walk(resolve(import.meta.dirname, "../../src/cli/hook.ts"));
    const reached = [...seen].map((f) => f.slice(resolve(import.meta.dirname, "../..").length + 1));
    for (const real of ["src/core/session/start.ts", "src/core/semantic/status.ts"])
      assert.ok(reached.includes(real), `the walk found the hook's real imports: ${real}`);
    assert.deepEqual(
      reached.filter((f) => f.includes("core/index/") || f.endsWith("cli/search.ts")),
      [],
    );
    assert.deepEqual(
      reached.filter((f) => /semantic\/(embedder|install|tar|refresh|meaning)\.ts$/.test(f)),
      [],
    );

    await run(["hook", "session-start"], { stdout: () => {}, isTty: false }, ctx({ home }));
    assert.equal(existsSync(indexPath(home)), false);
  }));

test("a search answers the best 20 unless --limit says, and says whether there are more behind them (§6.1)", () =>
  scratch(async (home) => {
    const { repo } = machine(home);
    let words = "";
    let all = await kioku(["page", "search", "x", "--limit", "50"], home, repo);
    for (const w of ["postgres", "deploy", "migraciones", "acme", "the", "database", "page"]) {
      all = await kioku(["page", "search", w, "--limit", "50"], home, repo);
      if (all.out.hits.length >= 2) {
        words = w;
        break;
      }
    }
    assert.notEqual(words, "", "some word of the fixture finds two pages");
    assert.deepEqual([all.out.limit, all.out.more], [50, false]);
    const one = await kioku(["page", "search", words, "--limit", "1"], home, repo);
    assert.equal(one.out.hits.length, 1);
    assert.equal(one.out.more, true);
    assert.equal(one.out.hits[0].path, all.out.hits[0].path);
    assert.equal((await kioku(["page", "search", words], home, repo)).out.limit, 20);
    assert.equal(
      (await kioku(["page", "search", words, "--offset", "1"], home, repo)).out.error.code,
      "usage",
      "a search does not page",
    );
  }));
