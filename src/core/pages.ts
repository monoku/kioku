import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isFrontPageAt, listMarkdown } from "./brain/brain.ts";
import { evidenceOf, parseBrainFile, type BrainFile } from "./brain/file.ts";
import { placementOf } from "./brain/kinds.ts";
import { isRetired, verifiedOf, type Verification } from "./brain/lifecycle.ts";
import { linksOf, resolveLink } from "./brain/paths.ts";
import { seeAlsoEntries } from "./write/body.ts";
import { newSince, readViews, type NewPage } from "./session/views.ts";
import { historyOf, lastTouched, touchedOf, type HistoryEntry } from "./touched.ts";

/**
 * A page as `kioku page list` and `kioku page show` answer it (§1.2, §6.1): its front matter, its last touch, and its
 * place in the brain's web of links. What an interface outside the conversation lists; the agent reads it too.
 */
export interface PageRecord {
  brain: string;
  path: string;
  id: string | null;
  kind: string | null;
  subkind: string | null;
  namespace: string | null;
  title: string;
  summary: string | null;
  aliases: string[];
  created: string | null;
  source: string | null;
  /** Which version of the source the page was written from, when the writer said. */
  source_version: string | null;
  evidence: string | null;
  /** The date after which the page needs a second look, when the writer set one (§3.3). */
  stale_after: string | null;
  /** `deprecated` for a retired page (§3.3), null otherwise. */
  status: string | null;
  /** The latest confirmation that the page is still true: who and when (§3.3), or null. */
  verified: Verification | null;
  supersedes: string | null;
  superseded_by: string | null;
  /** The day of the last commit that changed it, or null before any (§3.3). */
  touched: string | null;
  /** An instinct's Evidence lines (§3.6); null for every other page. */
  occasions: number | null;
  /** `added` or `changed` when someone else wrote it in a shared brain since this machine's last session (§4.1, item 6); null otherwise. */
  change: NewPage["change"] | null;
  /** The pages it points at: relative links in the body, `supersedes` and `superseded_by`, resolved, in the brain or not. */
  links: string[];
  /** The pages that point at it. */
  linkedFrom: string[];
  /** How it stands to the pages its See also says something about: `contradicts`, `qualifies`, `qualified by` (§3.3). */
  relations: { type: string; path: string }[];
}

interface Doc {
  rel: string;
  file: BrainFile;
}

/** The brain-relative targets of a page's links, each once, the page itself left out. */
function targetsOf(d: Doc): string[] {
  const out = new Set<string>();
  for (const l of linksOf(d.file.body)) {
    const t = resolveLink(d.rel, l.target);
    if (t !== undefined) out.add(t);
  }
  for (const field of ["supersedes", "superseded_by"]) {
    const v = d.file.front.getString(field);
    if (v === undefined) continue;
    const t = resolveLink(d.rel, v) ?? resolveLink("x", v);
    if (t !== undefined) out.add(t);
  }
  out.delete(d.rel);
  return [...out].sort();
}

const str = (d: Doc, key: string): string | null => d.file.front.getString(key) ?? null;

/** What a brain's pages are compared against: the news of §4.1 item 6, by path. */
export type Changes = Map<string, NewPage["change"]>;

/**
 * What is new in a brain since this machine's last session, as the summary computes it (§4.1): nothing in the
 * personal brain, where every write is this machine's, and nothing before a second session has set a view.
 */
export function changesOf(home: string, brain: { key: string; root: string; tier?: string }): Changes {
  if (brain.tier === "personal") return new Map();
  return new Map(newSince(brain.root, readViews(home)[brain.key]).map((n) => [n.path, n.change]));
}

/** A page as `kioku page show` answers it: the record, its body and the commits that changed it (§3.3, §6.1). */
export interface ShownPage extends PageRecord {
  body: string;
  history: HistoryEntry[];
}

/** One page with its body and history (§6.1); undefined when the path is not a page of the brain. */
export function showPage(
  brain: { key: string; root: string },
  rel: string,
  changes?: Changes,
  pages: PageRecord[] = pagesOf(brain, changes),
): ShownPage | undefined {
  const page = pages.find((p) => p.path === rel);
  if (page === undefined) return undefined;
  const parsed = parseBrainFile(readFileSync(join(brain.root, rel), "utf8"));
  return { ...page, body: parsed.ok ? parsed.file.body : "", history: historyOf(brain.root, rel) };
}

/** Every readable page of a brain, in path order. Pages whose front matter cannot be read are the validator's. */
export function pagesOf(brain: { key: string; root: string }, changes?: Changes): PageRecord[] {
  const docs: Doc[] = [];
  for (const rel of listMarkdown(brain.root)) {
    if (isFrontPageAt(rel)) continue;
    const parsed = parseBrainFile(readFileSync(join(brain.root, rel), "utf8"));
    if (parsed.ok) docs.push({ rel, file: parsed.file });
  }
  const touched = lastTouched(brain.root);
  const links = new Map(docs.map((d) => [d.rel, targetsOf(d)]));
  const linkedFrom = new Map<string, string[]>();
  for (const [from, targets] of links) for (const t of targets) linkedFrom.set(t, [...(linkedFrom.get(t) ?? []), from]);
  return docs.map((d) => ({
    brain: brain.key,
    path: d.rel,
    id: str(d, "id"),
    kind: str(d, "kind"),
    subkind: placementOf(d.rel)?.sub ?? null,
    occasions: placementOf(d.rel)?.sub === "instinct" ? evidenceOf(d.file).length : null,
    change: changes?.get(d.rel) ?? null,
    namespace: str(d, "namespace"),
    title: d.file.front.getString("title") ?? d.rel,
    summary: str(d, "summary"),
    aliases: d.file.front.getList("aliases") ?? [],
    created: str(d, "created"),
    source: str(d, "source"),
    source_version: str(d, "source_version"),
    evidence: str(d, "evidence"),
    stale_after: str(d, "stale_after"),
    status: isRetired(d.file.front) ? "deprecated" : null,
    verified: verifiedOf(d.file.front) ?? null,
    supersedes: str(d, "supersedes"),
    superseded_by: str(d, "superseded_by"),
    touched: touchedOf(touched, d.rel),
    links: links.get(d.rel) ?? [],
    linkedFrom: (linkedFrom.get(d.rel) ?? []).sort(),
    relations: seeAlsoEntries(d.file.body).flatMap((e) => {
      const to = resolveLink(d.rel, e.target);
      return e.relation !== undefined && to !== undefined ? [{ type: e.relation, path: to }] : [];
    }),
  }));
}
