import { withoutChangelog } from "../brain/file.ts";
import type { Embedder } from "../semantic/embedder.ts";
import { currentSteps } from "../steps.ts";
import { brainIn, type Index } from "./db.ts";

/**
 * The vectors of the meaning half of search (§4.3): one per page, in the same SQLite file as the full text, with
 * the page's content hash and the model's name. A page whose hash or model differs has no current vector. Nearest
 * neighbours by cosine in JavaScript, exact, behind three functions (embed, upsert, nearest) so that a vector
 * extension inside SQLite can take the place of the loop without anything above it changing.
 */

/** A page, as the vectors key it. */
export interface PageKey {
  brain: string;
  path: string;
}

export interface VectorStore {
  upsert(page: PageKey, hash: string, vector: Float32Array): void;
  /** The `k` pages nearest to `vector`, best first; among `only` when given. */
  nearest(vector: Float32Array, k: number, only?: PageKey[]): (PageKey & { score: number })[];
}

const toBlob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

/** Vectors are unit length, so their dot product is their cosine. */
export const cosine = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** A page as one string, for sets and maps. */
export const keyOf = (p: PageKey): string => `${p.brain}\n${p.path}`;

export function vectorStore(index: Index, model: string): VectorStore {
  const { db } = index;
  const put = db.prepare("INSERT OR REPLACE INTO vectors (brain, path, hash, model, vector) VALUES (?, ?, ?, ?, ?)");
  const all = db.prepare("SELECT brain, path, vector FROM vectors WHERE model = ?");
  return {
    upsert: (page, hash, vector) => void put.run(page.brain, page.path, hash, model, toBlob(vector)),
    nearest(vector, k, only) {
      const wanted = only === undefined ? undefined : new Set(only.map(keyOf));
      const scored: (PageKey & { score: number })[] = [];
      for (const r of all.all(model) as unknown as (PageKey & { vector: Uint8Array })[]) {
        if (wanted !== undefined && !wanted.has(keyOf(r))) continue;
        scored.push({ brain: r.brain, path: r.path, score: cosine(vector, fromBlob(r.vector)) });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

/** What a page is embedded from: title, summary, aliases and body without the Changelog. */
const passageOf = (r: { title: string; summary: string; aliases: string; body: string }): string =>
  [r.title, r.summary, r.aliases, withoutChangelog(r.body)].filter((x) => x.trim() !== "").join("\n\n");

interface StaleRow {
  brain: string;
  path: string;
  hash: string;
  title: string;
  summary: string;
  aliases: string;
  body: string;
}

/** The pages of these brains (keys) with no vector of this model for their current content. */
function stale(index: Index, brains: string[], model: string): StaleRow[] {
  if (brains.length === 0) return [];
  return index.db
    .prepare(`
    SELECT p.brain AS brain, p.path AS path, p.hash AS hash, p.title AS title, p.summary AS summary, p.aliases AS aliases, f.body AS body
    FROM pages p JOIN fts f ON f.rowid = p.rowid
    LEFT JOIN vectors v ON v.brain = p.brain AND v.path = p.path AND v.hash = p.hash AND v.model = ?
    WHERE v.path IS NULL AND ${brainIn(brains)}
    ORDER BY p.brain, p.path`)
    .all(model, ...brains) as unknown as StaleRow[];
}

/**
 * Embed the pages of these brains that have no current vector, dropping the vectors of any other model as they are
 * written (a new model rebuilds them all). With more than `max` to do, nothing is embedded and the count comes back: a
 * search does not stop to index a whole brain, `sync` does. With nothing to do, nothing is written.
 */
export async function embedStale(
  index: Index,
  embedder: Embedder,
  brains: string[],
  max = Infinity,
): Promise<{ embedded: number; left: number }> {
  const todo = stale(index, brains, embedder.model);
  if (todo.length === 0 || todo.length > max) return { embedded: 0, left: todo.length };
  const store = vectorStore(index, embedder.model);
  const vectors = await currentSteps().runAsync(
    { doing: "Reading the meaning of the pages", done: "Read the meaning of the pages", direction: "down" },
    () => embedder.embed(todo.map(passageOf), "passage"),
  );
  index.db.exec("BEGIN IMMEDIATE");
  try {
    index.db.prepare("DELETE FROM vectors WHERE model != ?").run(embedder.model);
    todo.forEach((r, i) => store.upsert(r, r.hash, vectors[i]!));
    index.db.exec("COMMIT");
  } catch (e) {
    index.db.exec("ROLLBACK");
    throw e;
  }
  return { embedded: todo.length, left: 0 };
}
