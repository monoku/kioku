/**
 * `applies_to` (§3.3): the files of the project a page is about, as globs relative to the project folder, the one whose
 * `kioku.yaml` names the brain. A page that says so is named to the agent when it reads or changes one of them (§4.7).
 * `*` is anything inside a folder's name, `?` one character, `**` any folders; a glob with neither is a file, or a
 * folder and everything under it.
 */

/** The most globs a page lists. */
export const APPLIES_MAX = 10;

/** `none` alone, to `update`, takes the field off the page. */
export const isNone = (globs: string[]): boolean => globs.length === 1 && globs[0]!.trim() === "none";

/** A glob as it is kept: trimmed, no `./` before it, no `/` after it. */
export const cleanGlob = (glob: string): string =>
  glob
    .trim()
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");

/** Why a glob cannot be one, or undefined: it names files inside the project folder, and not all of them. */
export function globProblem(raw: string): string | undefined {
  const glob = cleanGlob(raw);
  if (glob === "") return "it is empty";
  if (/[\\\n]/.test(glob)) return "it holds a `\\` or a line break; folders are parted by `/`";
  if (glob.startsWith("/") || glob.startsWith("~") || /^[A-Za-z]:/.test(glob))
    return "it is absolute; it is relative to the project folder";
  const segments = glob.split("/");
  if (segments.includes("..")) return "it leaves the project folder";
  if (segments.every((s) => s === "**" || s === "*")) return "it matches every file of the project";
  return undefined;
}

const literal = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** One segment of a glob as a regular expression: `*` and `?` stay inside a folder's name. */
const segment = (s: string): string => literal(s).replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");

const compiled = new Map<string, RegExp | null>();

function regexOf(raw: string): RegExp | null {
  const known = compiled.get(raw);
  if (known !== undefined) return known;
  let made: RegExp | null = null;
  if (globProblem(raw) === undefined) {
    const parts = cleanGlob(raw).split("/");
    const wild = parts.some((p) => /[*?]/.test(p));
    let re = "";
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      if (p === "**") re += last ? ".*" : "(?:.*/)?";
      else re += segment(p) + (last ? "" : "/");
    });
    // With no wildcard it is a file, or a folder and what is under it.
    made = new RegExp(`^${re}${wild ? "" : "(?:/.*)?"}$`);
  }
  compiled.set(raw, made);
  return made;
}

/** Whether a glob matches a path relative to the project folder, parted by `/`. A glob that cannot be one matches nothing. */
export const globMatches = (glob: string, rel: string): boolean => regexOf(glob)?.test(rel) ?? false;
