import { existsSync, realpathSync } from "node:fs";
import { dirname, join, parse as parsePath, relative, resolve, sep } from "node:path";
import { gitQuiet } from "../git.ts";
import {
  cloneOf,
  defaultUrl,
  isSshAddress,
  localPathOf,
  managedRef,
  ownerKey,
  parseRepo,
  repoKey,
  type BrainRef,
} from "./brain-ref.ts";
import { readFolderConfig, type ConfigResult, type FolderConfig } from "./folder-config.ts";
import { emptyConfig, type MachineConfig } from "./machine.ts";

export type LinkTier = "personal" | "project" | "team";

export interface ChainLink {
  tier: LinkTier;
  ref: BrainRef;
  /** Canonical key of the brain: `host/owner/repo`, plus `#path` for a folder inside a repository. */
  key: string;
  /** Where it is, or will be cloned, on this machine. */
  path: string;
  /** The folder exists and holds a `kioku.yaml`. */
  cloned: boolean;
  /** For a link not trusted: the address the folder gives it that this machine does not know (§2.4). */
  address?: string;
}

export interface Chain {
  /** The folder holding the project folder's `kioku.yaml`, when the folder is in a linked repository. */
  root?: string;
  /** The project brain's key, as the project folder's `kioku.yaml` names it, or the project brain the session is inside. */
  project?: string;
  /** The key of the brain whose folder the session is in (§2.7): the session works on that brain. */
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
  /** Things wrong with a `kioku.yaml` along the way; the validator and `doctor` say more. */
  problems: string[];
}

/**
 * Whether the address a reference gives is one this machine knows for its repository (§2.4): none, the one its key
 * says, an ssh address of the same repository, or the one `repositories` records. A folder cannot send a trusted
 * brain's clone, or its pushes, anywhere else.
 */
export function knownAddress(config: MachineConfig, ref: BrainRef): boolean {
  const url = ref.url;
  if (url === undefined || url === defaultUrl(ref)) return true;
  const same = isSshAddress(url) ? parseRepo(url) : undefined;
  if (same !== undefined && repoKey(same) === repoKey(ref)) return true;
  return config.repositories[repoKey(ref)]?.url === url;
}

/**
 * Whether this machine lets a repository's `kioku.yaml` name this brain (§2.4): it is a repository the machine
 * already knows, or its owner is in `trusted`, and at an address the machine knows for it. A person makes a brain
 * trusted with `kioku init`, `kioku brain trust`, or `kioku brain clone --url` for an address.
 */
export function isTrusted(config: MachineConfig, ref: BrainRef): boolean {
  return (
    (config.repositories[repoKey(ref)] !== undefined ||
      config.trust.owners.includes(ownerKey(ref)) ||
      repoKey(ref) === config.brain ||
      repoKey(ref) === config.team) &&
    knownAddress(config, ref)
  );
}

/** The command that makes a link this machine did not trust trusted (§2.4): `brain clone --url` for an address it does not know. */
export const trustCommand = (link: Pick<ChainLink, "key" | "address">): string =>
  link.address === undefined ? `kioku brain trust ${link.key}` : `kioku brain clone ${link.key} --url ${link.address}`;

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

/**
 * The brain whose folder is `root`, as this machine knows it (§2.7): the clone of a known repository; a clone in the
 * managed folder, `~/.kioku/brains/<owner>/<repo>` (§2.5); else, for a clone made by
 * hand, the repository its `origin` names. Undefined for a brain nothing names.
 */
function brainAt(root: string, config: MachineConfig, home: string): BrainRef | undefined {
  // Compared as real paths: git reports them so, and a temporary folder may be a symlink.
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const here = real(root);
  const inside = (folder: string): string | undefined => {
    const clone = real(folder);
    return here === clone ? "" : here.startsWith(clone + sep) ? relative(clone, here).split(sep).join("/") : undefined;
  };
  for (const key of [...(config.brain === undefined ? [] : [config.brain]), ...Object.keys(config.repositories)]) {
    const ref = parseRepo(key);
    if (ref === undefined) continue;
    // A brain is the whole clone: a folder inside one is no brain of its own.
    const sub = inside(cloneOf(config, ref, home));
    if (sub !== undefined) return sub === "" ? ref : undefined;
  }
  const managed = inside(join(home, ".kioku", "brains"));
  if (managed !== undefined) return managedRef(managed);
  const top = gitQuiet(root, ["rev-parse", "--show-toplevel"]);
  const origin = top === undefined ? undefined : gitQuiet(top, ["remote", "get-url", "origin"]);
  const ref = origin === undefined ? undefined : parseRepo(origin);
  if (ref === undefined || top === undefined) return undefined;
  return inside(top) === "" ? ref : undefined;
}

