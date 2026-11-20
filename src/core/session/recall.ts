import { isAbsolute, join, relative, sep } from "node:path";
import { readBrainFile } from "../brain/file.ts";
import { globMatches } from "../brain/applies.ts";
import { resolveChain } from "../config/chain.ts";
import type { MachineConfig } from "../config/machine.ts";
import { brainIn, openIndexAsItIs, type Index } from "../index/db.ts";
import { stemMeets, stemsMet } from "../index/similar.ts";
import { significantWords, stemOf, wordsOf } from "../index/text.ts";
import { keyOf, vectorStore, type PageKey, type VectorStore } from "../index/vectors.ts";
import { openMeaning, type SemanticDeps } from "../semantic/meaning.ts";
import { brainRepoOfKey } from "../config/brain-ref.ts";
import { readJournal } from "./journal.ts";
import { ruleSaid } from "./summary.ts";
import { historyRow, type Message } from "./message.ts";
import { RECALL_MIN_PAGES } from "./recall-floor.ts";
import { fileOutpaced, recordedOutpaced } from "../outpaced.ts";
import { REVIEW_ADVICE, expiredSince, pageDay, reviewOf, reviewSaid, type Review } from "../review.ts";
import { lintReportPath } from "../state.ts";
import { lastTouchOf } from "../touched.ts";
import { plural, readJson } from "../util.ts";

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
  /** Why it is due a second look, when it is (§4.4): said at the end of its line. */
  review?: Review;
  /** For a Rule about the file (§3.4): its text, which is given whole, as a Rule is. */
  rule?: string;
}

/** A page the recall weighs: what its line would say, and what decides whether it may be named. */
export interface RecallPage extends Recalled {
  kind: string | null;
  status: string | null;
  /** Its other names, which the words of a prompt may meet (§4.7). */
  aliases?: string;
}

/**
 * How a recall's pages were found (§4.7): by meaning, by a prompt's words where meaning cannot run, or by the path of
 * a file the agent read or changed, which a page says it is about.
 */
