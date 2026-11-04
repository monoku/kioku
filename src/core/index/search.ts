import { brainIn, type Index } from "./db.ts";
import { DEFAULT_LIMIT } from "../limit.ts";
import { significantWords, wordsOf } from "./text.ts";
import { keyOf } from "./vectors.ts";

export interface Hit {
  brain: string;
  path: string;
  id: string | null;
  title: string;
  kind: string | null;
  subkind: string | null;
  namespace: string | null;
  /** `deprecated` for a retired page (§3.3), `superseded` for a replaced decision (§3.5), null otherwise. */
  status: string | null;
  summary: string;
  snippet: string;
}

/** How much each column weighs in the ranking (§4.3): a match in the title or aliases is worth more than one in the summary, which is worth more than one in the body. */
const WEIGHTS = { title: 10, aliases: 10, summary: 4, body: 1 };

const SELECT = `
  SELECT p.brain AS brain, p.path AS path, p.id AS id, p.title AS title, p.kind AS kind, p.sub AS subkind,
         p.namespace AS namespace, p.status AS status, p.summary AS summary,
         snippet(fts, -1, '[', ']', '…', 14) AS snippet
  FROM fts JOIN pages p ON p.rowid = fts.rowid`;
const ORDER = `ORDER BY bm25(fts, ${WEIGHTS.title}, ${WEIGHTS.aliases}, ${WEIGHTS.summary}, ${WEIGHTS.body}), p.path`;

/** `"word"*` for each word: prefix matching, so `migr` finds `migraciones`. Words are letters and digits, so quoting them is safe. */
const prefixQuery = (words: string[], join: "AND" | "OR"): string => words.map((w) => `"${w}"*`).join(` ${join} `);

export function runMatch(index: Index, match: string, brains: string[], limit: number): Hit[] {
  if (brains.length === 0) return [];
  const sql = `${SELECT} WHERE fts MATCH ? AND ${brainIn(brains)} ${ORDER} LIMIT ?`;
  return index.db.prepare(sql).all(match, ...brains, limit) as unknown as Hit[];
}

/** The words a page may match some of: the significant ones, unless the query has none. */
export const someOf = (query: string): string[] => {
  const significant = significantWords(query);
  return significant.length > 0 ? significant : wordsOf(query);
};

/**
 * The pages with every word of the query, then, when there are none or `more` asks for them, those with some of the
 * significant ones, each in text order.
 */
export function byWords(index: Index, query: string, brains: string[], limit: number, more: boolean): Hit[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const all = runMatch(index, prefixQuery(words, "AND"), brains, limit);
  if (words.length === 1 || (all.length > 0 && !more)) return all;
  const seen = new Set(all.map(keyOf));
  return [
    ...all,
    ...runMatch(index, prefixQuery(someOf(query), "OR"), brains, limit).filter((h) => !seen.has(keyOf(h))),
  ].slice(0, limit);
}

/**
 * Full-text search over the given brains (keys), best first. All the words must match; when no page has them all,
 * the pages that have some of the significant ones come back instead, so that `la` or `the` alone finds nothing.
 * Case and diacritics do not matter.
 */
export function search(index: Index, query: string, brains: string[], limit = DEFAULT_LIMIT): Hit[] {
  return byWords(index, query, brains, limit, false);
}
