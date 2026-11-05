import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { brainFolder, brainRepoOfFolder, brainsFolder, managedRef, parseName, repoKey } from "../config/brain-ref.ts";
import { readFolderConfig } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig } from "../config/machine.ts";
import { gitQuiet } from "../git.ts";

export interface KnownBrain {
  /** The brain's name, `<owner>/<repo>` (§2.2). */
  key: string;
  tier?: string;
  /** Its folder, `~/.kioku/brains/<owner>/<repo>` (§2.5). */
  folder: string;
  onDisk: boolean;
  /** The folder holds a `kioku.yaml` that is not a brain's, or cannot be read: why, so a verb says it (§2.5). */
  problem?: string;
  remote?: string;
  /** Its format, when its file says one (§3.2). */
  format?: number;
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

/** A brain's name from its folder (§2.5): its path under the managed folder; else the folder's last two parts. */
export function brainRepoAt(root: string, home: string): string {
  const managed = real(brainsFolder(home));
  const at = real(root);
  const ref = at.startsWith(managed + sep) ? managedRef(relative(managed, at).split(sep).join("/")) : undefined;
  return ref === undefined ? brainRepoOfFolder(root) : repoKey(ref);
}

/** The names of the folders under the managed folder that hold a `kioku.yaml`, `<owner>/<repo>` (§2.5). */
function brainsOnDisk(home: string): string[] {
  const top = brainsFolder(home);
  const dirs = (p: string): string[] => {
    try {
      return readdirSync(p).filter((d) => !d.startsWith(".") && statSync(join(p, d)).isDirectory());
    } catch {
      return [];
    }
  };
  const out: string[] = [];
  for (const owner of dirs(top))
    for (const repo of dirs(join(top, owner))) {
      const name = `${owner}/${repo}`;
      if (parseName(name) !== undefined && existsSync(join(top, owner, repo, "kioku.yaml"))) out.push(name);
    }
  return out;
}

/**
 * The brains this machine knows (§2.5): every folder under the managed folder that holds a brain, and the brains the
 * configuration names, `brain`, `team` and `repositories`, on disk or not yet; each with its tier, its folder, its
 * remote, and whether it is on disk.
 */
export function knownBrains(home: string): KnownBrain[] {
  const config = readMachineConfig(home) ?? emptyConfig();
  const keys = [
    ...new Set([
      ...(config.brain ? [config.brain] : []),
      ...(config.team ? [config.team] : []),
      ...Object.keys(config.repositories),
      ...brainsOnDisk(home),
    ]),
  ];
  return keys.map((key): KnownBrain => {
    const folder = brainFolder(home, parseName(key)!);
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
    // As written in the clone, the address the person gave, not as git's `insteadOf` rewrites it (§2.4).
    const remote = existsSync(join(folder, ".git"))
      ? gitQuiet(folder, ["config", "--get", "remote.origin.url"])
      : undefined;
    return {
      key,
      folder,
      onDisk: brain !== undefined,
      ...(problem !== undefined && { problem }),
      personal: key === config.brain,
      ...(brain && { tier: brain.tier, format: brain.format }),
      ...(remote !== undefined && { remote }),
    };
  });
}
