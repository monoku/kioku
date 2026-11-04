import { readFileSync } from "node:fs";
import { Frontmatter, splitFile } from "./front-matter.ts";
import { isKind, type Kind } from "./kinds.ts";
import { userError } from "../errors.ts";

/** A brain file: YAML front matter and a Markdown body (§3.3). The path is its identity, so it is not stored here. */
export interface BrainFile {
  front: Frontmatter;
  body: string;
}

export type ParseResult = { ok: true; file: BrainFile } | { ok: false; reason: string };

/** Never throws. A file with no front matter, an unclosed fence or invalid YAML is a reason, for the validator to report. */
export function parseBrainFile(raw: string): ParseResult {
  const split = splitFile(raw);
  if (split.unclosed) return { ok: false, reason: "the front matter is never closed" };
  if (split.front === null) return { ok: false, reason: "the file has no front matter" };
  const front = Frontmatter.parse(split.front);
  if (!(front instanceof Frontmatter)) return { ok: false, reason: front.message };
  return { ok: true, file: { front, body: split.body } };
}

export function readBrainFile(path: string): ParseResult {
  return parseBrainFile(readFileSync(path, "utf8"));
}

/** The front matter and the body as they were read; the body byte for byte. */
export function serializeBrainFile(file: BrainFile): string {
  return `---\n${file.front.toString()}---\n${file.body}`;
}

/** Atomic write. Callers that change a brain hold the brain's lock around it. */
/** The `## ` headings of a body, in order, ignoring those inside fenced code. */
export function sectionsOf(body: string): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of body.split("\n")) {
    const f = /^(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === undefined) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const h = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) out.push(h[1]!);
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text under one `## ` heading, up to the next heading of the same or higher level; undefined if absent. */
export function sectionBody(body: string, heading: string): string | undefined {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##[ \\t]+${escapeRegExp(heading)}[ \\t]*$`).test(l));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (/^#{1,2}[ \t]/.test(lines[i]!)) {
      end = i;
      break;
    }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/** The body without its `## Changelog`, which grows with every update and is not part of what a page says (§4.3). */
export function withoutChangelog(body: string): string {
  const at = body.search(/^##[ \t]+Changelog[ \t]*$/m);
  return (at < 0 ? body : body.slice(0, at)).trim();
}

/** The kind, when present and in its list. */
export function kindOf(file: BrainFile): Kind | undefined {
  const k = file.front.getString("kind");
  return k !== undefined && isKind(k) ? k : undefined;
}

/** Add one `- <line>` at the end of a `## <heading>` section, creating the section at the end of the body when it is missing. */
function appendToSection(file: BrainFile, heading: string, line: string): void {
  if (line.includes("\n")) throw userError(`a ${heading.toLowerCase()} entry is one line`, "entry_multiline");
  const item = `- ${line}`;
  const lines = file.body.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^##[ \\t]+${escapeRegExp(heading)}[ \\t]*$`).test(l));
  if (at < 0) {
    file.body = `${file.body.replace(/\s+$/, "")}\n\n## ${heading}\n\n${item}\n`;
    return;
  }
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++)
    if (/^#{1,2}[ \t]/.test(lines[i]!)) {
      end = i;
      break;
    }
  const before = lines.slice(0, at + 1).join("\n");
  const entries = lines
    .slice(at + 1, end)
    .join("\n")
    .trim();
  const tail = lines.slice(end).join("\n");
  file.body = `${before}\n\n${entries === "" ? "" : `${entries}\n`}${item}\n${tail ? `\n${tail}` : ""}`;
}

/** A Changelog line: the date and one line of text (§3.3). */
export function appendChangelog(file: BrainFile, date: string, text: string): void {
  appendToSection(file, "Changelog", `${date} ${text}`);
}

/** An Evidence line of an instinct: the date, what happened, and its source (§3.6). */
export function appendEvidence(file: BrainFile, date: string, text: string, source: string): void {
  appendToSection(file, "Evidence", `${date}: ${text} (${source})`);
}

/** A dated note in an instinct's record that is not an occasion, in the Changelog's shape, which `evidenceOf` does not count (§3.6). */
export function appendEvidenceNote(file: BrainFile, date: string, text: string): void {
  appendToSection(file, "Evidence", `${date} ${text}`);
}

export interface EvidenceLine {
  date: string;
  text: string;
  source: string;
}

const EVIDENCE_LINE = /^- (\d{4}-\d{2}-\d{2}): (.*) \((.*)\)$/;
const CHANGELOG_LINE = /^- (\d{4}-\d{2}-\d{2}) (.*)$/;

/** The Evidence lines of a page, in order; lines of another shape are skipped. */
export function evidenceOf(file: BrainFile): EvidenceLine[] {
  const section = sectionBody(file.body, "Evidence");
  if (section === undefined) return [];
  return section.split("\n").flatMap((l) => {
    const m = EVIDENCE_LINE.exec(l.trim());
    return m ? [{ date: m[1]!, text: m[2]!, source: m[3]! }] : [];
  });
}

/** The Changelog lines of a page, in order. */
export function changelogOf(file: BrainFile): { date: string; text: string }[] {
  const section = sectionBody(file.body, "Changelog");
  if (section === undefined) return [];
  return section.split("\n").flatMap((l) => {
    const m = CHANGELOG_LINE.exec(l.trim());
    return m ? [{ date: m[1]!, text: m[2]! }] : [];
  });
}
