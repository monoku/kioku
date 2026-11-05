import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addressUrl,
  brainFolder,
  isAddress,
  nameOfAddress,
  parseName,
  repoKey,
  sameRepository,
  type BrainRef,
} from "../config/brain-ref.ts";
import { ACCEPTS, addressOf, isHere, resolveChain, type ChainLink, type LinkTier } from "../config/chain.ts";
import { readFolderConfig, type BrainConfig, type Tier } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig, updateMachineConfig, type MachineConfig } from "../config/machine.ts";
import { git } from "../git.ts";
import { NON_INTERACTIVE } from "../write/publish.ts";
import { environmentError, firstLine, userError } from "../errors.ts";
import { currentSteps } from "../steps.ts";
import { knownBrains } from "./list.ts";

export type SyncStatus = "cloned" | "pulled" | "pushed" | "up-to-date" | "no-remote" | "failed" | "conflict";

export interface SyncOutcome {
  key: string;
  tier: LinkTier;
  path: string;
  status: SyncStatus;
  message?: string;
}

/** A clone that takes longer is a hung network, not a big brain. Chosen, not measured. */
export const CLONE_TIMEOUT_MS = 300_000;

/** What git says when a repository is not there for this person: absent, or not theirs to read, which looks the same. */
export const ABSENT = /not found|does not exist|does not appear to be a git repository|could not read Username/i;

/** Where a brain is cloned from (§2.2): the address the link gives, else the one this machine recorded for its name. */
export const cloneUrl = (ref: BrainRef, config?: MachineConfig): string | undefined =>
  ref.url ?? config?.repositories[repoKey(ref)];

/** A brain cloned into a folder of the tool's, outside the managed one, before it has a name here (§2.3). */
interface Staged {
  folder: string;
  config: BrainConfig;
  /** The name it holds, or, in `format: 1`, the one its address says (§3.2). */
  name: string;
}

/** Remove a staged clone and the folder that held it. */
const unstage = (s: { folder: string }): void => rmSync(dirname(s.folder), { recursive: true, force: true });

/**
 * Clone `url` into a folder of the tool's and read its `kioku.yaml`: an address says nothing of the name it holds, so
 * the brain is read before it moves to its folder (§2.3). Removes what it made on any failure.
 */
function stage(home: string, url: string, label: string): Staged {
  const holder = join(home, ".kioku", "staging");
  mkdirSync(holder, { recursive: true });
  const at = mkdtempSync(join(holder, "clone-"));
  const folder = join(at, "brain");
  try {
    currentSteps().run({ doing: `Cloning ${label}`, done: `Cloned ${label}`, direction: "down" }, () =>
      git(undefined, ["clone", "-q", "--", url, folder], { ...NON_INTERACTIVE, timeoutMs: CLONE_TIMEOUT_MS }),
    );
  } catch (e) {
    rmSync(at, { recursive: true, force: true });
    throw environmentError(`could not clone ${url}: ${firstLine(e)}`, "clone_failed");
  }
  const found = readFolderConfig(join(folder, "kioku.yaml"));
  const problem = !found.ok
    ? found.reason
    : found.value.form !== "brain"
      ? "its kioku.yaml is a project folder's, not a brain's"
      : undefined;
  if (problem !== undefined || !found.ok || found.value.form !== "brain") {
    rmSync(at, { recursive: true, force: true });
    throw userError(`${url} holds no brain: ${problem}`, "not_a_brain");
  }
  const name = found.value.name ?? (nameOfAddress(url) && repoKey(nameOfAddress(url)!));
  if (name === undefined || parseName(name) === undefined) {
    rmSync(at, { recursive: true, force: true });
    throw userError(
      `${url} holds a brain of format ${found.value.format} with no name, and its address says none`,
      "brain_unnamed",
    );
  }
  return { folder, config: found.value, name };
}

/** Move a staged clone to its folder under its name (§2.5). */
function place(home: string, staged: Staged): string {
  const target = brainFolder(home, parseName(staged.name)!);
  if (existsSync(target) && readdirSync(target).length > 0) {
    unstage(staged);
    throw userError(`${target} exists and is not empty`, "path_not_empty");
  }
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(staged.folder, target);
  unstage(staged);
  return target;
}

/**
 * Clone a link of the chain into its folder, checking that the address holds the brain the link names, of a tier the
 * link takes (§2.1, §2.4). On any failure what this call created is removed, so a half clone never passes for a brain.
 * Never throws.
 */
