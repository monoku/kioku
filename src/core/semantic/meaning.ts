import type { Embedder } from "./embedder.ts";
import type { Download } from "./install.ts";
import { PINS, type Pins } from "./pins.ts";
import { semanticStatus } from "./status.ts";
import { firstLine } from "../errors.ts";

/** What the meaning half of search needs from the machine, given so that a test can stand in for it. */
export interface SemanticDeps {
  download: Download;
  loadEmbedder: (home: string, pins: Pins) => Promise<Embedder>;
  pins?: Pins;
  platform?: string;
}

/** The model, ready to embed, or why search answers with full text alone. */
export type Meaning = { embedder: Embedder } | { reason: string };

/** Load the embedder when the engine and model are on disk as verified; otherwise say why not. Never fetches. */
export async function openMeaning(home: string, deps: SemanticDeps): Promise<Meaning> {
  const pins = deps.pins ?? PINS;
  const status = semanticStatus(home, pins, deps.platform);
  if (!status.ready) return { reason: status.reason! };
  try {
    return { embedder: await deps.loadEmbedder(home, pins) };
  } catch (e) {
    return { reason: `the search engine failed to load: ${firstLine(e)}` };
  }
}
