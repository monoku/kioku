import { existsSync } from "node:fs";
import { join } from "node:path";
import { brainFolder, brainRepoOfKey, parseName } from "../config/brain-ref.ts";
import { readFolderConfig, type ConfigResult, type FolderConfig } from "../config/folder-config.ts";
import { machineReader, readMachineConfig, type MachineConfig } from "../config/machine.ts";
import { resolveChain, type ChainLink } from "../config/chain.ts";
import { onceByPath } from "./session-reads.ts";

/**
 * How a message names a brain (§1.2): by its tier, which says who sees it and, since a session has one brain of each
 * tier (§2.1), which one: `project`, `team`, `personal`. A brain that is not one of the session's, reached by a
 * command run in another folder, is named by its tier and name, `project · northwind/brain-acme`; one whose tier
 * cannot be read, by its name alone.
 */

/** What a caller has already read, so that the labels do not read it again. */
export interface KnownToLabels {
  machine?: () => MachineConfig | undefined;
  /** The session's brains, as `brainsOfLinks` gives them, when the chain is already resolved. */
  ours?: Map<string, string>;
}

type ReadConfig = (path: string) => ConfigResult<FolderConfig>;

/** Each brain this machine knows, by its key, with the tier its own `kioku.yaml` declares. Reads no git: hooks call it. */
function brainTiers(
  home: string,
  machine: () => MachineConfig | undefined = () => readMachineConfig(home),
  readConfig: ReadConfig = readFolderConfig,
): Map<string, string> {
  const tiers = new Map<string, string>();
  let config;
  try {
    config = machine();
  } catch {
    return tiers;
  }
  if (config === undefined) return tiers;
  const read = (folder: string, key: string): void => {
    const found = readConfig(join(folder, "kioku.yaml"));
    if (found.ok && found.value.form === "brain") tiers.set(key, found.value.tier);
  };
  for (const key of new Set([
    ...(config.brain ? [config.brain] : []),
    ...(config.team ? [config.team] : []),
    ...Object.keys(config.repositories),
  ])) {
    const ref = parseName(key);
    if (ref === undefined) continue;
    const clone = brainFolder(home, ref);
    if (existsSync(join(clone, "kioku.yaml"))) read(clone, key);
  }
  return tiers;
}

/** The links of a chain, by their brains' keys, with their tiers (§2.1). */
export function brainsOfLinks(links: ChainLink[]): Map<string, string> {
  return new Map(links.map((link) => [link.key, link.tier]));
}

/** The brains of the session's chain, by their keys, with their tiers (§2.1). */
function sessionBrains(
  home: string,
  cwd: string,
  machine: () => MachineConfig | undefined = () => readMachineConfig(home),
  read: ReadConfig = readFolderConfig,
): Map<string, string> {
  try {
    return brainsOfLinks(resolveChain(cwd, machine(), home, read).links);
  } catch {
    /* a label is only a label */
    return new Map();
  }
}

/** How a session's messages name brains: by the session's chain, then by what the machine knows of the rest. */
export interface Labels {
  label: (key: string) => string;
}

export function labelsFor(home: string, cwd: string | undefined, given: KnownToLabels = {}): Labels {
  const read = onceByPath(readFolderConfig);
  const machine = given.machine ?? machineReader(home);
  const ours = given.ours ?? (cwd === undefined ? new Map<string, string>() : sessionBrains(home, cwd, machine, read));
  let known: Map<string, string> | undefined;
  return {
    label: (key) => {
      const tier = ours.get(key);
      if (tier !== undefined) return tier;
      known ??= brainTiers(home, machine, read);
      const other = known.get(key);
      const repo = brainRepoOfKey(key);
      return other === undefined ? repo : `${other} · ${repo}`;
    },
  };
}

/** Brains listed together, comma-separated, each as a message names it. */
export const labelList = (keys: string, labels: Labels): string => keys.split(", ").map(labels.label).join(", ");
