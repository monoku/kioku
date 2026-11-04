import { Frontmatter } from "./front-matter.ts";
import type { BrainFile } from "./file.ts";
import { specFor, type PageType } from "./kinds.ts";
import { newUlid } from "./ulid.ts";

/** The empty body a new page of this type starts from: its required sections in order, then Changelog where the type has one (§3.4). */
export function template(type: PageType): string {
  const spec = specFor(type);
  const headings = [...spec.sections, ...(spec.changelog ? ["Changelog"] : [])];
  return headings.map((h) => `## ${h}\n`).join("\n");
}

/** A body from the text of each required section; sections not given stay empty. */
export function buildBody(type: PageType, sections: Record<string, string> = {}): string {
  const spec = specFor(type);
  const headings = [...spec.sections, ...(spec.changelog ? ["Changelog"] : [])];
  return headings.map((h) => (sections[h]?.trim() ? `## ${h}\n\n${sections[h]!.trim()}\n` : `## ${h}\n`)).join("\n");
}

export interface NewPage {
  type: PageType;
  namespace: string;
  title: string;
  /** `YYYY-MM-DD`. */
  created: string;
  source: string;
  /** Which version of the source this page was written from: a sha, a date or a hash. */
  sourceVersion?: string;
  evidence?: string;
  /** `YYYY-MM-DD`: after it the page needs a second look (§3.3). */
  staleAfter?: string;
  summary?: string;
  aliases?: string[];
  supersedes?: string;
  /** The whole body; the type's template when absent. */
  body?: string;
  /** Only tests pass one; the tool generates the id when a page is created and never changes it afterwards. */
  id?: string;
}

/** A page ready to be written, front matter in the order of §3.3, with a new id. */
export function createPage(p: NewPage): BrainFile {
  const front = Frontmatter.empty();
  front.set("kind", p.type.kind, { raw: true });
  front.set("id", p.id ?? newUlid());
  front.set("namespace", p.namespace);
  front.set("title", p.title);
  if (p.summary !== undefined) front.set("summary", p.summary);
  if (p.aliases !== undefined && p.aliases.length > 0) front.set("aliases", p.aliases);
  front.set("created", p.created, { raw: true });
  front.set("source", p.source, { quoted: true });
  if (p.sourceVersion !== undefined) front.set("source_version", p.sourceVersion, { quoted: true });
  if (p.evidence !== undefined) front.set("evidence", p.evidence, { quoted: true });
  if (p.staleAfter !== undefined) front.set("stale_after", p.staleAfter, { raw: true });
  if (p.supersedes !== undefined) front.set("supersedes", p.supersedes);
  return { front, body: p.body ?? template(p.type) };
}
