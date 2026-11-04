import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseNamed, repoKey, cloneOf, type BrainRef } from "../config/brain-ref.ts";
import { findConfigRoot, isTrusted, resolveChain, type ChainLink } from "../config/chain.ts";
import { readFolderConfig, stringifyFolderConfig } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig, updateMachineConfig } from "../config/machine.ts";
import { environmentError, userError } from "../errors.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { gitQuiet } from "../git.ts";
import { cloneMissing, recordedUrl, type SyncOutcome } from "./clone.ts";
import { createBrain, type CreateResult } from "./create.ts";

export interface InitResult {
  /** The project folder's `kioku.yaml`. */
  file: string;
  /** The file is in a git repository, so it travels with the code once committed. */
  inRepository: boolean;
  /** False when the file already named these brains. */
  wrote: boolean;
  /** The project brain's key, when the file names one. */
  brain?: string;
  /** The team brain's key, when the file names one. */
  team?: string;
  cloned: SyncOutcome[];
  /** The brains `--create` made because they could not be cloned. */
  created: CreateResult[];
  chain: ChainLink[];
}

/** What `--create` needs to make a brain: the version whose files it writes. */
export interface InitCreate {
  version: string;
  /** How the write arrived (§1.6). */
  via?: string;
}

/** A brain as `init` is given it: `owner/repo` or a URL. */
function refOf(text: string, what: string): BrainRef {
  const ref = parseNamed(text, true);
  if (ref === undefined) throw userError(`"${text}" is not a ${what} brain such as github.com/owner/repo`, "usage");
  return ref;
}

const keyOrNone = (ref: BrainRef | undefined): string => (ref === undefined ? "none" : repoKey(ref));

/**
 * `kioku init [<brain>] [--team <brain>]` (§2.4): link a project folder to its project brain, to a team brain,
 * or to both, with the `kioku.yaml` of §2.5 at the repository's root, not committed; then clone the brains the chain names when they are not on this machine.
 * With no brain named, it takes the ones the nearest `kioku.yaml` already names, as a teammate who cloned the code
 * does. Outside a repository the file goes in the current folder. Refuses inside a brain, over a `kioku.yaml` that names other brains, and, outside a terminal,
 * when a brain it would register is new to this machine, before writing anything. A brain it names that cannot be
 * cloned undoes what this call wrote: the file and the registration; with `create`, it is made instead (§2.4), on
 * this machine only.
 */
