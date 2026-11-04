import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { launcherPath, onPath, type InstallDirs } from "./install.ts";

/**
 * Putting `kioku` on the person's PATH (§6.3): a link in a folder already on it when there is one,
 * the profile of the person's shell when there is not. The plan is made first and applied after, so `--dry-run` shows
 * exactly what a run would do.
 */
export const SHELLS = ["fish", "zsh", "bash"] as const;
export type Shell = (typeof SHELLS)[number];

/** What marks the lines Kioku writes into a profile, so they are written once. */
const MARK = "# kioku";

/** Folders a version manager rewrites: a link put there would go with its next update. */
const MANAGED = /\/(mise|asdf|nvm|volta|rbenv|pyenv|rtx|fnm)\/|\/shims\/?$|\/node_modules\/\.bin\/?$/;

export interface PathPlan {
  action: "linked" | "profile" | "already" | "unavailable";
  /** The link, or the first profile file. */
  target?: string;
  /** Every file written, for a profile. */
  files: string[];
  /** Folders of the PATH that were candidates and had another `kioku`, or could not be used. */
  skipped: { path: string; reason: string }[];
  /** Why nothing could be done, or the line to add by hand. */
  line?: string;
  reason?: string;
}

export interface PathEnv {
  /** Where the tool is installed: the launcher is `<bin>/kioku`. */
  dirs: InstallDirs;
  /** The person's home: `~/.local/bin` and the shells' profiles are there, even when `KIOKU_HOME` moves Kioku's. */
  person: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** The shell `$SHELL` names, when the tool knows it. */
export function shellOf(env: NodeJS.ProcessEnv): Shell | undefined {
  const name = basename(env.SHELL ?? "");
  return (SHELLS as readonly string[]).includes(name) ? (name as Shell) : undefined;
}

/** The line that puts the launcher's folder on the PATH of `shell`. */
export function lineFor(shell: Shell | undefined, dirs: InstallDirs): string {
  return shell === "fish" ? `fish_add_path --global "${dirs.bin}"` : `export PATH="${dirs.bin}:$PATH"`;
}

/** The file a shell reads for this: fish's own `conf.d` file, so no file of the person's is edited. */
export function profilesOf(shell: Shell, e: PathEnv): string[] {
  if (shell === "fish")
    return [join(e.env.XDG_CONFIG_HOME ?? join(e.person, ".config"), "fish", "conf.d", "kioku.fish")];
  if (shell === "zsh") return [join(e.env.ZDOTDIR ?? e.person, ".zshrc")];
  // A macOS login shell of bash reads `.bash_profile` and not `.bashrc`.
  const profile = join(e.person, ".bash_profile");
  return [
    join(e.person, ".bashrc"),
    ...((e.platform ?? process.platform) === "darwin" || existsSync(profile) ? [profile] : []),
  ];
}

/** Whether `path` is a link to the launcher. */
function isLauncher(path: string, launcher: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && join(dirname(path), readlinkSync(path)) === launcher;
  } catch {
    return false;
  }
}

/** A folder where a link would work: it exists, is the person's, is writable and is not a version manager's. */
function usable(dir: string): string | undefined {
  if (!isAbsolute(dir) || MANAGED.test(`${dir}/`)) return "a version manager's folder";
  try {
    if (!statSync(dir).isDirectory()) return "not a folder";
    const mine = typeof process.getuid !== "function" || statSync(dir).uid === process.getuid();
    if (!mine) return "not yours";
    accessSync(dir, constants.W_OK);
  } catch {
    return "not writable";
  }
  return undefined;
}

/** What to do, from the PATH the command was run with. Writes nothing. */
export function planPath(e: PathEnv, opts: { shell?: Shell | "all" } = {}): PathPlan {
  const launcher = launcherPath(e.dirs);
  const base = { files: [] as string[], skipped: [] as PathPlan["skipped"] };
  if (onPath(e.dirs, e.env.PATH)) return { ...base, action: "already" };
  if (!existsSync(launcher)) {
    return {
      ...base,
      action: "unavailable",
      reason: `the launcher ${launcher} is not installed: run the installer`,
    };
  }

  const onIt = (e.env.PATH ?? "").split(delimiter).filter(Boolean);
  const preferred = [join(e.person, ".local", "bin"), join(e.person, "bin")].filter((d) => onIt.includes(d));
  const others = onIt.filter((d) => !preferred.includes(d));
  for (const dir of [...preferred, ...others]) {
    const unusable = usable(dir);
    if (unusable !== undefined) {
      // Only a person's own folders are worth naming: the rest of a PATH is system folders.
      if (preferred.includes(dir)) base.skipped.push({ path: dir, reason: unusable });
      continue;
    }
    const link = join(dir, "kioku");
    if (existsSync(link) || isSymlink(link)) {
      if (!isLauncher(link, launcher)) base.skipped.push({ path: link, reason: "another `kioku` is there" });
      continue;
    }
    return { ...base, action: "linked", target: link };
  }

  const shells: Shell[] =
    opts.shell === "all"
      ? [...SHELLS]
      : opts.shell !== undefined
        ? [opts.shell]
        : shellOf(e.env)
          ? [shellOf(e.env)!]
          : [];
  if (shells.length === 0) {
    return {
      ...base,
      action: "unavailable",
      line: lineFor(undefined, e.dirs),
      reason:
        "no folder of the PATH can take a link and the shell is not one the tool knows (fish, zsh, bash): add the line to your shell's profile",
    };
  }
  const files = shells.flatMap((s) => profilesOf(s, e));
  return { ...base, action: "profile", target: files[0]!, files };
}

const isSymlink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Do what the plan says. A profile that already holds the line is left as it is. */
export function applyPath(plan: PathPlan, e: PathEnv, opts: { shell?: Shell | "all" } = {}): PathPlan {
  if (plan.action === "linked" && plan.target !== undefined) {
    symlinkSync(launcherPath(e.dirs), plan.target);
    return plan;
  }
  if (plan.action !== "profile") return plan;
  const shells: Shell[] =
    opts.shell === "all"
      ? [...SHELLS]
      : opts.shell !== undefined
        ? [opts.shell]
        : shellOf(e.env)
          ? [shellOf(e.env)!]
          : [];
  const written: string[] = [];
  for (const shell of shells) {
    for (const file of profilesOf(shell, e)) {
      mkdirSync(dirname(file), { recursive: true });
      const have = existsSync(file) ? readFileSync(file, "utf8") : "";
      if (have.includes(e.dirs.bin)) continue;
      const block = `${MARK}\n${lineFor(shell, e.dirs)}\n`;
      if (shell === "fish") writeFileSync(file, block);
      else appendFileSync(file, `${have === "" || have.endsWith("\n") ? "" : "\n"}${block}`);
      written.push(file);
    }
  }
  return { ...plan, files: written, target: written[0] ?? plan.target };
}
