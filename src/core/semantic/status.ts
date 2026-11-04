import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../fs/atomic.ts";
import { enginePath, modelsPath, semanticStatePath } from "../state.ts";
import { readMachineConfig, type SearchMode } from "../config/machine.ts";
import { currentPlatform, downloadMB, PINS, type Pins } from "./pins.ts";
import { readJson } from "../util.ts";

/**
 * Whether the meaning half of search can run on this machine (§4.3): the engine and the model on disk, each as
 * it was when its checksums were verified. Reads small files and stats; never hashes on the way to a search, never
 * loads the engine. `doctor` hashes everything with `verifySemantic`.
 */

/** A file as it was verified: its path below the part's folder, size, SHA-256 and modification time. */
export interface StampedFile {
  path: string;
  size: number;
  sha256: string;
  mtimeMs: number;
}

/** What `install` writes once every file of a part passed its checksum. */
export interface Stamp {
  /** The engine's version, or the model's name. */
  version: string;
  platform?: string;
  files: StampedFile[];
}

export type Part = "engine" | "model";

export interface SemanticStatus {
  ready: boolean;
  /** The parts to fetch. */
  missing: Part[];
  /** Why search answers with full text alone, in words for the person. */
  reason?: string;
}

/** The last failure to fetch, and when the person was told the model is being fetched. */
export interface SemanticState {
  failure?: { reason: string; at: string };
  announced?: string;
}

/** How the machine configuration says search runs; hybrid when it says nothing or cannot be read, which `doctor` reports. */
export function configuredMode(home: string): SearchMode {
  try {
    return readMachineConfig(home)?.search?.mode ?? "hybrid";
  } catch {
    return "hybrid";
  }
}

/** Why search answers with full text alone when the person chose it. */
export const FULL_TEXT_CHOSEN = "search is set to full text in ~/.kioku/config.yaml";

export const partRoot = (home: string, part: Part): string => (part === "engine" ? enginePath(home) : modelsPath(home));
const stampPath = (home: string, part: Part): string => join(partRoot(home, part), "stamp.json");

/** The engine's entry module, which the embedder imports. */
export const engineEntry = (home: string): string =>
  join(enginePath(home), "node_modules/@huggingface/transformers/dist/transformers.node.mjs");

export function readStamp(home: string, part: Part): Stamp | undefined {
  const raw = readJson<Stamp | null>(stampPath(home, part));
  return typeof raw?.version === "string" && Array.isArray(raw.files) ? raw : undefined;
}

export function readSemanticState(home: string): SemanticState {
  const raw = readJson<SemanticState | null>(semanticStatePath(home));
  return raw !== null && typeof raw === "object" ? raw : {};
}

export function writeSemanticState(home: string, change: (s: SemanticState) => SemanticState): void {
  writeAtomic(semanticStatePath(home), `${JSON.stringify(change(readSemanticState(home)), null, 2)}\n`);
}

type PartState = "ok" | "missing" | "changed";

/** A part on disk is the pinned one, and every file is as it was when verified. */
function partState(home: string, part: Part, pins: Pins, platform: string): PartState {
  const stamp = readStamp(home, part);
  const wanted = part === "engine" ? pins.engine.version : pins.model.name;
  if (stamp === undefined || stamp.version !== wanted || (part === "engine" && stamp.platform !== platform))
    return "missing";
  for (const f of stamp.files) {
    const path = join(partRoot(home, part), f.path);
    if (!existsSync(path)) return "changed";
    const s = statSync(path);
    // Some file systems keep times to the millisecond only.
    if (s.size !== f.size || Math.abs(s.mtimeMs - f.mtimeMs) >= 1) return "changed";
  }
  return "ok";
}

export function semanticStatus(
  home: string,
  pins: Pins = PINS,
  platform: string = currentPlatform(),
  mode: SearchMode = configuredMode(home),
): SemanticStatus {
  // Full text by choice: nothing to fetch, nothing to load (§4.3).
  if (mode === "full-text") return { ready: false, missing: [], reason: FULL_TEXT_CHOSEN };
  if (pins.engine.native[platform] === undefined) {
    return { ready: false, missing: [], reason: `the search engine has no build for ${platform}` };
  }
  const states = { engine: partState(home, "engine", pins, platform), model: partState(home, "model", pins, platform) };
  const missing = (["engine", "model"] as const).filter((p) => states[p] !== "ok");
  if (missing.length === 0) return { ready: true, missing };
  if (missing.some((p) => states[p] === "changed")) {
    return {
      ready: false,
      missing,
      reason: "the search model changed on disk since its checksums were verified; the next sync fetches it again",
    };
  }
  const failure = readSemanticState(home).failure;
  if (failure !== undefined)
    return { ready: false, missing, reason: `fetching the search model failed: ${failure.reason}` };
  return {
    ready: false,
    missing,
    reason: `the search model is not on this machine yet; the next sync fetches it (about ${downloadMB(pins)} MB)`,
  };
}

/** A file's SHA-256, read a megabyte at a time. */
export function sha256Of(path: string): string {
  const hash = createHash("sha256");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    for (let n = readSync(fd, buf); n > 0; n = readSync(fd, buf)) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** Every file of both parts hashed against its stamp, and the stamp against the pins where they pin it (`doctor`). */
export function verifySemantic(
  home: string,
  pins: Pins = PINS,
  platform: string = currentPlatform(),
): { ok: true } | { ok: false; reason: string } {
  const status = semanticStatus(home, pins, platform);
  if (!status.ready) return { ok: false, reason: status.reason! };
  const pinned = new Map<string, string>([
    ...(pins.engine.native[platform] ?? []).map((f): [string, string] => [`engine:${nativeRel(f.path)}`, f.sha256]),
    ...pins.model.files.map((f): [string, string] => [`model:${pins.model.id}/${f.path}`, f.sha256]),
  ]);
  for (const part of ["engine", "model"] as const) {
    for (const f of readStamp(home, part)!.files) {
      const actual = sha256Of(join(partRoot(home, part), f.path));
      const expected = pinned.get(`${part}:${f.path}`) ?? f.sha256;
      if (actual !== expected || actual !== f.sha256)
        return { ok: false, reason: `${join(partRoot(home, part), f.path)} fails its checksum` };
    }
  }
  return { ok: true };
}

/** Where a native file of `onnxruntime-node` sits below the engine folder. */
export const nativeRel = (path: string): string => `node_modules/onnxruntime-node/${path}`;
