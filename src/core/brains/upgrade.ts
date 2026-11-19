import { CURRENT_FORMAT, memoryByNamespace, stringifyFolderConfig, type Tier } from "../config/folder-config.ts";
import { rmdirSync } from "node:fs";
import { join } from "node:path";
import { readBrainConfig } from "../brain/brain.ts";
import { refusedError, userError } from "../errors.ts";
import { plural } from "../util.ts";
import {
  applyChanges,
  bringIn,
  type Applied,
  type FileChange,
  type Publication,
  type TargetBrain,
} from "../write/apply.ts";
import type { WriteContext } from "../write/apply.ts";
import { memoryMoves, relocated, unplacedSaid } from "../write/relocate.ts";
import type { KnownBrain } from "./list.ts";

export interface UpgradeResult {
  brain: string;
  /** The format the brain was in, and the one it is in now (§3.2). */
  from: number;
  to: number;
  /** The commit that raised it; absent when it was in the newest format already. */
  commit?: string;
  published?: Publication;
  /** The Memory pages it moved to the folder of their namespace, `from` → `to` (§3.1); absent when it moved none. */
  moved?: { from: string; to: string }[];
}

/**
 * `kioku brain upgrade <brain>` (§3.2): the brain raised to the newest format this tool writes, in one commit, pushed
 * in a brain with a remote. From `format: 1` it writes the brain's name, the one it has on this machine; from a
 * format that kept Memory in one folder, it moves each Memory page to the folder of its namespace, and refuses,
 * touching nothing, while one has no namespace of the brain to go to. A brain in the newest format already is left as
 * it is. Nothing lowers a format.
 */
export async function upgradeBrain(
  home: string,
  brain: Pick<KnownBrain, "key" | "folder" | "tier">,
  now: Date,
  w: Partial<WriteContext> = {},
): Promise<UpgradeResult> {
  if (brain.tier === undefined) throw userError(`${brain.key} cannot be read as a brain`, "brain_config_invalid");
  const target = { key: brain.key, tier: brain.tier as Tier, root: brain.folder };
  const seen = await bringIn(target);
  const config = seen.repo.config();
  if (config.format >= CURRENT_FORMAT) return { brain: brain.key, from: config.format, to: config.format };
  const said = [`format: ${CURRENT_FORMAT}`];
  if (config.name === undefined) said.push(`the brain's name ${brain.key} in kioku.yaml`);
  const changes: FileChange[] = [];
  let moved: UpgradeResult["moved"];
  if (!memoryByNamespace(config.format)) {
    const { moves, unplaced } = memoryMoves(brain.folder, config);
    if (unplaced.length > 0)
      throw refusedError(
        `${brain.key} stays in format ${config.format}, and nothing was written: format ${CURRENT_FORMAT} keeps each memory page in the folder of its namespace, and ${plural(unplaced.length, "page")} ${unplaced.length === 1 ? "has" : "have"} none to go to: ${unplacedSaid(unplaced)}. Give each a namespace of the brain with kioku page move <path> --namespace <namespace> --brain ${brain.key}, or declare the one it names with kioku namespace add, then run kioku brain upgrade ${brain.key}`,
        "memory_unplaced",
      );
    changes.push(...relocated(brain.folder, moves));
    if (moves.size > 0) {
      moved = [...moves].map(([from, to]) => ({ from, to }));
      said.push(placedSaid(moves.size));
    }
  }
  changes.push({
    rel: "kioku.yaml",
    text: stringifyFolderConfig({ ...config, format: CURRENT_FORMAT, name: config.name ?? brain.key }),
  });
  const applied = await applyChanges(target, changes, said.join(", "), { home, now, ...w }, seen);
  dropEmptied(brain.folder);
  return {
    brain: brain.key,
    from: config.format,
    to: CURRENT_FORMAT,
    commit: applied.commit,
    published: applied.publication,
    ...(moved !== undefined && { moved }),
  };
}

/** What a commit says of the Memory pages it moved (§3.2). */
const placedSaid = (n: number): string =>
  `${plural(n, "memory page")} in the folder of ${n === 1 ? "its" : "their"} namespace`;

/** The folder the instincts left, when nothing is in it: git does not track an empty one, so it would stay on this machine alone. */
function dropEmptied(root: string): void {
  try {
    rmdirSync(join(root, "memory", "instincts"));
  } catch {
    // It holds something, or was never there.
  }
}

/**
 * The Memory pages a brain kept by namespace holds outside their folders, moved there in one commit (§3.2): what a
 * teammate saved before the brain was raised and published after. Undefined when there is none to move; the ones with
 * no namespace of the brain stay where they are, for the validator to name (§5.1 rule 5).
 */
export async function placeMemories(
  target: TargetBrain,
  w: WriteContext,
): Promise<(Applied & { moved: number }) | undefined> {
  // Read from the disk first: a brain with nothing to move, which is nearly every one, is not fetched for this.
  const here = readBrainConfig(target.root);
  if (!memoryByNamespace(here.format) || here.format > CURRENT_FORMAT) return undefined;
  if (memoryMoves(target.root, here).moves.size === 0) return undefined;
  const seen = await bringIn(target);
  const config = seen.repo.config();
  const { moves } = memoryMoves(target.root, config);
  if (moves.size === 0) return undefined;
  const applied = await applyChanges(
    target,
    relocated(target.root, moves),
    `format: ${config.format}, ${placedSaid(moves.size)}`,
    w,
    seen,
  );
  dropEmptied(target.root);
  return { ...applied, moved: moves.size };
}
