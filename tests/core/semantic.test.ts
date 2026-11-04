import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { realDoctorEnv, runDoctor } from "../../src/core/doctor.ts";
import { openIndex } from "../../src/core/index/db.ts";
import { blend, STRONG_TEXT_PLACE } from "../../src/core/index/hybrid.ts";
import { coverageOf } from "../../src/core/index/coverage.ts";
import { loadEmbedder } from "../../src/core/semantic/embedder.ts";
import { installSemantic } from "../../src/core/semantic/install.ts";
import type { PackagePin } from "../../src/core/semantic/pins.ts";
import { semanticStatus } from "../../src/core/semantic/status.ts";
import { extractTgz } from "../../src/core/semantic/tar.ts";
import { enginePath, modelsPath, semanticStatePath } from "../../src/core/state.ts";
import { CONTEXT, MEMORY, made, validPages } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { engineLoaded, fakeSemantic, lastEmbedCall, TEST_PLATFORM, type FakeSemantic } from "../semantic.ts";
import { world, type World } from "../world.ts";

isolateGit();

const MEM = { "What happened": "x", Lesson: "x", "Rule of thumb": "x" };

/** The §2.5 machine, with pages on two subjects written in both languages. */
const PAGES = [
  ...validPages().filter((p) => !p.path.startsWith("memory/run-migrations")),
  made({
    n: 70,
    type: CONTEXT,
    title: "Office wifi password location",
    sections: {},
    summary: "Where the wifi password is.",
  }),
  made({
    n: 71,
    type: CONTEXT,
    title: "Oficina: horario de la oficina",
    sections: {},
    summary: "La oficina abre a las nueve; horario de la oficina.",
  }),
  made({
    n: 72,
    type: MEMORY,
    title: "Migraciones antes del deploy",
    sections: { ...MEM, Lesson: "Corre las migraciones antes de desplegar." },
  }),
  made({
    n: 73,
    type: CONTEXT,
    title: "Deploy party before the weekend",
    sections: {},
    summary: "Every deploy before the weekend ends in a party.",
  }),
];
const WIFI = "knowledge/acme/context/office-wifi-password-location.md";
const HOURS = "knowledge/acme/context/oficina-horario-de-la-oficina.md";
const MIGRACIONES = "memory/migraciones-antes-del-deploy.md";
const PARTY = "knowledge/acme/context/deploy-party-before-the-weekend.md";

type Run = (argv: string[], o?: { stdin?: string; tty?: boolean }) => ReturnType<World["kioku"]>;

/** The world of §2.5 with a stand-in engine and model served from disk; `k` runs the tool with them. */
const semanticWorld = <T>(fn: (w: World, f: FakeSemantic, k: Run) => Promise<T>) =>
  world(
    async (w) => {
      const f = fakeSemantic(join(w.dir, "served"));
      const k: Run = (argv, o = {}) => w.kioku(argv, { ...o, context: { semantic: f.deps } });
      return fn(w, f, k);
    },
    { acmePages: PAGES },
  );

const sync = (w: World, k: Run) => k(["sync", "--cwd", w.repo]);
const pathsOf = (r: { out: { hits: { path: string }[] } }) => r.out.hits.map((h) => h.path);
const doctor = (w: World, f: FakeSemantic, name = "embedding model") => {
  const r = runDoctor({
    ...realDoctorEnv(w.home, undefined, w.home),
    semantic: { pins: f.pins, platform: TEST_PLATFORM },
  });
  return r.checks.find((c) => c.name === name)!;
};

test("without the engine and model, search says full text and doctor says what is missing and how it comes", () =>
  semanticWorld(async (w, f, k) => {
    const r = await k(["page", "search", "wifi"]);
    assert.equal(r.out.mode, "full-text");
    assert.match(r.out.reason, /not on this machine yet; the next sync fetches it/);
    assert.deepEqual(pathsOf(r), [WIFI]);
    const c = doctor(w, f);
    assert.equal(c.state, "warn");
    assert.match(c.detail, /not on this machine yet/);
    assert.match(c.fix!, /`kioku sync` fetches it into ~\/\.kioku\/ \(about \d+ MB, once\)/);
    assert.deepEqual(f.calls, [], "search never fetches");
  }));

