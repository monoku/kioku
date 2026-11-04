import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { writeAtomic } from "../fs/atomic.ts";

/**
 * Where the tool is installed (§6.3): one folder per version under `versions/`, `current` pointing at the active
 * one, and the launcher, a short script that runs `current`. The installer writes the first version and
 * `kioku update` the next ones (§6.4); nothing of the tool lives anywhere else, and `~/.kioku/` holds only state.
 */
export interface InstallDirs {
  /** `versions/` and `current` are here. */
  install: string;
  /** The launcher, `kioku`, is here. */
  bin: string;
}

/** `KIOKU_INSTALL_DIR` and `KIOKU_BIN_DIR`; else `$XDG_DATA_HOME/kioku` or `~/.local/share/kioku`, and `~/.local/bin`, under the person's home. */
export function installDirs(person: string, env: NodeJS.ProcessEnv): InstallDirs {
  const data = env.XDG_DATA_HOME?.trim() ? env.XDG_DATA_HOME : join(person, ".local", "share");
  return {
    install: env.KIOKU_INSTALL_DIR?.trim() || join(data, "kioku"),
    bin: env.KIOKU_BIN_DIR?.trim() || join(person, ".local", "bin"),
  };
}

export const versionsDir = (d: InstallDirs): string => join(d.install, "versions");
export const versionDir = (d: InstallDirs, version: string): string => join(versionsDir(d), version);
export const currentLink = (d: InstallDirs): string => join(d.install, "current");
/** The bundle the launcher runs. */
export const currentBundle = (d: InstallDirs): string => join(currentLink(d), "kioku.mjs");
export const launcherPath = (d: InstallDirs): string => join(d.bin, "kioku");
export const launcherScript = (d: InstallDirs): string =>
  `#!/bin/sh\n# Written by Kioku. Runs the active version, or the build KIOKU_BIN names when it is set.\n[ -n "\${KIOKU_BIN:-}" ] && exec "$KIOKU_BIN" "$@"\nexec node "${currentBundle(d)}" "$@"\n`;

/** How the tool on this machine was installed, which decides how it is updated (§6.4). */
export type InstallOrigin = "installer" | "homebrew" | "other";

/** A path with its links resolved, as far up as it exists: the bundle a process runs is always there, a folder may not be. */
function real(path: string): string {
  const p = resolve(path);
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(real(parent), basename(p));
  }
}

/**
 * How the bundle this process runs was installed (§6.4): `installer` when it lies under the installer's folder, where
 * the installer and `kioku update` put every version; `homebrew` when it lies in Homebrew's cellar; `other` for
 * anything else, a build a person runs from where they put it, and the tool run from source, which has no bundle.
 */
