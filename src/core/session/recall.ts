import { resolveChain } from "../config/chain.ts";
import type { MachineConfig } from "../config/machine.ts";
import { brainIn, openIndexAsItIs, type Index } from "../index/db.ts";
import { stemMeets, stemsMet } from "../index/similar.ts";
import { significantWords, stemOf, wordsOf } from "../index/text.ts";
import { keyOf, vectorStore, type PageKey, type VectorStore } from "../index/vectors.ts";
import { openMeaning, type SemanticDeps } from "../semantic/meaning.ts";
import { brainRepoOfKey } from "../config/brain-ref.ts";
import { readJournal } from "./journal.ts";
import { historyRow, type Message } from "./message.ts";
import { RECALL_MIN_PAGES } from "./recall-floor.ts";
import { plural } from "../util.ts";

/**
 * At each prompt (§4.7): the few pages that stand out by meaning, named for the agent, never their text. The agent
 * does not search for what it does not know the brains hold, so the memory comes to it. Where meaning cannot run, with
 * no model on the machine or search kept to full text, the pages that stand out by the prompt's words are named instead.
 *
 * The model scores every page close to every prompt, so a similarity says little alone: a page stands out by how far
 * it is above the mean of the session's pages, in standard deviations. The numbers are chosen with `pnpm eval:recall`
 * and what the agent does with them measured with `pnpm eval:memory` (§4.7), not derived. `eval:recall` scores with the
 * functions below, so that it measures what the hook does.
 */

/**
 * How many standard deviations above the mean of the session's pages a page must be to stand out, the better of the
 * page whole and its best part (§4.3), with a significant word of the prompt in its title or summary; and how many with
 * none. Chosen with `pnpm eval:recall` (§4.7): on its labelled set, 19 of 20 found and 2 of 12 prompts with nothing to
 * find given a page (`variable` meeting `variables` is one of the two); the page whole alone found 18 at best, and 3 alone without a word gave 4 of the 12 a page.
 */
const RECALL_Z = 3;
const RECALL_Z_ALONE = 4;
/**
 * By words (§4.7): a page stands out when its title, aliases and summary hold at least this many significant words of
 * the prompt, by stem, weighing together at least `RECALL_WORDS_WEIGHT`. A word weighs by how few of the session's
 * pages hold it: 1 when one page does, 0 when half of them do. And it is near the heaviest: at least
 * `RECALL_WORDS_NEAR` of that page's weight, so a page that only shares the prompt's commoner words is not named beside
 * the one it is about. Chosen with `pnpm eval:recall -- --words`: on its labelled set, 13 of 20 found, none of 12
 * prompts with nothing to find given a page, and 10 pages named beside the one wanted (18 with no `near`); a weight of
 * 1.25 gave 1 of the 12 a page, and words alone cannot find a page in another language than the prompt's.
 */
const RECALL_WORDS_LEAST = 2;
const RECALL_WORDS_WEIGHT = 1.5;
const RECALL_WORDS_NEAR = 2 / 3;
/** The most pages one prompt recalls. */
const RECALL_MAX = 3;
/** A prompt with fewer words than this asks nothing a page could bear on. */
const RECALL_MIN_WORDS = 3;
/** Past this the hook gives up and adds nothing: every prompt waits for it. */
const RECALL_BUDGET_MS = 1000;

/** A page a prompt recalled: what its line says, never its text. */
export interface Recalled {
  brain: string;
  path: string;
  id: string | null;
  title: string;
  summary: string;
}

/** A page the recall weighs: what its line would say, and what decides whether it may be named. */
export interface RecallPage extends Recalled {
  kind: string | null;
  status: string | null;
  /** Its other names, which the words of a prompt may meet (§4.7). */
  aliases?: string;
}

/** How a prompt's pages were found (§4.7): by meaning, or by their words where meaning cannot run. */
export type RecallBy = "meaning" | "words";

/** What a prompt recalled, and how. */
export interface Recall {
  by: RecallBy;
  pages: Recalled[];
}
const NOTHING: Recall = { by: "meaning", pages: [] };

