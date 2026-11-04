import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import { brainIn, openIndex } from "../core/index/db.ts";
import { updateIndex, type IndexedBrain } from "../core/index/indexer.ts";
import { rankedSearch, type Ranked } from "../core/index/hybrid.ts";
import { windowOf } from "../core/limit.ts";
import { openMeaning } from "../core/semantic/meaning.ts";
import { lastTouched, touchedOf } from "../core/touched.ts";
import { readBrainFile } from "../core/brain/file.ts";
import { parseVerb } from "./args.ts";
import { chainBrains, pickBrain } from "./chain.ts";
import { nothingIn } from "./pages.ts";
import { PLAIN, entry, highlight, paint, type Ui } from "./render.ts";
import type { Handler } from "./run.ts";

/**
 * `kioku page search <words> [--brain <b>] [--limit <n>]` (§4.3, §6.1): paths, titles, kind, `created`, `touched` and
 * a snippet, ranked by meaning on top of full text when the model is on this machine, and saying so when it is full
 * text alone.
 */
export const runSearch: Handler = async (args, ctx) => {
  const parsed = parseVerb("page search", args);
  const query = parsed.positionals.join(" ").trim();
  if (query === "") throw userError("page search needs the words to look for", "usage");
  const includeRetired = parsed.values["include-retired"] === true;
  const { limit } = windowOf(parsed.values.limit, undefined);

  const chain = chainBrains(ctx);
  const brains =
    parsed.values.brain === undefined ? chain.filter((b) => b.cloned) : [pickBrain(chain, parsed.values.brain, ctx)];
  const toIndex: IndexedBrain[] = brains.map((b) => ({ key: b.key, root: b.root }));

  const index = await openIndex(ctx.home);
  let ranked: Ranked;
  try {
    updateIndex(index, toIndex);
    const keys = brains.map((b) => b.key);
    // A retired or superseded page is history and not an answer unless asked for (§3.3, §3.5): ask for as many more as there are.
    const retired =
      includeRetired || keys.length === 0
        ? 0
        : (
            index.db
              .prepare(`SELECT count(*) AS n FROM pages p WHERE p.status IS NOT NULL AND ${brainIn(keys)}`)
              .get(...keys) as { n: number }
          ).n;
    ranked = await rankedSearch(index, query, keys, limit + 1 + retired, await openMeaning(ctx.home, ctx.semantic));
  } finally {
    index.close();
  }
  const byKey = new Map(brains.map((b) => [b.key, b]));
  // The dates come from the file and from git, for the few pages a search returns (§3.3).
  const touched = new Map<string, Map<string, string>>();
  // One hit more than asked for: it is how the answer knows there are more (§6.1, bounded answers).
  const wanted = ranked.hits.filter((h) => includeRetired || h.status === null);
  const more = wanted.length > limit;
  const hits = wanted.slice(0, limit).map(({ status, ...h }) => {
    const b = byKey.get(h.brain);
    if (b !== undefined && !touched.has(b.key)) touched.set(b.key, lastTouched(b.root));
    const file = b === undefined ? undefined : readBrainFile(`${b.root}/${h.path}`);
    return {
      ...h,
      ...(status !== null && { status }),
      brain: b?.key ?? h.brain,
      created: file?.ok ? (file.file.front.getString("created") ?? null) : null,
      touched: b === undefined ? null : touchedOf(touched.get(b.key)!, h.path),
    };
  });
  const lines =
    hits.length === 0
      ? [nothingIn(`Nothing found for "${query}"`, brains)]
      : hits.map((h) => describe(h, ctx.ui ?? PLAIN));
  if (more) lines.push(`… more hits: narrow the words, or --limit ${limit * 2}`);
  if (ranked.mode === "full-text") lines.push(paint(ctx.ui ?? PLAIN).dim(`Full text only: ${ranked.reason}.`));
  return {
    data: { mode: ranked.mode, ...(ranked.reason !== undefined && { reason: ranked.reason }), hits, limit, more },
    text: lines.join("\n"),
  };
};

/** A hit as three lines: its title with where it is from, its path, and the words around what matched. */
function describe(
  h: {
    brain: string;
    path: string;
    kind: string | null;
    subkind: string | null;
    title: string;
    snippet: string;
    status?: string;
  },
  ui: Ui,
): string {
  const state = h.status === undefined ? [] : [h.status === "superseded" ? "superseded" : "retired"];
  const meta = [brainRepoOfKey(h.brain), h.subkind ?? h.kind ?? "?", ...state].join(" · ");
  return entry(ui, h.title, meta, [
    { text: h.path, keepEnd: true },
    { text: highlight(ui, h.snippet.replace(/\s+/g, " ").trim()), dim: false },
  ]);
}
