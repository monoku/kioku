import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultUrl, parseNamed, repoKey, cloneOf, type BrainRef } from "../config/brain-ref.ts";
import { resolveChain, type ChainLink, type LinkTier } from "../config/chain.ts";
import { readFolderConfig, type Tier } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig, updateMachineConfig, type MachineConfig } from "../config/machine.ts";
import { git } from "../git.ts";
import { NON_INTERACTIVE } from "../write/publish.ts";
import { environmentError, firstLine, userError } from "../errors.ts";
import { currentSteps } from "../steps.ts";

export type SyncStatus = "cloned" | "pulled" | "pushed" | "up-to-date" | "no-remote" | "failed" | "conflict";

export interface SyncOutcome {
  key: string;
  tier: LinkTier;
  path: string;
  status: SyncStatus;
  message?: string;
}

/** What a link of the chain may be, by the tier its `kioku.yaml` declares. A personal project's brain is the personal brain (§2.1). */
const ACCEPTS: Record<LinkTier, Tier[]> = { personal: ["personal"], project: ["project", "personal"], team: ["team"] };

/** A clone that takes longer is a hung network, not a big brain. Chosen, not measured. */
export const CLONE_TIMEOUT_MS = 300_000;

/** What git says when a repository is not there for this person: absent, or not theirs to read, which looks the same. */
export const ABSENT = /not found|does not exist|does not appear to be a git repository|could not read Username/i;

/**
 * Where a repository is cloned from (§2.2): the address the reference gives, else the one the machine recorded for it,
 * else the one its key says, over https.
 */
export const cloneUrl = (ref: BrainRef, config?: MachineConfig): string =>
  ref.url ?? config?.repositories[repoKey(ref)]?.url ?? defaultUrl(ref);

/** The address to record for a repository: undefined when it is the one its name already says. */
export const recordedUrl = (ref: BrainRef, url: string | undefined): string | undefined =>
  url === undefined || url === defaultUrl(ref) ? undefined : url;

/**
 * Clone the repository of a link into its place on this machine and check the brain is the tier the chain expects.
 * On any failure what this call created is removed, so a half clone never passes for a brain. Never throws.
 */
function cloneLink(link: ChainLink, clone: string, config?: MachineConfig): SyncOutcome {
  const base = { key: link.key, tier: link.tier, path: link.path };
  const fail = (message: string): SyncOutcome => ({ ...base, status: "failed", message });
  const repoThere = existsSync(join(clone, ".git"));
  if (!repoThere && existsSync(clone) && readdirSync(clone).length > 0) return fail(`${clone} exists and is not empty`);
  try {
    if (!repoThere) {
      mkdirSync(dirname(clone), { recursive: true });
      const from = cloneUrl(link.ref, config);
      currentSteps().run({ doing: `Cloning ${link.key}`, done: `Cloned ${link.key}`, direction: "down" }, () =>
        git(undefined, ["clone", "-q", "--", from, clone], { ...NON_INTERACTIVE, timeoutMs: CLONE_TIMEOUT_MS }),
      );
    }
    const found = readFolderConfig(join(link.path, "kioku.yaml"));
    const problem = !found.ok
      ? found.reason
      : found.value.form !== "brain"
        ? "its kioku.yaml is a project folder's, not a brain's"
        : !ACCEPTS[link.tier].includes(found.value.tier)
          ? `it is a ${found.value.tier} brain, not a ${link.tier} one`
          : undefined;
    if (problem !== undefined) throw new Error(`${link.key} is not usable as the ${link.tier} brain: ${problem}`);
    return { ...base, status: "cloned" };
  } catch (e) {
    if (!repoThere) rmSync(clone, { recursive: true, force: true });
    return fail(firstLine(e));
  }
}

/**
 * Clone what the chain of `cwd` is missing (§2.5, §4.2), registering each clone in the machine configuration. No brain
 * names another (§2.4), so one look at the chain finds all of it.
 */
