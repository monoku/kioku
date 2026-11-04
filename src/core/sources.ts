import type { PageRecord } from "./pages.ts";

/**
 * What was ingested from a source (§1.7), derived from the pages' own `source` and `source_version`:
 * there is no second record to keep in step with the pages.
 */
export interface SourceRecord {
  brain: string;
  source: string;
  /** Live pages that say they come from it. */
  count: number;
  /** The latest day a page from it was written or changed, or null. */
  last: string | null;
  /** The version every page was written from, or null when they differ or some page names none. */
  version: string | null;
  /** Every version the pages name: more than one means some pages were not brought up to date. */
  versions: string[];
  /** The pages, when one source was asked for. */
  pages?: { path: string; title: string; source_version: string | null }[];
}

/** A source that is a work session, not a document (§3.3): left out of the list unless asked for. */
const isSessionSource = (source: string): boolean => /^Session\b/.test(source);

const dayOf = (p: PageRecord): string => p.touched ?? p.created ?? "";

/**
 * The sources of one brain's pages, most recently read first. A retired page is history and does not count. With
 * `only`, just that source (exactly as written, after trimming) and the pages that come from it.
 */
export function sourcesOf(pages: PageRecord[], o: { all?: boolean; only?: string } = {}): SourceRecord[] {
  const groups = new Map<string, PageRecord[]>();
  for (const p of pages) {
    if (p.status !== null || p.source === null) continue;
    const source = p.source.trim();
    if (o.only !== undefined ? source !== o.only : !o.all && isSessionSource(source)) continue;
    groups.set(source, [...(groups.get(source) ?? []), p]);
  }
  const records = [...groups].map(([source, ps]): SourceRecord => {
    const days = ps
      .map(dayOf)
      .filter((d) => d !== "")
      .sort();
    const versions = [...new Set(ps.flatMap((p) => (p.source_version === null ? [] : [p.source_version])))].sort();
    const agreed = versions.length === 1 && ps.every((p) => p.source_version !== null) ? versions[0]! : null;
    return {
      brain: ps[0]!.brain,
      source,
      count: ps.length,
      last: days.at(-1) ?? null,
      version: agreed,
      versions,
      ...(o.only !== undefined && {
        pages: ps
          .map((p) => ({ path: p.path, title: p.title, source_version: p.source_version }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }),
    };
  });
  return records.sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.source.localeCompare(b.source));
}
