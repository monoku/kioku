import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { writeAtomic } from "../fs/atomic.ts";
import { RELEASE_VERSION } from "../setup/update.ts";
import { pluginSaidPath } from "../state.ts";
import { readJson } from "../util.ts";

/** The version a tool run from source says it is: no release, so no plugin is held to it. */
const FROM_SOURCE = "0.0.0-dev";

/**
 * The plugin's version and the tool's, when they differ and this machine has not been told of this pair yet: the
 * pair, noted as told, so that a session says it once (§6.2). Undefined when either is not a release's version, or the
 * tool runs from source.
 */
export function newVersionPair(
  home: string,
  plugin: string | undefined,
  tool: string,
): { plugin: string; tool: string } | undefined {
  if (plugin === undefined || plugin === tool || tool === FROM_SOURCE) return undefined;
  if (!RELEASE_VERSION.test(plugin) || !RELEASE_VERSION.test(tool)) return undefined;
  const said = readJson<{ plugin?: unknown; tool?: unknown } | null>(pluginSaidPath(home));
  if (said?.plugin === plugin && said?.tool === tool) return undefined;
  try {
    mkdirSync(dirname(pluginSaidPath(home)), { recursive: true });
    writeAtomic(pluginSaidPath(home), `${JSON.stringify({ plugin, tool })}\n`);
  } catch {
    /* a stamp that cannot be written says it again next session, which is better than never */
  }
  return { plugin, tool };
}
