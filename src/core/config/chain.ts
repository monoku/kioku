import { existsSync, realpathSync } from "node:fs";
import { dirname, join, parse as parsePath, relative, resolve, sep } from "node:path";
import { gitQuiet } from "../git.ts";
import {
  brainFolder,
  brainsFolder,
  managedRef,
  ownerOfAddress,
  parseName,
  repoKey,
  sameRepository,
  type BrainRef,
} from "./brain-ref.ts";
import { readFolderConfig, type ConfigResult, type FolderConfig, type Tier } from "./folder-config.ts";
import { emptyConfig, type MachineConfig } from "./machine.ts";

export type LinkTier = "personal" | "project" | "team";

export interface ChainLink {
  tier: LinkTier;
  ref: BrainRef;
  /** The brain's name, `<owner>/<repo>` (§2.2). */
  key: string;
  /** Its folder on this machine, `~/.kioku/brains/<owner>/<repo>` (§2.5). */
  path: string;
  /** The folder exists and holds a `kioku.yaml`. */
  cloned: boolean;
  /** For a link not trusted: the address the folder gives it (§2.4). */
  address?: string;
}

export interface Chain {
  /** The folder holding the project folder's `kioku.yaml`, when the folder is in a linked repository. */
  root?: string;
  /** The project brain's name, as the project folder's `kioku.yaml` names it, or the project brain the session is inside. */
  project?: string;
  /** The name of the brain whose folder the session is in (§2.7): the session works on that brain. */
  inside?: string;
  /** Where the team link came from (§2.4): the project folder's `kioku.yaml`, or the machine configuration's `team`. */
  teamFrom?: "folder" | "machine";
  /** In reading order, personal first, then project, then team. At most three. */
  links: ChainLink[];
  /**
   * Inside a brain (§2.7) only that brain is loaded: the personal brain and the machine's team, which a folder would
   * have loaded beside it, are still the session's chain but are not loaded.
   */
  notLoaded: { tier: LinkTier; key: string }[];
  /** The links whose folder is not cloned yet. */
  missing: ChainLink[];
  /**
   * Brains a repository's `kioku.yaml` names that this machine does not trust (§2.4): not cloned and not loaded,
   * so an unvetted repository cannot put its own brain's Rules in front of the agent.
   */
  untrusted: ChainLink[];
  /** Links by name alone to a brain that has a remote: a teammate cannot clone them (`link-without-address`, §2.4). */
  withoutAddress: ChainLink[];
  /** Links by name alone to a brain this machine does not have: nothing to clone it from (`brain-not-here`, §2.4). */
  notHere: ChainLink[];
  /** Things wrong with a `kioku.yaml` along the way, or a brain of a tier its link does not take; `doctor` says more. */
  problems: string[];
}

/** What a link of the chain takes, by the tier a brain declares (§2.1): each its own, never the personal brain as a project. */
export const ACCEPTS: Record<LinkTier, Tier[]> = { personal: ["personal"], project: ["project"], team: ["team"] };

/** A brain of this machine: its folder holds a `kioku.yaml` (§2.5). */
export const isHere = (home: string, ref: Pick<BrainRef, "owner" | "repo">): boolean =>
  existsSync(join(brainFolder(home, ref), "kioku.yaml"));

/** The address a brain of this machine is published at: the one `repositories` records, else its clone's `origin`. */
export function addressOf(
  config: MachineConfig,
  home: string,
  ref: Pick<BrainRef, "owner" | "repo">,
): string | undefined {
  const recorded = config.repositories[repoKey(ref)];
  if (recorded !== undefined) return recorded;
  const folder = brainFolder(home, ref);
  // As written in the clone, not as git's `insteadOf` rewrites it: the address the person gave (§2.4).
  return existsSync(join(folder, ".git")) ? gitQuiet(folder, ["config", "--get", "remote.origin.url"]) : undefined;
}

