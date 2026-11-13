/**
 * `pnpm eval:recall [-- --whole] [-- --rule <z>,<gap>,words|any,<alone>]`: how the prompt's recall (§4.7) would do on a labelled set of
 * prompts against the demo's brains, with no agent and no cost: the embedding model alone, on this machine. Each
 * prompt either names the page it should bring or none. It scores a grid of rules, each half of the set apart (so a
 * rule that only fits one half shows it), and the rule the tool holds now; `--rule` scores one rule of your own.
 *
 * `--rule` is a rule of the grid: at least `z` above the mean; `gap` (here only, not the tool's) that far above the next
 * page; `words` to ask for a word in common, `any` not to; `alone` how far out a page stands with none. `--whole`
 * measures the page whole alone, as the recall did before a page had parts (§4.3). It scores with the hook's own
 * functions, so it measures what the hook does.
 *
 * `--words` measures the recall by words instead (§4.7), what a machine with no search model gets: a grid of the least
 * weight a page's words in common with the prompt must have, and of how near the heaviest page's, with how many pages it names that
 * are not the one wanted. It needs no model.
 *
 * Not a check: a measure, to choose the recall's numbers with (§4.7), and to see whether a model's change moves them.
 * Needs `pnpm demo` and the search model on the demo's machine.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { resolveChain } from "../../src/core/config/chain.ts";
import { machineReader } from "../../src/core/config/machine.ts";
import { openIndex, openIndexAsItIs } from "../../src/core/index/db.ts";
import { updateIndex } from "../../src/core/index/indexer.ts";
import { embedStale, keyOf, vectorStore } from "../../src/core/index/vectors.ts";
import { loadEmbedder } from "../../src/core/semantic/embedder.ts";
import { httpDownload } from "../../src/core/semantic/install.ts";
import { openMeaning } from "../../src/core/semantic/meaning.ts";
import {
  currentPages,
  indexedPages,
  RECALL_TUNING,
  recallable,
  sharesWord,
  standingOf,
  standOutByWords,
  wordStanding,
  zScores,
} from "../../src/core/session/recall.ts";

/** A prompt as a person types it, and the page it should bring: a part of its path, or none. */
interface Labelled {
  prompt: string;
  want?: string;
}

