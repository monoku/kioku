import { firstLine } from "../errors.ts";
import type { Meaning } from "../semantic/meaning.ts";
import { brainIn, type Index } from "./db.ts";
import { byWords, search, someOf, type Hit } from "./search.ts";
import { titleHolds } from "./text.ts";
import { embedStale, keyOf, vectorStore, type PageKey } from "./vectors.ts";

/** How a search was ranked (§4.3): by meaning on top of full text, or by full text alone and why. */
export interface Ranked {
  mode: "hybrid" | "full-text";
  reason?: string;
  hits: Hit[];
}

/** How many full-text candidates meaning reorders. */
export const HYBRID_CANDIDATES = 50;
/** How many of the pages nearest in meaning join them, so that a page sharing no word with the query can be found. */
export const NEAREST_CANDIDATES = 10;
/** A search embeds at most this many pages that changed since the last `sync`; more, and it answers with full text. */
export const INLINE_EMBED_MAX = 32;
/** The share of text in the blend, against meaning's; a strong text match is kept near the top by its own rule. */
export const TEXT_WEIGHT = 0.4;
/** A page whose title holds every word of the query is never pushed below this place. */
export const STRONG_TEXT_PLACE = 3;

/**
 * Order candidates by text and meaning together (§4.3). Each candidate with a vector scores its text (`textOf`:
 * the share of the query's words it holds; by default its text rank, first 1 and last 0) blended with its cosine to
 * the query, scaled over the candidates; candidates without a vector keep their place. A strong text match, a title
 * holding every word of the query, stays among the first places.
 */
export function blend<T>(
  candidates: T[],
  cosineOf: (t: T) => number | undefined,
  strong: (t: T) => boolean = () => false,
  textOf: (t: T, i: number) => number = (_t, i) => (candidates.length === 1 ? 1 : 1 - i / (candidates.length - 1)),
): T[] {
  const withVector = candidates
    .map((t, i) => ({ t, i, cos: cosineOf(t) }))
    .filter((x): x is { t: T; i: number; cos: number } => x.cos !== undefined);
  if (withVector.length === 0) return candidates;
  const lo = Math.min(...withVector.map((x) => x.cos));
  const hi = Math.max(...withVector.map((x) => x.cos));
  const score = (x: { t: T; i: number; cos: number }) =>
    TEXT_WEIGHT * textOf(x.t, x.i) + (1 - TEXT_WEIGHT) * (hi === lo ? 1 : (x.cos - lo) / (hi - lo));
  const order = [...withVector].sort((a, b) => score(b) - score(a) || a.i - b.i);
  const out = [...candidates];
  withVector.map((x) => x.i).forEach((slot, k) => (out[slot] = order[k]!.t));
  // A strong text match the blend pushed down comes back up, keeping the order among strong matches.
  for (let i = STRONG_TEXT_PLACE; i < out.length; i++) {
    const t = out[i]!;
    if (!strong(t)) continue;
    let at = STRONG_TEXT_PLACE - 1;
    while (at > 0 && strong(out[at - 1]!)) at--;
    while (at < i && strong(out[at]!)) at++;
    if (at >= i) continue;
    out.splice(i, 1);
    out.splice(at, 0, t);
  }
  return out;
}

/**
 * Search the given brains (keys), hybrid whenever the meaning half can run (§4.3): the full-text candidates and
 * the pages nearest in meaning, ordered by both. Pages changed since the last `sync` are embedded first when there
 * are few; otherwise, and whenever the model is not on the machine, the answer is full text alone and says why.
 */
export async function rankedSearch(
  index: Index,
  query: string,
  brains: string[],
  limit: number,
  meaning: Meaning,
): Promise<Ranked> {
  const textOnly = (reason: string): Ranked => ({
    mode: "full-text",
    reason,
    hits: search(index, query, brains, limit),
  });
  if ("reason" in meaning) return textOnly(meaning.reason);
  try {
    const { left } = await embedStale(index, meaning.embedder, brains, INLINE_EMBED_MAX);
    if (left > 0) return textOnly(`${left} pages are not indexed by meaning yet; the next sync indexes them`);
    const byText = byWords(index, query, brains, Math.max(HYBRID_CANDIDATES, limit), true);
    const [q] = await meaning.embedder.embed([query], "query");
    const seen = new Set(byText.map(keyOf));
    const byMeaning = hitsFor(
      index,
      vectorStore(index, meaning.embedder.model).nearest(q!, NEAREST_CANDIDATES, pageKeysOf(index, brains)),
    ).filter((h) => !seen.has(keyOf(h)));
    const found = [...byText, ...byMeaning];
    if (found.length === 0) return { mode: "hybrid", hits: [] };
    const scores = cosinesOf(index, meaning.embedder.model, q!, found);
    const share = wordShare(index, query, brains, found);
    return {
      mode: "hybrid",
      hits: blend(
        found,
        (h) => scores.get(keyOf(h)),
        titleHolds(query),
        (h) => share.get(keyOf(h)) ?? 0,
      ).slice(0, limit),
    };
  } catch (e) {
    return textOnly(`the search model failed: ${firstLine(e)}`);
  }
}

/**
 * For each candidate, the share of the query's significant words it holds (prefix match, any field): the text half
 * of hybrid ranking. Two pages that each hold one word of three are even on text, and meaning decides between them.
 */
function wordShare(index: Index, query: string, brains: string[], pages: PageKey[]): Map<string, number> {
  const words = someOf(query);
  const wanted = new Set(pages.map(keyOf));
  const share = new Map<string, number>();
  const sql = `SELECT p.brain AS brain, p.path AS path FROM fts JOIN pages p ON p.rowid = fts.rowid WHERE fts MATCH ? AND ${brainIn(brains)}`;
  for (const w of words) {
    for (const r of index.db.prepare(sql).all(`"${w}"*`, ...brains) as unknown as PageKey[]) {
      const k = keyOf(r);
      if (wanted.has(k)) share.set(k, (share.get(k) ?? 0) + 1 / words.length);
    }
  }
  return share;
}

/** The pages of these brains (keys). */
function pageKeysOf(index: Index, brains: string[]): PageKey[] {
  if (brains.length === 0) return [];
  return index.db
    .prepare(`SELECT brain, path FROM pages WHERE ${brainIn(brains, "brain")}`)
    .all(...brains) as unknown as PageKey[];
}

/** Pages found by meaning alone, as hits: no word matched, so the snippet is the start of the summary or the body. */
function hitsFor(index: Index, pages: PageKey[]): Hit[] {
  const one = index.db.prepare(`
    SELECT p.brain AS brain, p.path AS path, p.id AS id, p.title AS title, p.kind AS kind, p.sub AS subkind,
           p.namespace AS namespace, p.status AS status, p.summary AS summary, substr(f.body, 1, 400) AS body
    FROM pages p JOIN fts f ON f.rowid = p.rowid WHERE p.brain = ? AND p.path = ?`);
  return pages.flatMap((k) => {
    const r = one.get(k.brain, k.path) as (Omit<Hit, "snippet"> & { body: string }) | undefined;
    if (r === undefined) return [];
    const { body, ...hit } = r;
    const text = (hit.summary || body.replace(/^#+ .*$/gm, "")).replace(/\s+/g, " ").trim();
    return [{ ...hit, snippet: text.length > 120 ? `${text.slice(0, 120)}…` : text }];
  });
}

function cosinesOf(index: Index, model: string, query: Float32Array, pages: PageKey[]): Map<string, number> {
  return new Map(
    vectorStore(index, model)
      .nearest(query, pages.length, pages)
      .map((n) => [keyOf(n), n.score]),
  );
}
