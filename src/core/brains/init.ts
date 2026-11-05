import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  addressUrl,
  isAddress,
  ownerOfAddress,
  parseName,
  repoKey,
  sameRepository,
  type BrainRef,
} from "../config/brain-ref.ts";
import {
  ACCEPTS,
  addressOf,
  findConfigRoot,
  isHere,
  isTrusted,
  resolveChain,
  type ChainLink,
} from "../config/chain.ts";
import { readFolderConfig, stringifyFolderConfig, type CodeRepoConfig } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig, updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { gitQuiet } from "../git.ts";
import { brainAtAddress, bringBrain, cloneMissing, type CloneResult, type SyncOutcome } from "./clone.ts";
import { createBrain, type CreateResult } from "./create.ts";

export interface InitResult {
  /** The project folder's `kioku.yaml`. */
  file: string;
  /** The file is in a git repository, so it travels with the code once committed. */
  inRepository: boolean;
  /** False when the file already said all of it. */
  wrote: boolean;
  /** The project brain's name, when the file names one. */
  brain?: string;
  /** The team brain's name, when the file names one. */
  team?: string;
  /** The brain `init` cloned from the address it was given. */
  brought?: CloneResult;
  /** What cloning the brains the folder's chain was missing did. */
  cloned: SyncOutcome[];
  /** The brain `init` made, given a name this machine did not have (§2.4). */
  created: CreateResult[];
  /** The brains the file named by name alone and now names with their address, published since (§2.4). */
  addressed: string[];
  /** The brains the file names by name alone that this machine does not have (`brain-not-here`, §2.4). */
  notHere: string[];
  chain: ChainLink[];
}

export interface InitOptions {
  /** The project brain: an address or a name (§2.4); none takes what the file names. */
  brain?: string;
  /** In a terminal: the person's act, which accepts an address or makes a brain (§2.4). */
  interactive?: boolean;
  /** The version whose files a brain `init` makes is written with. */
  version: string;
  /** How the write arrived (§1.6). */
  via?: string;
}

const needTerminal = (what: string): never => {
  throw userError(
    `kioku init is for you to run in a terminal when it ${what}: the files of a brain reach the agent's context, so the agent does not do it`,
    "needs_terminal",
  );
};

/**
 * `kioku init [<brain>]` (§2.4): link a project folder to its project brain, with the `kioku.yaml` of §2.5 at the
 * repository's root, keeping the `team` the file holds, which is written by hand. `<brain>` is an address, cloned
 * when this machine does not have its brain, or a name, made as a project brain when this machine has none of it.
 * Alone, where the file exists, it accepts the addresses the file gives, clones what the chain is missing, and writes
 * the address of a brain the file names by name alone once that brain has a remote. Refuses inside a brain, a brain of
 * another tier than the link takes, and, outside a terminal, before writing anything, an address this machine does not
 * know or a brain it would make.
 */