const SET: Labelled[] = [
  // Pages a prompt should bring, in both languages, with the asides people add.
  {
    prompt:
      "Acme says some of their orders were created twice after a timeout on our API. Why could that happen? Keep it short.",
    want: "a-partner-retried-on-a-timeout",
  },
  {
    prompt: "Some invoices are one cent off from the payment amount. Where would you look first? Brief.",
    want: "rounding-each-line",
  },
  {
    prompt:
      "Staging and production disagree on yesterday's invoice totals. Where should I start looking? Answer in three lines at most, and change no code.",
    want: "staging-s-clock",
  },
  {
    prompt:
      "Checkout got slow for about four minutes right at the top of the hour last night. What would you look at first? Three lines at most, change no code.",
    want: "nightly-report-locked",
  },
  {
    prompt: "A customer's refund just came back as failed. What should I check first? Three lines at most.",
    want: "when-a-refund-fails",
  },
  {
    prompt: "I need to rename the customer email column in the orders table. How should I ship it? Three lines.",
    want: "migration-renames-a-column",
  },
  { prompt: "Where do release notes go in this repo? One line.", want: "release-notes-go-in-changelog" },
  {
    prompt: "We're about to deploy a change to checkout this afternoon. Anything I should keep in mind? Brief.",
    want: "deploy-touches-checkout",
  },
  { prompt: "unas facturas no cuadran por un centavo con el pago, ¿qué reviso primero?", want: "rounding-each-line" },
  {
    prompt: "Acme dice que se les duplicaron pedidos después de un timeout de la API, ¿por qué pasaría? corto",
    want: "a-partner-retried-on-a-timeout",
  },
  {
    prompt: "Which partners call our API, and what does each one do with it? Short answer.",
    want: "partners-who-call-the-api",
  },
  {
    prompt: "What environments does the app have, and how long does a preview live?",
    want: "the-environments-of-the-app",
  },
  { prompt: "How do we deploy the app? Just the steps.", want: "deploy-the-app" },
  {
    prompt: "Is stock reserved when the order is placed or when the cart checks out?",
    want: "stock-is-reserved-when-the-cart-checks-out",
  },
  {
    prompt: "el checkout se puso lento cuatro minutos justo a la hora en punto anoche, ¿qué reviso?",
    want: "nightly-report-locked",
  },
  {
    prompt: "una consulta está escaneando toda la tabla en producción, ¿qué hago primero?",
    want: "query-scans-a-whole-table",
  },
  { prompt: "A test has been flaky twice this week. What do we usually do about it?", want: "test-is-flaky-twice" },
  {
    prompt: "Why is the pricing engine's config different between environments? Any history there?",
    want: "pricing-engine-config-skew",
  },
  // Another language with no word in common: meaning alone has to carry them.
  {
    prompt: "¿dónde se escriben las novedades de cada versión en este repositorio?",
    want: "release-notes-go-in-changelog",
  },
  { prompt: "¿qué ambientes tiene la aplicación y cuánto vive una vista previa?", want: "the-environments-of-the-app" },
  // Prompts no page bears on: work on code that the brains say nothing about.
  { prompt: "rename this variable to camelCase please" },
  { prompt: "What does `git rebase --onto` do? One short paragraph." },
  { prompt: "write a regex that matches ISO 8601 dates" },
  { prompt: "explain the difference between let and const in JavaScript" },
  { prompt: "can you fix the typo in the README's title?" },
  { prompt: "add a unit test for the parseDate function in utils" },
  { prompt: "how do I center a div with flexbox?" },
  { prompt: "convert this list to a markdown table: apples 3, pears 5, plums 2" },
  { prompt: "¿qué hora es en Tokio cuando en Bogotá son las 9 de la mañana?" },
  { prompt: "make the primary button blue and a bit bigger" },
  { prompt: "explícame qué hace este código: const add = (a, b) => a + b" },
  { prompt: "sort these names alphabetically: Zoe, Ana, Luis, Marta" },
];

const { values } = parseArgs({
  options: { rule: { type: "string" }, whole: { type: "boolean" }, words: { type: "boolean" } },
  strict: true,
  args: process.argv.slice(2).filter((a) => a !== "--"),
});

const root = resolve(new URL("../..", import.meta.url).pathname);
const home = join(root, ".demo", ".home");
const app = join(root, ".demo", "app");
if (!existsSync(join(app, "kioku.yaml"))) {
  console.error("No demo yet. Run: pnpm demo");
  process.exit(1);
}

const config = machineReader(home)();
const links = resolveChain(app, config, home).links.filter((l) => l.cloned);
const keys = links.map((l) => l.key);
if (values.words === true) {
  await byWords();
  process.exit(0);
}

