/**
 * What a namespace may be called (§3.2): a path whose segments are folders' names, as a repository's is. One place, so
 * that the verbs that make a namespace and the validator that reads one say the same.
 */
export const NAMESPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Names a brain already uses for its folders and files, which a namespace would be confused with (§3.2). */
export const RESERVED_NAMESPACES: readonly string[] = [
  "decisions",
  "playbooks",
  "context",
  "instincts",
  "memory",
  "rules",
  "skills",
  "knowledge",
  "index",
];

/** The deepest a namespace goes: `payments/billing/invoices` (§3.2). */
export const MAX_NAMESPACE_DEPTH = 3;

/** The segments of a namespace path. */
export const segmentsOf = (path: string): string[] => path.split("/");

/** How many segments deep a namespace is: 1 for a top-level one. */
export const depthOf = (path: string): number => segmentsOf(path).length;

/** The namespace above, or undefined for a top-level one. */
export const parentOf = (path: string): string | undefined => {
  const at = path.lastIndexOf("/");
  return at < 0 ? undefined : path.slice(0, at);
};

/** Whether a segment is one of the reserved names, in any case. */
export const isReservedNamespace = (segment: string): boolean => RESERVED_NAMESPACES.includes(segment.toLowerCase());

/** Whether `path` is `of` or lies under it. */
export const isUnder = (path: string, of: string): boolean => path === of || path.startsWith(`${of}/`);

/** What a verb that makes a namespace says is wrong with a path, or undefined when it is fine (§3.2). */
export function namespaceProblem(path: string): string | undefined {
  for (const segment of segmentsOf(path)) {
    if (!NAMESPACE_NAME.test(segment))
      return `a namespace is letters, digits, dots, dashes and underscores, starting with a letter or digit, in each part of its path, not "${path}"`;
    if (isReservedNamespace(segment))
      return `"${segment}" is a name a brain already uses (${RESERVED_NAMESPACES.join(", ")}); choose another`;
  }
  if (depthOf(path) > MAX_NAMESPACE_DEPTH) return `a namespace is at most ${MAX_NAMESPACE_DEPTH} deep, not "${path}"`;
  return undefined;
}

/**
 * What cannot be a namespace at all, so that the validator refuses it and does not only warn (§5.1 rule 11): a segment
 * that is empty, `.`, `..` or holds a `\`.
 */
export function namespaceBreaksPaths(path: string): string | undefined {
  const segments = segmentsOf(path);
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\\")))
    return `the namespace "${path}" cannot be a folder's name`;
  return undefined;
}
