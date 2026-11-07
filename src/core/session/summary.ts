import { FRONT_PAGE } from "../brain/brain.ts";
import { brainRepo } from "../config/brain-ref.ts";
import { LOAD_FIRST_MAX, type LoadFirst } from "../brain/load-first.ts";
import { evidenceOf, kindOf, sectionBody, withoutKept, type BrainFile } from "../brain/file.ts";
import { placementOf } from "../brain/kinds.ts";
import { depthOf, isUnder } from "../brain/namespace-name.ts";
import { resolveLink } from "../brain/paths.ts";
import { trustCommand, type ChainLink } from "../config/chain.ts";
import type { BrainConfig } from "../config/folder-config.ts";
import type { NewPage } from "./views.ts";
import { plural } from "../util.ts";

/**
 * The start-of-session summary (§4.1): composed from the files on disk with no model call, in the order of §4.1, in
 * two parts, each injected by a hook of its own and each cut so that it never passes the host's cap for one hook.
 *
 * How to use the memory: an opening that is never cut names the brains and what the agent must know it works without;
 * then, while they fit, the project brain's front page, trimmed, and the Rules of the three brains, each its Rule and
 * its Why. What the memory holds: a heading that names the brains; then, while they fit, the pages to load first; the
 * Skills, one line each; the current decisions of the project brain, newest first; the instincts with recent
 * evidence, personal then project; what is new in the shared brains; the maintenance count per brain; and a last line
 * that counts the pages and says that search finds them. In each part the first item that does not fit ends it, so
 * nothing later jumps ahead of something earlier. Memories that are facts and lessons are never in it.
 *
 * This composes what `summary-load.ts` read: nothing here touches the disk.
 */

/**
 * Claude Code's cap on one hook's output, in characters, which each part takes (§4.1): past it the host keeps a
 * preview and leaves the rest in a file. Measured here in UTF-16 units, which never undercounts.
 */
export const SUMMARY_CAP = 10_000;
/** How much of the project's front page goes in. Chosen, not measured. */
export const INDEX_TRIM = 2_000;

/** The least a cap may be set to: below it the opening and the closing line alone would not fit. */
export const MIN_SUMMARY_CAP = 1_000;

