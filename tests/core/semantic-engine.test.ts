import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { loadEmbedder } from "../../src/core/semantic/embedder.ts";
import type { SemanticDeps } from "../../src/core/semantic/meaning.ts";
import { semanticStatus } from "../../src/core/semantic/status.ts";
import { enginePath, modelsPath } from "../../src/core/state.ts";
import { CONTEXT, MEMORY, OFFLINE, made, validPages } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { world } from "../world.ts";

isolateGit();

/**
 * The real engine and model (§4.3), run only where a home that `kioku sync` filled is named by
 * KIOKU_SEMANTIC_HOME; everywhere else, and in CI, it is skipped. Its engine and model are linked into a test home,
 * never fetched here.
 */
const source = process.env.KIOKU_SEMANTIC_HOME;
const skip =
  source === undefined || !semanticStatus(source).ready
    ? "set KIOKU_SEMANTIC_HOME to a home where `kioku sync` fetched the model"
    : false;

const MEM = { "What happened": "x", Lesson: "x", "Rule of thumb": "x" };
const PAGES = [
  ...validPages().filter((p) => !p.path.startsWith("memory/run-migrations")),
  made({
    n: 70,
    type: CONTEXT,
    title: "Office wifi password location",
    sections: {},
    summary: "The office manager keeps the wifi password; it is never written down.",
  }),
  made({
    n: 71,
    type: CONTEXT,
    title: "Oficina: horario de la oficina",
    sections: {},
    summary: "La oficina abre a las nueve y cierra a las seis.",
  }),
  made({
    n: 72,
    type: MEMORY,
    title: "Migraciones antes del deploy",
    sections: { ...MEM, Lesson: "Corre las migraciones de la base de datos antes de desplegar, nunca después." },
  }),
  made({
    n: 73,
    type: CONTEXT,
    title: "Deploy party before the weekend",
    sections: {},
    summary: "Every Friday the team celebrates the week's deploy with a party before the weekend.",
  }),
];

test("the real model puts a Spanish query near the English page on its subject, and the reverse", {
  skip,
}, async () => {
  const embedder = await loadEmbedder(source!);
  const [q, wifi, hours] = [
    ...(await embedder.embed(["¿quién tiene la contraseña del wifi?"], "query")),
    ...(await embedder.embed(
      [
        "Office wifi password location. The office manager keeps the wifi password.",
        "La oficina abre a las nueve y cierra a las seis.",
      ],
      "passage",
    )),
  ];
  const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  assert.equal(q!.length, 384);
  assert.ok(dot(q!, wifi!) > dot(q!, hours!), `${dot(q!, wifi!)} > ${dot(q!, hours!)}`);
  const [en, migraciones, fiesta] = [
    ...(await embedder.embed(["when do the database migrations run?"], "query")),
    ...(await embedder.embed(
      [
        "Corre las migraciones de la base de datos antes de desplegar.",
        "El viernes hay fiesta antes del fin de semana.",
      ],
      "passage",
    )),
  ];
  assert.ok(dot(en!, migraciones!) > dot(en!, fiesta!), `${dot(en!, migraciones!)} > ${dot(en!, fiesta!)}`);
});

test(
  "with the real model, hybrid search lifts the page on the subject above an unrelated text match, both ways",
  { skip },
  () =>
    world(
      async (w) => {
        symlinkSync(enginePath(source!), enginePath(w.home));
        symlinkSync(modelsPath(source!), modelsPath(w.home));
        const semantic: SemanticDeps = { download: OFFLINE.download, loadEmbedder };
        const k = (argv: string[]) => w.kioku(argv, { context: { semantic } });
        const s = await k(["sync", "--cwd", w.repo]);
        assert.equal(s.out.semantic.mode, "hybrid", s.raw);
        const paths = (r: { out: { hits: { path: string }[] } }) => r.out.hits.map((h) => h.path);
        const es = await k(["page", "search", "contraseña wifi oficina"]);
        assert.equal(es.out.mode, "hybrid");
        const esPaths = paths(es);
        assert.ok(
          esPaths.indexOf("knowledge/acme/context/office-wifi-password-location.md") <
            esPaths.indexOf("knowledge/acme/context/oficina-horario-de-la-oficina.md"),
          `${esPaths}`,
        );
        const none = paths(await k(["page", "search", "contraseña de la red inalámbrica"]));
        assert.equal(
          none[0],
          "knowledge/acme/context/office-wifi-password-location.md",
          `a query with no word in common: ${none}`,
        );
        const en = paths(await k(["page", "search", "migrations before deploy"]));
        assert.ok(
          en.indexOf("memory/migraciones-antes-del-deploy.md") <
            en.indexOf("knowledge/acme/context/deploy-party-before-the-weekend.md"),
          `${en}`,
        );
      },
      { acmePages: PAGES },
    ),
);
