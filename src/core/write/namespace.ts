import { brainRepoOfKey } from "../config/brain-ref.ts";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isFrontPageAt, listMarkdown, readBrainConfig } from "../brain/brain.ts";
import { appendChangelog, parseBrainFile, serializeBrainFile } from "../brain/file.ts";
import { placementOf, specFor } from "../brain/kinds.ts";
import { linkBetween, resolveLink } from "../brain/paths.ts";
import { stringifyFolderConfig } from "../config/folder-config.ts";
import { depthOf, isUnder, MAX_NAMESPACE_DEPTH, namespaceProblem, parentOf } from "../brain/namespace-name.ts";
import { newIndex, withDescription } from "../brain/namespace-index.ts";
import { namedError, userError } from "../errors.ts";
import { applyChanges, bringIn, type Applied, type FileChange, type TargetBrain } from "./apply.ts";
import { retargetLinksBy } from "./body.ts";
import type { WriteContext } from "./apply.ts";
import { today } from "./verbs.ts";

export interface NamespaceRenamed extends Partial<Applied> {
  status: "done" | "dry-run";
  brain: string;
  from: string;
  to: string;
  /** The files that move, `from` → `to`, brain-relative. */
  moved: { from: string; to: string }[];
  /** The pages that keep their place and are rewritten: links into the namespace, `supersedes`, `namespace:`. */
  rewritten: string[];
  /** The format the brain is at after, when this raised it (§3.2). */
  format?: number;
}

export { namespaceOverview as listNamespaces, type NamespaceSummary } from "../brain/namespaces.ts";

/** Every file under a brain-relative folder, brain-relative, hidden ones too. */
function filesUnder(root: string, folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  if (existsSync(join(root, folder))) walk(join(root, folder));
  return out;
}

/**
 * `kioku brain rename-namespace <from> <to>` (§3.2): a namespace gets another name, in one commit. Its folder
 * `knowledge/<from>/` moves to `knowledge/<to>/`, `kioku.yaml` declares the new name, every page that carries
 * `namespace: <from>` carries `<to>`, and the links and `supersedes` that pointed into the folder follow. The ids do
 * not change. `<to>` must not exist: two namespaces are not merged here. `dryRun` changes nothing and says what would.
 */