/** How the recall is tuned; a test gives other numbers to work on a few pages. */
export interface RecallTuning {
  z: number;
  alone: number;
  max: number;
  minPages: number;
  budgetMs: number;
  /** By words: the least a page's words in common with the prompt weigh together, and the least share of the heaviest page's; absent, the tool's. */
  wordsWeight?: number;
  wordsNear?: number;
}
export const RECALL_TUNING: RecallTuning = {
  z: RECALL_Z,
  alone: RECALL_Z_ALONE,
  max: RECALL_MAX,
  minPages: RECALL_MIN_PAGES,
  budgetMs: RECALL_BUDGET_MS,
  wordsWeight: RECALL_WORDS_WEIGHT,
  wordsNear: RECALL_WORDS_NEAR,
};

/** Each page's z among scored ones: how many standard deviations above their mean; none when they all score alike. */
export function zScores(scored: (PageKey & { score: number })[]): Map<string, number> {
  const mean = scored.reduce((s, x) => s + x.score, 0) / scored.length;
  const sd = Math.sqrt(scored.reduce((s, x) => s + (x.score - mean) ** 2, 0) / scored.length);
  return sd === 0 ? new Map() : new Map(scored.map((x) => [keyOf(x), (x.score - mean) / sd]));
}

/**
 * The pages that stand out, the furthest first: at least `z` with a word of the prompt (`shares`), or `alone` with
 * none; `max` at most, none of `skip`.
 */
export function standOut<T extends PageKey & { z: number }>(
  pages: T[],
  skip: (t: T) => boolean,
  shares: (t: T) => boolean,
  tuning: Pick<RecallTuning, "z" | "alone" | "max">,
): T[] {
  return [...pages]
    .sort((a, b) => b.z - a.z)
    .filter((x) => (x.z >= tuning.alone || (x.z >= tuning.z && shares(x))) && !skip(x))
    .slice(0, tuning.max);
}

/**
 * Whether a page's title or summary shares a significant word with the prompt, compared by stem (§4.7): what tells a
 * page on the subject from one that only sounds like it. Two words meet as two pages' do for `save` (§1.4): by the same
 * stem, or by one's stem starting the other's, since a stem alone parts `deploys` from `deploying`.
 */
export function sharesWord(prompt: string): (page: { title: string; summary: string }) => boolean {
  const asked = [...new Set(significantWords(prompt).map(stemOf))];
  return (page) => stemsMet(asked, `${page.title} ${page.summary}`) > 0;
}

/**
 * How much each page's words in common with a prompt weigh (§4.7), for the pages that hold at least `least` of its
 * significant words, by stem, in their title, aliases and summary; the heaviest first. A word weighs by how few of
 * these pages hold it, `ln(N / (1 + n)) / ln(N / 2)` for `n` of `N`: one page alone 1, half of them 0, so `the app`
 * or the project's name says little and `refund` says much.
 */
export function wordStanding<T extends { title: string; summary: string; aliases?: string }>(
  prompt: string,
  pages: T[],
  least: number = RECALL_WORDS_LEAST,
): { page: T; words: number; weight: number }[] {
  const asked = [...new Set(significantWords(prompt).map(stemOf))];
  if (asked.length === 0 || pages.length < 3) return [];
  const theirs = pages.map((p) => [
    ...new Set(significantWords(`${p.title} ${p.aliases ?? ""} ${p.summary}`).map(stemOf)),
  ]);
  const scale = Math.log(pages.length / 2);
  const weightOf = new Map(
    asked.map((a) => {
      const n = theirs.filter((t) => t.some((x) => stemMeets(a, x))).length;
      return [a, Math.max(0, Math.log(pages.length / (1 + n)) / scale)];
    }),
  );
  return pages
    .flatMap((page, i) => {
      const met = asked.filter((a) => theirs[i]!.some((x) => stemMeets(a, x)));
      return met.length < least
        ? []
        : [{ page, words: met.length, weight: met.reduce((s, a) => s + weightOf.get(a)!, 0) }];
    })
    .sort((a, b) => b.weight - a.weight);
}