/**
 * The chain a session loads from `cwd` (§2.1, §2.3, §2.4, §2.7): the personal brain from the machine
 * configuration, the project and team brains from the project folder's `kioku.yaml`, `brain` and `team`, and, where
 * the folder names no team or there is no such file, the machine configuration's `team`; no brain names another. Inside a brain's own folder, that brain alone is the chain (§2.7). A folder with no `kioku.yaml`
 * resolves to the personal brain alone. A brain that is also another link appears once. Reads files on disk and,
 * inside a brain, local git: no network. `read` is how a `kioku.yaml` is read, for a caller that reads the same files
 * after it.
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
    problems: [],
  };
  /**
   * `named` is a brain a project folder's `kioku.yaml` names, without the person's act: each is checked on its own
   * (§2.4). The personal brain, the machine's team and a brain the session is inside need no check.
   */
  const add = (tier: LinkTier, ref: BrainRef, at?: string, named = false): ChainLink => {
    const key = repoKey(ref);
    const existing = chain.links.find((l) => l.key === key) ?? chain.untrusted.find((l) => l.key === key);
    if (existing) return existing;
    const path = at ?? localPathOf(config, ref, home);
    if (named && !isTrusted(config, ref)) {
      const link: ChainLink = {
        tier,
        ref,
        key,
        path,
        cloned: false,
        ...(!knownAddress(config, ref) && { address: ref.url! }),
      };
      chain.untrusted.push(link);
      return link;
    }
    const link: ChainLink = { tier, ref, key, path, cloned: existsSync(join(path, "kioku.yaml")) };
    chain.links.push(link);
    if (!link.cloned) chain.missing.push(link);
    return link;
  };

  const addPersonal = (): void => {
    if (config.brain !== undefined) add("personal", parseRepo(config.brain)!);
  };
  /** The person's own team, where no project folder names one (§2.4). */
  const addMachineTeam = (): void => {
    if (config.team === undefined) return;
    add("team", parseRepo(config.team)!);
    chain.teamFrom = "machine";
  };

  const root = findConfigRoot(cwd);
  const own = root === undefined ? undefined : read(join(root, "kioku.yaml"));
  // The nearest file is a brain's own: the session is inside a brain and loads that brain alone (§2.7).
  if (root !== undefined && own?.ok && own.value.form === "brain") {
    const ref = brainAt(root, config, home);
    if (ref === undefined) {
      addPersonal();
      chain.problems.push(
        `${root} is a brain this machine does not know (no known repository is cloned there and it has no origin); only the personal brain is loaded`,
      );
      return chain;
    }
    const link = add(own.value.tier, ref, root);
    chain.inside = link.key;
    if (own.value.tier === "project") chain.project = link.key;
    const others = [
      { tier: "personal" as const, key: config.brain },
      { tier: "team" as const, key: config.team },
    ];
    for (const o of others) {
      const key = o.key === undefined ? undefined : repoKey(parseRepo(o.key)!);
      if (key !== undefined && key !== link.key && !chain.notLoaded.some((n) => n.key === key))
        chain.notLoaded.push({ tier: o.tier, key });
    }
    return chain;
  }

  addPersonal();
  if (root === undefined || own === undefined) {
    addMachineTeam();
    return chain;
  }
  if (!own.ok) {
    chain.root = root;
    chain.problems.push(own.reason);
    return chain;
  }
  if (own.value.form === "brain") return chain;

  chain.root = root;
  const code = own.value;
  if (code.brain !== undefined) chain.project = add("project", code.brain, undefined, true).key;
  if (code.team === undefined) addMachineTeam();
  else {
    add("team", code.team, undefined, true);
    chain.teamFrom = "folder";
  }
  return chain;
}