test("one sync fetches and verifies the engine and model, embeds every page, and search turns hybrid", () =>
  semanticWorld(async (w, f, k) => {
    const s = await sync(w, k);
    assert.equal(s.code, 0, s.raw);
    assert.deepEqual(s.out.semantic, { mode: "hybrid", fetched: ["engine", "model"], embedded: 14 });
    assert.equal(f.calls.length, 3 + 3, "three packages and three model files");

    assert.ok(
      existsSync(join(enginePath(w.home), "node_modules/@huggingface/transformers/dist/transformers.node.mjs")),
    );
    assert.ok(
      existsSync(
        join(enginePath(w.home), "node_modules/onnxruntime-node/bin/napi-v6/test/x64/onnxruntime_binding.node"),
      ),
    );
    assert.ok(
      existsSync(join(enginePath(w.home), "node_modules/sharp/index.js")),
      "the stand-in for the image library",
    );
    assert.ok(
      !existsSync(join(enginePath(w.home), "node_modules/@huggingface/transformers/dist/transformers.web.js")),
      "only what runs is kept",
    );
    assert.ok(
      !existsSync(join(enginePath(w.home), "node_modules/onnxruntime-node/bin/napi-v6/other")),
      "only this platform's native files",
    );
    assert.ok(existsSync(join(modelsPath(w.home), "test/model/onnx/model_quantized.onnx")));
    assert.deepEqual(
      readdirSync(join(w.home, ".kioku")).filter((n) => n.includes("partial")),
      [],
      "no scratch folder is left",
    );
    assert.equal(semanticStatus(w.home, f.pins, TEST_PLATFORM).ready, true);
    assert.equal(doctor(w, f).state, "ok");
    assert.match(doctor(w, f).detail, /checksums verified/);

    const index = await openIndex(w.home);
    try {
      const pages = (index.db.prepare("SELECT count(*) AS n FROM pages").get() as { n: number }).n;
      assert.deepEqual([pages, coverageOf(index.db, f.pins.model.name)], [14, 14]);
    } finally {
      index.close();
    }
    const r = await k(["page", "search", "wifi"]);
    assert.deepEqual(Object.keys(r.out), ["mode", "hits", "limit", "more"]);
    assert.equal(r.out.mode, "hybrid");
    const text = await k(["page", "search", "wifi"], { tty: true });
    assert.doesNotMatch(text.out, /Full text only/);
  }));

test("fetching the model is a step a person watches, so a sync whose standard error is not a terminal says nothing there (§4.2, §6.1)", () =>
  semanticWorld(async (w, _f, k) => {
    const said: string[] = [];
    const write = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => (
      said.push(String(chunk)), true
    )) as typeof process.stderr.write;
    try {
      const r = await sync(w, k);
      assert.equal(r.code, 0, r.raw);
      assert.deepEqual(said, []);
      assert.equal(r.out.semantic.mode, "hybrid", "stdout has the one result");
      await k(["sync", "--cwd", w.repo, "--background"]);
      assert.deepEqual(said, [], "nor the hook's");
    } finally {
      process.stderr.write = write;
    }
  }));

test("a Spanish query finds the English page above an unrelated text match, and the reverse", () =>
  semanticWorld(async (w, _f, k) => {
    const es = "contraseña wifi oficina";
    const en = "migrations before deploy";
    const before = { es: pathsOf(await k(["page", "search", es])), en: pathsOf(await k(["page", "search", en])) };
    assert.ok(
      before.es.indexOf(HOURS) < before.es.indexOf(WIFI),
      `full text ranks the office hours first: ${before.es}`,
    );
    assert.ok(
      before.en.indexOf(PARTY) < before.en.indexOf(MIGRACIONES),
      `full text ranks the party first: ${before.en}`,
    );

    await sync(w, k);
    const after = { es: await k(["page", "search", es]), en: await k(["page", "search", en]) };
    assert.equal(after.es.out.mode, "hybrid");
    assert.ok(
      pathsOf(after.es).indexOf(WIFI) < pathsOf(after.es).indexOf(HOURS),
      `meaning lifts the wifi page: ${pathsOf(after.es)}`,
    );
    assert.ok(
      pathsOf(after.en).indexOf(MIGRACIONES) < pathsOf(after.en).indexOf(PARTY),
      `meaning lifts the migrations page: ${pathsOf(after.en)}`,
    );
    for (const p of before.es) assert.ok(pathsOf(after.es).includes(p), `the text candidates stay: ${p}`);
  }));