/** Words as the summary compares them: lower case, no diacritics, letters and digits of four or more, cut to five letters. */
const wordsOf = (s: string): string[] =>
  (
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((w) => w.length >= 4);
const stemOfWord = (w: string): string => w.slice(0, 5);

/** An instinct's evidence is recent within this many days (§4.1 item 5). Chosen, not measured. */
export const RECENT_EVIDENCE_DAYS = 90;
/** One line of a list never passes this. */
const LINE_MAX = 300;

/** A brain as the session start knows it, before its files are read. */
export interface SummaryBrainSource {
  link: ChainLink;
  /** This brain is the project brain (for a personal project, the personal brain is). */
  isProject: boolean;
  /** Pages added or changed by others since this machine's last session; shared brains only. */
  news?: NewPage[];
  /** How many things `brain lint` has to review, when a report exists (§4.4). */
  lint?: number;
}

export interface SummaryInput {
  /** How many characters the summary may take: the host's cap, `SUMMARY_CAP`, which the session always uses (§4.1); a test gives less to see the cut. */
  cap?: number;
  /** Words that say what this session is about, from the repository's folder and the project brain's repository; decisions and instincts that name them come first. */
  hints?: string[];
  brains: SummaryBrain[];
  /** Brains the chain needs that are not on disk; `sync` is cloning them. */
  missing: ChainLink[];
  /** Brains the repository names that this machine does not trust: not loaded (§2.4). */
  untrusted?: ChainLink[];
  /** Links by name alone to a brain this machine does not have (§2.4). */
  notHere?: ChainLink[];
  /** The brain whose folder the session is in (§2.7), by key: the session works on it. */
  inside?: string;
  /** Where the team came from: the machine's when the folder names none (§2.4), which the team's line says. */
  teamFrom?: "folder" | "machine";
  /** The brains of the chain this session leaves out because it is inside a brain, which is loaded alone (§2.7). */
  notLoaded?: { tier: string; key: string }[];
  /** Problems with `kioku.yaml` files along the chain; the opening's, as the next three are. */
  problems?: string[];
  /** Shared brains whose last publication did not complete, by key, with the reason. */
  pending?: Record<string, string>;
  /** Brains whose last `sync` failed, by key, with the reason. */
  syncFailures?: Record<string, string>;
  /** Shared brains that hold changes of this machine set aside because they conflicted with what others published. */
  conflicts?: Record<string, { path: string; branches: string[] }>;
  now: Date;
}

/** A page of a brain, parsed. */
export interface SummaryDoc {
  rel: string;
  file: BrainFile;
}

/** A brain with everything the summary says of it, read. */
export interface SummaryBrain extends SummaryBrainSource {
  config?: BrainConfig;
  broken?: string;
  /** Its pages but the front page, the retired and the unreadable. */
  docs: SummaryDoc[];
  /** What each declared namespace's index says it is for, when it says something of its own. */
  descriptions?: Map<string, string>;
  /** The links of each declared namespace's `## Load first`. */
  loadFirst?: Map<string, LoadFirst["links"]>;
  /** Its front page's text; absent when it does not read. */
  front?: string;
}

const str = (d: SummaryDoc, key: string): string | undefined => d.file.front.getString(key)?.trim() || undefined;
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
/** The news of one brain the summary lists, newest first; the rest is counted, so the list always fits whole (§4.1). */
export const NEWS_MAX = 10;

const clip = (s: string, max: number = LINE_MAX): string => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const nameOf = (b: SummaryBrain): string => brainRepo(b.link.ref);
const titleOf = (d: SummaryDoc): string => oneLine(str(d, "title") ?? d.rel);
const withSummary = (d: SummaryDoc): string => {
  const s = str(d, "summary");
  return s ? `${titleOf(d)}: ${oneLine(s)}` : titleOf(d);
};

/** Headings of a page pushed two levels down, so they sit under the summary's own `###` items. */
function demote(text: string): string {
  let fence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^(```|~~~)/.test(line)) fence = !fence;
      return !fence && /^#{1,4}[ \t]/.test(line) ? `##${line}` : line;
    })
    .join("\n");
}

/** A front page cut at a line boundary, saying so when something was left out. */
function trimIndex(text: string, where: string): string {
  const t = text.trim();
  if (t.length <= INDEX_TRIM) return t;
  const cut = t.slice(0, INDEX_TRIM);
  const at = cut.lastIndexOf("\n");
  return `${(at > INDEX_TRIM / 2 ? cut.slice(0, at) : cut).trimEnd()}\n\n(trimmed; the whole page is ${where})`;
}

/** Decisions that are history: marked `superseded_by`, or named by another decision's `supersedes` (§3.5). */
function superseded(docs: SummaryDoc[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs) {
    if (placementOf(d.rel)?.sub !== "decision") continue;
    if (str(d, "superseded_by") !== undefined) out.add(d.rel);
    const target = str(d, "supersedes");
    if (target !== undefined) for (const t of [resolveLink(d.rel, target), resolveLink("x", target)]) if (t) out.add(t);
  }
  return out;
}

/** A line that offers a page of a brain, for the count of §4.5. */
const offer = (text: string, b: SummaryBrain, d: SummaryDoc): Offer => ({
  text,
  page: { brain: b.link.key, id: d.file.front.getString("id") ?? null },
});

const newestFirst = (a: SummaryDoc, b: SummaryDoc): number => {
  const x = str(a, "created") ?? "";
  const y = str(b, "created") ?? "";
  return x < y ? 1 : x > y ? -1 : a.rel < b.rel ? -1 : 1;
};

