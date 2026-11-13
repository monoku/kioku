import { isDescribed } from "./brain/namespace-index.ts";
import { readFolderConfig } from "./config/folder-config.ts";
import { readReads, type ReadsState } from "./reads.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFrontPageAt, listMarkdown } from "./brain/brain.ts";
import { evidenceOf, parseBrainFile, sectionBody, type BrainFile } from "./brain/file.ts";
import { isRetired, verifiedOf } from "./brain/lifecycle.ts";
import { placementOf } from "./brain/kinds.ts";
import { linksOf, resolveLink } from "./brain/paths.ts";
import { conflictsOf } from "./conflicts.ts";
import { writeAtomic } from "./fs/atomic.ts";
import { acquireLock } from "./fs/lock.ts";
import { openIndex, type Index } from "./index/db.ts";
import { updateIndex } from "./index/indexer.ts";
import { aliasesOf, similarPages, stemsMet } from "./index/similar.ts";
import { significantWords, stemOf } from "./index/text.ts";
import { seeAlsoEntries } from "./write/body.ts";
import { lintReportPath } from "./state.ts";
import { lastTouched, touchedOf } from "./touched.ts";
import { readJson } from "./util.ts";

/**
 * The maintenance report (§4.4): what a brain written by an agent accumulates, computed from files,
 * dates and the index, with no model and without writing anything in the brain. The action happens in conversation.
 */

/** An instinct with no Evidence line newer than this many days is stale (§4.4: six months). */
export const STALE_INSTINCT_DAYS = 180;
/** A page this machine has not opened is asked about after this many days, since the later of its last change and the day it began to count (§4.5). */
export const UNOPENED_DAYS = 60;
/** A page a recall named this many times, and no session opened after, is one to reword or retire (§4.4). Chosen, not measured. */
export const UNFOLLOWED_RECALLS = 5;
/** An instinct with this many occasions is a candidate for a Skill (§3.6). */
export const SKILL_CANDIDATE_OCCASIONS = 3;
/** The share of the shorter title's words the other's title meets before `brain lint` reports the pair as one subject (§4.4). */
export const SIMILAR_REPORT_SHARE = 0.6;
/**
 * How many days a kind of page lasts without being changed or confirmed before `lint` asks. What changes
 * under people (context: who, where, which client) is asked after nine months; a way of working, a Rule or a Skill, a
 * year. A decision is history and an instinct has its own staleness: neither is asked.
 */
export const CONFIRM_DAYS = { context: 270, playbook: 365, rule: 365, skill: 365, memory: 365 } as const;

/**
 * Whether an instinct was evolved: its Evidence carries the line linking the Skill (§3.6), so it is no longer a
 * candidate. Only the Evidence counts: a See also entry pointing at a related Skill is a neighbour, not an evolution.
 */
export const evolvedInstinct = (rel: string, file: BrainFile): boolean =>
  linksOf(sectionBody(file.body, "Evidence") ?? "").some((l) => isEvolutionTarget(resolveLink(rel, l.target)));