test("a query that shares no word with a page finds it by meaning", () =>
  semanticWorld(async (w, _f, k) => {
    const q = "¿quién guarda la contraseña?";
    const before = await k(["page", "search", q]);
    assert.ok(!pathsOf(before).includes(WIFI), `full text cannot: ${pathsOf(before)}`);
    await sync(w, k);
    const after = await k(["page", "search", q]);
    assert.equal(after.out.mode, "hybrid");
    assert.equal(pathsOf(after)[0], WIFI, `${pathsOf(after)}`);
    const hit = after.out.hits[0];
    assert.equal(hit.title, "Office wifi password location");
    assert.equal(hit.snippet, "Where the wifi password is.", "with no word matched, the snippet is the summary");
  }));

test("a page saved after the last sync is embedded by the next search; many changed pages leave search on full text", () =>
  semanticWorld(async (w, f, k) => {
    await sync(w, k);
    const saved = await k(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Guest wifi",
        "--source",
        "https://x.io",
      ],
      { stdin: "The guest wifi password is on the fridge.\n" },
    );
    assert.equal(saved.out.status, "done", saved.raw);
    assert.equal((await k(["page", "search", "wifi"])).out.mode, "hybrid");

    for (let i = 0; i < 40; i++)
      writeFileSync(
        join(w.acme, `memory/bulk-${i}.md`),
        made({ n: 100 + i, type: MEMORY, title: `Bulk lesson ${i}`, sections: MEM }).text,
      );
    const many = await k(["page", "search", "wifi"]);
    assert.equal(many.out.mode, "full-text");
    assert.match(many.out.reason, /^40 pages are not indexed by meaning yet; the next sync indexes them$/);
    assert.equal(doctor(w, f, "search index").state, "warn", "doctor says what search says");
    assert.match(doctor(w, f, "search index").detail, /search answers with full text until the other 40 are$/);
    assert.equal((await sync(w, k)).out.semantic.embedded, 40);
    assert.equal((await k(["page", "search", "wifi"])).out.mode, "hybrid");
    assert.equal(doctor(w, f, "search index").state, "ok");
  }));

test("changing one page reindexes only that page; a new pin of the model, another name, rebuilds every vector", () =>
  semanticWorld(async (w, f, k) => {
    assert.equal((await sync(w, k)).out.semantic.embedded, 14);
    assert.equal((await sync(w, k)).out.semantic.embedded, 0);
    writeFileSync(
      join(w.acme, WIFI),
      readFileSync(join(w.acme, WIFI), "utf8").replace("## Changelog", "Ask the office manager.\n\n## Changelog"),
    );
    assert.equal((await sync(w, k)).out.semantic.embedded, 1);

    const next = fakeSemantic(join(w.dir, "served-2"), { modelName: "test/model@2 q8" });
    next.deps.pins!.engine = f.pins.engine;
    const r = await w.kioku(["sync", "--cwd", w.repo], { context: { semantic: next.deps } });
    assert.deepEqual(r.out.semantic, { mode: "hybrid", fetched: ["model"], embedded: 14 });
    assert.ok(
      next.calls.every((u) => u.startsWith("https://models.test/")),
      "the engine is not fetched again",
    );
  }));

test("a tampered download fails its checksum: search stays on full text, doctor and the next session say why", () =>
  semanticWorld(async (w, f, k) => {
    f.tamper(f.modelUrl("onnx/model_quantized.onnx"));
    const s = await sync(w, k);
    assert.equal(s.out.semantic.mode, "full-text");
    assert.match(
      s.out.semantic.reason,
      /fetching the search model failed: test\/model onnx\/model_quantized\.onnx does not match its pinned checksum/,
    );
    assert.ok(!existsSync(modelsPath(w.home)), "nothing unverified is left in place");
    const r = await k(["page", "search", "wifi"]);
    assert.equal(r.out.mode, "full-text");
    assert.match(r.out.reason, /does not match its pinned checksum/);
    assert.match(doctor(w, f).detail, /does not match its pinned checksum/);

    // The background sync waits before trying again; by hand it tries at once.
    const calls = f.calls.length;
    await k(["sync", "--cwd", w.repo, "--background"]);
    assert.equal(f.calls.length, calls, "a recent failure is not retried in the background");
    await sync(w, k);
    assert.ok(f.calls.length > calls, "by hand it is");
  }));