/**
 * The pages that stand out by words (§4.7), the heaviest first: at least `weight`, and at least `near` of the heaviest
 * page's; `max` at most, none of `skip`.
 */
export function standOutByWords<T extends { weight: number }>(
  standing: T[],
  skip: (t: T) => boolean,
  tuning: { weight: number; near: number; max: number },
): T[] {
  const top = standing[0]?.weight ?? 0;
  return standing
    .filter((x) => x.weight >= tuning.weight && x.weight >= tuning.near * top && !skip(x))
    .slice(0, tuning.max);
}

/** Whether a page may be recalled at all (§4.7): not a Rule, whole in every summary; not retired or superseded (§3.5). */
export const recallable = (page: { kind: string | null; status: string | null }): boolean =>
  page.kind !== "rule" && page.status === null;

/**
 * The pages of these brains (keys) with a vector of this model for their current content (§4.3): a page changed since
 * its vector was made waits for the next `sync`, as one with none does. Its parts are written with it, so they are current too.
 */
export function currentPages(index: Index, brains: string[], model: string): RecallPage[] {
  if (brains.length === 0) return [];
  return index.db
    .prepare(`
      SELECT p.brain AS brain, p.path AS path, p.id AS id, p.title AS title, p.summary AS summary, p.kind AS kind, p.status AS status
      FROM pages p JOIN vectors v ON v.brain = p.brain AND v.path = p.path AND v.hash = p.hash AND v.model = ?
      WHERE ${brainIn(brains)}`)
    .all(model, ...brains) as unknown as RecallPage[];
}

/** Every page of these brains (keys), as the index has it: what the recall by words weighs (§4.7). */
export function indexedPages(index: Index, brains: string[]): RecallPage[] {
  if (brains.length === 0) return [];
  return index.db
    .prepare(`
      SELECT p.brain AS brain, p.path AS path, p.id AS id, p.title AS title, p.summary AS summary, p.aliases AS aliases,
             p.kind AS kind, p.status AS status
      FROM pages p WHERE ${brainIn(brains)}`)
    .all(...brains) as unknown as RecallPage[];
}

/**
 * How far out each page stands for a prompt (§4.7): its z the better of the page whole and its part nearest the prompt,
 * each among the given pages.
 */
export function standingOf(store: VectorStore, prompt: Float32Array, pages: PageKey[]): (PageKey & { z: number })[] {
  const whole = store.nearest(prompt, pages.length, pages);
  const zWhole = zScores(whole);
  const zPart = zScores(store.bestParts(prompt, pages));
  return whole.flatMap((x) => {
    const z = Math.max(zWhole.get(keyOf(x)) ?? -Infinity, zPart.get(keyOf(x)) ?? -Infinity);
    return z === -Infinity ? [] : [{ brain: x.brain, path: x.path, z }];
  });
}

/** Whether a prompt asks for a recall at all (§4.7): not a command, and enough words to bear on a page. */
export const asksRecall = (prompt: string): boolean =>
  !prompt.trimStart().startsWith("/") && wordsOf(prompt).length >= RECALL_MIN_WORDS;

/**
 * The pages a prompt recalls in the chain of `cwd` (§4.7), or none: inside a brain, without an index, among too few
 * pages, past the budget, or when none stands out. By meaning where the model is on the machine and enough pages have
 * a current vector; else by the prompt's words. Never fetches the model, never creates, rebuilds or writes the index:
 * a page without a current vector waits for the next `sync`. The prompt is embedded and kept nowhere.
 */
export async function recallFor(
  home: string,
  config: MachineConfig,
  input: { cwd: string; prompt: string; sessionId?: string },
  semantic: SemanticDeps,
  tuning: RecallTuning = RECALL_TUNING,
): Promise<Recall> {
  if (!asksRecall(input.prompt)) return NOTHING;
  const chain = resolveChain(input.cwd, config, home);
  if (chain.inside !== undefined) return NOTHING;
  const keys = chain.links.filter((l) => l.cloned).map((l) => l.key);
  if (keys.length === 0) return NOTHING;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Recall>((done) => {
    timer = setTimeout(() => done(NOTHING), tuning.budgetMs);
  });
  try {
    return await Promise.race([late, recallIn(home, keys, input, semantic, tuning)]);
  } finally {
    clearTimeout(timer);
  }
}

