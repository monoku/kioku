import { readInsideIfAny } from "./inside.ts";
import { sectionBody } from "./file.ts";
import { linksOf, resolveLink } from "./paths.ts";

/** The most pages a namespace's `## Load first` may name: the few an agent should read before working there. */
export const LOAD_FIRST_MAX = 5;

export interface LoadFirst {
  /** The namespace's index, brain-relative. */
  index: string;
  /** Each link as written, and the brain-relative path it resolves to (undefined when it leaves the brain). */
  links: { target: string; path: string | undefined }[];
}

/**
 * The `## Load first` section of a namespace's `INDEX.md` (§4.1): the links an agent should read first. Undefined
 * when the namespace has no index or no such section; the section is the person's to write.
 */
export function loadFirstOf(
  root: string,
  namespace: string,
  read: (rel: string) => string | undefined = (rel) => readInsideIfAny(root, rel),
): LoadFirst | undefined {
  const index = `knowledge/${namespace}/INDEX.md`;
  const indexText = read(index);
  if (indexText === undefined) return undefined;
  const text = sectionBody(indexText, "Load first");
  if (text === undefined) return undefined;
  return { index, links: linksOf(text).map((l) => ({ target: l.target, path: resolveLink(index, l.target) })) };
}