export async function renameNamespace(
  brain: TargetBrain,
  input: { from: string; to: string; dryRun?: boolean },
  env: WriteContext,
): Promise<NamespaceRenamed> {
  const { from, to } = input;
  const problem = namespaceProblem(to);
  if (problem !== undefined) throw userError(problem, "usage");
  if (from === to) throw userError(`the namespace is already called ${to}; nothing was written`, "unchanged");
  const seen = input.dryRun !== true ? await bringIn(brain) : undefined;
  const config = seen?.repo.config() ?? readBrainConfig(brain.root);
  if (!config.namespaces.includes(from))
    throw userError(
      `${brainRepoOfKey(brain.key)} has no namespace ${from} (it has ${config.namespaces.join(", ")})`,
      "not_found",
    );
  if (isUnder(to, from)) throw userError(`${to} is under ${from}; a namespace is not moved into itself`, "usage");
  if (config.namespaces.includes(to) || existsSync(join(brain.root, "knowledge", to))) {
    throw userError(
      `${brainRepoOfKey(brain.key)} already has a namespace ${to}; merging two namespaces is not done by this verb`,
      "path_exists",
    );
  }
  const parent = parentOf(to);
  if (parent !== undefined && !config.namespaces.includes(parent))
    throw userError(
      `${brainRepoOfKey(brain.key)} has no namespace ${parent} to put ${to} under; add it first`,
      "not_found",
    );
  // Where each namespace of the subtree goes: the prefix changes and the rest of the path stays.
  const renamed = (ns: string): string => (isUnder(ns, from) ? to + ns.slice(from.length) : ns);
  const tooDeep = config.namespaces.find((n) => isUnder(n, from) && depthOf(renamed(n)) > MAX_NAMESPACE_DEPTH);
  if (tooDeep !== undefined)
    throw userError(
      `${tooDeep} would be ${depthOf(renamed(tooDeep))} deep as ${renamed(tooDeep)}; a namespace is at most ${MAX_NAMESPACE_DEPTH} deep`,
      "usage",
    );
  const oldDir = `knowledge/${from}/`;
  const newDir = `knowledge/${to}/`;
  const moves = new Map<string, string>(
    filesUnder(brain.root, `knowledge/${from}`).map((f) => [f, newDir + f.slice(oldDir.length)]),
  );
  const now = today(env.now);

  const changes: FileChange[] = [];
  const rewritten: string[] = [];
  const pageRels = listMarkdown(brain.root);
  const handled = new Set<string>();

  for (const rel of pageRels) {
    const newRel = moves.get(rel) ?? rel;
    handled.add(rel);
    const text = readFileSync(join(brain.root, rel), "utf8");
    let out = text;
    if (isFrontPageAt(rel)) {
      // A namespace's index names itself in its heading.
      const at = /^knowledge\/(.+)\/INDEX\.md$/.exec(rel);
      if (moves.has(rel) && at !== null) {
        const was = at[1]!;
        out = out.replace(new RegExp(`^# ${was.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `# ${renamed(was)}`);
      }
    } else {
      const parsed = parseBrainFile(text);
      if (parsed.ok) {
        const file = parsed.file;
        let changed = false;
        const body = retargetLinksBy(file.body, newRel, moves);
        if (body !== file.body) {
          file.body = body;
          changed = true;
        }
        for (const field of ["supersedes", "superseded_by"]) {
          const v = file.front.getString(field);
          if (v === undefined) continue;
          const targetRel = moves.get(resolveLink(newRel, v) ?? "") ?? moves.get(resolveLink("x", v) ?? "");
          if (targetRel !== undefined) {
            file.front.set(field, linkBetween(newRel, targetRel));
            changed = true;
          }
        }
        const own = file.front.getString("namespace");
        if (own !== undefined && isUnder(own, from)) {
          file.front.set("namespace", renamed(own));
          const place = placementOf(rel);
          if (
            place !== undefined &&
            specFor({ kind: place.kind, ...(place.sub !== undefined && { sub: place.sub }) }).changelog
          ) {
            appendChangelog(file, now, `Namespace renamed from "${own}" to "${renamed(own)}".`);
          }
          changed = true;
        }
        if (changed) out = serializeBrainFile(file);
      }
    }
    if (out !== text || newRel !== rel) {
      if (newRel !== rel) changes.push({ rel, text: null });
      changes.push({ rel: newRel, text: out });
      if (newRel === rel) rewritten.push(rel);
    }
  }
  // Files of the folder that are not Markdown move as they are.
  for (const [oldRel, newRel] of moves) {
    if (handled.has(oldRel)) continue;
    changes.push({ rel: oldRel, text: null }, { rel: newRel, text: readFileSync(join(brain.root, oldRel), "utf8") });
  }
  changes.push({
    rel: "kioku.yaml",
    text: stringifyFolderConfig({ ...config, namespaces: config.namespaces.map(renamed) }),
  });

  const base = {
    brain: brain.key,
    from,
    to,
    moved: [...moves].map(([f, t]) => ({ from: f, to: t })),
    rewritten,
  };
  // A dry run brought nothing in and writes nothing.
  if (seen === undefined) return { status: "dry-run", ...base };
  const applied = await applyChanges(brain, changes, `namespace: rename ${from} to ${to}`, env, seen);
  // The files left their folders; git does not track the empty ones.
  if (filesUnder(brain.root, `knowledge/${from}`).length === 0)
    rmSync(join(brain.root, "knowledge", from), { recursive: true, force: true });
  return { status: "done", ...base, ...applied };
}

export interface NamespaceMade extends Partial<Applied> {
  status: "done";
  brain: string;
  namespace: string;
  /** The format the brain is at after, when this raised it (§3.2). */
  format?: number;
}

/**
 * `kioku namespace add <path> --summary <text> --brain <b>` (§3.2): a namespace is declared in `kioku.yaml` and its `INDEX.md` is
 * written, in one commit. Its parent must exist.
 */
export async function addNamespace(
  brain: TargetBrain,
  input: { namespace: string; summary: string },
  env: WriteContext,
): Promise<NamespaceMade> {
  const { namespace } = input;
  const problem = namespaceProblem(namespace);
  if (problem !== undefined) throw userError(problem, "usage");
  const summary = input.summary.replace(/\s+/g, " ").trim();
  if (summary === "") throw namedError((n) => `${n.field("summary")} says what the namespace is for, in a sentence`);
  const seen = await bringIn(brain);
  const config = seen.repo.config();
  if (config.namespaces.includes(namespace) || existsSync(join(brain.root, "knowledge", namespace))) {
    throw userError(`${brainRepoOfKey(brain.key)} already has a namespace ${namespace}`, "path_exists");
  }
  const parent = parentOf(namespace);
  if (parent !== undefined && !config.namespaces.includes(parent))
    throw userError(
      `${brainRepoOfKey(brain.key)} has no namespace ${parent} to put ${namespace} under; add it first`,
      "not_found",
    );
  const changes: FileChange[] = [
    { rel: "kioku.yaml", text: stringifyFolderConfig({ ...config, namespaces: [...config.namespaces, namespace] }) },
    { rel: `knowledge/${namespace}/INDEX.md`, text: newIndex(namespace, summary) },
  ];
  const applied = await applyChanges(brain, changes, `namespace: add ${namespace}`, env, seen);
  return { status: "done", brain: brain.key, namespace, ...applied };
}

export interface NamespaceDescribed extends Partial<Applied> {
  status: "done";
  brain: string;
  namespace: string;
}

/** `kioku namespace describe <path> --summary <text>` (§3.2): only the paragraph under the title of `INDEX.md` changes. */
export async function describeNamespace(
  brain: TargetBrain,
  input: { namespace: string; summary: string },
  env: WriteContext,
): Promise<NamespaceDescribed> {
  const { namespace } = input;
  const summary = input.summary.replace(/\s+/g, " ").trim();
  if (summary === "") throw namedError((n) => `${n.field("summary")} says what the namespace is for, in a sentence`);
  const seen = await bringIn(brain);
  const config = seen.repo.config();
  if (!config.namespaces.includes(namespace))
    throw userError(
      `${brainRepoOfKey(brain.key)} has no namespace ${namespace} (it has ${config.namespaces.join(", ")})`,
      "not_found",
    );
  const rel = `knowledge/${namespace}/INDEX.md`;
  const path = join(brain.root, rel);
  const before = existsSync(path) ? readFileSync(path, "utf8") : `# ${namespace}\n`;
  const after = withDescription(before, summary);
  if (after === before) throw userError(`${namespace} already says that; nothing was written`, "unchanged");
  const applied = await applyChanges(brain, [{ rel, text: after }], `namespace: describe ${namespace}`, env, seen);
  return { status: "done", brain: brain.key, namespace, ...applied };
}
