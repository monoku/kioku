import type { Index } from "../index/db.ts";
import { embedStale } from "../index/vectors.ts";
import { installSemantic } from "./install.ts";
import { openMeaning, type SemanticDeps } from "./meaning.ts";
import { currentPlatform, downloadMB, PINS } from "./pins.ts";
import { currentSteps } from "../steps.ts";
import { readSemanticState, semanticStatus, writeSemanticState, type Part } from "./status.ts";
import { firstLine } from "../errors.ts";

/** After a failed fetch, the background `sync` waits this long before trying again; `kioku sync` by hand always tries. */
export const RETRY_AFTER_HOURS = 6;

export type SemanticOutcome =
  | { mode: "hybrid"; fetched: Part[]; embedded: number }
  | { mode: "full-text"; reason: string };

/**
 * The meaning half of `sync` (§4.2, §4.3): fetch the engine and the model when they are missing or changed,
 * recording a failure for `doctor` and the summary, then embed every page of these brains that has no current vector.
 */
export async function refreshSemantic(
  home: string,
  index: Index,
  brains: string[],
  deps: SemanticDeps,
  now: Date,
  background: boolean,
): Promise<SemanticOutcome> {
  const pins = deps.pins ?? PINS;
  const platform = deps.platform ?? currentPlatform();
  const status = semanticStatus(home, pins, platform);
  let fetched: Part[] = [];
  if (!status.ready) {
    if (status.missing.length === 0) return { mode: "full-text", reason: status.reason! };
    const failure = readSemanticState(home).failure;
    if (background && failure !== undefined && now.getTime() - Date.parse(failure.at) < RETRY_AFTER_HOURS * 3_600_000) {
      return { mode: "full-text", reason: status.reason! };
    }
    try {
      await currentSteps().runAsync(
        {
          doing: `Downloading the search model (about ${downloadMB(pins)} MB, once)`,
          done: "Downloaded the search model",
          direction: "down",
        },
        () => installSemantic(home, status.missing, { download: deps.download, pins, platform }),
      );
    } catch (e) {
      const reason = firstLine(e);
      writeSemanticState(home, (s) => ({ ...s, failure: { reason, at: now.toISOString() } }));
      return { mode: "full-text", reason: `fetching the search model failed: ${reason}` };
    }
    writeSemanticState(home, ({ failure: _, ...s }) => s);
    fetched = status.missing;
  }
  const meaning = await openMeaning(home, { ...deps, pins });
  if ("reason" in meaning) return { mode: "full-text", reason: meaning.reason };
  const { embedded } = await embedStale(index, meaning.embedder, brains);
  return { mode: "hybrid", fetched, embedded };
}
