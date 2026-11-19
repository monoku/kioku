import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFrontPageAt, listMarkdown } from "../brain/brain.ts";
import { parseBrainFile, serializeBrainFile } from "../brain/file.ts";
import { folderFor, placementOf } from "../brain/kinds.ts";
import type { BrainConfig } from "../config/folder-config.ts";
import type { FileChange } from "./apply.ts";
import { rebaseLinks, retargetLinksBy } from "./body.ts";

/** A Memory page that has no folder to go to (§3.2): it names no namespace, or one the brain does not declare. */
export interface Unplaced {
  path: string;
  /** The namespace its front matter says; absent when it says none. */
  namespace?: string;
  /** Where it would go, when a page is there already. */
  taken?: string;
}

/**
 * The Memory pages of a brain that are not in the folder of their namespace (§3.1), each with where it belongs,
 * `memory/<namespace>/` or `memory/<namespace>/instincts/` with its file name, and the ones that have nowhere to go.
 */
export function memoryMoves(root: string, config: BrainConfig): { moves: Map<string, string>; unplaced: Unplaced[] } {
  const moves = new Map<string, string>();
  const unplaced: Unplaced[] = [];
  const taken = new Set<string>();
  for (const rel of listMarkdown(root)) {
    const place = placementOf(rel);
    if (place?.kind !== "memory" || place.namespace !== undefined) continue;
    const parsed = parseBrainFile(readFileSync(join(root, rel), "utf8"));
    const namespace = parsed.ok ? parsed.file.front.getString("namespace") : undefined;
    if (namespace === undefined || !config.namespaces.includes(namespace)) {
      unplaced.push({ path: rel, ...(namespace !== undefined && { namespace }) });
      continue;
    }
    const type = { kind: place.kind, ...(place.sub !== undefined && { sub: place.sub }) };
    const to = `${folderFor(type, namespace, true)}/${rel.split("/").at(-1)}`;
    if (taken.has(to) || existsSync(join(root, to))) {
      unplaced.push({ path: rel, namespace, taken: to });
      continue;
    }
    taken.add(to);
    moves.set(rel, to);
  }
  return { moves, unplaced };
}

/**
 * The files of a brain as they are once the pages of `moves` are at their new paths (§3.2): each page moved with its
 * own relative links written again from where it is, every link of the brain to a moved page pointing at its new
 * path, an index or the front page included, and a `source` that is a moved page's path saying the new one. Nothing
 * else of a page changes: its `id`, its fields and its text stay.
 */
export function relocated(root: string, moves: ReadonlyMap<string, string>): FileChange[] {
  const changes: FileChange[] = [];
  if (moves.size === 0) return changes;
  for (const rel of listMarkdown(root)) {
    const newRel = moves.get(rel) ?? rel;
    const text = readFileSync(join(root, rel), "utf8");
    let out = text;
    const parsed = isFrontPageAt(rel) ? undefined : parseBrainFile(text);
    if (parsed?.ok) {
      const file = parsed.file;
      const body = retargetLinksBy(newRel === rel ? file.body : rebaseLinks(file.body, rel, newRel), newRel, moves);
      let changed = body !== file.body;
      file.body = body;
      const source = file.front.getString("source");
      const moved = source === undefined ? undefined : moves.get(source);
      if (moved !== undefined) {
        file.front.set("source", moved);
        changed = true;
      }
      if (changed) out = serializeBrainFile(file);
    } else out = retargetLinksBy(text, rel, moves);
    if (out === text && newRel === rel) continue;
    if (newRel !== rel) changes.push({ rel, text: null });
    changes.push({ rel: newRel, text: out });
  }
  return changes;
}

/** What is said of the pages that have nowhere to go, wherever it is said: each with its namespace, or that it has none. */
export const unplacedSaid = (unplaced: Unplaced[]): string =>
  unplaced
    .map((u) =>
      u.taken !== undefined
        ? `${u.path} (${u.taken} is there already)`
        : `${u.path} (${u.namespace === undefined ? "no namespace" : `namespace ${u.namespace}, which the brain does not declare`})`,
    )
    .join(", ");