const daysBefore = (now: Date, days: number): string => {
  const d = new Date(now.getTime() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** One line of a section that lists a page: what the line says, and which page it offers (§4.5). */
interface Offer {
  text: string;
  page: { brain: string; id: string | null };
}

/** Adds pieces in order while they fit under the cap, keeping room for the closing line. */
class Composer {
  private readonly parts: string[] = [];
  /** The pages whose line got in: what the session offered (§4.5). */
  readonly offered: { brain: string; id: string | null }[] = [];
  private used = 0;
  private stopped = false;
  private readonly room: number;

  constructor(cap: number, reserve: number) {
    this.room = cap - reserve;
  }

  /** The opening: always added. */
  must(text: string): void {
    this.parts.push(text);
    this.used += text.length + 1;
  }

  /** A section: its heading goes in with its first item, or not at all. `blocks` separates items of several lines. True when every item got in. */
  section(heading: string, items: (string | Offer)[], blocks = false): boolean {
    let first = true;
    for (const entry of items) {
      if (this.stopped) return false;
      const item = typeof entry === "string" ? entry : entry.text;
      const piece = first ? `\n${heading}\n\n${item}` : blocks ? `\n${item}` : item;
      if (this.used + piece.length + 1 > this.room) {
        this.stopped = true;
        return false;
      }
      if (typeof entry !== "string") this.offered.push(entry.page);
      this.parts.push(piece);
      this.used += piece.length + 1;
      first = false;
    }
    return true;
  }

  get cut(): boolean {
    return this.stopped;
  }

  text(closing?: string): string {
    const body = this.parts.join("\n");
    return closing === undefined ? body : `${body}\n\n${closing}`;
  }
}

/** The two parts of the summary (§4.1), by the hook that injects each. */
export type SummaryPart = "usage" | "holds";

/** What the summary says of a Rule (§4.1): its Rule and its Why; a Rule written without them, its body without what the tool keeps. */
function ruleText(body: string): string {
  const rule = sectionBody(body, "Rule");
  if (rule === undefined || rule === "") return withoutKept(body);
  const why = sectionBody(body, "Why");
  return why === undefined || why === "" ? rule : `${rule}\n\nWhy: ${why}`;
}

/** Said once under the brains of the opening (§4.1, §3.2): how a page gets a namespace, and how one is made. */
export const NAMESPACES_NOTE =
  'Pass `--namespace <path>` to `kioku page save`: the deepest namespace whose description fits what you save; one that fits needs no yes. When none fits, or the brain has none yet, make one with `kioku namespace add <path> --summary "…" --brain <brain>`, named and described for the area: the host asks the person to confirm it; on a no, use a namespace that exists or ask where.';

/** The most the namespaces take of the opening; past it descriptions go first, then the deepest levels, never the first (§4.1). */
const NAMESPACES_BUDGET = 1800;

/** One brain's namespaces, indented by depth, each with what it says it is for and how many pages it holds (§4.1). */
function namespaceLines(b: SummaryBrain): string[] {
  const declared = b.config?.namespaces ?? [];
  if (declared.length === 0) return [];
  const counts = new Map<string, number>(declared.map((n) => [n, 0]));
  for (const d of b.docs) {
    const place = placementOf(d.rel);
    const ns = place?.namespace ?? d.file.front.getString("namespace");
    if (ns !== undefined && counts.has(ns)) counts.set(ns, counts.get(ns)! + 1);
  }
  const render = (maxDepth: number, withText: boolean): string[] =>
    declared
      .filter((n) => depthOf(n) <= maxDepth)
      .map((n) => {
        const own = counts.get(n)!;
        const below = declared.filter((o) => o !== n && isUnder(o, n)).reduce((s, o) => s + counts.get(o)!, 0);
        const pages = `${plural(own, "page")}${below > 0 ? `, ${below} more under it` : ""}`;
        const text = withText
          ? b.descriptions?.get(n) === undefined
            ? "not described"
            : oneLine(b.descriptions.get(n)!).slice(0, 100)
          : undefined;
        return `${"  ".repeat(depthOf(n))}- ${n}${text === undefined ? "" : `: ${text}`} (${pages})`;
      });
  for (const [maxDepth, withText] of [
    [3, true],
    [3, false],
    [2, false],
    [1, false],
  ] as const) {
    const lines = render(maxDepth, withText);
    if (lines.join("\n").length <= NAMESPACES_BUDGET || maxDepth === 1) return lines;
  }
  return [];
}

/**
 * Said in the opening (§4.1): when to save. The skill, loaded on demand, says what to save as and how; the moment
 * itself must be recognised before anything is loaded, so the two tests and the usual moments travel with every session.
 */
export const WHEN_TO_SAVE =
  "Save on your own, without asking, the moment you learn something that will still be true in months and would change how you act in a later session: a correction and what the person wanted instead, a preference of tool, style or workflow, a decision and why, an error and how it was resolved, context the repository does not hold. At that moment load the `kioku` skill, which says what to save as and how. Never save secrets, and never personal remarks to a shared brain.";
/** The same in one line, for a cap that leaves the whole no room beside the brains (§4.1). */
export const WHEN_TO_SAVE_SHORT =
  "Save on your own, without asking, what will still be true in months and would change how you act later (corrections, preferences, decisions, errors resolved, context the repository lacks): load the `kioku` skill then.";

/** Said under the Skills of the summary (§4.1): a line is only a Skill's summary; its Steps are on its page. */
export const SKILLS_NOTE =
  "When one fits the task at hand, run `kioku page show <path> --brain <brain>` before starting and follow its Steps; the line here is only its summary.";

/** Said at the end of the first part when the cap cut the Rules (§4.1). */
export const RULES_CUT =
  "Not every Rule fits here: `kioku page list --kind rule` lists them, and `kioku page show` reads one.";

/** Both parts, one after the other: what an agent that reads the whole sees. */
export function composeSummary(input: SummaryInput): string {
  const { usage, holds } = composeSummaryOffering(input);
  return holds === undefined ? usage : `${usage}\n\n${holds}`;
}

/** What both parts read of the input: the brains that read, the project brain, how many pages, the cap. */
function partsOfInput(input: SummaryInput) {
  const readable = input.brains.filter((b) => b.config !== undefined);
  const pages = readable.reduce((n, b) => n + b.docs.length, 0);
  return {
    brains: input.brains,
    readable,
    project: readable.find((b) => b.isProject),
    pages,
    // Each part takes the cap of its own hook (§4.1).
    cap: Math.min(SUMMARY_CAP, Math.max(MIN_SUMMARY_CAP, input.cap ?? SUMMARY_CAP)),
    loaded: { brains: readable.map((b) => b.link.key), pages, counts: readable.map((b) => b.docs.length) },
  };
}

/**
 * The summary's first part (§4.1), how to use the memory: the opening, the project's front page and the Rules; and the
 * brains it loaded with how many pages they hold (§1.2).
 */
export function composeUsage(input: SummaryInput): {
  usage: string;
  loaded: { brains: string[]; pages: number; counts: number[] };
} {
  const { brains, readable, project, cap, loaded } = partsOfInput(input);
  const c = new Composer(cap, RULES_CUT.length + 2);

  const opening = [
    "# Kioku: the brains of this session",
    "",
    "On conflict the most specific brain wins: personal, then project, then team. Load the `kioku` skill before reading or writing memory, and read a brain only through the tool, `kioku page search` and `kioku page show`, never through its files: this lists where pages are, not their text, and only `show` counts a page as opened.",
    "",
  ];
  for (const b of brains) {
    const inside = b.link.key === input.inside;
    const tier =
      b.link.tier === "personal" && b.isProject && !inside ? "personal (also the project brain)" : b.link.tier;
    if (b.broken) opening.push(`- ${tier} ${b.link.key} cannot be read: ${clip(b.broken, 160)}`);
    else {
      const language = b.config?.language === undefined ? "" : `, its pages are written in ${b.config.language}`;
      const machine =
        b.link.tier === "team" && input.teamFrom === "machine" && !inside
          ? " (this machine's team, as this folder names none: teammates here may not have it)"
          : "";
      opening.push(
        `- ${tier}: ${nameOf(b)}${language}${machine}${inside ? " (this session is inside it: work on it through the kioku verbs, never by editing its files; its AGENTS.md says what is where)" : ""}`,
      );
      const lines = namespaceLines(b);
      opening.push(
        ...(lines.length > 0
          ? lines
          : ["  - no namespace yet: the first page it gets makes the first, with `kioku namespace add`"]),
      );
    }
  }
  // Inside a brain only that brain is loaded: the rest of the chain is named, with the reason (§2.7, §4.1).
  const within = brains.find((b) => b.link.key === input.inside);
  if (within !== undefined) {
    for (const n of input.notLoaded ?? [])
      opening.push(
        `- ${n.tier}: in this chain but not loaded; this session was opened inside the ${within.link.tier} brain ${nameOf(within)}, which works on its own.`,
      );
    if (within.link.tier !== "personal")
      opening.push(
        "- Nothing the person says about themselves is saved in this session, since the personal brain is not loaded: tell them it was not kept, and that a session opened outside a brain saves it.",
      );
  }
  if (brains.some((b) => !b.broken && b.config !== undefined)) opening.push("", NAMESPACES_NOTE, "");
  for (const m of input.missing)
    opening.push(
      `- ${m.tier} ${m.key} is not on this machine yet; it is being cloned in the background and will be in the next session.`,
    );
  for (const u of input.untrusted ?? []) {
    opening.push(
      `- This repository names ${u.key} as its ${u.tier} brain${u.address === undefined ? "" : ` at ${u.address}, an address this machine does not know for it`}, but this machine does not trust it, so nothing from it is loaded. Tell the person; \`${trustCommand(u)}\` in this folder is theirs to run in a terminal, never yours.`,
    );
  }
  for (const n of input.notHere ?? [])
    opening.push(
      `- This repository names ${n.key} as its ${n.tier} brain by name alone, and this machine does not have it, so nothing from it is loaded. Tell the person: a teammate who has it gives its address, and \`kioku init <address>\` links it.`,
    );
  for (const p of input.problems ?? []) opening.push(`- ${clip(p, 200)}`);
  for (const [key, reason] of Object.entries(input.pending ?? {}))
    opening.push(`- A change to ${key} is committed but not published yet (${clip(reason, 120)}); sync retries it.`);
  for (const [key, c] of Object.entries(input.conflicts ?? {})) {
    const found = brains.find((b) => b.link.key === key);
    const name = found === undefined ? key : nameOf(found);
    opening.push(
      `- ${name} holds changes of the person's that conflicted with what others published, kept on ${c.branches.join(", ")}. Tell the person; with them read both versions (\`kioku brain conflicts ${name} --branch ${c.branches[0]}\`), write what should stand with \`kioku page update\`, then \`kioku brain conflicts ${name} --resolve ${c.branches[0]}\`.`,
    );
  }
  for (const [key, reason] of Object.entries(input.syncFailures ?? {}))
    opening.push(`- The last sync of ${key} failed: ${clip(reason, 160)}`);
  // When to save (§4.1) takes the room the rest of the opening leaves under the cap: whole, else one line, else none.
  const rest = opening.join("\n").length + RULES_CUT.length + 2;
  const whenToSave = [WHEN_TO_SAVE, WHEN_TO_SAVE_SHORT].find((t) => rest + t.length + 2 <= cap);
  if (whenToSave !== undefined) opening.splice(4, 0, whenToSave, "");
  c.must(opening.join("\n"));

  // 1. The project brain's front page, trimmed; inside a brain, that brain's.
  const front = project ?? readable.find((b) => b.link.key === input.inside);
  if (front?.front?.trim())
    c.section(`## ${nameOf(front)}: front page`, [demote(trimIndex(front.front, `${FRONT_PAGE} of ${nameOf(front)}`))]);

  // 2. The Rules of the three brains, each its Rule and its Why; most specific brain first.
  const rules = readable.flatMap((b) => b.docs.filter((d) => kindOf(d.file) === "rule").map((d) => ({ b, d })));
  const allRules = c.section(
    "## Rules",
    readable.flatMap((b) =>
      b.docs
        .filter((d) => kindOf(d.file) === "rule")
        .sort((x, y) => (x.rel < y.rel ? -1 : 1))
        .map((d) => `### ${titleOf(d)} (${nameOf(b)}, ${d.rel})\n\n${demote(ruleText(d.file.body))}`),
    ),
    true,
  );
  // Said only when a Rule did not fit, not when the front page alone did not (§4.1).
  return { usage: c.text(rules.length > 0 && !allRules ? RULES_CUT : undefined), loaded };
}

/**
 * The summary's second part (§4.1), what the memory holds, absent when no brain reads; the pages whose line got into it
 * (§4.5), and the brains whose news got in whole, by key.
 */
export function composeHolds(input: SummaryInput): {
  holds?: string;
  offered: { brain: string; id: string | null }[];
  newsShown: string[];
} {
  const { readable, project, pages, cap } = partsOfInput(input);
  if (readable.length === 0) return { offered: [], newsShown: [] };
  const closing = (cut: boolean) =>
    `The brains hold ${plural(pages, "page")}${cut ? "; this summary shows part of them" : ""}. \`kioku page search <words>\` finds them; Memories that are facts and lessons are found that way, not listed here.`;
  const h = new Composer(cap, closing(true).length + 2);
  // The project brain's repository is a hint by its words, `brain-acme` for acme: the word brain itself says nothing.
  const hints = (input.hints ?? [])
    .flatMap(wordsOf)
    .filter((w) => w !== "brain")
    .map(stemOfWord);
  /** Pages that say what the session is about, first; the order they had otherwise is kept. */
  const byRelevance = <T>(items: T[], text: (t: T) => string): T[] => {
    if (hints.length === 0) return items;
    const score = (t: T) => {
      const words = new Set(wordsOf(text(t)).map(stemOfWord));
      return hints.filter((h) => words.has(h)).length;
    };
    return items
      .map((t, i) => ({ t, i, s: score(t) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.t);
  };

  // What the memory holds: a heading that stands alone, since the agent may read this part first (§4.1).
  h.must(
    [
      "# Kioku: what the brains of this session hold",
      "",
      `From ${readable.map(nameOf).join(", ")}: the second part of Kioku's summary, beside the one that says how to use the memory. Read a page only with \`kioku page show <path> --brain <brain>\`, never through its files.`,
    ].join("\n"),
  );

  // 1. The pages each namespace's index says to read first, at most five a namespace.
  h.section(
    "## Load first",
    readable.flatMap((b) => {
      const out: Offer[] = [];
      for (const ns of b.config?.namespaces ?? []) {
        for (const l of (b.loadFirst?.get(ns) ?? []).slice(0, LOAD_FIRST_MAX)) {
          const doc = l.path === undefined ? undefined : b.docs.find((d) => d.rel === l.path);
          if (doc !== undefined) out.push(offer(clip(`- ${withSummary(doc)} (${nameOf(b)}, ${doc.rel})`), b, doc));
        }
      }
      return out;
    }),
  );

  // 2. The Skills of the three brains, one line each.
  // The line under the heading carries the one thing to do with the list, whether or not the agent loaded the skill.
  h.section(
    `## Skills\n\n${SKILLS_NOTE}`,
    readable.flatMap((b) =>
      b.docs
        .filter((d) => kindOf(d.file) === "skill")
        .sort(newestFirst)
        .map((d) => offer(clip(`- ${withSummary(d)} (${nameOf(b)}, ${d.rel})`), b, d)),
    ),
  );

  // 3. The current decisions of the project brain, newest first.
  if (project) {
    const gone = superseded(project.docs);
    h.section(
      `## Decisions in ${nameOf(project)}`,
      byRelevance(
        project.docs.filter((d) => placementOf(d.rel)?.sub === "decision" && !gone.has(d.rel)).sort(newestFirst),
        (d) => `${titleOf(d)} ${str(d, "summary") ?? ""}`,
      ).map((d) => offer(clip(`- ${withSummary(d)} (${d.rel})`), project, d)),
    );
  }

  // 4. Instincts with recent evidence, personal then project.
  const since = daysBefore(input.now, RECENT_EVIDENCE_DAYS);
  const order = (b: SummaryBrain) => (b.link.tier === "personal" ? 0 : 1);
  const instincts = readable
    .filter((b) => b.link.tier === "personal" || b.isProject)
    .sort((x, y) => order(x) - order(y))
    // Within a brain, the ones that name what the session is about come first; personal still comes before project.
    .flatMap((b) =>
      byRelevance(
        b.docs
          .filter((d) => placementOf(d.rel)?.sub === "instinct")
          .map((d) => ({ d, b, evidence: evidenceOf(d.file) }))
          .filter(({ evidence }) => evidence.some((e) => e.date >= since))
          .sort((x, y) => (x.evidence.at(-1)!.date < y.evidence.at(-1)!.date ? 1 : -1)),
        ({ d }) => `${titleOf(d)} ${str(d, "summary") ?? ""}`,
      ),
    );
  h.section(
    "## Instincts",
    instincts.map(({ d, b, evidence }) => {
      const what = str(d, "summary") ?? sectionBody(d.file.body, "Do");
      const n = evidence.length;
      return offer(
        clip(
          `- ${titleOf(d)}${what ? `: ${oneLine(what)}` : ""} (${plural(n, "occasion")}, last ${evidence.at(-1)!.date}; ${nameOf(b)}, ${d.rel})`,
        ),
        b,
        d,
      );
    }),
  );

  // 5. What is new in the shared brains since this machine's last session that showed it: the newest few and how many
  // more, so that the list fits whole and the news moves on however much accumulated (§4.1).
  const newsShown: string[] = [];
  for (const b of readable.filter((x) => x.link.tier !== "personal" && (x.news?.length ?? 0) > 0)) {
    const news = b.news!;
    const lines = news.slice(0, NEWS_MAX).map((n) => clip(`- ${n.change}: ${oneLine(n.title)} (${n.path})`));
    if (news.length > NEWS_MAX)
      lines.push(
        `- and ${news.length - NEWS_MAX} more: \`kioku page list --brain ${nameOf(b)}\` gives each its \`change\``,
      );
    if (h.section(`## New in ${nameOf(b)} since your last session`, lines)) newsShown.push(b.link.key);
  }

  // 6. What `brain lint` has to review, per brain.
  h.section(
    "## To review",
    readable
      .filter((b) => (b.lint ?? 0) > 0)
      .map((b) => `- ${nameOf(b)}: ${plural(b.lint!, "thing")} for \`kioku brain lint ${nameOf(b)}\``),
  );

  // 7. The last line, never cut: how many pages, and that search finds them.
  return { holds: h.text(closing(h.cut)), offered: h.offered, newsShown };
}

/** Both parts and what each says of itself, as one; what a test of the whole reads. */
export function composeSummaryOffering(
  input: SummaryInput,
): ReturnType<typeof composeUsage> & ReturnType<typeof composeHolds> {
  return { ...composeUsage(input), ...composeHolds(input) };
}