test("a file changed after it was verified sends search back to full text until the next sync fetches it again", () =>
  semanticWorld(async (w, f, k) => {
    await sync(w, k);
    const model = join(modelsPath(w.home), "test/model/onnx/model_quantized.onnx");
    const original = readFileSync(model);
    writeFileSync(model, Buffer.from(original).fill(0x41, 0, 16));
    const r = await k(["page", "search", "wifi"]);
    assert.equal(r.out.mode, "full-text");
    assert.match(r.out.reason, /changed on disk since its checksums were verified/);
    assert.equal(doctor(w, f).state, "warn");

    // Same size and time as verified: only doctor's hashing sees it.
    const stamp = JSON.parse(readFileSync(join(modelsPath(w.home), "stamp.json"), "utf8"));
    const entry = stamp.files.find((x: { path: string }) => x.path === "test/model/onnx/model_quantized.onnx");
    utimesSync(model, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
    assert.match(doctor(w, f).detail, /model_quantized\.onnx fails its checksum/);

    writeFileSync(model, "x");
    const again = await sync(w, k);
    assert.deepEqual(again.out.semantic.fetched, ["model"]);
    assert.equal((await k(["page", "search", "wifi"])).out.mode, "hybrid");
  }));

test("the session hook says nothing of the model's fetch, which setup says, never loads the engine, and stays under a second with the model present", () =>
  semanticWorld(async (w, f, k) => {
    const hook = () =>
      k(["hook", "session-start"], { stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }) });
    assert.doesNotMatch(
      (await hook()).out.systemMessage ?? "",
      /search model/,
      "setup says it, not the session (§4.3)",
    );

    // Fetched without embedding anything, so that nothing in this process has imported the engine yet.
    await installSemantic(w.home, ["engine", "model"], {
      download: f.deps.download,
      pins: f.pins,
      platform: TEST_PLATFORM,
    });
    const started = performance.now();
    await hook();
    assert.ok(performance.now() - started < 1000, "under a second with the model present");
    assert.equal(engineLoaded(w.home), false, "the hook never loads the engine");
    await k(["page", "search", "wifi"]);
    assert.equal(engineLoaded(w.home), true, "search does, so the check above means something");
    assert.ok(f.calls.length > 0);
  }));

test("a model that fails while searching leaves the answer on full text with the reason", () =>
  semanticWorld(async (w, f, k) => {
    await sync(w, k);
    const broken = {
      ...f.deps,
      loadEmbedder: async () => ({
        model: f.pins.model.name,
        embed: async () => {
          throw new Error("out of memory");
        },
      }),
    };
    const r = await w.kioku(["page", "search", "wifi"], { context: { semantic: broken } });
    assert.equal(r.code, 0);
    assert.equal(r.out.mode, "full-text");
    assert.equal(r.out.reason, "the search model failed: out of memory");
    assert.deepEqual(pathsOf(r), [WIFI]);
  }));

test("save never loads the model: with the engine on the machine and stubbed to throw, the similar pages are the same, in full text's order (§4.3)", () =>
  semanticWorld(async (w, f, k) => {
    const args = [
      "page",
      "save",
      "--brain",
      "northwind/brain-acme",
      "--kind",
      "knowledge",
      "--sub",
      "context",
      "--title",
      "Office wifi and deploy party",
      "--source",
      "https://x.io",
    ];
    const body = "The wifi password changed; ask for the new password.\n";
    const before = await k(args, { stdin: body });
    assert.equal(before.out.status, "similar", before.raw);
    assert.ok(before.out.similar.length >= 2, "two or more to order");
    await sync(w, k);
    assert.equal((await k(["page", "search", "wifi"])).out.mode, "hybrid", "the model is on the machine");
    let asked = false;
    const after = await w.kioku(args, {
      stdin: body,
      context: {
        semantic: {
          ...f.deps,
          loadEmbedder: async () => {
            asked = true;
            throw new Error("the engine must not load in a save");
          },
        },
      },
    });
    assert.equal(after.out.status, "similar", after.raw);
    assert.equal(asked, false, "save never asked for the engine");
    assert.deepEqual(
      after.out.similar.map((s: { path: string }) => s.path),
      before.out.similar.map((s: { path: string }) => s.path),
      "the same pages in the same order, model or no model",
    );
  }));