export async function cloneMissing(cwd: string, home: string): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  const config = readMachineConfig(home);
  for (const link of resolveChain(cwd, config, home).missing) {
    const outcome = cloneLink(link, cloneOf(config ?? emptyConfig(), link.ref, home), config);
    outcomes.push(outcome);
    if (outcome.status === "cloned") {
      const url = recordedUrl(link.ref, link.ref.url);
      await updateMachineConfig((c) => {
        c.repositories[repoKey(link.ref)] ??= {};
        if (url !== undefined) c.repositories[repoKey(link.ref)]!.url ??= url;
      }, home);
    }
  }
  return outcomes;
}

export interface CloneResult {
  brain: string;
  tier: Tier;
  path: string;
  /** `cloned` now, or `registered`: the clone was already in its place. */
  action: "cloned" | "registered";
}

/**
 * `kioku brain clone <brain> [--url <url>] [--dir <folder>]` (§2.2, §2.3, §6.1): bring a brain that already exists to
 * this machine, into the managed folder or the one named, from where its key says, its ssh address, or `url`, and
 * register it as its `kioku.yaml` says: a personal brain as the machine's `personal`, a shared one as a trusted
 * repository, with the address it came from when that is not the one its key says. What this call cloned is removed
 * when the brain cannot be registered. Never called for the agent.
 */
export async function cloneBrain(home: string, from: string, dir?: string, url?: string): Promise<CloneResult> {
  const named = parseNamed(from, true);
  if (named === undefined) {
    const hint =
      url === undefined && !/^[\w.-]+(\/[\w.-]+){1,2}$/.test(from.trim())
        ? `; to clone from an address, name the brain and give the address: kioku brain clone <owner>/<repo> --url ${from}`
        : "";
    throw userError(`"${from}" is not a brain such as github.com/owner/repo or owner/repo${hint}`, "brain_url_invalid");
  }
  const ref: BrainRef = url === undefined ? named : { ...named, url };
  const config = readMachineConfig(home) ?? emptyConfig();
  const key = repoKey(ref);
  const recorded = config.repositories[key]?.path;
  if (dir !== undefined && recorded !== undefined && cloneOf(config, ref, home) !== dir) {
    throw userError(
      `${key} is already at ${cloneOf(config, ref, home)} on this machine; --dir cannot move it`,
      "usage",
    );
  }
  const path = dir ?? cloneOf(config, ref, home);
  const repoThere = existsSync(join(path, ".git"));
  if (!repoThere && existsSync(path) && readdirSync(path).length > 0)
    throw userError(`${path} exists and is not empty`, "path_not_empty");
  const undo = () => {
    if (!repoThere) rmSync(path, { recursive: true, force: true });
  };
  if (!repoThere) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      const fromUrl = cloneUrl(ref, config);
      currentSteps().run({ doing: `Cloning ${key}`, done: `Cloned ${key}`, direction: "down" }, () =>
        git(undefined, ["clone", "-q", "--", fromUrl, path], { ...NON_INTERACTIVE, timeoutMs: CLONE_TIMEOUT_MS }),
      );
    } catch (e) {
      undo();
      throw environmentError(`could not clone ${key}: ${firstLine(e)}`, "clone_failed");
    }
  }
  const found = readFolderConfig(join(path, "kioku.yaml"));
  const problem = !found.ok
    ? found.reason
    : found.value.form !== "brain"
      ? "its kioku.yaml is a project folder's, not a brain's"
      : undefined;
  if (problem !== undefined || !found.ok || found.value.form !== "brain") {
    undo();
    throw userError(`${key} is not a brain: ${problem}`, "not_a_brain");
  }
  const { tier } = found.value;
  if (tier === "personal" && config.brain !== undefined && config.brain !== key) {
    undo();
    throw userError(`a personal brain is already set (${config.brain}); nothing was changed`, "personal_exists");
  }
  const address = recordedUrl(ref, ref.url);
  await updateMachineConfig((c) => {
    c.repositories[key] ??= {};
    if (dir !== undefined) c.repositories[key]!.path = dir;
    if (address !== undefined) c.repositories[key]!.url = address;
    // Bringing a brain records nothing about the person (§2.3).
    if (tier === "personal") c.brain ??= key;
  }, home);
  return { brain: key, tier, path, action: repoThere ? "registered" : "cloned" };
}