export async function initRepository(home: string, cwd: string, o: InitOptions): Promise<InitResult> {
  // Inside a brain the nearest file is the brain's own, wherever in its folder this runs (§2.7).
  const nearest = findConfigRoot(cwd);
  const around = nearest === undefined ? undefined : readFolderConfig(join(nearest, "kioku.yaml"));
  if (around?.ok && around.value.form !== "code")
    throw userError(`${nearest} is a brain, not a project folder`, "is_a_brain");
  const repository = gitQuiet(cwd, ["rev-parse", "--show-toplevel"]);
  // With no brain named it takes what the folder is under already; naming one links this folder, and the nearest wins.
  const top = repository ?? (o.brain === undefined && nearest !== undefined ? nearest : cwd);
  const file = join(top, "kioku.yaml");
  const found = existsSync(file) ? readFolderConfig(file) : undefined;
  if (found !== undefined && !found.ok)
    throw userError(`${found.reason}; fix or remove it first`, "kioku_yaml_invalid");
  if (found?.ok && found.value.form !== "code")
    throw userError(`${top} is a brain, not a project folder`, "is_a_brain");
  const existing: CodeRepoConfig | undefined = found?.ok && found.value.form === "code" ? found.value : undefined;
  if (o.brain === undefined && existing === undefined) {
    throw userError(
      `${top} has no kioku.yaml yet: name its project brain, kioku init <address> to clone it, or kioku init <owner>/<repo> to make it here`,
      "usage",
    );
  }
  const interactive = o.interactive === true;
  const config = readMachineConfig(home) ?? emptyConfig();
  const created: CreateResult[] = [];
  let brought: CloneResult | undefined;
  let project: BrainRef | undefined = existing?.brain;

  // A file that names another project brain is an edit by hand: refused before anything is cloned or made.
  if (o.brain !== undefined && existing?.brain !== undefined) {
    const named = parseName(o.brain);
    const url = named === undefined && isAddress(o.brain) ? addressUrl(o.brain) : undefined;
    const same =
      named !== undefined
        ? repoKey(named) === repoKey(existing.brain)
        : url !== undefined &&
          ((existing.brain.url !== undefined && sameRepository(existing.brain.url, url)) ||
            brainAtAddress(home, url, config) === repoKey(existing.brain));
    if (!same)
      throw userError(
        `${file} already names the project brain ${repoKey(existing.brain)}; edit it by hand to change it`,
        "kioku_yaml_exists",
      );
  }

  if (o.brain !== undefined) {
    if (isAddress(o.brain)) {
      const url = addressUrl(o.brain);
      const here = brainAtAddress(home, url, config);
      if (here !== undefined) project = { ...parseName(here)!, url };
      else {
        // An address this machine does not know is accepted only by the person, unless its owner is trusted (§2.4).
        const owner = ownerOfAddress(url);
        if (!interactive && (owner === undefined || !config.trust.owners.includes(owner)))
          needTerminal(`clones ${url}, which this machine does not know`);
        brought = await bringBrain(home, url, "project");
        project = { ...parseName(brought.brain)!, url };
      }
    } else {
      const named = parseName(o.brain);
      if (named === undefined)
        throw userError(
          `"${o.brain}" is neither an address nor a brain's name, <owner>/<repo>, such as northwind/app-brain`,
          "usage",
        );
      if (!isHere(home, named)) {
        if (!interactive) needTerminal(`makes the brain ${repoKey(named)}`);
        created.push(
          await createBrain(home, o.version, {
            tier: "project",
            repo: repoKey(named),
            ...(o.via !== undefined && { via: o.via }),
          }),
        );
      } else {
        const tier = readFolderConfig(join(home, ".kioku", "brains", named.owner, named.repo, "kioku.yaml"));
        const declared = tier.ok && tier.value.form === "brain" ? tier.value.tier : undefined;
        if (declared !== undefined && !ACCEPTS.project.includes(declared))
          throw userError(
            `${repoKey(named)} is a ${declared} brain; a project folder's \`brain\` takes a project brain`,
            "brain_other_tier",
          );
      }
      const url = addressOf(config, home, named);
      project = url === undefined ? named : { ...named, url };
    }
    if (existing?.brain !== undefined && repoKey(existing.brain) !== repoKey(project!))
      throw userError(
        `${file} already names the project brain ${repoKey(existing.brain)}; edit it by hand to change it`,
        "kioku_yaml_exists",
      );
  }

  // Alone: the addresses the file gives are the person's to accept, here, in a terminal (§2.4).
  const refs = [project, existing?.team].filter((r): r is BrainRef => r !== undefined);
  const accepted: string[] = [];
  // Read again: a brain cloned or made above recorded its address.
  const now = readMachineConfig(home) ?? emptyConfig();
  for (const ref of refs) {
    if (ref.url === undefined || isTrusted(now, ref, home)) continue;
    if (isHere(home, ref) || addressOf(now, home, ref) !== undefined)
      throw userError(
        `${file} gives ${repoKey(ref)} the address ${ref.url}, and this machine has that brain at another address; edit the file, or remove the brain here first`,
        "brain_exists",
      );
    if (!interactive) needTerminal(`accepts the address ${ref.url}, which this machine does not know`);
    accepted.push(repoKey(ref));
  }
  if (accepted.length > 0)
    await updateMachineConfig((c) => {
      for (const ref of refs) if (accepted.includes(repoKey(ref))) c.repositories[repoKey(ref)] = ref.url!;
    }, home);

  // A link by name alone takes the address of its brain once it has one, so a teammate can clone it (§2.4).
  const after = readMachineConfig(home) ?? emptyConfig();
  const addressed: string[] = [];
  const withAddress = (ref: BrainRef | undefined): BrainRef | undefined => {
    if (ref === undefined || ref.url !== undefined) return ref;
    const url = addressOf(after, home, ref);
    if (url === undefined) return ref;
    addressed.push(repoKey(ref));
    return { ...ref, url };
  };
  const next: CodeRepoConfig = {
    form: "code",
    ...(project !== undefined && { brain: withAddress(project)! }),
    ...(existing?.team !== undefined && { team: withAddress(existing.team)! }),
  };
  const text = stringifyFolderConfig(next);
  const before = existsSync(file) ? stringifyFolderConfig(existing!) : undefined;
  const wrote = text !== before;
  if (wrote) writeAtomic(file, text);

  const cloned = (await cloneMissing(top, home)).filter((c) => c.tier !== "personal");
  // An address accepted here whose clone failed is forgotten again: nothing of this call is left behind for it.
  const failed = cloned.filter((c) => c.status === "failed" && accepted.includes(c.key)).map((c) => c.key);
  if (failed.length > 0) await updateMachineConfig((c) => void failed.forEach((k) => delete c.repositories[k]), home);
  const notHere = [next.brain, next.team]
    .filter((r): r is BrainRef => r !== undefined && r.url === undefined && !isHere(home, r))
    .map(repoKey);
  return {
    file,
    inRepository: repository !== undefined,
    wrote,
    ...(next.brain && { brain: repoKey(next.brain) }),
    ...(next.team && { team: repoKey(next.team) }),
    ...(brought !== undefined && { brought }),
    cloned,
    created,
    addressed,
    notHere,
    chain: resolveChain(top, readMachineConfig(home), home).links,
  };
}