export type RecallBy = "meaning" | "words" | "path";

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
  input: { cwd: string; prompt: string; sessionId?: string; now?: Date },
  semantic: SemanticDeps,
  tuning: RecallTuning = RECALL_TUNING,
): Promise<Recall> {
  if (!asksRecall(input.prompt)) return NOTHING;
  const chain = resolveChain(input.cwd, config, home);
  if (chain.inside !== undefined) return NOTHING;
  const keys = chain.links.filter((l) => l.cloned).map((l) => l.key);
  if (keys.length === 0) return NOTHING;
  const roots = new Map(chain.links.map((l) => [l.key, l.path]));
  const found = async (): Promise<Recall> => {
    const recall = await recallIn(home, keys, input, semantic, tuning);
    return { ...recall, pages: marked(home, roots, recall.pages, input.now ?? new Date()) };
  };
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Recall>((done) => {
    timer = setTimeout(() => done(NOTHING), tuning.budgetMs);
  });
  try {
    return await Promise.race([late, found()]);
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
    const seen = seenIn(home, input.sessionId);
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

/**
 * What an agent of this session was already given, by key: not named again (§4.7). The session itself, or one of its
 * subagents, each with a context of its own: what a subagent was named the session was not, nor the reverse. A page
 * the session opened is known to it and is named to no one again.
 */
function seenIn(
  home: string,
  sessionId: string | undefined,
  /** The subagent asking, or none for the session itself. */
  agent?: string,
  /** For the Rules about a file: only what the agent still holds of them, which a compaction took. */
  rules = false,
): Set<string> {
  let entries = sessionId === undefined ? [] : readJournal(home, sessionId);
  if (rules)
    entries = entries
      .slice(entries.findLastIndex((e) => e.what === "summary" && e.source === "compact") + 1)
      .filter((e) => e.what === "recalled");
  return new Set(
    entries.flatMap((e) =>
      e.what === "opened" && e.brain !== undefined && e.path !== undefined
        ? [keyOf({ brain: e.brain, path: e.path })]
        : e.what === "recalled" && e.agent === agent
          ? (e.hits ?? []).map(keyOf)
          : [],
    ),
  );
}

/**
 * The pages of the project brain that say they are about a file (§3.3 `applies_to`, §4.7), for a file the agent reads
 * or changes in the chain of `cwd`: three at most, by path, none a Rule, retired, superseded, or already opened or
 * recalled in this session. None inside a brain, for a file outside the project folder, or with no index: it reads the
 * index as it is, with no model, and writes nothing.
 */
export async function recallForPath(
  home: string,
  config: MachineConfig,
  input: { cwd: string; file: string; sessionId?: string; now?: Date; agent?: string },
  max: number = RECALL_MAX,
): Promise<Recalled[]> {
  const chain = resolveChain(input.cwd, config, home);
  if (chain.inside !== undefined || chain.root === undefined || chain.project === undefined) return [];
  if (!chain.links.some((l) => l.cloned && l.key === chain.project)) return [];
  const rel = relative(chain.root, isAbsolute(input.file) ? input.file : `${input.cwd}${sep}${input.file}`);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return [];
  const path = rel.split(sep).join("/");
  const index = await openIndexAsItIs(home);
  if (index === undefined) return [];
  try {
    const rows = index.db
      .prepare(`
        SELECT a.glob AS glob, p.brain AS brain, p.path AS path, p.id AS id, p.title AS title, p.summary AS summary,
               p.kind AS kind, p.status AS status
        FROM applies a JOIN pages p ON p.brain = a.brain AND p.path = a.path AND p.hash = a.hash
        WHERE a.brain = ? ORDER BY p.path`)
      .all(chain.project) as unknown as (RecallPage & { glob: string })[];
    const seen = seenIn(home, input.sessionId, input.agent);
    const given = seenIn(home, input.sessionId, input.agent, true);
    const roots = new Map(chain.links.map((l) => [l.key, l.path]));
    const found = new Map<string, Recalled>();
    const rules: Recalled[] = [];
    for (const { glob, kind, status, ...page } of rows) {
      if (status !== null || !globMatches(glob, path)) continue;
      if (kind === "rule") {
        // A Rule about this file (§3.4): given whole, once, and again after a compaction took it.
        if (given.has(keyOf(page)) || rules.some((r) => keyOf(r) === keyOf(page))) continue;
        const read = readBrainFile(join(roots.get(page.brain) ?? "", page.path));
        if (read.ok) rules.push({ ...page, rule: ruleSaid(read.file.body) });
      } else if (!found.has(keyOf(page)) && !seen.has(keyOf(page))) found.set(keyOf(page), page);
    }
    if (rules.length > 0)
      return [
        ...rules,
        ...marked(home, roots, [...found.values()].slice(0, max), input.now ?? new Date(), {
          folder: chain.root,
          file: path,
        }),
      ];
    return marked(home, roots, [...found.values()].slice(0, max), input.now ?? new Date(), {
      folder: chain.root,
      file: path,
    });
  } catch {
    // An index an older version made has no such table: no page says what it is about yet.
    return [];
  } finally {
    index.close();
  }
}

/**
 * The pages a recall names, each with its mark when it is due a second look (§4.4, §4.7). Past its date is read from
 * the page. Not changed or confirmed is taken from the report last recorded for the brain, since a hook does not read
 * a brain's whole history, and then asked of the page as it is: one question to git, for a page the report lists.
 * A page that cannot be read, or a report that cannot, marks nothing: a mark never fails a recall.
 */
function marked(
  home: string,
  roots: Map<string, string>,
  pages: Recalled[],
  now: Date,
  /** The file the pages were named for, relative to the project folder: the mark is then about that file (§4.7). */
  at?: { folder: string; file: string },
): Recalled[] {
  let recorded: Record<string, { report?: { unconfirmed?: { path: string }[] } }> | undefined;
  return pages.map((page) => {
    try {
      const root = roots.get(page.brain);
      const read = root === undefined ? undefined : readBrainFile(join(root, page.path));
      if (root === undefined || read === undefined || !read.ok) return page;
      // What the code did after the page comes first: at a file, asked of git for that file; at a prompt, the report's.
      const listed = at === undefined ? recordedOutpaced(home, page.brain).pages.get(page.path) : undefined;
      if (at !== undefined || listed !== undefined) {
        const touched = lastTouchOf(root, page.path);
        const day = pageDay(read.file, touched);
        const outpaced = at !== undefined && day !== undefined ? fileOutpaced(at.folder, day, at.file) : listed;
        const review = outpaced === undefined ? undefined : reviewOf(page.path, read.file, touched, now, outpaced);
        if (review?.reason === "outpaced") return { ...page, review };
      }
      const expired = expiredSince(read.file, now);
      if (expired !== undefined) return { ...page, review: { reason: "expired" as const, since: expired } };
      recorded ??= readJson(lintReportPath(home)) ?? {};
      if (!(recorded[page.brain]?.report?.unconfirmed ?? []).some((u) => u.path === page.path)) return page;
      const review = reviewOf(page.path, read.file, lastTouchOf(root, page.path), now);
      return review === undefined ? page : { ...page, review };
    } catch {
      return page;
    }
  });
}

/** What a prompt's context carries for the pages it recalled (§4.7): one line each, under what to do with them. */
export function recallText(all: Recalled[], by: RecallBy = "meaning"): string {
  const rules = all.filter((p) => p.rule !== undefined);
  const pages = all.filter((p) => p.rule === undefined);
  // The Rules about the file first, whole (§3.4), under the room one hook has; then the pages, one line each.
  const said: string[] = [];
  let room = RULES_ROOM;
  rules.forEach((r, i) => {
    const text = `### ${oneLine(r.title)} (${brainRepoOfKey(r.brain)}, ${oneLine(r.path)})\n\n${r.rule}`;
    if (room < 0) return;
    room -= text.length;
    said.push(
      room < 0
        ? `${plural(rules.length - i, "more Rule")} about this file: \`kioku page list --kind rule\` lists them, and \`kioku page show\` reads one.`
        : text,
    );
  });
  const rulesPart =
    rules.length === 0
      ? []
      : [
          "## Kioku: Rules about this file",
          "",
          "The project brain's Rules for the file you just read or are changing. They hold from now on, as every Rule of this session does.",
          "",
          said.join("\n\n"),
        ];
  if (pages.length === 0) return rulesPart.join("\n");
  return [
    ...rulesPart,
    ...(rulesPart.length > 0 ? [""] : []),
    by === "path" ? "## Kioku: pages about this file" : "## Kioku: pages that may bear on this prompt",
    "",
    `Found by ${by === "words" ? "the words of this prompt" : by === "path" ? "the file you just read or are changing, which each says it is about," : "meaning"} in the brains of this session. Read one with \`kioku page show <path> --brain <brain>\` before relying on it; the line here is only its summary.${pages.some((p) => p.review !== undefined) ? ` A line that ends in brackets is due a second look: ${REVIEW_ADVICE}.` : ""}`,
    "",
    ...pages.map((p) => {
      const summary = oneLine(p.summary);
      return `- ${oneLine(p.title)}${summary === "" ? "" : `: ${summary}`} (${brainRepoOfKey(p.brain)}, ${oneLine(p.path)})${p.review === undefined ? "" : ` [${reviewSaid(p.review, by === "path")}]`}`;
    }),
  ].join("\n");
}

/** The most the Rules about one file take of what the hook adds, under the host's cap of 10,000 characters a hook (§4.1). */
const RULES_ROOM = 6000;

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