function cloneLink(link: ChainLink, home: string, config?: MachineConfig): SyncOutcome {
  const base = { key: link.key, tier: link.tier, path: link.path };
  const fail = (message: string): SyncOutcome => ({ ...base, status: "failed", message });
  const url = cloneUrl(link.ref, config);
  if (url === undefined) return fail(`no address is known for ${link.key}`);
  let staged: Staged;
  try {
    staged = stage(home, url, link.key);
  } catch (e) {
    return fail(firstLine(e));
  }
  const problem =
    staged.name !== link.key
      ? `${url} holds the brain ${staged.name}, not ${link.key}`
      : !ACCEPTS[link.tier].includes(staged.config.tier)
        ? `it is a ${staged.config.tier} brain, not a ${link.tier} one`
        : undefined;
  if (problem !== undefined) {
    unstage(staged);
    return fail(`${link.key} is not usable as the ${link.tier} brain: ${problem}`);
  }
  try {
    place(home, staged);
  } catch (e) {
    return fail(firstLine(e));
  }
  return { ...base, status: "cloned" };
}

/**
 * Clone what the chain of `cwd` is missing (§2.5, §4.2), recording each address in the machine configuration. No brain
 * names another (§2.4), so one look at the chain finds all of it.
 */
export async function cloneMissing(cwd: string, home: string): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  const config = readMachineConfig(home);
  for (const link of resolveChain(cwd, config, home).missing) {
    const outcome = cloneLink(link, home, config);
    outcomes.push(outcome);
    const url = cloneUrl(link.ref, config);
    if (outcome.status === "cloned" && url !== undefined)
      await updateMachineConfig((c) => void (c.repositories[link.key] ??= url), home);
  }
  return outcomes;
}

export interface CloneResult {
  brain: string;
  tier: Tier;
  path: string;
  /** Always `cloned`: a brain already here is refused, naming it (§2.3). */
  action: "cloned";
  /** The address it was cloned from, now recorded (§2.5). */
  url: string;
}

/** The brain of this machine whose address is `url`, in either of its https and ssh forms, if any (§2.3). */
export function brainAtAddress(home: string, url: string, config?: MachineConfig): string | undefined {
  const c = config ?? readMachineConfig(home) ?? emptyConfig();
  return knownBrains(home).find((b) => {
    const at = addressOf(c, home, parseName(b.key)!);
    return at !== undefined && sameRepository(at, url);
  })?.key;
}

/**
 * Bring the brain at `url` to this machine (§2.3): cloned into a folder of the tool's, read, then moved to its folder
 * under the name it holds, with its address recorded, a personal brain as the machine's `brain`. Refused, leaving
 * nothing, when a brain of this machine is at that address, when its name is one this machine has, when it is a
 * personal brain and the machine has one, or when it is not of the tier `tier` says.
 */
export async function bringBrain(home: string, url: string, tier?: Tier): Promise<CloneResult> {
  const config = readMachineConfig(home) ?? emptyConfig();
  const already = brainAtAddress(home, url, config);
  if (already !== undefined)
    throw userError(`${url} is the repository of ${already}, which is on this machine already`, "brain_exists");
  const staged = stage(home, url, url);
  const ref = parseName(staged.name)!;
  const refuse = (message: string, code: string): never => {
    unstage(staged);
    throw userError(message, code);
  };
  if (isHere(home, ref)) {
    if (addressOf(config, home, ref) === undefined)
      refuse(
        `${url} holds ${staged.name}, and this machine has a brain of that name with no remote; to put this machine's in that repository: kioku brain publish ${staged.name} --remote ${url}`,
        "brain_exists",
      );
    refuse(
      `${url} holds ${staged.name}, and this machine has another brain of that name, at ${addressOf(config, home, ref)}; nothing was changed`,
      "brain_exists",
    );
  }
  if (tier !== undefined && staged.config.tier !== tier)
    refuse(`${url} holds the ${staged.config.tier} brain ${staged.name}, not a ${tier} brain`, "brain_other_tier");
  if (staged.config.tier === "personal" && config.brain !== undefined && config.brain !== staged.name)
    refuse(`a personal brain is already set (${config.brain}); nothing was changed`, "personal_exists");
  const path = place(home, staged);
  await updateMachineConfig((c) => {
    c.repositories[staged.name] = url;
    // Bringing a brain records nothing about the person (§2.3).
    if (staged.config.tier === "personal") c.brain ??= staged.name;
  }, home);
  return { brain: staged.name, tier: staged.config.tier, path, action: "cloned", url };
}

/**
 * `kioku brain clone <address>` (§2.2, §2.3, §6.1): a brain that already exists, from any address git clones from,
 * under the name it holds. Never called for the agent.
 */
export async function cloneBrain(home: string, from: string): Promise<CloneResult> {
  if (!isAddress(from)) {
    const named = parseName(from);
    throw userError(
      named !== undefined
        ? `"${from}" is a brain's name, and brain clone takes an address, which has a host: github.com/${from}, say, or https://… or git@…`
        : `"${from}" is not an address git clones from, such as github.com/owner/repo, https://…, git@host:path or a folder`,
      "brain_url_invalid",
    );
  }
  return bringBrain(home, addressUrl(from));
}
