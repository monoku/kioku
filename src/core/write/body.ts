import { appendEvidence, type BrainFile } from "../brain/file.ts";
import { specFor, type PageType } from "../brain/kinds.ts";
import { linkBetween, linksOf, resolveLink } from "../brain/paths.ts";
import { namedError } from "../errors.ts";

/** A body cut at its `## ` headings: the text before the first one, then each section with its heading. Fenced code is not cut. */
export interface Sections {
  preamble: string;
  sections: { heading: string; text: string }[];
}

export function splitSections(body: string): Sections {
  const out: Sections = { preamble: "", sections: [] };
  let fence: string | undefined;
  let current: { heading: string; lines: string[] } | undefined;
  const preamble: string[] = [];
  const done: { heading: string; lines: string[] }[] = [];
  for (const line of body.split("\n")) {
    const f = /^(```+|~~~+)/.exec(line);
    if (f) fence = fence === undefined ? f[1]![0]! : fence === f[1]![0] ? undefined : fence;
    const h = fence === undefined && !f ? /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line) : null;
    if (h) {
      current = { heading: h[1]!, lines: [] };
      done.push(current);
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  out.preamble = preamble.join("\n").trim();
  out.sections = done.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
  return out;
}

export function joinSections(s: Sections): string {
  const parts = [
    ...(s.preamble ? [`${s.preamble}\n`] : []),
    ...s.sections.map((x) => (x.text ? `## ${x.heading}\n\n${x.text}\n` : `## ${x.heading}\n`)),
  ];
  return parts.join("\n");
}

/** Sections the tool keeps itself: the agent's body never writes them (§3.3). */
const TOOL_SECTIONS = ["Changelog", "Evidence"];

/** The section that holds a page's links to related pages, one `- [title](./path)` per line (§3.3). The tool writes it; `update --section` may rewrite it. */
export const SEE_ALSO = "See also";

/**
 * The body of a page from what the agent wrote (§3.4): the type's sections first, in the template's order, then
 * any other sections in the order written, then the tool's own sections — Changelog where the type has one,
 * Evidence on an instinct — taken from `keep` when the page already has them.
 */
export function assembleBody(type: PageType, written: string, keep?: string): string {
  const spec = specFor(type);
  const mine = splitSections(written);
  const old = keep === undefined ? undefined : splitSections(keep);
  const find = (s: Sections | undefined, h: string) => s?.sections.find((x) => x.heading === h);
  const sections: Sections["sections"] = [];
  for (const h of spec.sections) {
    if (TOOL_SECTIONS.includes(h)) continue;
    const s = find(mine, h);
    if (s) sections.push(s);
  }
  for (const s of mine.sections)
    if (!spec.sections.includes(s.heading) && !TOOL_SECTIONS.includes(s.heading)) sections.push(s);
  // See also is the tool's to write (§3.3): a body that does not bring one keeps the page's.
  const seeAlso = find(old, SEE_ALSO);
  if (seeAlso !== undefined && find(mine, SEE_ALSO) === undefined) sections.push(seeAlso);
  if (spec.evidence)
    sections.push(find(old, "Evidence") ?? find(mine, "Evidence") ?? { heading: "Evidence", text: "" });
  if (spec.changelog) sections.push(find(old, "Changelog") ?? { heading: "Changelog", text: "" });
  return joinSections({ preamble: mine.preamble, sections });
}

/** Replace the text of one section, adding it before the tool's own sections when the page lacks it. */
export function replaceSection(body: string, heading: string, text: string): string {
  if (TOOL_SECTIONS.includes(heading))
    throw namedError(
      (n) => `the ${heading} section is kept by the tool; use ${n.field("note")} or ${n.field("evidence")}`,
      "section_reserved",
    );
  const s = splitSections(body);
  // The agent may repeat the heading in what it sends; the section is what follows it.
  const own = splitSections(text);
  const content =
    own.sections.length === 1 && own.sections[0]!.heading === heading && own.preamble === ""
      ? own.sections[0]!.text
      : text.trim();
  const at = s.sections.findIndex((x) => x.heading === heading);
  if (at >= 0) s.sections[at] = { heading, text: content };
  else {
    const tool = s.sections.findIndex((x) => TOOL_SECTIONS.includes(x.heading));
    s.sections.splice(tool < 0 ? s.sections.length : tool, 0, { heading, text: content });
  }
  return joinSections(s);
}

/** Link text with the characters Markdown would read as its own escaped. */
export const linkText = (s: string): string => s.replace(/[[\]\\]/g, "\\$&");

/**
 * How one page stands to another, written after the link in See also, `- [Title](./x.md) (contradicts)` (§3.3).
 * A link with nothing after it is "related": seen, judged, and kept apart or together. `qualified by` is the
 * other page's side of `qualifies`.
 */
export const RELATIONS = ["contradicts", "qualifies", "qualified by"] as const;
export type Relation = (typeof RELATIONS)[number];

/** What a typed link says on the page at the other end. */
export const RELATION_OF_OTHER: Record<Relation, Relation> = {
  contradicts: "contradicts",
  qualifies: "qualified by",
  "qualified by": "qualifies",
};

/** The entries of a page's See also: each link's target as written, and how the page stands to it when it says. */
export function seeAlsoEntries(body: string): { target: string; relation?: Relation }[] {
  const s = splitSections(body).sections.find((x) => x.heading === SEE_ALSO);
  if (s === undefined) return [];
  return s.text.split("\n").flatMap((line) => {
    const target = linksOf(line)[0]?.target;
    if (target === undefined) return [];
    const relation = RELATIONS.find((r) => new RegExp(`\\)\\s*\\(${r}\\)\\s*$`).test(line));
    return [{ target, ...(relation !== undefined && { relation }) }];
  });
}

/** The body with the See also line that points at `toRel` (from the page at `fromRel`) saying `relation`; the line as it was when none points there. */
export function relateSeeAlso(body: string, fromRel: string, toRel: string, relation: Relation): string {
  const s = splitSections(body);
  const section = s.sections.find((x) => x.heading === SEE_ALSO);
  if (section === undefined) return body;
  section.text = section.text
    .split("\n")
    .map((line) => {
      const target = linksOf(line)[0]?.target;
      if (target === undefined || resolveLink(fromRel, target) !== toRel) return line;
      const bare = RELATIONS.reduce((l, r) => l.replace(new RegExp(`\\s*\\(${r}\\)\\s*$`), ""), line);
      return `${bare} (${relation})`;
    })
    .join("\n");
  return joinSections(s);
}

/** Add links to See also, creating the section before the tool's own ones; what is already listed stays. */
export function addSeeAlso(body: string, entries: { title: string; href: string; relation?: Relation }[]): string {
  const s = splitSections(body);
  let section = s.sections.find((x) => x.heading === SEE_ALSO);
  if (section === undefined) {
    section = { heading: SEE_ALSO, text: "" };
    const tool = s.sections.findIndex((x) => TOOL_SECTIONS.includes(x.heading));
    s.sections.splice(tool < 0 ? s.sections.length : tool, 0, section);
  }
  section.text = [
    section.text,
    ...entries.map((e) => `- [${linkText(e.title)}](${e.href})${e.relation === undefined ? "" : ` (${e.relation})`}`),
  ]
    .filter(Boolean)
    .join("\n");
  return joinSections(s);
}

/** The first Evidence line of a new instinct, when the agent's body brought none (§3.6). */
export function seedEvidence(file: BrainFile, date: string, text: string, source: string): void {
  const s = splitSections(file.body).sections.find((x) => x.heading === "Evidence");
  if (s === undefined || s.text === "") appendEvidence(file, date, text, source);
}

/**
 * `body` as the page at `fromPath` would read it after the page at `oldRel` moved to `newRel`: each relative link that
 * pointed at the old path points at the new one, and a link whose text is the old title says the new one. Links in code
 * fences and inline code are left as they are.
 */
export function retargetLinks(
  body: string,
  fromPath: string,
  oldRel: string,
  newRel: string,
  oldTitle: string,
  newTitle: string,
): string {
  return rewriteLinks(body, (text, written, title) => {
    if (resolveLink(fromPath, written) !== oldRel) return undefined;
    const suffix = /[#?].*$/.exec(written)?.[0] ?? "";
    const label = text === oldTitle || text === linkText(oldTitle) ? linkText(newTitle) : text;
    return `[${label}](${linkBetween(fromPath, newRel)}${suffix}${title})`;
  });
}

/**
 * `body` of the page at `fromPath` with every relative link that pointed at a key of `moved` pointing at its value:
 * one pass over the body however many files moved. Links in code fences and inline code are left as they are.
 */
export function retargetLinksBy(body: string, fromPath: string, moved: ReadonlyMap<string, string>): string {
  return rewriteLinks(body, (text, written, title) => {
    const newRel = moved.get(resolveLink(fromPath, written) ?? "");
    if (newRel === undefined) return undefined;
    const suffix = /[#?].*$/.exec(written)?.[0] ?? "";
    return `[${text}](${linkBetween(fromPath, newRel)}${suffix}${title})`;
  });
}

/**
 * `body` of a page that moved from `from` to `to`, with each relative link written again from the new place so that it
 * still points where it did, and a link to the page itself pointing at `to`. Links in code are left as they are.
 */
export function rebaseLinks(body: string, from: string, to: string): string {
  return rewriteLinks(body, (text, written, title) => {
    const target = resolveLink(from, written);
    if (target === undefined) return undefined;
    const suffix = /[#?].*$/.exec(written)?.[0] ?? "";
    return `[${text}](${linkBetween(to, target === from ? to : target)}${suffix}${title})`;
  });
}

/** Each Markdown link outside code fences and inline code, as `rewrite` answers it (`undefined` keeps it). */
function rewriteLinks(
  body: string,
  rewrite: (text: string, written: string, title: string) => string | undefined,
): string {
  let fence: string | undefined;
  const link = /\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g;
  const fix = (segment: string): string =>
    segment.replace(
      link,
      (whole, text: string, angled: string | undefined, plain: string | undefined, title: string) =>
        rewrite(text, (angled ?? plain)!, title) ?? whole,
    );
  return body
    .split("\n")
    .map((line) => {
      const f = /^\s*(```+|~~~+)/.exec(line);
      if (f) {
        fence = fence === undefined ? f[1]![0]! : fence === f[1]![0] ? undefined : fence;
        return line;
      }
      if (fence !== undefined) return line;
      return line
        .split(/(`[^`]*`)/)
        .map((part, i) => (i % 2 === 1 ? part : fix(part)))
        .join("");
    })
    .join("\n");
}