async function recallIn(
  home: string,
  keys: string[],
  input: { prompt: string; sessionId?: string },
  semantic: SemanticDeps,
  tuning: RecallTuning,
): Promise<Recall> {
  const meaning = await openMeaning(home, semantic);
  const index = await openIndexAsItIs(home);
  if (index === undefined) return NOTHING;
  try {
    // What this session already opened or was already recalled is not named again.
    const seen = new Set(
      input.sessionId === undefined
        ? []
        : readJournal(home, input.sessionId).flatMap((e) =>
            e.what === "opened" && e.brain !== undefined && e.path !== undefined
              ? [keyOf({ brain: e.brain, path: e.path })]
              : e.what === "recalled"
                ? (e.hits ?? []).map(keyOf)
                : [],
          ),
    );
    const named = ({ kind: _k, status: _s, aliases: _a, ...page }: RecallPage): Recalled => page;
    const current = "embedder" in meaning ? currentPages(index, keys, meaning.embedder.model) : [];
    // By meaning, where the model is here and enough pages have a current vector: among a few the measure says nothing (§4.7).
    if ("embedder" in meaning && current.length >= tuning.minPages) {
      const byKey = new Map(current.map((p) => [keyOf(p), p]));
      const [q] = await meaning.embedder.embed([input.prompt], "query");
      const standing = standingOf(vectorStore(index, meaning.embedder.model), q!, current);
      const pageOf = (k: PageKey): RecallPage => byKey.get(keyOf(k))!;
      const shares = sharesWord(input.prompt);
      const pages = standOut(
        standing,
        (k) => !recallable(pageOf(k)) || seen.has(keyOf(k)),
        (k) => shares(pageOf(k)),
        tuning,
      ).map((k) => named(pageOf(k)));
      return { by: "meaning", pages };
    }
    // By words, where meaning cannot run: under the same floor the summary names the pages itself (§4.1).
    const all = indexedPages(index, keys);
    if (all.length < tuning.minPages) return NOTHING;
    const pages = standOutByWords(wordStanding(input.prompt, all.filter(recallable)), (x) => seen.has(keyOf(x.page)), {
      weight: tuning.wordsWeight ?? RECALL_WORDS_WEIGHT,
      near: tuning.wordsNear ?? RECALL_WORDS_NEAR,
      max: tuning.max,
    }).map((x) => named(x.page));
    return { by: "words", pages };
  } finally {
    index.close();
  }
}

/** What a prompt's context carries for the pages it recalled (§4.7): one line each, under what to do with them. */
export function recallText(pages: Recalled[], by: RecallBy = "meaning"): string {
  return [
    "## Kioku: pages that may bear on this prompt",
    "",
    `Found by ${by === "words" ? "the words of this prompt" : "meaning"} in the brains of this session. Read one with \`kioku page show <path> --brain <brain>\` before relying on it; the line here is only its summary.`,
    "",
    ...pages.map((p) => {
      const summary = oneLine(p.summary);
      return `- ${oneLine(p.title)}${summary === "" ? "" : `: ${summary}`} (${brainRepoOfKey(p.brain)}, ${oneLine(p.path)})`;
    }),
  ].join("\n");
}

/**
 * A field of a page on one line: what a brain's author wrote, a title of several lines say, never adds a line, and so
 * never a heading, to what the agent is given (threat model: a page cannot restructure what Kioku injects).
 */
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * What the person is told of a prompt's recall (§1.2): the history's `recalled` row on the brand's line, with the
 * brains it came from. The pages are the memory history's to list, where they open.
 */
export function recalledRow(pages: Recalled[], label: (brain: string) => string, by: RecallBy = "meaning"): Message {
  const brains = [...new Set(pages.map((p) => label(p.brain)))];
  return historyRow("recalled", `by ${by} · ${plural(pages.length, "page")}`, brains);
}
