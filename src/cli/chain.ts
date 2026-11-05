import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { brainRel, readBrainConfig } from "../core/brain/brain.ts";
import { brainFolder, brainRepoOfKey, parseName } from "../core/config/brain-ref.ts";
import { resolveChain, type Chain, type ChainLink } from "../core/config/chain.ts";
import { readFolderConfig, type BrainConfig } from "../core/config/folder-config.ts";
import { readMachineConfig } from "../core/config/machine.ts";
import { userError } from "../core/errors.ts";
import type { TargetBrain } from "../core/write/apply.ts";
import type { Context } from "./run.ts";
import { personHome } from "./home.ts";

/** A brain of the current chain, as the verbs that read brains see it. */
export interface ChainBrain {
  tier: ChainLink["tier"];
  /** The brain's name, `<owner>/<repo>` (§2.2). */
  key: string;
  root: string;
  cloned: boolean;
  /** Its `kioku.yaml`, when it is on disk and readable: what the verbs that write start from. */
  config?: BrainConfig;
}

/** The chain of the current folder, as resolved. */
export const chainOf = (ctx: Context): Chain => resolveChain(ctx.cwd, readMachineConfig(ctx.home), ctx.home);

/** The links of the chain of the current folder (§2.1). */
export function chainBrains(ctx: Context): ChainBrain[] {
  const chain = chainOf(ctx);
  return chain.links.map((l) => {
    const found = l.cloned ? readFolderConfig(`${l.path}/kioku.yaml`) : undefined;
    const config = found?.ok && found.value.form === "brain" ? found.value : undefined;
    return { tier: l.tier, key: l.key, root: l.path, cloned: l.cloned, ...(config && { config }) };
  });
}

/** A folder the person named with `--dir`: `~` is their home, a relative folder is from where they are. */
export function folderArg(ctx: Context, dir: string): string {
  const home = personHome(ctx);
  if (dir === "~") return home;
  if (dir.startsWith("~/")) return join(home, dir.slice(2));
  return resolve(ctx.cwd, dir);
}

/** The brains of the chain a session inside a brain leaves out (§2.7). */
export function notLoadedBrains(ctx: Context): ChainBrain[] {
  return chainOf(ctx).notLoaded.map((n) => {
    const ref = parseName(n.key);
    const root = ref === undefined ? "" : brainFolder(ctx.home, ref);
    const found = root === "" ? undefined : readFolderConfig(`${root}/kioku.yaml`);
    return { tier: n.tier, key: n.key, root, cloned: found?.ok === true };
  });
}

/**
 * A brain of the chain, named by its tier, its key or its repository. Two brains that answer the same word
 * at the same level are an error that names their keys, never a guess: a page saved in the wrong brain says nothing.
 */
export function pickBrain(brains: ChainBrain[], wanted: string, ctx?: Context): ChainBrain {
  const find = (among: ChainBrain[]): ChainBrain | undefined => {
    const levels: ((b: ChainBrain) => boolean)[] = [
      (b) => b.key === wanted,
      (b) => b.tier === wanted,
      (b) => b.key === wanted || b.key.endsWith(`/${wanted}`) || (b.root !== "" && basename(b.root) === wanted),
    ];
    for (const test of levels) {
      const all = among.filter(test);
      if (all.length > 1)
        throw userError(
          `"${wanted}" names more than one brain here: ${all.map((b) => `${b.key} (${b.tier})`).join(", ")}; use the key`,
          "brain_ambiguous",
        );
      if (all.length === 1) return all[0];
    }
    return undefined;
  };
  const found = find(brains);
  if (found === undefined) {
    // A brain of the chain that this session leaves out is not unknown: it is not loaded (§2.7).
    const left = ctx === undefined ? undefined : find(notLoadedBrains(ctx));
    if (left !== undefined) {
      throw userError(
        `the ${left.tier} brain ${left.key} is in the chain of this folder but is not loaded: this session was opened inside a brain, which works on its own; open the project folder's folder to load the chain`,
        "brain_not_loaded",
      );
    }
    const known = brains.map((b) => brainRepoOfKey(b.key)).join(", ") || "none";
    throw userError(`no brain called "${wanted}" in the chain of this folder (${known})`, "brain_unknown");
  }
  if (!found.cloned)
    throw userError(`the brain ${found.key} is not on this machine yet; run kioku sync`, "brain_not_cloned");
  return found;
}

/** A brain of the chain as the verbs that write see it. */
export function target(b: ChainBrain): TargetBrain {
  const config = b.config ?? readBrainConfig(b.root);
  return { key: b.key, tier: config.tier, root: b.root, config };
}

/** The real path of what exists, with the rest of the path, not there yet, as given. */
function realish(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(realish(parent), basename(p));
  }
}

/**
 * The brain and brain-relative path of a page: an absolute path inside one brain of the chain, or a brain-relative
 * path in the brain `--brain` names or, without it, in the one brain of the chain that has it.
 */
export function locate(
  ctx: Context,
  pathArg: string,
  brainArg: string | undefined,
): { brain: TargetBrain; rel: string } {
  const chain = chainBrains(ctx).filter((b) => b.cloned);
  // Compared as real paths, as the chain's own resolution does: a brain under a symlinked folder, `/var` for
  // `/private/var`, is the same brain whichever way it is named, and a file not there yet is real up to its folder.
  const toRel = (root: string, p: string): string | undefined =>
    brainRel(isAbsolute(p) ? relative(realish(root), realish(p)).split(sep).join("/") : p);
  if (brainArg !== undefined) {
    const b = pickBrain(chain, brainArg, ctx);
    const rel = toRel(b.root, pathArg);
    if (rel === undefined) throw userError(`${pathArg} is not inside the brain ${brainRepoOfKey(b.key)}`, "not_found");
    return { brain: target(b), rel };
  }
  if (isAbsolute(pathArg)) {
    const b = chain
      .filter((c) => toRel(c.root, pathArg) !== undefined)
      .sort((x, y) => y.root.length - x.root.length)[0];
    if (b === undefined) throw userError(`${pathArg} is not inside a brain of this folder's chain`, "not_found");
    return { brain: target(b), rel: toRel(b.root, pathArg)! };
  }
  const rel = toRel("/", pathArg);
  const having = rel === undefined ? [] : chain.filter((c) => existsSync(join(c.root, rel)));
  if (having.length === 0) throw userError(`no brain of this folder's chain has ${pathArg}`, "not_found");
  if (having.length > 1)
    throw userError(`${pathArg} is in ${having.map((b) => b.key).join(" and ")}; say which with --brain`, "ambiguous");
  return { brain: target(having[0]!), rel: rel! };
}
