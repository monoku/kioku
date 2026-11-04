import { posix } from "node:path";
import { folderFor, type PageType } from "./kinds.ts";
import { userError } from "../errors.ts";

const SLUG_MAX = 80;

/** A title as a file name: accents folded, lower case, runs of anything else become one hyphen, cut at a word. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= SLUG_MAX) return slug;
  const cut = slug.slice(0, SLUG_MAX);
  const at = cut.lastIndexOf("-");
  return (at > SLUG_MAX / 2 ? cut.slice(0, at) : cut).replace(/-+$/, "");
}

/** The brain-relative path of a page: a slug of the title in the folder of its type (§3.1, §3.4). */
export function pagePath(type: PageType, namespace: string, title: string): string {
  const slug = slugify(title);
  if (slug === "") throw userError(`the title "${title}" has no letters or digits to name a file by`, "title_unusable");
  return `${folderFor(type, namespace)}/${slug}.md`;
}

/**
 * The brain-relative path a relative Markdown link points at from the page at `fromPath` (§3.3), or undefined
 * for a link that is not a file of the brain: an external URL, a bare anchor, or a path that leaves the brain.
 */
export function resolveLink(fromPath: string, href: string): string | undefined {
  const target = href.trim().split("#")[0]!.split("?")[0]!;
  if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/") || target.startsWith("//"))
    return undefined;
  const resolved = posix.normalize(posix.join(posix.dirname(fromPath), safeDecode(target)));
  return resolved === "." || resolved === ".." || resolved.startsWith("../") ? undefined : resolved;
}

/** The relative link text from the page at `fromPath` to the page at `toPath`, both brain-relative. */
export function linkBetween(fromPath: string, toPath: string): string {
  const rel = posix.relative(posix.dirname(fromPath), toPath);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** A relative Markdown link of a body: its target as written (decoded, without anchor) and the 1-based line it is on. */
export interface BodyLink {
  target: string;
  line: number;
}

/**
 * The relative links in a body. Links to other sites, anchors, mail and absolute paths are not the brain's to check,
 * and neither is anything inside a code fence or inline code. Images are links too.
 */
export function linksOf(body: string, firstLine = 1): BodyLink[] {
  const links: BodyLink[] = [];
  let fence: string | undefined;
  body.split("\n").forEach((raw, i) => {
    const f = /^\s*(```+|~~~+)/.exec(raw);
    if (f) {
      fence = fence === undefined ? f[1]![0]! : fence === f[1]![0] ? undefined : fence;
      return;
    }
    if (fence !== undefined) return;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
      const target = (m[1] ?? m[2])!.replace(/[#?].*$/, "");
      if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/") || target.startsWith("//"))
        continue;
      links.push({ target: safeDecode(target), line: firstLine + i });
    }
  });
  return links;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