/**
 * Whether this machine lets a repository's `kioku.yaml` name this brain (§2.4). A name alone is a brain of this machine
 * and nothing else, trusted when it is here. An address is trusted when it is the one this machine knows for that name
 * (recorded, or its clone's `origin`, in either of its https and ssh forms), or, for a name this machine does not know,
 * when its owner, `host/owner`, is in `trust.owners`. Trust follows the address, never the name.
 */
export function isTrusted(config: MachineConfig, ref: BrainRef, home: string): boolean {
  if (ref.url === undefined) return isHere(home, ref);
  const known = addressOf(config, home, ref);
  if (known !== undefined) return sameRepository(known, ref.url);
  const owner = ownerOfAddress(ref.url);
  return owner !== undefined && config.trust.owners.includes(owner);
}

/** The command that makes a link this machine did not trust trusted (§2.4): `kioku init`, run in the folder. */
export const trustCommand = (_link: Pick<ChainLink, "key" | "address">): string => "kioku init";

/** The command that trusts every brain of a link's owner (§2.4), when its address has one. */
export const trustOwnerCommand = (link: Pick<ChainLink, "address">): string | undefined => {
  const owner = link.address === undefined ? undefined : ownerOfAddress(link.address);
  return owner === undefined ? undefined : `kioku config set trust.owners +${owner}`;
};

