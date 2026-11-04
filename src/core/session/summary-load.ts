import { join } from "node:path";
import { FRONT_PAGE, isFrontPageAt } from "../brain/brain.ts";
import { isRetired } from "../brain/lifecycle.ts";
import { loadFirstOf, type LoadFirst } from "../brain/load-first.ts";
import { descriptionOf, isGenericDescription } from "../brain/namespace-index.ts";
import { sessionReads, type SessionReads } from "./session-reads.ts";
import type { SummaryBrain, SummaryBrainSource, SummaryDoc } from "./summary.ts";

/** What the summary says of a brain (§4.1), read from its folder; `summary.ts` composes it. */
function load(b: SummaryBrainSource, reads: SessionReads): SummaryBrain {
  const found = reads.folderConfig(join(b.link.path, "kioku.yaml"));
  if (!found.ok) return { ...b, broken: found.reason, docs: [] };
  if (found.value.form !== "brain")
    return { ...b, broken: "its kioku.yaml is a project folder's, not a brain's", docs: [] };
  const docs: SummaryDoc[] = [];
  for (const rel of reads.markdown(b.link.path)) {
    if (isFrontPageAt(rel)) continue;
    try {
      const parsed = reads.brainFile(join(b.link.path, rel));
      // A retired page is history (§3.3): it is not a Rule, a Skill, an instinct or a decision of this session.
      if (parsed.ok && !isRetired(parsed.file.front)) docs.push({ rel, file: parsed.file });
    } catch {
      /* unreadable: the validator reports it */
    }
  }
  const descriptions = new Map<string, string>();
  const links = new Map<string, LoadFirst["links"]>();
  for (const n of found.value.namespaces ?? []) {
    // An index that is not there, or not inside the brain (§3.1), is the validator's to report.
    const index = reads.inside(b.link.path, `knowledge/${n}/INDEX.md`);
    const d = index === undefined ? undefined : descriptionOf(index);
    if (d !== undefined && d !== "" && !isGenericDescription(d)) descriptions.set(n, d);
    const first = loadFirstOf(b.link.path, n, (rel) => reads.inside(b.link.path, rel));
    if (first !== undefined) links.set(n, first.links);
  }
  // A missing front page, or one that is not a file inside the brain (§3.1), is the validator's to report.
  const front = reads.inside(b.link.path, FRONT_PAGE);
  return { ...b, config: found.value, docs, descriptions, loadFirst: links, ...(front !== undefined && { front }) };
}

/** The brains of a session start, read for the summary. */
export const loadSummaryBrains = (brains: SummaryBrainSource[], reads: SessionReads = sessionReads()): SummaryBrain[] =>
  brains.map((b) => load(b, reads));
