import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readInsideIfAny } from "./inside.ts";
import { join, posix, relative, sep } from "node:path";
import { brainRepoOfFolder } from "../config/brain-ref.ts";
import { KNOWN_FORMATS, readFolderConfig, type BrainConfig } from "../config/folder-config.ts";
import { parseBrainFile, type BrainFile } from "./file.ts";
import { KNOWLEDGE_FOLDERS, placementOf, type Placement } from "./kinds.ts";
import { environmentError, refusedError, userError } from "../errors.ts";
import { hostRootFiles } from "../../harness/index.ts";
import { AGENTS_MD } from "../brains/agents-md.ts";

/** One page of a brain, read: where it is, what its folder says it is, and the file or why it could not be read. */
export interface Page {
  /** Brain-relative, `/`-separated. */
  path: string;
  /** From the folder alone; undefined for a file in no kind's folder. */
  placement: Placement | undefined;
  /** The parsed file, or the reason it is not a page (for the validator). */
  parsed: { ok: true; file: BrainFile } | { ok: false; reason: string };
}

export interface Brain {
  root: string;
  config: BrainConfig;
  /** `BRAIN.md` at the root, when present. */
  index: string | undefined;
  /** `knowledge/<namespace>/INDEX.md` for each namespace that has one. */
  namespaceIndexes: Record<string, string>;
  pages: Page[];
}

/** Every `.md` file of the brain, brain-relative, skipping hidden folders (`.git`, `.github`). */
export function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/**
 * A brain-relative path as the tool takes one from outside, a flag or a request (§3.1): normalised, and inside the
 * brain; undefined for one that is empty or would leave it. The command line and the writing path both ask here.
 */
export function brainRel(raw: string): string | undefined {
  const rel = posix.normalize(raw.replace(/^\.\//, ""));
  return rel === "" || rel === "." || rel.startsWith("..") || rel.startsWith("/") ? undefined : rel;
}

/** The brain's front page (§3.1). */
export const FRONT_PAGE = "BRAIN.md";
/**
 * The Markdown files at the root that are not pages (§3.1, §2.7): the front page, `AGENTS.md` and each agent host's
 * pointer, which only the adapter names. A host's files under a hidden folder, such as `.claude/`, are never listed.
 */
const rootFiles = (): string[] => [FRONT_PAGE, AGENTS_MD, ...hostRootFiles()];

/** Whether a brain-relative path is plain Markdown and not a page: a root file above, or a namespace's `INDEX.md`. The name says "front page" for the common case. */
export function isFrontPageAt(rel: string): boolean {
  if (rootFiles().includes(rel)) return true;
  // A namespace's index, at any depth: `knowledge/payments/billing/INDEX.md`; an INDEX.md under a kind's folder is a page.
  // The first part of the path is always a namespace, even one a brain named before the names were reserved (§3.2).
  const parts = rel.split("/");
  return (
    parts[0] === "knowledge" &&
    parts.length >= 3 &&
    parts.at(-1) === "INDEX.md" &&
    !parts.slice(2, -1).some((s) => KNOWLEDGE_FOLDERS().includes(s))
  );
}

/** A brain's own `kioku.yaml`. Throws when the folder is not a brain. */
export function readBrainConfig(root: string): BrainConfig {
  const path = join(root, "kioku.yaml");
  if (!existsSync(path)) throw environmentError(`${root} is not a brain: it has no kioku.yaml`, "not_a_brain");
  const config = readFolderConfig(path);
  if (!config.ok) throw userError(config.reason, "brain_config_invalid");
  if (config.value.form !== "brain")
    throw userError(`${path} is a project folder's file, not a brain's`, "brain_config_invalid");
  return config.value;
}

/** The newest brain format this tool reads, and whether a brain declares a newer one (§5.1). */
export const NEWEST_FORMAT = Math.max(...KNOWN_FORMATS);
/** What is said of a format past `NEWEST_FORMAT`, wherever it is said. */
export const NEWER_THAN_READ = `newer than the newest this tool reads (${NEWEST_FORMAT})`;

/**
 * A brain in a format newer than the tool reads is not written to (§5.1): the tool cannot know what the newer format
 * changed, so it would write what the others on that brain no longer expect. Refused before any file is touched.
 */
export function assertWritableFormat(root: string, config: BrainConfig = readBrainConfig(root)): void {
  if (config.format > NEWEST_FORMAT) {
    throw refusedError(
      `${brainRepoOfFolder(root)} is in format ${config.format}, ${NEWER_THAN_READ}, so nothing was written: run kioku update, then try again`,
      "format_newer",
    );
  }
}

/** Reads a brain: its configuration, its front pages and every page with the kind its folder gives it (§3.1, §3.2). */
export function readBrain(root: string): Brain {
  const config = readBrainConfig(root);
  // Only the brain's own files (§3.1): a link, or a path that leaves the folder, is read as missing.
  const read = (rel: string): string | undefined => readInsideIfAny(root, rel);
  const namespaceIndexes: Record<string, string> = {};
  for (const ns of config.namespaces) {
    const text = read(`knowledge/${ns}/INDEX.md`);
    if (text !== undefined) namespaceIndexes[ns] = text;
  }
  const pages = listMarkdown(root)
    .filter((rel) => !isFrontPageAt(rel))
    .map(
      (rel): Page => ({
        path: rel,
        placement: placementOf(rel),
        parsed: parseBrainFile(readFileSync(join(root, rel), "utf8")),
      }),
    );
  return { root, config, index: read(FRONT_PAGE), namespaceIndexes, pages };
}
