import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { brainRepo, brainRepoOfFolder, cloneOf, parseRepo } from "../config/brain-ref.ts";
import { readFolderConfig } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig } from "../config/machine.ts";
import { gitQuiet } from "../git.ts";

export interface KnownBrain {
  /** Canonical key: the repository, plus `#path` for a brain inside it. */
  key: string;
  tier?: string;
  /** Where it is, or would be cloned, on this machine. */
  folder: string;
  onDisk: boolean;
  /** The folder holds a `kioku.yaml` that is not a brain's, or cannot be read: why, so a verb says it (§2.5). */
  problem?: string;
  remote?: string;
  personal: boolean;
}

/** A path as it really is, or as given when it is not there. */
const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * A brain's repository from its folder (§2.3), as a person reads it: the one this machine knows the folder as a clone of;
 * else the folder's own last two parts read as `<owner>/<repo>`.
 */
export function brainRepoAt(root: string, home: string): string {
  const config = readMachineConfig(home) ?? emptyConfig();
  const keys = [...(config.brain ? [config.brain] : []), ...Object.keys(config.repositories)];
  const at = real(root);
  for (const key of keys) {
    const ref = parseRepo(key);
    if (ref !== undefined && real(cloneOf(config, ref, home)) === at) return brainRepo(ref);
  }
  return brainRepoOfFolder(root);
}

/**
 * The brains this machine knows (§2.5): the personal brain and every repository in `brains`, each with its tier
 * and folder, its remote, and whether it is on disk. A repository holding several brains as folders lists each.
 */
export function knownBrains(home: string): KnownBrain[] {
  const config = readMachineConfig(home) ?? emptyConfig();
  const keys = [...new Set([...(config.brain ? [config.brain] : []), ...Object.keys(config.repositories)])];
  const out: KnownBrain[] = [];
  for (const key of keys) {
    const ref = parseRepo(key)!;
    const clone = cloneOf(config, ref, home);
    const remote = existsSync(clone) ? gitQuiet(clone, ["remote", "get-url", "origin"]) : undefined;
    const describe = (k: string, folder: string): KnownBrain => {
      const file = join(folder, "kioku.yaml");
      const found = readFolderConfig(file);
      const brain = found.ok && found.value.form === "brain" ? found.value : undefined;
      // A file that is there but is not a brain's, or that the tool refuses, is not "not cloned": the verb says why.
      const problem =
        brain !== undefined || !existsSync(file)
          ? undefined
          : found.ok
            ? `${file} is a project folder's file, not a brain's`
            : found.reason;
      return {
        key: k,
        folder,
        onDisk: brain !== undefined,
        ...(problem !== undefined && { problem }),
        personal: key === config.brain,
        ...(brain && { tier: brain.tier }),
        ...(remote !== undefined && { remote }),
      };
    };
    out.push(describe(key, clone));
  }
  return out;
}
