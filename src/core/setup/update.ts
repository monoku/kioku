import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { PRODUCT_REPO } from "../../product.ts";
import { environmentError } from "../errors.ts";
import type { Download } from "../semantic/install.ts";
import { sha256Of } from "../semantic/status.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { updateStatePath } from "../state.ts";
import {
  activate,
  bundleVersion,
  currentBundle,
  currentVersion,
  ensureLauncher,
  installVersion,
  newerThan,
  prune,
  versionDir,
  versionPluginDir,
  versionsDir,
  type InstallDirs,
} from "./install.ts";
import { currentSteps } from "../steps.ts";
import { readJson } from "../util.ts";

/**
 * Bringing a machine to the latest release, and never back (§6.4): the release's checksum first, the bundle only
 * when it differs from the installed one, checked against the checksum before anything is written. A failure changes
 * nothing.
 */

/** Where the releases are: the product repository's (§6.1). `KIOKU_RELEASES_URL` moves them for the tests; it is not documented and not for people. */
export const releasesUrl = (env: NodeJS.ProcessEnv): string =>
  (env.KIOKU_RELEASES_URL?.trim() || `https://${PRODUCT_REPO}/releases`).replace(/\/+$/, "");
/** Where the latest release's assets are. */
const latestAssets = (releases: string): string => `${releases}/latest/download`;
/** Where one version's assets are: its tag's release. */
const versionAssets = (releases: string, version: string): string => `${releases}/download/v${version}`;

/** A version a release can have: `<major>.<minor>.<patch>` (§6.4). */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/** How often a session looks for a new version: once a day (§6.4). */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * What the machine keeps about updates, in `~/.kioku/update.json` and in no brain (§6.4): when a new version was last
 * looked for, and the newer version that look found, until a session has said it.
 */
export interface UpdateState {
  checked?: string;
  available?: string;
}

export function readUpdateState(home: string): UpdateState {
  const raw = readJson<Record<string, unknown> | null>(updateStatePath(home));
  if (raw === undefined || raw === null) return {};
  const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  return {
    ...(text(raw.checked) !== undefined && { checked: text(raw.checked)! }),
    ...(text(raw.available) !== undefined && { available: text(raw.available)! }),
  };
}

/** Change the state: `change` gets what is there and returns the new state. */
export function updateUpdateState(home: string, change: (s: UpdateState) => UpdateState): void {
  mkdirSync(dirname(updateStatePath(home)), { recursive: true });
  writeAtomic(updateStatePath(home), `${JSON.stringify(change(readUpdateState(home)))}\n`);
}

/** When a new version was last looked for, from any session or `kioku update`; undefined when never. */
export function lastCheck(home: string): Date | undefined {
  const when = readUpdateState(home).checked;
  const date = when === undefined ? undefined : new Date(when);
  return date !== undefined && !Number.isNaN(date.getTime()) ? date : undefined;
}

/** Whether a day has passed since the last look (or there was none). */
export const dueForCheck = (home: string, now: Date): boolean => {
  const last = lastCheck(home);
  return last === undefined || now.getTime() - last.getTime() >= CHECK_EVERY_MS;
};

/** Note that a new version was looked for now, so no other session looks again today. */
export function recordCheck(home: string, now: Date): void {
  updateUpdateState(home, (s) => ({ ...s, checked: now.toISOString() }));
}

/** The newer version a look found, or none: what the next session says (§6.4). */
export function recordAvailable(home: string, version: string | undefined): void {
  updateUpdateState(home, ({ available: _, ...s }) => ({ ...s, ...(version !== undefined && { available: version }) }));
}

/** The newer version the last look found, once: returned and forgotten, so a session says it once per look (§6.4). */
export function takeAvailable(home: string): string | undefined {
  const { available } = readUpdateState(home);
  if (available !== undefined) recordAvailable(home, undefined);
  return available;
}

/** A bundle larger than this is not one of ours. */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface UpdateOutcome {
  /** `current`: nothing newer; `available`: a newer version, not installed (`--check`, `--dry-run`); `updated`: installed and active. */
  status: "current" | "available" | "updated";
  /** The version installed, or that would be; the one active when nothing is. */
  version: string | null;
  /** The latest release's version, when it is older than the one active and so was not installed. */
  latest?: string;
  /** The version that was active before. */
  was: string | null;
  /** Whether a bundle was written. */
  installed: boolean;
  /** Versions removed. */
  pruned: string[];
  dryRun: boolean;
}

async function fetchText(download: Download, url: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of await download(url)) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The bundle a release carries, and the plugin of each agent host beside it, as a marketplace of its own (§6.2, §6.4). */
const BUNDLE = "kioku.mjs";
export const PLUGIN_ARCHIVE = "kioku-plugin.tar.gz";

/** The checksum a release publishes for one asset, `<sha256>  <asset>`; `which` names the release in an error. */
async function releaseChecksum(
  download: Download,
  base: string,
  which = "the latest release",
  asset = BUNDLE,
): Promise<string> {
  let body: string;
  try {
    body = await fetchText(download, `${base}/${asset}.sha256`);
  } catch (e) {
    throw environmentError(
      `could not fetch ${which} (${e instanceof Error ? e.message : String(e)}); nothing was changed`,
      "update_failed",
    );
  }
  const sha = body.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/.test(sha))
    throw environmentError(`${base}/${asset}.sha256 does not hold a checksum; nothing was changed`, "update_failed");
  return sha;
}