/** What an instinct can evolve into (§3.6): a Skill, a Rule or a playbook. */
const isEvolutionTarget = (path: string | undefined): boolean =>
  path !== undefined &&
  (path.startsWith("skills/") || path.startsWith("rules/") || /^knowledge\/[^/]+\/playbooks\//.test(path));

/** The occasions of an instinct that is a candidate for a Skill: `SKILL_CANDIDATE_OCCASIONS` or more, not yet evolved. */
export function candidateOccasions(rel: string, file: BrainFile): number | undefined {
  const occasions = evidenceOf(file).length;
  return occasions >= SKILL_CANDIDATE_OCCASIONS && !evolvedInstinct(rel, file) ? occasions : undefined;
}

export interface LintReport {
  brain: string;
  root: string;
  /** Pairs of pages on the same subject that do not link to each other. */
  similar: { a: string; b: string }[];
  /** Instincts whose latest occasion is older than `STALE_INSTINCT_DAYS`, except those evolved into a Skill. */
  staleInstincts: { path: string; last: string | null }[];
  /** Decisions a newer one replaced; history, kept on purpose, listed so a person can decide. */
  superseded: { path: string; by: string | null }[];
  /** Relative links, `supersedes` and `superseded_by` whose target is gone. */
  brokenLinks: { path: string; target: string }[];
  /** Pages without `summary`, which show nothing in the session summary. */
  missingSummary: string[];
  /** Instincts with enough occasions to become a Skill, not yet evolved. */
  skillCandidates: { path: string; occasions: number }[];
  /** Pages whose `stale_after` has come: the writer said they need a second look from that day (§3.3). */
  expired: { path: string; stale_after: string }[];
  /** Pages nobody has changed or confirmed for longer than their kind lasts without it (§4.4). */
  unconfirmed: { path: string; since: string; days: number; window: number }[];
  /** Current pages (not retired, not superseded) that link to a page that was retired. */
  retiredLinks: { path: string; target: string }[];
  /** Two live pages one of which says it contradicts the other, and nothing has been done about it (§3.3). */
  contradictions: { a: string; b: string }[];
  /** Changes of this machine kept aside because they conflicted with what others published (§1.6). */
  conflicts: { branch: string; pages: string[] }[];
  /** Pages this machine has not opened in `UNOPENED_DAYS`, Rules and history left out; empty while nothing is counted (§4.5). */
  unopened: { path: string; since: string; days: number; surfaced: number }[];
  /** Pages a recall named `UNFOLLOWED_RECALLS` times or more on this machine and no session then opened (§4.5). */
  unfollowed: { path: string; recalled: number }[];
  /** The day this machine began to count what it opens, or null when it does not (§4.5). */
  counting_since: string | null;
  /** Namespaces that do not say what they are for, in a brain that has more than one (§3.2). */
  undescribed: string[];
  /** How many things there are to review, all lists together. */
  count: number;
}

interface Doc {
  rel: string;
  file: BrainFile;
}

/** Whole days from `date` (YYYY-MM-DD, local) to `now`. */
const daysSince = (date: string, now: Date): number => {
  const [y, m, d] = date.split("-").map(Number);
  const then = new Date(y!, m! - 1, d!);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
};

/** The targets of a page's links and of its `supersedes` and `superseded_by`, as written and as resolved. */
function targetsOf(d: Doc): { written: string; resolved: string[] }[] {
  const out = linksOf(d.file.body).map((l) => ({
    written: l.target,
    resolved: [resolveLink(d.rel, l.target)].filter((x): x is string => x !== undefined),
  }));
  for (const field of ["supersedes", "superseded_by"]) {
    const v = d.file.front.getString(field);
    if (v !== undefined)
      out.push({
        written: v,
        resolved: [resolveLink(d.rel, v), resolveLink("x", v)].filter((x): x is string => x !== undefined),
      });
  }
  return out;
}

/** The reports of these brains, with the machine's index opened and closed around them. */
export async function lintBrains(
  home: string,
  brains: { key: string; root: string }[],
  now: Date,
): Promise<LintReport[]> {
  const index = await openIndex(home);
  const reads = readReads(home);
  try {
    return brains.map((b) => lintBrain(b, index, now, reads));
  } finally {
    index.close();
  }
}

export function lintBrain(
  brain: { key: string; root: string },
  index: Index,
  now: Date = new Date(),
  reads?: ReadsState,
): LintReport {
  updateIndex(index, [brain]);
  const docs: Doc[] = [];
  for (const rel of listMarkdown(brain.root)) {
    if (isFrontPageAt(rel)) continue;
    const parsed = parseBrainFile(readFileSync(join(brain.root, rel), "utf8"));
    if (parsed.ok) docs.push({ rel, file: parsed.file });
  }
  const exists = (rel: string) => existsSync(join(brain.root, rel));
  const retired = new Set(docs.filter((d) => isRetired(d.file.front)).map((d) => d.rel));
  const live = docs.filter((d) => !retired.has(d.rel));

  // Two similar pages that link to each other were seen and kept apart on purpose (§3.3, §4.4): not a thing to review.
  const linked = new Map(docs.map((d) => [d.rel, new Set(targetsOf(d).flatMap((t) => t.resolved))]));
  const linkEachOther = (a: string, b: string) => (linked.get(a)?.has(b) ?? false) || (linked.get(b)?.has(a) ?? false);
  const similar: LintReport["similar"] = [];
  const seen = new Set<string>();
  for (const d of live) {
    const title = d.file.front.getString("title");
    if (title === undefined) continue;
    const aliases = d.file.front.getList("aliases") ?? [];
    for (const hit of similarPages(index, brain.key, { title, aliases, body: d.file.body })) {
      if (hit.path === d.rel || retired.has(hit.path) || linkEachOther(d.rel, hit.path)) continue;
      // `save` asks "is there a page on this subject?" and answers by a loose rule, because the agent decides. A report
      // for a person is stricter: the two titles, with their aliases, share most of what the shorter one says.
      const mine = [...new Set(significantWords([title, ...aliases].join(" ")).map(stemOf))];
      const theirText = `${hit.title} ${aliasesOf(index, brain.key, hit.path)}`;
      const theirs = new Set(significantWords(theirText).map(stemOf));
      const shared = stemsMet(mine, theirText);
      if (shared < 2 || shared / Math.min(mine.length, theirs.size) < SIMILAR_REPORT_SHARE) continue;
      const [a, b] = [d.rel, hit.path].sort() as [string, string];
      if (seen.has(`${a}\n${b}`)) continue;
      seen.add(`${a}\n${b}`);
      similar.push({ a, b });
    }
  }

  const staleInstincts: LintReport["staleInstincts"] = [];
  const skillCandidates: LintReport["skillCandidates"] = [];
  for (const d of live.filter((x) => placementOf(x.rel)?.sub === "instinct")) {
    const evidence = evidenceOf(d.file);
    const last =
      evidence
        .map((e) => e.date)
        .sort()
        .at(-1) ?? null;
    // An evolved instinct is the history of its Skill, not conduct that went quiet.
    if (!evolvedInstinct(d.rel, d.file) && (last === null || daysSince(last, now) > STALE_INSTINCT_DAYS))
      staleInstincts.push({ path: d.rel, last });
    const occasions = candidateOccasions(d.rel, d.file);
    if (occasions !== undefined) skillCandidates.push({ path: d.rel, occasions });
  }

  const superseded: LintReport["superseded"] = [];
  const decisions = docs.filter((d) => placementOf(d.rel)?.sub === "decision");
  for (const d of decisions) {
    const by = d.file.front.getString("superseded_by");
    const named = decisions.find((x) => {
      const s = x.file.front.getString("supersedes");
      return s !== undefined && [resolveLink(x.rel, s), resolveLink("x", s)].includes(d.rel);
    });
    if (by !== undefined || named !== undefined)
      superseded.push({ path: d.rel, by: by !== undefined ? (resolveLink(d.rel, by) ?? by) : named!.rel });
  }

  const brokenLinks: LintReport["brokenLinks"] = [];
  for (const d of docs)
    for (const t of targetsOf(d)) if (!t.resolved.some(exists)) brokenLinks.push({ path: d.rel, target: t.written });

  const missingSummary = live.filter((d) => d.file.front.getString("summary") === undefined).map((d) => d.rel);

  const day = now.toISOString().slice(0, 10);
  const expired: LintReport["expired"] = [];
  for (const d of live) {
    const due = d.file.front.getString("stale_after");
    if (due !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(due) && due <= day)
      expired.push({ path: d.rel, stale_after: due });
  }

  const touched = lastTouched(brain.root);
  const unconfirmed: LintReport["unconfirmed"] = [];
  for (const d of live) {
    const place = placementOf(d.rel);
    const kind = place === undefined ? undefined : (place.sub ?? place.kind);
    const window =
      kind !== undefined && kind in CONFIRM_DAYS ? CONFIRM_DAYS[kind as keyof typeof CONFIRM_DAYS] : undefined;
    if (window === undefined) continue;
    const dates = [
      touchedOf(touched, d.rel),
      verifiedOf(d.file.front)?.at.slice(0, 10),
      d.file.front.getString("created"),
    ].filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x));
    const since = dates
      .map((x) => x.slice(0, 10))
      .sort()
      .at(-1);
    if (since === undefined) continue;
    const days = daysSince(since, now);
    if (days > window) unconfirmed.push({ path: d.rel, since, days, window });
  }

  const retiredLinks: LintReport["retiredLinks"] = [];
  // A superseded decision is history and always links to what replaced it.
  for (const d of live)
    if (d.file.front.getString("superseded_by") === undefined)
      for (const t of targetsOf(d))
        if (t.resolved.some((r) => retired.has(r))) retiredLinks.push({ path: d.rel, target: t.written });

  // A contradiction is open while both pages are current: retiring one, superseding it or forgetting it settles it, and
  // so does removing the link (`update --section "See also"`).
  const settled = new Set([
    ...retired,
    ...docs.filter((d) => d.file.front.getString("superseded_by") !== undefined).map((d) => d.rel),
  ]);
  const contradictions: LintReport["contradictions"] = [];
  const seenPairs = new Set<string>();
  for (const d of live) {
    for (const e of seeAlsoEntries(d.file.body)) {
      const to = resolveLink(d.rel, e.target);
      if (e.relation !== "contradicts" || to === undefined || !exists(to) || settled.has(d.rel) || settled.has(to))
        continue;
      const [a, b] = [d.rel, to].sort() as [string, string];
      if (seenPairs.has(`${a}\n${b}`)) continue;
      seenPairs.add(`${a}\n${b}`);
      contradictions.push({ a, b });
    }
  }

  const conflicts = conflictsOf(brain.root).map((c) => ({ branch: c.branch, pages: c.pages }));

  // A brain with more than one namespace asks each what it is for, because the agent chooses by it (§3.2).
  const own = readFolderConfig(join(brain.root, "kioku.yaml"));
  const declared = own.ok && own.value.form === "brain" ? own.value.namespaces : [];
  const undescribed =
    declared.length < 2
      ? []
      : declared.filter((n) => {
          const file = join(brain.root, "knowledge", n, "INDEX.md");
          return !isDescribed(existsSync(file) ? readFileSync(file, "utf8") : undefined);
        });

  // What this machine has not opened (§4.5): a signal to look at. Rules are whole in every summary, and a superseded
  // decision is history; a page with no `id` has nothing to be counted by.
  const unopened: LintReport["unopened"] = [];
  if (reads !== undefined) {
    const counted = reads.brains[brain.key] ?? {};
    for (const d of live) {
      const id = d.file.front.getString("id");
      const place = placementOf(d.rel);
      if (id === undefined || place?.kind === "rule" || d.file.front.getString("superseded_by") !== undefined) continue;
      const entry = counted[id];
      if (entry !== undefined && entry.opened > 0) continue;
      const dates = [touchedOf(touched, d.rel), d.file.front.getString("created"), reads.counting_since].filter(
        (x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x),
      );
      const since = dates
        .map((x) => x.slice(0, 10))
        .sort()
        .at(-1)!;
      const days = daysSince(since, now);
      if (days >= UNOPENED_DAYS) unopened.push({ path: d.rel, since, days, surfaced: entry?.surfaced ?? 0 });
    }
  }

  // What a recall keeps bringing and nobody opens (§4.5): its title and summary are all the recall's line shows.
  const unfollowed: LintReport["unfollowed"] = [];
  if (reads !== undefined) {
    const counted = reads.brains[brain.key] ?? {};
    for (const d of live) {
      const entry = counted[d.file.front.getString("id") ?? ""];
      if (entry !== undefined && (entry.recalled ?? 0) >= UNFOLLOWED_RECALLS && (entry.followed ?? 0) === 0)
        unfollowed.push({ path: d.rel, recalled: entry.recalled! });
    }
    unfollowed.sort((a, b) => b.recalled - a.recalled || (a.path < b.path ? -1 : 1));
  }

  const count =
    similar.length +
    staleInstincts.length +
    superseded.length +
    brokenLinks.length +
    missingSummary.length +
    skillCandidates.length +
    expired.length +
    unconfirmed.length +
    retiredLinks.length +
    contradictions.length +
    conflicts.length +
    unopened.length +
    unfollowed.length +
    undescribed.length;
  return {
    brain: brain.key,
    root: brain.root,
    similar,
    staleInstincts,
    superseded,
    brokenLinks,
    missingSummary,
    skillCandidates,
    expired,
    unconfirmed,
    retiredLinks,
    contradictions,
    conflicts,
    unopened,
    unfollowed,
    counting_since: reads?.counting_since ?? null,
    undescribed,
    count,
  };
}

