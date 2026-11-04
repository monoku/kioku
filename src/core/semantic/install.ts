import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { processAlive } from "../fs/lock.ts";
import { enginePath, modelsPath } from "../state.ts";
import { currentPlatform, PINS, type FilePin, type PackagePin, type Pins } from "./pins.ts";
import { nativeRel, sha256Of, type Part, type Stamp, type StampedFile } from "./status.ts";
import { extractTgz } from "./tar.ts";

/**
 * Fetch the embedding engine and model into `~/.kioku/` (§4.3): from the pinned URLs, each file checked
 * against its pinned checksum, put together in a scratch folder that replaces the old one only once everything
 * passed, then stamped. Only `sync` calls this; never a hook, `save`, `setup` or `search`.
 */

/** Fetch a URL's bytes; a test stands in its own. */
export type Download = (url: string) => Promise<AsyncIterable<Uint8Array>>;

export const httpDownload: Download = async (url) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  if (response.body === null) throw new Error(`${url} answered no body`);
  return response.body as unknown as AsyncIterable<Uint8Array>;
};

/** Write a download to `dest` while hashing it, stopping as soon as it grows past the pinned size. */
async function fetchTo(
  download: Download,
  url: string,
  dest: string,
  algorithm: "sha256" | "sha512",
  max: number,
): Promise<{ digest: Buffer; size: number }> {
  mkdirSync(dirname(dest), { recursive: true });
  const hash = createHash(algorithm);
  const fd = openSync(dest, "w");
  let size = 0;
  try {
    for await (const chunk of await download(url)) {
      if (size + chunk.length > max) throw new Error(`${url} is larger than its pinned ${max} bytes`);
      hash.update(chunk);
      writeSync(fd, chunk);
      size += chunk.length;
    }
  } finally {
    closeSync(fd);
  }
  return { digest: hash.digest(), size };
}

const filesBelow = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(root, join(d.parentPath, d.name)).split(sep).join("/"));

async function stampOf(root: string, version: string, platform?: string): Promise<Stamp> {
  const files: StampedFile[] = [];
  for (const path of filesBelow(root).sort()) {
    const full = join(root, path);
    const s = statSync(full);
    files.push({ path, size: s.size, sha256: sha256Of(full), mtimeMs: s.mtimeMs });
  }
  return { version, ...(platform !== undefined && { platform }), files };
}

/** Put a finished scratch folder in place of the part's folder. */
function swap(scratch: string, root: string): void {
  rmSync(root, { recursive: true, force: true });
  renameSync(scratch, root);
}

const scratchFor = (root: string): string => `${root}.partial-${process.pid}`;

/** Remove the scratch folders of fetches cut short: those whose process no longer runs. */
function removeStaleScratch(root: string): void {
  const dir = dirname(root);
  const prefix = `${basename(root)}.partial-`;
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length));
    if (pid === process.pid || !Number.isInteger(pid) || !processAlive(pid))
      rmSync(join(dir, name), { recursive: true, force: true });
  }
}

async function checkFile(path: string, pin: FilePin): Promise<void> {
  if (!existsSync(path)) throw new Error(`${pin.path} is missing from what was fetched`);
  if (statSync(path).size !== pin.size || sha256Of(path) !== pin.sha256)
    throw new Error(`${pin.path} does not match its pinned checksum`);
}

/** The engine: three npm tarballs checked against their integrity, the files it runs kept, the platform's native ones checked. */
async function installEngine(home: string, download: Download, pins: Pins, platform: string): Promise<void> {
  const native = pins.engine.native[platform];
  if (native === undefined) throw new Error(`the search engine has no build for ${platform}`);
  const root = enginePath(home);
  const scratch = scratchFor(root);
  removeStaleScratch(root);
  try {
    const downloads = join(scratch, "downloads");
    for (const pkg of pins.engine.packages) {
      const tgz = join(downloads, `${pkg.name.replace("/", "+")}.tgz`);
      const { digest } = await fetchTo(download, pkg.url, tgz, "sha512", pkg.size);
      if (`sha512-${digest.toString("base64")}` !== pkg.integrity)
        throw new Error(`${pkg.name} ${pkg.version} does not match its pinned checksum`);
      const own = pkg.name === "onnxruntime-node" ? native.map((f) => f.path) : [];
      const into = join(scratch, "node_modules", pkg.name);
      await extractTgz(tgz, (name) => {
        const rel = name.replace(/^package\//, "");
        return name.startsWith("package/") && keeps(pkg, own, rel) ? below(into, rel) : undefined;
      });
    }
    rmSync(downloads, { recursive: true, force: true });
    for (const f of native) await checkFile(join(scratch, nativeRel(f.path)), f);
    // The engine imports an image library it never uses for text; a stand-in that refuses to load images.
    const sharp = join(scratch, "node_modules", "sharp");
    mkdirSync(sharp, { recursive: true });
    writeFileSync(
      join(sharp, "package.json"),
      `${JSON.stringify({ name: "sharp", version: "0.0.0", type: "module", exports: "./index.js" })}\n`,
    );
    writeFileSync(
      join(sharp, "index.js"),
      'export default function sharp() { throw new Error("Kioku loads no images"); }\n',
    );
    writeFileSync(
      join(scratch, "stamp.json"),
      `${JSON.stringify(await stampOf(scratch, pins.engine.version, platform), null, 2)}\n`,
    );
    swap(scratch, root);
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true });
    throw e;
  }
}

/** `rel` inside `root`; a name from an archive that would land outside it fails the fetch. */
function below(root: string, rel: string): string {
  const base = resolve(root);
  const dest = resolve(base, rel);
  if (!dest.startsWith(base + sep)) throw new Error(`${rel} would be written outside ${root}`);
  return dest;
}

const keeps = (pkg: PackagePin, own: string[], rel: string): boolean =>
  own.includes(rel) || pkg.keep.some((k) => (k.endsWith("/") ? rel.startsWith(k) : rel === k));

/** The model: each file from its pinned revision, checked against its pinned checksum. */
async function installModel(home: string, download: Download, pins: Pins): Promise<void> {
  const root = modelsPath(home);
  const scratch = scratchFor(root);
  removeStaleScratch(root);
  try {
    for (const f of pins.model.files) {
      const dest = join(scratch, pins.model.id, f.path);
      const { digest, size } = await fetchTo(download, pins.model.url(f.path), dest, "sha256", f.size);
      if (size !== f.size || digest.toString("hex") !== f.sha256)
        throw new Error(`${pins.model.id} ${f.path} does not match its pinned checksum`);
    }
    writeFileSync(join(scratch, "stamp.json"), `${JSON.stringify(await stampOf(scratch, pins.model.name), null, 2)}\n`);
    swap(scratch, root);
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true });
    throw e;
  }
}

export interface InstallOptions {
  download?: Download;
  pins?: Pins;
  platform?: string;
}

/** Fetch the parts named; throws with a reason fit for the person when one cannot be fetched or fails its checksum. */
export async function installSemantic(home: string, parts: Part[], o: InstallOptions = {}): Promise<void> {
  const download = o.download ?? httpDownload;
  const pins = o.pins ?? PINS;
  const platform = o.platform ?? currentPlatform();
  mkdirSync(join(home, ".kioku"), { recursive: true });
  if (parts.includes("engine")) await installEngine(home, download, pins, platform);
  if (parts.includes("model")) await installModel(home, download, pins);
}
