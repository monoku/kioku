import { brainRepoOfKey } from "../config/brain-ref.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendChangelog, parseBrainFile, serializeBrainFile, type BrainFile } from "../brain/file.ts";
import { placementOf, specFor } from "../brain/kinds.ts";
import { linkBetween, pagePath, resolveLink } from "../brain/paths.ts";
import { userError } from "../errors.ts";
import { applyChanges, bringIn, type FileChange, type TargetBrain } from "./apply.ts";
import { rebaseLinks, retargetLinks } from "./body.ts";
import type { WriteContext } from "./apply.ts";
import { described, oneLine, pagesLinkingTo, readPage, today, type Done } from "./verbs.ts";

/**
 * The verbs that give a page another path, `move` and `rename` (§3.2, §3.3), and what follows from it: the links of
 * the brain that pointed at the old path point at the new one, in the same commit. Links from outside the brain are
 * not rewritten.
 */

/** Whether a `supersedes` or `superseded_by` value, written in `from`, names `rel`. */
/** A `supersedes` or `superseded_by` value, written in `from`, resolved: relative to the page, else from the root. */
const resolveEither = (from: string, value: string): string | undefined =>
  resolveLink(from, value) ?? resolveLink("x", value);
const namesPage = (from: string, value: string, rel: string): boolean => resolveEither(from, value) === rel;

/**
 * The Markdown of the brain that links to `rel`, rewritten to link to `newRel` (§3.5): a page's body links, with
 * the old title as their text replaced by the new one, and its `supersedes` and `superseded_by` fields; a file that
 * is not a page, an index or a front page, in its text.
 */
export function relink(
  brain: TargetBrain,
  rel: string,
  newRel: string,
  titles: { old: string; new: string },
): { changes: FileChange[]; linked: string[] } {
  const changes: FileChange[] = [];
  const linked: string[] = [];
  for (const from of pagesLinkingTo(brain.root, rel)) {
    const raw = readFileSync(join(brain.root, from), "utf8");
    const parsed = parseBrainFile(raw);
    if (!parsed.ok) {
      const text = retargetLinks(raw, from, rel, newRel, titles.old, titles.new);
      if (text !== raw) {
        changes.push({ rel: from, text });
        linked.push(from);
      }
      continue;
    }
    const page = parsed.file;
    const body = retargetLinks(page.body, from, rel, newRel, titles.old, titles.new);
    let changed = body !== page.body;
    page.body = body;
    for (const field of ["supersedes", "superseded_by"]) {
      const v = page.front.getString(field);
      if (v !== undefined && namesPage(from, v, rel)) {
        page.front.set(field, linkBetween(from, newRel));
        changed = true;
      }
    }
    if (changed) {
      changes.push({ rel: from, text: serializeBrainFile(page) });
      linked.push(from);
    }
  }
  return { changes, linked };
}

/** The page's own relative links, and its `supersedes` and `superseded_by`, written again from its new path. */
function rebaseOwnLinks(file: BrainFile, rel: string, newRel: string): void {
  file.body = rebaseLinks(file.body, rel, newRel);
  for (const field of ["supersedes", "superseded_by"]) {
    const v = file.front.getString(field);
    if (v === undefined) continue;
    const target = resolveEither(rel, v);
    if (target !== undefined) file.front.set(field, linkBetween(newRel, target));
  }
}

/**
 * `kioku page move <path> --namespace <ns>` (§3.2, §6.1): a page changes namespace of its brain. A knowledge page's
 * file moves to the folder of that namespace and the rest of its path stays; any other kind keeps its folder and its
 * `namespace` changes. The `id` does not; every page that linked to it, an index included, now links to the new path,
 * and its own relative links are written again from where it is, in the same commit.
 */
