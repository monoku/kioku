import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { environmentError, KiokuError, userError } from "./errors.ts";
import { writeAtomic } from "./fs/atomic.ts";

export interface GitOptions {
  /** Kill git after this long; a hung network must not hold a process forever. */
  timeoutMs?: number;
  /** Variables added to the environment, such as those that forbid git from asking for credentials. */
  env?: Record<string, string>;
  /** Configuration for this one call, as `-c key=value`: what git's own environment variables still override. */
  config?: Record<string, string>;
}

/** The most output git may answer with: a brain's whole history by name (`lastTouched`) runs past Node's 1 MiB. */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** Runs git and returns its standard output, trimmed. A failure carries git's own message. */
export function git(cwd: string | undefined, args: string[], options: GitOptions = {}): string {
  // What git was asked to do, for the error: the verb after any `-c key=value` of the call's own.
  const verb = args.find((a, i) => a !== "-c" && args[i - 1] !== "-c") ?? args[0];
  try {
    const config = Object.entries(options.config ?? {}).flatMap(([k, v]) => ["-c", `${k}=${v}`]);
    return execFileSync("git", [...(cwd ? ["-C", cwd] : []), ...config, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: GIT_MAX_BUFFER,
      ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs, killSignal: "SIGKILL" as const }),
      // The environment the process was given, passed on as it is, with what this call adds.
      ...(options.env !== undefined && { env: { ...process.env, ...options.env } }),
    }).trim();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") throw environmentError("git is not installed or not on PATH");
    if (err.code === "ENOBUFS")
      throw environmentError(
        `git ${verb} answered more than ${GIT_MAX_BUFFER / 1024 / 1024} MiB`,
        "git_output_too_large",
      );
    if (err.code === "ETIMEDOUT")
      throw userError(`git ${verb} did not finish in ${Math.round((options.timeoutMs ?? 0) / 1000)} s`);
    throw userError(`git ${verb} failed: ${(err.stderr ?? err.message).toString().trim()}`);
  }
}

/**
 * `-c` arguments that give git an author when the machine has none configured, so a commit made from a hook does
 * not fail for want of an identity: the person's user, at no host, since a brain made here may never be published
 * anywhere (§2.3). Empty when git already knows who the person is.
 */
function identityArgs(user: string, cwd: string): string[] {
  const has = (key: string) => gitQuiet(cwd, ["config", "--get", key]) !== undefined;
  return has("user.name") && has("user.email") ? [] : ["-c", `user.name=${user}`, "-c", `user.email=${user}@localhost`];
}

/**
 * The output of a git command that may fail harmlessly (no remote, not a repository). Output too large to read is
 * not such a failure: it would pass for an empty answer, so it is thrown.
 */
export function gitQuiet(cwd: string, args: string[], options: GitOptions = {}): string | undefined {
  try {
    return git(cwd, args, options) || undefined;
  } catch (e) {
    if (e instanceof KiokuError && e.code === "git_output_too_large") throw e;
    return undefined;
  }
}

/** A file a command writes in a repository, with what it held before; `before` is undefined for a file it creates. */
export interface Change {
  rel: string;
  before: string | undefined;
}

/** The trailer that says how a write arrived (§1.6). */
export const VIA_TRAILER = "Kioku-Via";
const VIA_VALUE = /^[a-z][a-z0-9-]*$/;

/** `message` with the `Kioku-Via` trailer after a blank line; the message alone when `via` is absent or not a plain word. */
const withVia = (message: string, via: string | undefined): string =>
  via !== undefined && VIA_VALUE.test(via) ? `${message}\n\n${VIA_TRAILER}: ${via}` : message;

/**
 * Commit exactly these paths, as `author` when git on this machine knows no one, and return the short hash. When the
 * commit fails each path is unstaged and put back as it was, a created file removed: a change that is not committed
 * would not travel with the brain.
 */
export function commitOrRestore(
  repo: string,
  message: string,
  changes: Change[],
  o: { via?: string | undefined; author?: string | (() => string | undefined) | undefined } = {},
): string {
  const paths = changes.map((c) => c.rel);
  const commit = (identity: string[], options: GitOptions = {}) =>
    git(repo, [...identity, "commit", "-q", "-m", withVia(message, o.via), "--", ...paths], options);
  try {
    git(repo, ["add", "--", ...paths]);
    if (o.author === undefined) commit([]);
    else {
      try {
        // A machine with no git identity still commits, as the person's user (§6.3), never as a name git guesses from
        // the host. Nearly every machine knows the person, so git is asked who only when it refuses; and a commit it
        // refused for want of a name made nothing, so the second is the only one.
        commit([], { config: { "user.useConfigOnly": "true" } });
      } catch (e) {
        const author = typeof o.author === "function" ? o.author() : o.author;
        const identity = author === undefined ? [] : identityArgs(author, repo);
        if (identity.length === 0) throw e;
        commit(identity);
      }
    }
  } catch (e) {
    gitQuiet(repo, ["reset", "-q", "--", ...paths]);
    for (const c of changes) {
      if (c.before === undefined) rmSync(join(repo, c.rel), { force: true });
      else writeAtomic(join(repo, c.rel), c.before);
    }
    throw e;
  }
  return git(repo, ["rev-parse", "--short", "HEAD"]);
}