export async function initRepository(
  home: string,
  cwd: string,
  o: { brain?: string; team?: string; dir?: string; interactive?: boolean; create?: InitCreate },
): Promise<InitResult> {
  // Inside a brain the nearest file is the brain's own, wherever in its folder this runs (§2.7).
  const nearest = findConfigRoot(cwd);
  const around = nearest === undefined ? undefined : readFolderConfig(join(nearest, "kioku.yaml"));
  if (around?.ok && around.value.form !== "code")
    throw userError(`${nearest} is a brain, not a project folder`, "is_a_brain");
  const repository = gitQuiet(cwd, ["rev-parse", "--show-toplevel"]);
  // With no brain named it takes what the folder is under already; naming one links this folder, and the nearest wins.
  const top = repository ?? (o.brain === undefined && o.team === undefined && nearest !== undefined ? nearest : cwd);
  const file = join(top, "kioku.yaml");
  const found = existsSync(file) ? readFolderConfig(file) : undefined;
  if (found !== undefined && !found.ok)
    throw userError(`${found.reason}; fix or remove it first`, "kioku_yaml_invalid");
  if (found?.ok && found.value.form !== "code")
    throw userError(`${top} is a brain, not a project folder`, "is_a_brain");
  const existing = found?.ok && found.value.form === "code" ? found.value : undefined;
  const named = o.brain !== undefined || o.team !== undefined;
  if (!named && existing === undefined) {
    throw userError(
      `${top} has no kioku.yaml yet: name its project brain, kioku init <owner>/<repo>, or its team brain, kioku init --team <owner>/<repo>. To make the project brain and link it: kioku init <owner>/<repo> --create`,
      "usage",
    );
  }
  // No brain named: the ones the repository's file names, which is what a teammate who cloned the code wants (§2.4).
  const wanted = named
    ? {
        ...(o.brain !== undefined && { brain: refOf(o.brain, "project") }),
        ...(o.team !== undefined && { team: refOf(o.team, "team") }),
      }
    : {
        ...(existing!.brain !== undefined && { brain: existing!.brain }),
        ...(existing!.team !== undefined && { team: existing!.team }),
      };

  let wrote = false;
  if (existing !== undefined) {
    for (const field of ["brain", "team"] as const) {
      if (keyOrNone(existing[field]) !== keyOrNone(wanted[field])) {
        throw userError(
          `${file} already names ${field === "brain" ? "the project brain" : "the team brain"} ${keyOrNone(existing[field])}; edit it by hand to change it`,
          "kioku_yaml_exists",
        );
      }
    }
  }
  if (o.interactive !== true) {
    const config = readMachineConfig(home) ?? emptyConfig();
    for (const ref of [wanted.brain, wanted.team]) {
      if (ref !== undefined && !isTrusted(config, ref)) {
        throw userError(
          `kioku init is for you to run in a terminal when this machine does not know ${repoKey(ref)}: registering a brain lets its files reach the agent's context, so the agent does not do it. Run kioku init ${repoKey(ref)} in a terminal, or kioku brain trust ${repoKey(ref)}`,
          "needs_terminal",
        );
      }
    }
  }
  if (!existsSync(file)) {
    // A brain the machine knows at an address of its own is written with it, so the file reaches it from every machine (§2.2, §2.4).
    const known = readMachineConfig(home) ?? emptyConfig();
    const withUrl = (ref: BrainRef): BrainRef =>
      ref.url !== undefined || known.repositories[repoKey(ref)]?.url === undefined
        ? ref
        : { ...ref, url: known.repositories[repoKey(ref)]!.url! };
    writeAtomic(
      file,
      stringifyFolderConfig({
        form: "code",
        ...(wanted.brain !== undefined && { brain: withUrl(wanted.brain) }),
        ...(wanted.team !== undefined && { team: withUrl(wanted.team) }),
      }),
    );
    wrote = true;
  }
  // `--dir`: where the repository of the brain named goes, the project brain's or else the team brain's (§2.5).
  const placed = o.dir === undefined ? undefined : (wanted.brain ?? wanted.team);
  if (placed !== undefined) {
    const config = readMachineConfig(home) ?? emptyConfig();
    const now = cloneOf(config, placed, home);
    if (config.repositories[repoKey(placed)] !== undefined && now !== o.dir)
      throw userError(`${repoKey(placed)} is already at ${now} on this machine; --dir cannot move it`, "usage");
  }
  // Naming a brain to `init` is the person's act: it is what makes this machine trust it (§2.4).
  const before = readMachineConfig(home)?.repositories ?? {};
  const added = [wanted.brain, wanted.team]
    .filter((ref): ref is BrainRef => ref !== undefined && before[repoKey(ref)] === undefined)
    .map(repoKey);
  await updateMachineConfig((c) => {
    for (const ref of [wanted.brain, wanted.team]) {
      if (ref === undefined) continue;
      c.repositories[repoKey(ref)] ??= {};
      // The address the file gives is the person's to record, here, in a terminal (§2.4).
      const address = recordedUrl(ref, ref.url);
      if (address !== undefined) c.repositories[repoKey(ref)]!.url ??= address;
    }
    if (placed !== undefined) c.repositories[repoKey(placed)]!.path = o.dir;
  }, home);
  const cloned = (await cloneMissing(top, home)).filter((c) => c.tier !== "personal");
  // A brain named here that could not be cloned, often one not created yet: nothing of this call is left behind.
  const ownKeys = new Set([wanted.brain, wanted.team].filter((ref): ref is BrainRef => ref !== undefined).map(repoKey));
  let missed = cloned.filter((c) => c.status === "failed" && ownKeys.has(c.key));
  const refs = [wanted.brain, wanted.team].filter((ref): ref is BrainRef => ref !== undefined);
  const created: CreateResult[] = [];
  if (missed.length > 0 && o.create !== undefined) {
    // Asked for: each brain named that could not be cloned is made, then the chain is cloned again.
    try {
      for (const m of missed) {
        const ref = refs.find((x) => repoKey(x) === m.key)!;
        created.push(
          await createBrain(home, o.create.version, {
            tier: m.tier,
            repo: `${ref.host}/${ref.owner}/${ref.repo}`,
            ...(o.create.via !== undefined && { via: o.create.via }),
          }),
        );
      }
      const again = await cloneMissing(top, home);
      missed = again.filter((c) => c.status === "failed" && ownKeys.has(c.key));
      cloned.splice(
        0,
        cloned.length,
        ...cloned.filter((c) => !ownKeys.has(c.key)),
        ...again.filter((c) => c.tier !== "personal"),
      );
    } catch (e) {
      if (wrote) rmSync(file, { force: true });
      if (added.length > 0) await updateMachineConfig((c) => void added.forEach((k) => delete c.repositories[k]), home);
      throw e;
    }
  }
  if (missed.length > 0) {
    if (wrote) rmSync(file, { force: true });
    if (added.length > 0) await updateMachineConfig((c) => void added.forEach((k) => delete c.repositories[k]), home);
    const why = missed.map((m) => `${m.key}: ${m.message ?? "the clone failed"}`).join("; ");
    const create = missed
      .map((m) => {
        const ref = refs.find((x) => repoKey(x) === m.key)!;
        return `kioku brain create ${ref.owner}/${ref.repo} --tier ${m.tier}`;
      })
      .join(", or ");
    throw environmentError(
      `could not clone ${why}. Nothing was written. If the brain does not exist yet, add --create to make it on this machine, or make it first: ${create}`,
      "clone_failed",
    );
  }
  return {
    file,
    inRepository: repository !== undefined,
    wrote,
    ...(wanted.brain && { brain: repoKey(wanted.brain) }),
    ...(wanted.team && { team: repoKey(wanted.team) }),
    cloned,
    created,
    chain: resolveChain(top, readMachineConfig(home), home).links,
  };
}