export function installOrigin(d: InstallDirs, bundle: string | undefined): InstallOrigin {
  if (bundle === undefined) return "other";
  const path = real(bundle);
  if (path.startsWith(`${real(d.install)}${sep}`)) return "installer";
  if (/\/(Cellar|opt)\/kioku\/|\/linuxbrew\//.test(path)) return "homebrew";
  return "other";
}

/** Where a version's plugin is, beside its bundle: a marketplace of one plugin (§6.2, §6.3). */
export const versionPluginDir = (d: InstallDirs, version: string): string => join(versionDir(d, version), "plugin");

/**
 * The folder a host reads the plugin from, beside the tool that runs (§6.2): one that does not move when the tool does.
 * The installer's `current/plugin`, which follows `current`; under Homebrew the formula's `opt` folder, not the
 * version's own in its cellar. Undefined for a tool installed any other way, which carries no plugin.
 */
export function pluginFolder(d: InstallDirs, origin: InstallOrigin, bundle: string | undefined): string | undefined {
  if (origin === "installer") return join(currentLink(d), "plugin");
  if (origin === "homebrew" && bundle !== undefined)
    return join(dirname(real(bundle).replace(/\/Cellar\/kioku\/[^/]+\//, "/opt/kioku/")), "plugin");
  return undefined;
}

/** The command that updates a tool installed some other way than by the installer; none known for `other`. */
export const managerCommand = (origin: Exclude<InstallOrigin, "installer">): string | undefined =>
  origin === "homebrew" ? "brew upgrade kioku" : undefined;

/** A version's numbers and its pre-release identifiers, build metadata dropped. */
export function versionParts(v: string): { numbers: number[]; pre: string[] } {
  const [core = "", ...rest] = v.split("+")[0]!.split("-");
  const pre = rest.join("-");
  return {
    numbers: core.split(".").map((n) => (/^\d+$/.test(n) ? Number(n) : 0)),
    pre: pre === "" ? [] : pre.split("."),
  };
}

/** Two pre-release identifiers: numbers by value and before words, words by text. */
function compareIdentifier(a: string, b: string): number {
  const x = /^\d+$/.test(a);
  const y = /^\d+$/.test(b);
  if (x && y) return Number(a) - Number(b);
  if (x !== y) return x ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether version `a` is newer than `b`, as semantic versioning orders them (§6.4), the pre-release part a build of its
 * own may carry included: `0.0.0-dev` < `1.2.0-dev.1` < `1.2.0-dev.2` < `1.2.0`.
 */
export function newerThan(a: string, b: string): boolean {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.numbers.length, y.numbers.length); i++) {
    const d = (x.numbers[i] ?? 0) - (y.numbers[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  // The same numbers: a version without a pre-release part comes after one with it.
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === 0 && y.pre.length > 0;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const d = compareIdentifier(x.pre[i]!, y.pre[i]!);
    if (d !== 0) return d > 0;
  }
  return x.pre.length > y.pre.length;
}

/** The versions installed, newest first: each a folder under `versions/` that holds a bundle. */
export function installedVersions(d: InstallDirs): string[] {
  if (!existsSync(versionsDir(d))) return [];
  return readdirSync(versionsDir(d))
    .filter((v) => !v.startsWith(".") && existsSync(join(versionDir(d, v), "kioku.mjs")))
    .sort((a, b) => (newerThan(a, b) ? -1 : newerThan(b, a) ? 1 : 0));
}

/** The version `current` points at, when it holds a bundle. */
export function currentVersion(d: InstallDirs): string | undefined {
  try {
    const version = basename(readlinkSync(currentLink(d)));
    return existsSync(join(versionDir(d, version), "kioku.mjs")) ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Put a bundle under `versions/<version>/`. Nothing is written when the same bytes are already there. */
export function installVersion(d: InstallDirs, version: string, bundle: string | Buffer): boolean {
  const dest = join(versionDir(d, version), "kioku.mjs");
  const bytes = typeof bundle === "string" ? readFileSync(bundle) : bundle;
  if (existsSync(dest) && readFileSync(dest).equals(bytes)) return false;
  mkdirSync(versionDir(d, version), { recursive: true });
  writeAtomic(dest, bytes);
  return true;
}

/** Point `current` at a version: a new link beside it, renamed into place, so a call in flight sees the old one or the new. */
export function activate(d: InstallDirs, version: string): boolean {
  if (currentVersion(d) === version) return false;
  const tmp = join(d.install, `.current.${process.pid}`);
  rmSync(tmp, { force: true });
  symlinkSync(join("versions", version), tmp);
  renameSync(tmp, currentLink(d));
  return true;
}

/** Remove the versions beyond the newest `keep`, never the active one; what was removed. */
export function prune(d: InstallDirs, keep = 2): string[] {
  const active = currentVersion(d);
  const removed: string[] = [];
  for (const v of installedVersions(d).slice(keep)) {
    if (v === active) continue;
    rmSync(versionDir(d, v), { recursive: true, force: true });
    removed.push(v);
  }
  return removed;
}

export type LauncherStatus = "installed" | "updated" | "current";

/** Whether the launcher is there, is this text and runs. */
function launcherOk(d: InstallDirs): boolean {
  const path = launcherPath(d);
  try {
    return readFileSync(path, "utf8") === launcherScript(d) && (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Write the launcher when it is missing, is another text or does not run. */
export function ensureLauncher(d: InstallDirs): { status: LauncherStatus; path: string } {
  const path = launcherPath(d);
  if (launcherOk(d)) return { status: "current", path };
  const had = existsSync(path);
  mkdirSync(d.bin, { recursive: true });
  writeAtomic(path, launcherScript(d));
  chmodSync(path, 0o755);
  return { status: had ? "updated" : "installed", path };
}

/** Whether `kioku` resolves from this PATH: the launcher's folder is on it, or some entry holds an executable of that name. */
export function onPath(d: InstallDirs, pathVar: string | undefined): boolean {
  return (pathVar ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => {
      if (dir === d.bin) return true;
      try {
        return (statSync(join(dir, "kioku")).mode & 0o111) !== 0;
      } catch {
        return false;
      }
    });
}

/** The absolute path of an executable `name` on this PATH, when there is one. */
export function whichOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile() && (statSync(candidate).mode & 0o111) !== 0) return candidate;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

/** The line that puts the launcher's folder on the PATH of a shell. */
export const pathLine = (d: InstallDirs): string => `export PATH="${d.bin}:$PATH"`;

/** The version a bundle says it is, by running it; a file that is not a Kioku bundle answers nothing. */
export function bundleVersion(file: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [file, "--version", "--json"],
      { timeout: 20_000, encoding: "utf8" },
      (error, stdout) => {
        if (error) return resolve(undefined);
        try {
          const answer = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as { version?: unknown };
          resolve(typeof answer.version === "string" && answer.version !== "" ? answer.version : undefined);
        } catch {
          resolve(undefined);
        }
      },
    );
  });
}
