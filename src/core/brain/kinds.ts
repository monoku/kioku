import type { Naming } from "../errors.ts";
/** The kinds of page in a brain, where each lives and what its body must hold (§3.1, §3.4). */

export const KINDS = ["memory", "knowledge", "rule", "skill"] as const;
export type Kind = (typeof KINDS)[number];

/** `instinct` is a subkind of Memory, the other three of Knowledge (§3.1, §3.6). */
export const SUBS = ["decision", "playbook", "context", "instinct"] as const;
export type Sub = (typeof SUBS)[number];

export const KNOWLEDGE_SUBS = ["decision", "playbook", "context"] as const;

/** What a page is: a kind and, where the kind has them, a subkind. */
export interface PageType {
  kind: Kind;
  sub?: Sub;
}

export interface TypeSpec extends PageType {
  /** Folder at the brain's root; Knowledge lives under `knowledge/<namespace>/<folder>/`. */
  folder: string;
  /** Fields the type adds to the shared ones. */
  extraFields: readonly string[];
  /** The `## ` headings the body must hold, in order. */
  sections: readonly string[];
  /** The tool appends to a `## Changelog` section on every update. */
  changelog: boolean;
  /** The body ends with a `## Evidence` list, one dated line per occasion. */
  evidence: boolean;
}

const spec = (s: Partial<TypeSpec> & Pick<TypeSpec, "kind" | "folder">): TypeSpec => ({
  extraFields: [],
  sections: [],
  changelog: false,
  evidence: false,
  ...s,
});

/** The table of §3.4, one row per type. */
/** The folders a knowledge page lives in, under its namespace: the names that end a namespace's path (§3.2). */
export const KNOWLEDGE_FOLDERS = (): string[] => TYPE_SPECS.filter((t) => t.kind === "knowledge").map((t) => t.folder);

export const TYPE_SPECS: readonly TypeSpec[] = [
  spec({ kind: "memory", folder: "memory", sections: ["What happened", "Lesson", "Rule of thumb"] }),
  spec({
    kind: "memory",
    sub: "instinct",
    folder: "memory/instincts",
    sections: ["When", "Do", "Evidence"],
    evidence: true,
  }),
  spec({
    kind: "knowledge",
    sub: "decision",
    folder: "decisions",
    extraFields: ["supersedes", "superseded_by"],
    sections: ["Decision", "Why", "Consequences"],
    changelog: true,
  }),
  spec({ kind: "knowledge", sub: "playbook", folder: "playbooks", sections: ["When", "Steps"], changelog: true }),
  spec({ kind: "knowledge", sub: "context", folder: "context", changelog: true }),
  spec({ kind: "rule", folder: "rules", sections: ["Rule", "Why"], changelog: true }),
  spec({ kind: "skill", folder: "skills", sections: ["When to use", "Steps"], changelog: true }),
];

export const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);
export const isSub = (s: string): s is Sub => (SUBS as readonly string[]).includes(s);

/** The subkind a kind accepts, or an explanation of why not. */
export function typeOf(kind: Kind, sub?: Sub): PageType | { error: (n: Naming) => string } {
  const found = TYPE_SPECS.find((t) => t.kind === kind && t.sub === sub);
  if (found) return sub === undefined ? { kind } : { kind, sub };
  if (kind === "knowledge")
    return { error: (n) => `a knowledge page needs ${n.field("sub")} ${KNOWLEDGE_SUBS.join(", ")}` };
  if (sub !== undefined) return { error: () => `a ${kind} page has no subkind \`${sub}\`` };
  return { error: () => `unknown type ${kind}` };
}

export function specFor(type: PageType): TypeSpec {
  const found = TYPE_SPECS.find((t) => t.kind === type.kind && t.sub === type.sub);
  if (!found) throw new Error(`unknown page type ${type.kind}${type.sub ? `/${type.sub}` : ""}`);
  return found;
}

/** The folder a page of this type lives in, brain-relative with no trailing slash. Knowledge needs its namespace. */
export function folderFor(type: PageType, namespace?: string): string {
  const s = specFor(type);
  if (type.kind !== "knowledge") return s.folder;
  if (!namespace) throw new Error("a knowledge page needs a namespace");
  return `knowledge/${namespace}/${s.folder}`;
}

/** What a page at a brain-relative path must be, from its folder alone (§5.1 rule 5). */
export interface Placement extends PageType {
  /** Knowledge only: the namespace the folder names. */
  namespace?: string;
}

export function placementOf(relPath: string): Placement | undefined {
  const parts = relPath.split("/");
  const [top, second] = parts;
  if (top === "knowledge") {
    // The namespace is a path: what lies between `knowledge/` and the first folder of a kind, which is why those names
    // are reserved (§3.2). A page needs at least a namespace, a folder and a file.
    const at = parts.findIndex((p, i) => i >= 2 && TYPE_SPECS.some((t) => t.kind === "knowledge" && t.folder === p));
    if (at < 0 || parts.length < at + 2) return undefined;
    const found = TYPE_SPECS.find((t) => t.kind === "knowledge" && t.folder === parts[at])!;
    return { kind: "knowledge", sub: found.sub!, namespace: parts.slice(1, at).join("/") };
  }
  if (top === "memory") {
    if (parts.length === 2) return { kind: "memory" };
    return second === "instincts" && parts.length === 3 ? { kind: "memory", sub: "instinct" } : undefined;
  }
  if (parts.length < 2) return undefined;
  const found = TYPE_SPECS.find((t) => t.kind !== "knowledge" && t.kind !== "memory" && t.folder === top);
  return found ? { kind: found.kind } : undefined;
}