test("a search with nothing to embed writes nothing to the index", () =>
  semanticWorld(async (w, _f, k) => {
    await sync(w, k);
    const others = async () => {
      const index = await openIndex(w.home);
      try {
        return (
          index.db.prepare("SELECT count(*) AS n FROM vectors WHERE model = 'another model'").get() as { n: number }
        ).n;
      } finally {
        index.close();
      }
    };
    const index = await openIndex(w.home);
    index.db
      .prepare(
        "INSERT INTO vectors (brain, path, hash, model, vector) VALUES ('x', 'y.md', 'h', 'another model', x'00')",
      )
      .run();
    index.close();
    assert.equal((await k(["page", "search", "wifi"])).out.mode, "hybrid");
    assert.equal(await others(), 1, "nothing to embed, nothing written");
    await k(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Guest wifi",
        "--source",
        "https://x.io",
      ],
      { stdin: "The guest wifi password is on the fridge.\n" },
    );
    await k(["page", "search", "wifi"]);
    assert.equal(await others(), 0, "the vectors of another model go when this one writes");
  }));

test("an archive entry that would land outside its folder fails the fetch, and a download past its pinned size stops", () =>
  semanticWorld(async (w, f) => {
    // A tarball by hand: one ustar entry whose name climbs out of `dist/`.
    const header = Buffer.alloc(512);
    const body = Buffer.from("escaped\n");
    header.write("package/dist/../../../../escaped.txt", 0);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.fill(" ", 148, 156);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    const evil = join(w.dir, "evil.tgz");
    writeFileSync(evil, gzipSync(Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)])));
    const bytes = readFileSync(evil);
    const url = "https://packages.test/evil.tgz";
    const withPackage = (i: number, change: Partial<PackagePin>) => ({
      ...f.pins,
      engine: { ...f.pins.engine, packages: f.pins.engine.packages.map((p, j) => (j === i ? { ...p, ...change } : p)) },
    });
    const pins = withPackage(1, {
      url,
      size: bytes.length,
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    });
    const download = async (u: string) => (u === url ? createReadStream(evil) : f.deps.download(u));
    await assert.rejects(
      installSemantic(w.home, ["engine"], { download, pins, platform: TEST_PLATFORM }),
      /would be written outside/,
    );
    assert.ok(!existsSync(join(w.home, ".kioku", "escaped.txt")) && !existsSync(join(w.home, "escaped.txt")));
    assert.deepEqual(
      readdirSync(join(w.home, ".kioku")).filter((n) => n.includes("partial")),
      [],
      "no scratch folder is left",
    );

    const small = withPackage(0, { size: f.pins.engine.packages[0]!.size - 1 });
    await assert.rejects(
      installSemantic(w.home, ["engine"], { download: f.deps.download, pins: small, platform: TEST_PLATFORM }),
      /larger than its pinned/,
    );
  }));

test("the model is embedded the way it was trained: its prefixes and its pooling", () =>
  semanticWorld(async (w, f) => {
    await installSemantic(w.home, ["engine", "model"], {
      download: f.deps.download,
      pins: f.pins,
      platform: TEST_PLATFORM,
    });
    const embedder = await loadEmbedder(w.home, f.pins);
    await embedder.embed(["who keeps the wifi password"], "query");
    assert.deepEqual(lastEmbedCall(), { texts: ["query: who keeps the wifi password"], pooling: "mean" });
    await embedder.embed(["x"], "passage");
    assert.deepEqual(lastEmbedCall(), { texts: ["passage: x"], pooling: "mean" });
  }));

test("a fetch removes the scratch folders a fetch cut short left behind, and keeps those of a running one", () =>
  semanticWorld(async (w, f) => {
    const dead = join(w.home, ".kioku", "engine.partial-99999999");
    const running = join(w.home, ".kioku", `models.partial-${process.ppid}`);
    for (const d of [dead, running]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "half.bin"), "half a download\n");
    }
    await installSemantic(w.home, ["engine", "model"], {
      download: f.deps.download,
      pins: f.pins,
      platform: TEST_PLATFORM,
    });
    assert.ok(!existsSync(dead), "the cut-short fetch's folder is gone");
    assert.ok(existsSync(running), "a running process keeps its own");
    assert.deepEqual(
      readdirSync(join(w.home, ".kioku")).filter((n) => n.includes("partial")),
      [`models.partial-${process.ppid}`],
    );
  }));

