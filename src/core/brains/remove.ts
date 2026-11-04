import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseRepo, repoKey, cloneOf } from "../config/brain-ref.ts";
import { readMachineConfig, remindsUnpublished, updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { gitQuiet } from "../git.ts";
import { openIndex } from "../index/db.ts";
import { dropFromIndex } from "../index/indexer.ts";
import { conflictsPath } from "../state.ts";
import type { KnownBrain } from "./list.ts";

export interface RemoveResult {
  /** The brain asked for, as the machine keys it: its repository. */
  brain: string;
  folder: string;
  /** `folder`: the clone was deleted; `unregistered`: it is in a folder the person named, which is left as it is. */
  removed: "folder" | "unregistered";
  /** Whether it was the personal brain, so the configuration's `brain` was forgotten too. */
  personal: boolean;
  /** Whether it was the machine's team, so the configuration's `team` was forgotten too (§2.5). */
  team: boolean;
  /** Whether the clone had a remote, so a repository elsewhere still holds the brain. */
  published: boolean;
  dryRun: boolean;
}

/** What in a clone exists nowhere else: uncommitted changes, and commits or branches no remote branch holds. */
function unsaved(folder: string): string | undefined {
  const dirty = gitQuiet(folder, ["status", "--porcelain"]);
  if (dirty !== undefined) return "it has changes that are not committed";
  const ahead = gitQuiet(folder, ["rev-list", "--branches", "--not", "--remotes", "--count"]);
  // A failing git is not "nothing unsaved": a clone that cannot be read is not one that is safe to delete.
  if (ahead === undefined) return "git could not say whether a remote holds all its commits";
  if (ahead !== "0")
    return `it has ${ahead} commit${ahead === "1" ? "" : "s"} that no remote has (kioku brain conflicts lists the ones kept aside)`;
  return undefined;
}

/**
 * `kioku brain remove <brain>` (§2.5): the brain off this machine, never off the git host. The clone in the managed
 * folder is deleted, the repository is forgotten in `brains` (and as `brain` or `team` when it was), and its pages
 * leave the index. A clone in a folder the person named is theirs: forgotten, its files left. Refused, with nothing
 * changed, when the clone holds what exists nowhere else, or is the personal brain or the machine's team, unless
 * `force`.
 */
export async function removeBrain(
  home: string,
  brain: KnownBrain,
  o: { force: boolean; dryRun: boolean },
): Promise<RemoveResult> {
  const ref = parseRepo(brain.key)!;
  const repository = repoKey(ref);
  const config = readMachineConfig(home);
  if (config === undefined)
    throw userError("this machine has no configuration; there is no brain to remove", "brain_unknown");
  const folder = cloneOf(config, ref, home);
  const managed = config.repositories[repository]?.path === undefined;
  const personal = config.brain === repository;
  const team = config.team === repository;
  const name = brain.key ?? brain.key;

  if (!o.force) {
    if (personal)
      throw userError(
        `${name} is your personal brain; --force removes it from this machine anyway, and forgets it as personal`,
        "brain_personal",
      );
    if (team)
      throw userError(
        `${name} is this machine's team, which loads where a project names none; --force removes it from this machine anyway, and forgets it as the team (kioku config unset team forgets it and keeps the brain)`,
        "brain_team",
      );
    if (existsSync(folder)) {
      if (gitQuiet(folder, ["remote", "get-url", "origin"]) === undefined) {
        throw userError(
          `${name} has no remote, so its clone is its only copy and deleting it deletes that memory; --force deletes it anyway${remindsUnpublished(readMachineConfig(home)) ? `, or kioku brain publish ${name} puts it in a repository you make first` : ""}`,
          "brain_no_remote",
        );
      }
      const reason = unsaved(folder);
      if (reason !== undefined)
        throw userError(
          `${name} would lose what exists nowhere else: ${reason}; kioku brain sync ${name} first, or --force`,
          "brain_unsaved",
        );
    }
  }

  const published = existsSync(folder) && gitQuiet(folder, ["remote", "get-url", "origin"]) !== undefined;
  const result: RemoveResult = {
    brain: brain.key,
    folder,
    removed: managed ? "folder" : "unregistered",
    personal,
    team,
    published,
    dryRun: o.dryRun,
  };
  if (o.dryRun) return result;

  if (managed) {
    rmSync(folder, { recursive: true, force: true });
    // The owner's folder goes with its last repository; a folder holding anything else stays.
    try {
      if (readdirSync(dirname(folder)).length === 0) rmdirSync(dirname(folder));
    } catch {
      /* not empty, or already gone */
    }
  }
  // The folders where this repository's conflicts were opened hold worktrees of a clone that is gone or forgotten.
  rmSync(join(conflictsPath(home), ref.owner, ref.repo), { recursive: true, force: true });
  await updateMachineConfig((c) => {
    delete c.repositories[repository];
    if (personal) delete c.brain;
    if (team) delete c.team;
  }, home);
  const index = await openIndex(home);
  try {
    dropFromIndex(index, [repository]);
  } finally {
    index.close();
  }
  return result;
}
