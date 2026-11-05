import { CURRENT_FORMAT, stringifyFolderConfig, type Tier } from "../config/folder-config.ts";
import { userError } from "../errors.ts";
import { applyChanges, bringIn, type Publication, type WriteContext } from "../write/apply.ts";
import type { KnownBrain } from "./list.ts";

export interface UpgradeResult {
  brain: string;
  /** The format the brain was in, and the one it is in now (§3.2). */
  from: number;
  to: number;
  /** The commit that raised it; absent when it was in the newest format already. */
  commit?: string;
  published?: Publication;
}

/**
 * `kioku brain upgrade <brain>` (§3.2): the brain raised to the newest format this tool writes, in one commit, pushed
 * in a brain with a remote. From `format: 1` it writes the brain's name, the one it has on this machine; a brain in the
 * newest format already is left as it is. Nothing lowers a format.
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
  const text = stringifyFolderConfig({ ...config, format: CURRENT_FORMAT, name: config.name ?? brain.key });
  const applied = await applyChanges(
    target,
    [{ rel: "kioku.yaml", text }],
    `format: ${CURRENT_FORMAT}, the brain's name ${brain.key} in kioku.yaml`,
    { home, now, ...w },
    seen,
  );
  return {
    brain: brain.key,
    from: config.format,
    to: CURRENT_FORMAT,
    commit: applied.commit,
    published: applied.publication,
  };
}