/** Keep each brain's count and report under `~/.kioku/`, for the session summary (§4.1 item 7). */
export async function recordLint(
  home: string,
  reports: { key: string; report: LintReport }[],
  now: Date = new Date(),
): Promise<void> {
  mkdirSync(join(home, ".kioku"), { recursive: true });
  const lock = await acquireLock(join(home, ".kioku", "lock"));
  try {
    const all = readJson<Record<string, unknown>>(lintReportPath(home)) ?? {};
    for (const r of reports) all[r.key] = { at: now.toISOString(), count: r.report.count, report: r.report };
    writeAtomic(lintReportPath(home), `${JSON.stringify(all, null, 2)}\n`);
  } finally {
    lock.release();
  }
}

/** The lists of a report, each of which a window of `limit` entries shows (§6.1, bounded answers). */
export const LINT_LISTS = [
  "similar",
  "staleInstincts",
  "superseded",
  "brokenLinks",
  "missingSummary",
  "skillCandidates",
  "expired",
  "unconfirmed",
  "retiredLinks",
  "contradictions",
  "conflicts",
  "unopened",
  "unfollowed",
  "undescribed",
] as const;

/** A report with each list cut to its first `limit` entries; `totals` has the lists that were cut, with their full length. */
export function cappedReport(
  r: LintReport,
  limit: number,
): LintReport & { limit: number; totals: Record<string, number> } {
  const out: LintReport & { limit: number; totals: Record<string, number> } = { ...r, limit, totals: {} };
  for (const k of LINT_LISTS) {
    const list = r[k] as unknown[] | undefined;
    if (list !== undefined && list.length > limit) {
      (out as unknown as Record<string, unknown[]>)[k] = list.slice(0, limit);
      out.totals[k] = list.length;
    }
  }
  return out;
}
