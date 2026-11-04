/**
 * A namespace's `INDEX.md` is plain Markdown (§3.2): a heading, then the paragraph that describes the namespace, then
 * `## Load first`. These read and change that paragraph and nothing else.
 */

/** The lines of the first paragraph under the title: where it starts and ends, or where one would go. */
function paragraphAt(lines: string[]): { start: number; end: number; present: boolean } {
  const heading = lines.findIndex((l) => /^# /.test(l));
  let i = heading + 1;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (i >= lines.length || /^#{1,6}\s/.test(lines[i]!)) return { start: heading + 1, end: heading + 1, present: false };
  let end = i;
  while (end < lines.length && lines[end]!.trim() !== "" && !/^#{1,6}\s/.test(lines[end]!)) end++;
  return { start: i, end, present: true };
}

/** The paragraph that describes the namespace, on one line; undefined when there is none. */
export function descriptionOf(index: string): string | undefined {
  const lines = index.split("\n");
  const p = paragraphAt(lines);
  if (!p.present) return undefined;
  return lines.slice(p.start, p.end).join(" ").replace(/\s+/g, " ").trim();
}

/** The generic paragraph the tool writes when it makes a namespace: it says nothing about this one (§3.2). */
export const isGenericDescription = (text: string): boolean =>
  /^What is true of (the work of )?.+: decisions, playbooks and context\.$/.test(text);

/** Whether the namespace says what it is: it has a paragraph, and it is not the generic one. */
export function isDescribed(index: string | undefined): boolean {
  if (index === undefined) return false;
  const d = descriptionOf(index);
  return d !== undefined && d !== "" && !isGenericDescription(d);
}

/** `index` with its description replaced, or added under the title when there is none; the rest is left as it is. */
export function withDescription(index: string, summary: string): string {
  const lines = index.split("\n");
  const p = paragraphAt(lines);
  const text = summary.replace(/\s+/g, " ").trim();
  if (p.present) return [...lines.slice(0, p.start), text, ...lines.slice(p.end)].join("\n");
  const at = p.start;
  return [
    ...lines.slice(0, at),
    "",
    text,
    ...(lines[at] === undefined || lines[at] === "" ? [] : [""]),
    ...lines.slice(at),
  ].join("\n");
}

/** What a new namespace's `INDEX.md` holds: its path as the title, its description, and an empty `## Load first`. */
export const newIndex = (namespace: string, summary: string): string =>
  `# ${namespace}\n\n${summary.replace(/\s+/g, " ").trim()}\n\n## Load first\n\nThe pages to read before working on ${namespace}, five at most, one link per line.\n`;