test("search set to full text downloads nothing, loads nothing, and says so; back to hybrid, the next sync fetches", () =>
  semanticWorld(async (w, f, k) => {
    const config = join(w.home, ".kioku/config.yaml");
    const original = readFileSync(config, "utf8");
    writeFileSync(config, original.replace("repositories:", "search:\n  mode: full-text\nrepositories:"));
    const synced = await sync(w, k);
    assert.deepEqual(synced.out.semantic, {
      mode: "full-text",
      reason: "search is set to full text in ~/.kioku/config.yaml",
    });
    assert.deepEqual(f.calls, [], "nothing downloaded");
    const r = await k(["page", "search", "wifi"]);
    assert.deepEqual([r.out.mode, r.out.reason], ["full-text", "search is set to full text in ~/.kioku/config.yaml"]);
    assert.deepEqual(
      [doctor(w, f).state, doctor(w, f).detail],
      ["ok", "not used: search is set to full text in the configuration"],
    );
    const hook = await k(["hook", "session-start"], {
      stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }),
    });
    assert.doesNotMatch(hook.out.systemMessage ?? "", /downloading the search model/);
    const saved = await k(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Office wifi and office hours",
        "--source",
        "https://x.io",
      ],
      { stdin: "The wifi password changed.\n" },
    );
    assert.equal(saved.out.status, "similar", saved.raw);
    assert.equal(engineLoaded(w.home), false, "save loads no engine");

    writeFileSync(config, original);
    assert.equal((await sync(w, k)).out.semantic.mode, "hybrid");
    assert.ok(f.calls.length > 0);
    assert.equal((await k(["page", "search", "wifi"])).out.mode, "hybrid");
  }));

test("blend: meaning reorders the pages that have a vector; the others keep their place; a strong text match stays near the top", () => {
  const cos: Record<string, number | undefined> = { a: 0.1, b: undefined, c: 0.9, d: 0.5 };
  assert.deepEqual(
    blend(["a", "b", "c", "d"], (x) => cos[x]),
    ["c", "b", "a", "d"],
  );
  assert.deepEqual(
    blend(["a", "b"], () => undefined),
    ["a", "b"],
  );
  const many = ["s", "x1", "x2", "x3", "x4", "x5"];
  const meaning: Record<string, number> = { s: 0.0, x1: 0.9, x2: 0.95, x3: 0.99, x4: 0.97, x5: 0.96 };
  const out = blend(
    many,
    (x) => meaning[x],
    (x) => x === "s",
  );
  assert.ok(out.indexOf("s") < STRONG_TEXT_PLACE, `${out}`);
  assert.notEqual(out[0], "s", "meaning still leads");
});

test("the tar reader keeps what it is told, long names included, and nothing else", () => {
  const dir = join(execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim());
  const long = `package/${"deep/".repeat(30)}file.txt`;
  mkdirSync(join(dir, "src", dirname(long)), { recursive: true });
  writeFileSync(join(dir, "src", long), "far down\n");
  writeFileSync(join(dir, "src/package/kept.txt"), "kept\n".repeat(300));
  writeFileSync(join(dir, "src/package/skipped.txt"), "skipped\n");
  execFileSync("tar", ["-czf", join(dir, "a.tgz"), "-C", join(dir, "src"), "package"]);
  return extractTgz(join(dir, "a.tgz"), (name) =>
    name === long || name === "package/kept.txt" ? join(dir, "out", name) : undefined,
  ).then((written) => {
    assert.equal(written.length, 2);
    assert.equal(readFileSync(join(dir, "out", long), "utf8"), "far down\n");
    assert.equal(readFileSync(join(dir, "out/package/kept.txt"), "utf8"), "kept\n".repeat(300));
    assert.ok(!existsSync(join(dir, "out/package/skipped.txt")));
    assert.ok(!existsSync(semanticStatePath(dir)));
  });
});
