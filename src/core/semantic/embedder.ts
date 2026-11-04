import { sep } from "node:path";
import { pathToFileURL } from "node:url";
import { modelsPath } from "../state.ts";
import { PINS, type Pins } from "./pins.ts";
import { engineEntry } from "./status.ts";

/**
 * The model behind one interface (§4.3): texts in, unit vectors out. Search and indexing see only this, so a
 * test stands in a stub and nothing above it knows which engine runs.
 */
export interface Embedder {
  /** The model's pinned name; vectors carry it. */
  model: string;
  /** A question is embedded as a query, a page as a passage. */
  embed(texts: string[], as: "query" | "passage"): Promise<Float32Array[]>;
}

/** One text per run: a batch pads every text to its longest, and measured slower and far heavier (§4.3). */
const BATCH = 1;

interface Extracted {
  dims: number[];
  data: Float32Array;
}

/**
 * Load the engine and the model from `~/.kioku/` (the one native component, loaded here and nowhere else).
 * Nothing is fetched: remote models are switched off and the engine is imported from its folder by path.
 */
export async function loadEmbedder(home: string, pins: Pins = PINS): Promise<Embedder> {
  const tf = await import(pathToFileURL(engineEntry(home)).href);
  Object.assign(tf.env, {
    allowRemoteModels: false,
    allowLocalModels: true,
    localModelPath: `${modelsPath(home)}${sep}`,
    useFSCache: false,
    useBrowserCache: false,
  });
  const extract: (texts: string[], o: object) => Promise<Extracted> = await tf.pipeline(
    "feature-extraction",
    pins.model.id,
    { dtype: pins.model.dtype, device: "cpu" },
  );
  return {
    model: pins.model.name,
    async embed(texts, as) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH).map((t) => `${pins.model.prefix[as]}${t}`);
        const r = await extract(batch, { pooling: pins.model.pooling, normalize: true });
        const [n, d] = r.dims as [number, number];
        for (let j = 0; j < n; j++) out.push(Float32Array.from(r.data.subarray(j * d, (j + 1) * d)));
      }
      return out;
    },
  };
}
