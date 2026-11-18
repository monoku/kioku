import type { Index } from "./db.ts";
import { runMatch, type Hit } from "./search.ts";
import { significantWords, stemOf, titleHolds } from "./text.ts";

/** A page is the same subject as a new one when at least this share of the new title's words meet the page's. */
export const SIMILAR_MIN_OVERLAP = 0.5;
/** ... and at least this many do, so one shared word never makes two pages the same subject. */
export const SIMILAR_MIN_WORDS = 2;
/** The most similar pages `save` shows the agent. */
export const SIMILAR_LIMIT = 5;
/** How many candidates the full-text query hands to the overlap test. */
const SIMILAR_CANDIDATES = 25;

export interface Subject {
  title: string;
  aliases?: string[];
  body?: string;
}

/**
 * The pages of one brain on the same subject as a new page (§1.4, §4.3): the ones whose title, aliases or summary
 * share the words that say what the new page is about — its title and aliases, or the start of its body when those
 * are too short to tell. Full text alone, never the model: a page whose title holds every word of the new title
 * first, then by the share of the new page's words each holds, then by full-text rank; weak matches are left out by
 * the cut-offs above.
 */
export function similarPages(index: Index, brain: string, subject: Subject): Hit[] {
  let words = significantWords([subject.title, ...(subject.aliases ?? [])].join(" "));
  if (words.length < SIMILAR_MIN_WORDS && subject.body)
    words = [...new Set([...words, ...significantWords(subject.body).slice(0, 8)])];
  if (words.length === 0) return [];
  const stems = [...new Set(words.map(stemOf))];
  const candidates = runMatch(index, stems.map((s) => `"${s}"*`).join(" OR "), [brain], SIMILAR_CANDIDATES);
  const strong = titleHolds(subject.title);

  const scored = candidates.map((hit, rank) => {
    const matched = stemsMet(stems, `${hit.title} ${hit.summary} ${aliasesOf(index, brain, hit.path)}`);
    return { hit, rank, matched, overlap: matched / stems.length, strong: strong(hit) };
  });
  return scored
    .filter((s) => s.overlap >= SIMILAR_MIN_OVERLAP && s.matched >= Math.min(SIMILAR_MIN_WORDS, stems.length))
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.overlap - a.overlap || a.rank - b.rank)
    .slice(0, SIMILAR_LIMIT)
    .map((s) => s.hit);
}

/**
 * How many of `stems` meet the words of a text. Only the text's significant words count, and a stem meets a word by
 * being equal or by one being the start of the other when it is at least four letters: `in` or `be` at the start of
 * `include` or `before` is not a meeting.
 */
export function stemsMet(stems: string[], text: string): number {
  const theirs = significantWords(text).map(stemOf);
  return stems.filter((s) => theirs.some((t) => stemMeets(s, t))).length;
}

/** Whether two stems meet: equal, or one the start of the other when it is at least four letters. */
export const stemMeets = (s: string, t: string): boolean =>
  t === s || (t.length >= 4 && s.startsWith(t)) || (s.length >= 4 && t.startsWith(s));

export function aliasesOf(index: Index, brain: string, path: string): string {
  const row = index.db.prepare("SELECT aliases FROM pages WHERE brain = ? AND path = ?").get(brain, path) as
    | { aliases: string }
    | undefined;
  return row?.aliases ?? "";
}

/** The share of the shorter title's words the other's title meets before `brain lint` reports the pair as one subject (§4.4). */
export const SIMILAR_REPORT_SHARE = 0.6;

/**
 * Whether a page and a hit of `similarPages` are on one subject for a report (§4.4), or for what `save` says of the
 * chain's other brains (§1.4). `save` asks "is there a page on this subject?" of the brain it writes to and answers by
 * a loose rule, because the agent decides there. What is only said, to a person or beside a write, is stricter: the
 * two titles, with their aliases, share most of what the shorter one says.
 */
export function sameSubject(index: Index, title: string, aliases: string[], hitBrain: string, hit: Hit): boolean {
  const mine = [...new Set(significantWords([title, ...aliases].join(" ")).map(stemOf))];
  const theirText = `${hit.title} ${aliasesOf(index, hitBrain, hit.path)}`;
  const theirs = new Set(significantWords(theirText).map(stemOf));
  const shared = stemsMet(mine, theirText);
  return shared >= 2 && shared / Math.min(mine.length, theirs.size) >= SIMILAR_REPORT_SHARE;
}