/** The recall by words (§4.7), scored with the hook's own function over every page the index holds. */
async function byWords(): Promise<void> {
  const index = await openIndexAsItIs(home);
  if (index === undefined) {
    console.error("No index on the demo's machine. Run: pnpm demo");
    process.exit(1);
  }
  const pages = indexedPages(index, keys).filter(recallable);
  index.close();
  // With one word in common, so that the page a prompt wants is shown wherever it stands; the rules ask for two or more.
  const standing = SET.map((s) => wordStanding(s.prompt, pages, 1));
  console.log("prompt → the page it wants: its words in common, their weight (rank), and the heaviest page");
  SET.forEach((s, i) => {
    const c = standing[i]!;
    const top = c[0];
    const head =
      top === undefined
        ? "nothing"
        : `${top.words} words, ${top.weight.toFixed(2)}  ${top.page.path.split("/").pop()!.slice(0, 44)}`;
    if (s.want === undefined) return console.log(`  none  ${s.prompt.slice(0, 58).padEnd(58)} top ${head}`);
    const k = c.findIndex((x) => x.page.path.includes(s.want!));
    const x = c[k];
    console.log(
      `  want  ${s.prompt.slice(0, 58).padEnd(58)} ${x === undefined ? "no word in common" : `${x.words} words, ${x.weight.toFixed(2)} (#${k + 1})`}`,
    );
  });
  console.log("\nrule                    found      noisy      other pages named beside the one wanted");
  for (const near of [0, 0.5, 2 / 3, 0.8])
    for (const weight of [1, 1.25, 1.5, 1.75, 2]) {
      let found = 0;
      let wanted = 0;
      let noisy = 0;
      let quiet = 0;
      let others = 0;
      SET.forEach((s, i) => {
        const got = standOutByWords(
          standing[i]!.filter((x) => x.words >= 2),
          () => false,
          { weight, near, max: RECALL_TUNING.max },
        ).map((x) => x.page.path);
        if (s.want === undefined) {
          quiet++;
          if (got.length > 0) noisy++;
          return;
        }
        wanted++;
        if (got.some((p) => p.includes(s.want!))) found++;
        others += got.filter((p) => !p.includes(s.want!)).length;
      });
      console.log(
        `weight ≥${weight.toFixed(2)}, near ≥${near.toFixed(2)}  ${`${found}/${wanted}`.padEnd(10)} ${`${noisy}/${quiet}`.padEnd(10)} ${others}`,
      );
    }
  console.log(
    `\n${SET.length} prompts, ${pages.length} pages; the tool now: 2 words or more, weight ≥${RECALL_TUNING.wordsWeight}, near ≥${RECALL_TUNING.wordsNear?.toFixed(2)}, ${RECALL_TUNING.max} at most`,
  );
}

const meaning = await openMeaning(home, { download: httpDownload, loadEmbedder });
if ("reason" in meaning) {
  console.error(`No search model on the demo's machine: ${meaning.reason}`);
  process.exit(1);
}
const index = await openIndex(home);
// What a sync would index and embed: the pages and their parts (§4.3), so that it measures without one first.
updateIndex(
  index,
  links.map((l) => ({ key: l.key, root: l.path })),
);
const { embedded } = await embedStale(index, meaning.embedder, keys);
if (embedded > 0) console.log(`embedded ${embedded} pages and their parts first\n`);
// The pages the hook weighs: those with a current vector, as `embedStale` above made them.
const pages = currentPages(index, keys, meaning.embedder.model);
const byKey = new Map(pages.map((p) => [keyOf(p), p]));
const store = vectorStore(index, meaning.embedder.model);
const vectors = await meaning.embedder.embed(
  SET.map((s) => s.prompt),
  "query",
);

/** A candidate page for a prompt: how far out it stands, how far above the next, and whether they share a word. */
interface Candidate {
  path: string;
  z: number;
  gap: number;
  shares: boolean;
}

/** How far out each page stands for a prompt, as the hook measures it (§4.7); with `--whole`, the page whole alone. */
const standing = (q: Float32Array): { brain: string; path: string; z: number }[] =>
  values.whole === true
    ? [...zScores(store.nearest(q, pages.length, pages))].map(([k, z]) => ({ ...pageOfKey(k), z }))
    : standingOf(store, q, pages);
const pageOfKey = (k: string) => byKey.get(k)!;

const candidates: Candidate[][] = SET.map((s, i) => {
  const shares = sharesWord(s.prompt);
  // The pages the hook may name at all (§4.7), the furthest out first.
  const kept = standing(vectors[i]!)
    .filter((x) => recallable(pageOfKey(keyOf(x))))
    .sort((a, b) => b.z - a.z);
  return kept.slice(0, 10).map((x, k) => {
    const p = pageOfKey(keyOf(x));
    return { path: p.path, z: x.z, gap: x.z - (kept[k + 1]?.z ?? x.z), shares: shares(p) };
  });
});

/** A rule: at least `z` above the mean; when `gap` is given, that far above the next page too; with `words`, a word shared. */
interface Rule {
  /** A page this far above the mean stands out with no word shared: one in another language, say. */
  alone: number;
  z: number;
  gap: number;
  words: boolean;
}
const recalled = (c: Candidate[], r: Rule): string[] =>
  c
    .filter((x) => x.z >= r.alone || (x.z >= r.z && x.gap >= r.gap && (!r.words || x.shares)))
    .slice(0, RECALL_TUNING.max)
    .map((x) => x.path);

/** Of a set of prompts: how many that want a page get it, and how many that want none get something. */
function score(r: Rule, which: (i: number) => boolean) {
  let found = 0;
  let wanted = 0;
  let noisy = 0;
  let quiet = 0;
  SET.forEach((s, i) => {
    if (!which(i)) return;
    const got = recalled(candidates[i]!, r);
    if (s.want !== undefined) {
      wanted++;
      if (got.some((p) => p.includes(s.want!))) found++;
    } else {
      quiet++;
      if (got.length > 0) noisy++;
    }
  });
  return { found, wanted, noisy, quiet };
}
const fmt = (s: ReturnType<typeof score>) => `${s.found}/${s.wanted} found, ${s.noisy}/${s.quiet} noisy`;
const label = (r: Rule) =>
  `z≥${r.z.toFixed(2)}${r.gap > 0 ? ` gap≥${r.gap.toFixed(2)}` : ""}${r.words ? " +word" : ""}${r.alone < Infinity ? ` or z≥${r.alone}` : ""}`;

// Each prompt and where its page stands, so a rule's misses can be read.
console.log("prompt → the page it wants: z, gap, shares a word (rank among the candidates)");
SET.forEach((s, i) => {
  const c = candidates[i]!;
  const top = c[0]!;
  if (s.want === undefined) {
    console.log(
      `  none  ${s.prompt.slice(0, 58).padEnd(58)} top z ${top.z.toFixed(2)} gap ${top.gap.toFixed(2)}${top.shares ? " +word" : ""}  ${top.path.split("/").pop()!.slice(0, 50)}`,
    );
    return;
  }
  const k = c.findIndex((x) => x.path.includes(s.want!));
  const x = c[k];
  console.log(
    `  want  ${s.prompt.slice(0, 58).padEnd(58)} ${x === undefined ? "not in the first 10" : `z ${x.z.toFixed(2)} gap ${x.gap.toFixed(2)}${x.shares ? " +word" : ""} (#${k + 1})`}`,
  );
});

const even = (i: number) => i % 2 === 0;
const odd = (i: number) => i % 2 === 1;
const all = () => true;
const rules: Rule[] = [];
if (values.rule !== undefined) {
  const [z, gap, words, alone] = values.rule.split(",");
  if (words !== "words" && words !== "any") {
    console.error("--rule <z>,<gap>,words|any,<alone>");
    process.exit(1);
  }
  rules.push({ z: Number(z), gap: Number(gap ?? 0), words: words === "words", alone: Number(alone ?? Infinity) });
} else {
  for (const z of [2.25, 2.5, 2.75, 3, 3.25])
    for (const gap of [0, 0.2, 0.3])
      for (const words of [false, true])
        for (const alone of words ? [Infinity, 4, 3.5] : [Infinity]) rules.push({ z, gap, words, alone });
}
console.log(`\nrule                       all                        even half                  odd half`);
for (const r of rules)
  console.log(
    `${label(r).padEnd(26)} ${fmt(score(r, all)).padEnd(26)} ${fmt(score(r, even)).padEnd(26)} ${fmt(score(r, odd))}`,
  );
console.log(
  `\n${SET.length} prompts, ${pages.length} pages; the tool now: z≥${RECALL_TUNING.z}, ${RECALL_TUNING.max} at most`,
);
index.close();