/** The nearest folder at or above `from` that holds a `kioku.yaml`. */
export function findConfigRoot(from: string): string | undefined {
  let dir = resolve(from);
  const { root } = parsePath(dir);
  for (;;) {
    if (existsSync(join(dir, "kioku.yaml"))) return dir;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/** A path as it really is, through any link the person made (§2.7); as given when it is not there. */
const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * The brain whose folder is `root` (§2.7): a folder under the managed folder, `~/.kioku/brains/<owner>/<repo>`, the path
 * resolved through any link the person made to it. Undefined for any other folder, a git clone elsewhere included.
 */
function brainAt(root: string, home: string): BrainRef | undefined {
  const here = real(root);
  const managed = real(brainsFolder(home));
  if (!here.startsWith(managed + sep)) return undefined;
  return managedRef(relative(managed, here).split(sep).join("/"));
}

/**
 * The chain a session loads from `cwd` (§2.1, §2.3, §2.4, §2.7): the personal brain from the machine
 * configuration, the project and team brains from the project folder's `kioku.yaml`, `brain` and `team`, and, where
 * the folder names no team or there is no such file, the machine configuration's `team`; no brain names another.
 * Inside a brain's own folder, that brain alone is the chain (§2.7). A folder with no `kioku.yaml` resolves to the
 * personal brain alone. A brain that is also another link appears once. A brain of a tier its link does not take is
 * not loaded (§2.1). Reads files on disk and, for a brain's address, local git: no network. `read` is how a
 * `kioku.yaml` is read, for a caller that reads the same files after it.
 */
export function resolveChain(
  cwd: string,
  given: MachineConfig | undefined,
  home: string,
  read: (path: string) => ConfigResult<FolderConfig> = readFolderConfig,
): Chain {
  const config = given ?? emptyConfig();
  const chain: Chain = {
    links: [],
    notLoaded: [],
    missing: [],
    untrusted: [],
    withoutAddress: [],
    notHere: [],
    problems: [],
  };
  /** The tier a brain on disk declares, when its file can be read. */
  const tierAt = (path: string): Tier | undefined => {
    const found = read(join(path, "kioku.yaml"));
    return found.ok && found.value.form === "brain" ? found.value.tier : undefined;
  };
  /**
   * `named` is a brain a project folder's `kioku.yaml` names, without the person's act: each is checked on its own
   * (§2.4). The personal brain, the machine's team and a brain the session is inside need no check.
   */
  const add = (tier: LinkTier, ref: BrainRef, at?: string, named = false): ChainLink | undefined => {
    const key = repoKey(ref);
    const existing = chain.links.find((l) => l.key === key) ?? chain.untrusted.find((l) => l.key === key);
    // A brain is one tier: the personal brain, which loads in every folder, is never a folder's project (§2.1).
    if (existing && existing.tier !== tier && !ACCEPTS[tier].includes(existing.tier)) {
      chain.problems.push(
        `${key} is a ${existing.tier} brain, and a ${tier} link takes only a ${ACCEPTS[tier].join(" or ")} brain, so it is not loaded as one`,
      );
      return undefined;
    }
    if (existing) return existing;
    const path = at ?? brainFolder(home, ref);
    const cloned = existsSync(join(path, "kioku.yaml"));
    const link: ChainLink = { tier, ref, key, path, cloned };
    if (named && ref.url === undefined) {
      // A name alone is a brain of this machine and nothing else: there is no address to clone it from (§2.4).
      if (!cloned) {
        chain.notHere.push(link);
        return undefined;
      }
      if (addressOf(config, home, ref) !== undefined) chain.withoutAddress.push(link);
    } else if (named && !isTrusted(config, ref, home)) {
      const untrusted = { ...link, cloned: false, address: ref.url! };
      chain.untrusted.push(untrusted);
      return untrusted;
    }
    if (cloned && at === undefined) {
      const declared = tierAt(path);
      if (declared !== undefined && !ACCEPTS[tier].includes(declared)) {
        chain.problems.push(
          `${key} is a ${declared} brain, and a ${tier} link takes only a ${ACCEPTS[tier].join(" or ")} brain, so it is not loaded`,
        );
        return undefined;
      }
    }
    chain.links.push(link);
    if (!link.cloned) chain.missing.push(link);
    return link;
  };

  const own = (name: string | undefined): BrainRef | undefined => (name === undefined ? undefined : parseName(name));
  const addPersonal = (): void => {
    const ref = own(config.brain);
    if (ref !== undefined)
      add("personal", {
        ...ref,
        ...(config.repositories[config.brain!] && { url: config.repositories[config.brain!] }),
      });
  };
  /** The person's own team, where no project folder names one (§2.4). */
  const addMachineTeam = (): void => {
    const ref = own(config.team);
    if (ref === undefined) return;
    if (add("team", { ...ref, ...(config.repositories[config.team!] && { url: config.repositories[config.team!] }) }))
      chain.teamFrom = "machine";
  };

  const root = findConfigRoot(cwd);
  const found = root === undefined ? undefined : read(join(root, "kioku.yaml"));
  // The nearest file is a brain's own: the session is inside a brain and loads that brain alone (§2.7).
  if (root !== undefined && found?.ok && found.value.form === "brain") {
    const ref = brainAt(root, home);
    if (ref === undefined) {
      addPersonal();
      chain.problems.push(
        `${root} is a brain outside ~/.kioku/brains, where this machine keeps its brains; only the personal brain is loaded`,
      );
      return chain;
    }
    const link = add(found.value.tier, ref, root)!;
    chain.inside = link.key;
    if (found.value.tier === "project") chain.project = link.key;
    for (const o of [
      { tier: "personal" as const, key: config.brain },
      { tier: "team" as const, key: config.team },
    ]) {
      if (o.key !== undefined && o.key !== link.key && !chain.notLoaded.some((n) => n.key === o.key))
        chain.notLoaded.push({ tier: o.tier, key: o.key });
    }
    return chain;
  }

  addPersonal();
  if (root === undefined || found === undefined) {
    addMachineTeam();
    return chain;
  }
  if (!found.ok) {
    chain.root = root;
    chain.problems.push(found.reason);
    return chain;
  }
  if (found.value.form === "brain") return chain;

  chain.root = root;
  const code = found.value;
  if (code.brain !== undefined) {
    const link = add("project", code.brain, undefined, true);
    if (link !== undefined) chain.project = link.key;
  }
  if (code.team === undefined) addMachineTeam();
  else if (add("team", code.team, undefined, true) !== undefined) chain.teamFrom = "folder";
  return chain;
}