/** Fetch one asset into a scratch file under `versions/`, hashing it on the way; removed when it does not match `sha`. */
async function fetchAsset(
  download: Download,
  base: string,
  d: InstallDirs,
  sha: string,
  which = "the latest release",
  asset = BUNDLE,
): Promise<string> {
  mkdirSync(versionsDir(d), { recursive: true });
  const scratch = join(versionsDir(d), `.download-${process.pid}-${asset}`);
  const hash = createHash("sha256");
  const fd = openSync(scratch, "w");
  let size = 0;
  try {
    for await (const chunk of await download(`${base}/${asset}`)) {
      if (size + chunk.length > MAX_BUNDLE_BYTES) throw new Error("the download is larger than an asset can be");
      hash.update(chunk);
      writeSync(fd, chunk);
      size += chunk.length;
    }
  } catch (e) {
    closeSync(fd);
    rmSync(scratch, { force: true });
    throw environmentError(
      `could not fetch ${which} (${e instanceof Error ? e.message : String(e)}); nothing was changed`,
      "update_failed",
    );
  }
  closeSync(fd);
  if (hash.digest("hex") !== sha) {
    rmSync(scratch, { force: true });
    throw environmentError("the download does not match its checksum; nothing was changed", "update_failed");
  }
  return scratch;
}

/**
 * Put a version's plugin beside its bundle, `versions/<version>/plugin/` (§6.2, §6.3), before `current` moves to it,
 * so `current/plugin` is always a plugin: from the release's `archive`, unpacked beside the folder and then moved in.
 */
async function placePlugin(d: InstallDirs, version: string, archive: string): Promise<void> {
  const dest = versionPluginDir(d, version);
  // Loaded only here: a hook that reads the update's state never unpacks anything.
  const { extractTgz } = await import("../semantic/tar.ts");
  const scratch = join(versionDir(d, version), `.plugin-${process.pid}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    await extractTgz(archive, (name) => {
      const path = name.replace(/^\.\//, "");
      const parts = path.split("/");
      return path === "" || isAbsolute(path) || parts.some((p) => p === "" || p === "." || p === "..")
        ? undefined
        : join(scratch, ...parts);
    });
    if (!existsSync(join(scratch, ".claude-plugin", "marketplace.json")))
      throw new Error("it holds no .claude-plugin/marketplace.json");
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true });
    throw environmentError(
      `the plugin's archive is not one (${e instanceof Error ? e.message : String(e)}); nothing was changed`,
      "update_failed",
    );
  }
  rmSync(dest, { recursive: true, force: true });
  renameSync(scratch, dest);
}

/** Put a bundle in place as `version`, make it current, make sure the launcher runs it, and prune. */
export function installBundle(
  d: InstallDirs,
  version: string,
  file: string,
): Pick<UpdateOutcome, "status" | "version" | "installed" | "pruned"> {
  const installed = installVersion(d, version, file);
  const activated = activate(d, version);
  ensureLauncher(d);
  const pruned = prune(d);
  return { status: installed || activated ? "updated" : "current", version, installed, pruned };
}

/**
 * A release: the latest, installed only when it is newer than the version active (§6.4), or the one `version` names,
 * installed whichever it is; or only looked at (`check`: is there one; `dry-run`: what would be done).
 */
export async function updateFromRelease(
  d: InstallDirs,
  download: Download,
  releases: string,
  mode: "install" | "check" | "dry-run",
  version?: string,
): Promise<UpdateOutcome> {
  const was = currentVersion(d) ?? null;
  const base = version === undefined ? latestAssets(releases) : versionAssets(releases, version);
  const which = version === undefined ? "the latest release" : `the release of ${version}`;
  const steps = currentSteps();
  const sha = await steps.runAsync(
    { doing: `Looking at ${which}`, done: `Looked at ${which}`, direction: "down" },
    () => releaseChecksum(download, base, which),
  );
  const have = existsSync(currentBundle(d)) ? sha256Of(currentBundle(d)) : undefined;
  const dryRun = mode !== "install";
  if (have === sha) return { status: "current", version: was, was, installed: false, pruned: [], dryRun };
  const scratch = await steps.runAsync(
    {
      doing: `Downloading ${which}`,
      done: `Downloaded ${which} and checked it against its checksum`,
      direction: "down",
    },
    () => fetchAsset(download, base, d, sha, which),
  );
  try {
    const found = await bundleVersion(scratch);
    if (found === undefined)
      throw environmentError("the download is not a Kioku bundle; nothing was changed", "update_failed");
    if (version !== undefined && found !== version)
      throw environmentError(`${which} holds ${found}, not ${version}; nothing was changed`, "update_failed");
    // The latest release takes a machine forward only: one on a build of its own newer than the latest stays there.
    if (version === undefined && was !== null && !newerThan(found, was))
      return { status: "current", version: was, latest: found, was, installed: false, pruned: [], dryRun };
    if (dryRun) return { status: "available", version: found, was, installed: false, pruned: [], dryRun };
    // The plugin travels with the bundle, checked as it is, and is in place before `current` moves (§6.2, §6.4).
    const archive = await steps.runAsync(
      {
        doing: `Downloading the plugin of ${which}`,
        done: `Downloaded the plugin of ${which} and checked it against its checksum`,
        direction: "down",
      },
      async () =>
        fetchAsset(
          download,
          base,
          d,
          await releaseChecksum(download, base, which, PLUGIN_ARCHIVE),
          which,
          PLUGIN_ARCHIVE,
        ),
    );
    try {
      await placePlugin(d, found, archive);
    } finally {
      rmSync(archive, { force: true });
    }
    return { ...installBundle(d, found, scratch), was, dryRun };
  } finally {
    rmSync(scratch, { force: true });
  }
}