export async function move(
  brain: TargetBrain,
  rel: string,
  input: { namespace: string },
  env: WriteContext,
): Promise<Done> {
  const seen = await bringIn(brain);
  const { file, type } = readPage(brain, rel);
  const config = seen.repo.config();
  const to = input.namespace.trim();
  if (!config.namespaces.includes(to))
    throw userError(
      `${brainRepoOfKey(brain.key)} has no namespace ${to} (it has ${config.namespaces.join(", ")}); \`kioku namespace add\` makes one`,
      "not_found",
    );
  const place = placementOf(rel);
  const from = place?.namespace ?? file.front.getString("namespace") ?? config.namespaces[0]!;
  if (from === to && file.front.getString("namespace") === to)
    throw userError(`${rel} is already in ${to}; nothing was written`, "unchanged");
  const newRel =
    type.kind === "knowledge" && place?.namespace !== undefined
      ? `knowledge/${to}/${rel.slice(`knowledge/${from}/`.length)}`
      : rel;
  if (newRel !== rel && existsSync(join(brain.root, newRel)))
    throw userError(`${newRel} already exists in ${brainRepoOfKey(brain.key)}; rename the page first`, "path_exists");
  const title = file.front.getString("title") ?? rel;

  file.front.set("namespace", to);
  if (specFor(type).changelog) appendChangelog(file, today(env.now), `Moved from the namespace "${from}" to "${to}".`);
  if (newRel !== rel) rebaseOwnLinks(file, rel, newRel);
  const changes: FileChange[] = [];
  if (newRel !== rel) changes.push({ rel, text: null });
  changes.push({ rel: newRel, text: serializeBrainFile(file) });
  const { changes: others, linked } =
    newRel !== rel ? relink(brain, rel, newRel, { old: title, new: title }) : { changes: [], linked: [] };
  const applied = await applyChanges(brain, [...changes, ...others], `move: ${title}`, env, seen);
  return {
    status: "done",
    brain: brain.key,
    path: newRel,
    id: file.front.getString("id")!,
    ...described(newRel, file.front),
    namespace: to,
    ...(newRel !== rel && { from: rel }),
    ...applied,
    ...(linked.length > 0 && { relinked: linked }),
  };
}

/**
 * `kioku page rename` (§3.5): a page's title, and so its file name, changes. The `id` does not; the old title
 * stays as an alias so that search still finds it; every page that linked to the old path, and every index or front
 * page, now links to the new one, in the same commit. Links from outside the brain are not rewritten.
 */
export async function rename(
  brain: TargetBrain,
  rel: string,
  input: { title: string },
  env: WriteContext,
): Promise<Done> {
  const seen = await bringIn(brain);
  const { file, type } = readPage(brain, rel);
  const title = oneLine(input.title, "title");
  const oldTitle = file.front.getString("title") ?? rel;
  if (title === oldTitle) throw userError(`${rel} is already called "${title}"; nothing was written`, "unchanged");
  const namespace = file.front.getString("namespace") ?? seen.repo.config().namespaces[0]!;
  const newRel = pagePath(type, namespace, title);
  if (newRel !== rel && existsSync(join(brain.root, newRel)))
    throw userError(`${newRel} already exists in ${brainRepoOfKey(brain.key)}; choose another title`, "path_exists");

  file.front.set("title", title);
  const aliases = file.front.getList("aliases") ?? [];
  if (!aliases.includes(oldTitle)) file.front.set("aliases", [...aliases, oldTitle]);
  if (specFor(type).changelog) appendChangelog(file, today(env.now), `Renamed from "${oldTitle}".`);
  const changes: FileChange[] = [];
  if (newRel !== rel) changes.push({ rel, text: null });
  changes.push({ rel: newRel, text: serializeBrainFile(file) });
  const { changes: others, linked } =
    newRel !== rel ? relink(brain, rel, newRel, { old: oldTitle, new: title }) : { changes: [], linked: [] };
  const applied = await applyChanges(brain, [...changes, ...others], `rename: ${title}`, env, seen);
  return {
    status: "done",
    brain: brain.key,
    path: newRel,
    id: file.front.getString("id")!,
    ...described(newRel, file.front),
    ...(newRel !== rel && { from: rel }),
    ...applied,
    ...(linked.length > 0 && { relinked: linked }),
  };
}
