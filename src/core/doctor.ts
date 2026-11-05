import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { knownBrains } from "./brains/list.ts";
import { brainFolder, brainRepoOfKey, parseName } from "./config/brain-ref.ts";
import { resolveChain, trustCommand, trustOwnerCommand } from "./config/chain.ts";
import { NEWER_THAN_READ, NEWEST_FORMAT } from "./brain/brain.ts";
import { readFolderConfig } from "./config/folder-config.ts";
import { configPath, readMachineConfig, mutes, remindsUnpublished, type MachineConfig } from "./config/machine.ts";
import { gitQuiet } from "./git.ts";
import { SCHEMA_VERSION } from "./index/db.ts";
import { allHarnesses, pluginBehind, type Harness, type MarketplaceSource } from "../harness/index.ts";
import {
  currentVersion,
  installDirs,
  launcherPath,
  managerCommand,
  onPath,
  type InstallDirs,
  type InstallOrigin,
} from "./setup/install.ts";
import { lastCheck } from "./setup/update.ts";
import { INSTALL_COMMAND } from "../product.ts";
import { VERSION } from "../version.ts";
import { lineFor, shellOf } from "./setup/path.ts";
import { coverageOf } from "./index/coverage.ts";
import { INLINE_EMBED_MAX } from "./index/hybrid.ts";
import { currentPlatform, downloadMB, PINS, type Pins } from "./semantic/pins.ts";
import { isStale, readOwner } from "./fs/lock.ts";
import { configuredMode, readSemanticState, semanticStatus, verifySemantic } from "./semantic/status.ts";
import { indexPath, syncLockPath, syncStatePath } from "./state.ts";
import { readPending } from "./write/pending.ts";
import { NON_INTERACTIVE } from "./write/publish.ts";
import { currentSteps } from "./steps.ts";
import { readJson } from "./util.ts";

/** `ok`: fine. `warn`: optional, or pending work; reported without failing. `missing`: required; it fails the exit code. */
export type State = "ok" | "warn" | "missing";

export interface Check {
  name: string;
  state: State;
  detail: string;
  /** What to do about it, when it is not fine. */
  fix?: string;
}

export interface DoctorReport {
  /** Nothing required is missing. */
  ok: boolean;
  checks: Check[];
}

export const REQUIRED_NODE_MAJOR = 24;

/** What the checks read from the machine, given so a test can stand in for it. */
export interface DoctorEnv {
  home: string;
  /** `process.versions.node`. */
  node: string;
  /** The PATH the launcher must be found on. */
  pathVar: string | undefined;
  /** What `git --version` prints, or undefined when git is not installed. */
  gitVersion: () => string | undefined;
  /** Whether the remote of a clone answers, without prompting. */
  remoteAnswers: (clone: string) => boolean;
  /** The tool's version a host's plugin is held to (§6.2); the one `current` runs, else this build's, when absent. */
  tool?: string;
  /** The agents to check; every adapter, as the machine's environment configures it, when absent. */
  harnesses?: Harness[];
  /** The folder doctor runs in, whose project settings may allow what the person's do not. */
  cwd?: string;
  /** The environment git's identity variables are read from. */
  env?: NodeJS.ProcessEnv;
  /** The person's home, where the tool is installed and the agent keeps its settings; `home` when absent. */
  hostHome?: string;
  /** How the tool running was installed (§6.4); `other` when absent. */
  origin?: InstallOrigin;
  /** The folder beside the tool that holds its plugin (§6.2); absent for a tool that carries none. */
  pluginFolder?: string;
  /** The pinned engine and model, and this machine's platform; a test stands in its own. */
  semantic?: { pins: Pins; platform: string };
}

export function realDoctorEnv(
  home: string,
  pathVar: string | undefined,
  cwd: string,
  harnesses?: Harness[],
  env: NodeJS.ProcessEnv = {},
  hostHome?: string,
): DoctorEnv {
  return {
    home,
    pathVar,
    cwd,
    env,
    ...(hostHome !== undefined && { hostHome }),
    ...(harnesses !== undefined && { harnesses }),
    node: process.versions.node,
    gitVersion: () => {
      try {
        return execFileSync("git", ["--version"], {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .trim()
          .replace(/^git version /, "");
      } catch {
        return undefined;
      }
    },
    remoteAnswers: (clone) =>
      gitQuiet(clone, ["ls-remote", "-q", "origin", "HEAD"], { ...NON_INTERACTIVE, timeoutMs: 20_000 }) !== undefined ||
      gitQuiet(clone, ["ls-remote", "-q", "origin"], { ...NON_INTERACTIVE, timeoutMs: 20_000 }) !== undefined,
  };
}

const ok = (name: string, detail: string): Check => ({ name, state: "ok", detail });
const warn = (name: string, detail: string, fix: string): Check => ({ name, state: "warn", detail, fix });
const missing = (name: string, detail: string, fix: string): Check => ({ name, state: "missing", detail, fix });

function nodeCheck(env: DoctorEnv): Check {
  const major = Number(env.node.split(".")[0]);
  return major >= REQUIRED_NODE_MAJOR
    ? ok("node", `${env.node}`)
    : missing(
        "node",
        `${env.node}; ${REQUIRED_NODE_MAJOR} or later is needed`,
        `install Node ${REQUIRED_NODE_MAJOR} or later (https://nodejs.org, or a version manager such as mise or nvm)`,
      );
}

function gitChecks(env: DoctorEnv, config: MachineConfig | undefined): Check[] {
  const version = env.gitVersion();
  if (version === undefined)
    return [missing("git", "not found on PATH", "install git (https://git-scm.com/downloads)")];
  // Who commits would carry, as git takes it: its configuration, or the variables that override it.
  const where = env.cwd ?? env.home;
  const name = env.env?.GIT_AUTHOR_NAME ?? gitQuiet(where, ["config", "--get", "user.name"]);
  const email = env.env?.GIT_AUTHOR_EMAIL ?? gitQuiet(where, ["config", "--get", "user.email"]) ?? env.env?.EMAIL;
  const identity = name !== undefined && email !== undefined ? `${name} <${email}>` : undefined;
  const checks = [ok("git", version)];
  if (identity === undefined) {
    checks.push(
      missing(
        "git identity",
        "git has no user.name and user.email; commits would fail",
        'git config --global user.name "Your Name" && git config --global user.email you@example.com',
      ),
    );
    return checks;
  }
  checks.push(ok("git identity", identity));
  return checks;
}

function brainChecks(env: DoctorEnv, config: MachineConfig): Check[] {
  const checks: Check[] = [];
  if (config.brain === undefined) {
    // The name is the person's to give, never worked out (§2.3).
    checks.push(
      warn(
        "personal brain",
        "none: nothing personal is saved on this machine",
        "`kioku brain create <owner>/<repo>` makes yours on this machine, named as you like; `kioku brain clone <address>` brings it from its repository",
      ),
    );
  } else {
    const path = brainFolder(env.home, parseName(config.brain)!);
    const found = readFolderConfig(join(path, "kioku.yaml"));
    checks.push(
      found.ok && found.value.form === "brain" && found.value.tier === "personal"
        ? ok("personal brain", `${config.brain} at ${path}`)
        : missing(
            "personal brain",
            `${config.brain} is registered but not at ${path}`,
            config.repositories[config.brain] !== undefined
              ? `run \`kioku brain clone ${config.repositories[config.brain]}\``
              : "it had no remote, so it is gone; `kioku brain create <owner>/<repo>` makes another",
          ),
    );
  }
  // The person's own team, where a project names none (§2.4): said when it is set, as the personal brain is.
  if (config.team !== undefined) {
    const path = brainFolder(env.home, parseName(config.team)!);
    const found = readFolderConfig(join(path, "kioku.yaml"));
    checks.push(
      found.ok && found.value.form === "brain" && found.value.tier === "team"
        ? ok("team brain", `${config.team} at ${path}, where a project names no team`)
        : missing(
            "team brain",
            `${config.team} is this machine's team but not a team brain at ${path}`,
            config.repositories[config.team] !== undefined
              ? `run \`kioku brain clone ${config.repositories[config.team]}\`, or \`kioku config unset team\``
              : "`kioku config unset team`",
          ),
    );
  }
  for (const b of knownBrains(env.home)) {
    const name = `brain ${brainRepoOfKey(b.key)}`;
    if (!b.onDisk) {
      checks.push(
        warn(
          name,
          `${brainRepoOfKey(b.key)} is not on this machine (${b.folder})`,
          "kioku sync clones it the next time a session opens in a repository that uses it",
        ),
      );
      continue;
    }
    const declared = readFolderConfig(join(b.folder, "kioku.yaml"));
    if (declared.ok && declared.value.form === "brain" && declared.value.format > NEWEST_FORMAT) {
      checks.push(
        warn(
          `${name} format`,
          `${b.folder} is in format ${declared.value.format}, ${NEWER_THAN_READ}: it is read, never written`,
          "kioku update installs a version that reads it",
        ),
      );
    }
    // A brain of an older format is read and written as it is; raising it is one commit (§3.2, `format-behind`).
    if (declared.ok && declared.value.form === "brain" && declared.value.format < NEWEST_FORMAT) {
      checks.push(
        warn(
          `${name} format`,
          `${b.folder} is in format ${declared.value.format}; this version writes ${NEWEST_FORMAT}`,
          declared.value.tier === "personal"
            ? `\`kioku brain upgrade ${b.key}\` raises it, in one commit`
            : `once your teammates run a version that reads format ${NEWEST_FORMAT}, \`kioku brain upgrade ${b.key}\` raises it; until then it is fine as it is`,
        ),
      );
    }
    if (b.remote === undefined) {
      // A brain with no remote is never looked for on a git host (§2.5); whether it is a warning is the person's (§2.3).
      const detail = `${b.folder}, no remote: it lives only on this machine`;
      checks.push(
        !remindsUnpublished(config)
          ? ok(name, detail)
          : warn(
              name,
              detail,
              `kioku brain publish ${brainRepoOfKey(b.key)} --remote <address> puts it in an empty repository you make, and a second machine clones it; kioku config set display.mute +unpublished if it is to stay here`,
            ),
      );
      continue;
    }
    const clone = gitQuiet(b.folder, ["rev-parse", "--show-toplevel"]) ?? b.folder;
    const answers = currentSteps().run(
      {
        doing: `Asking ${b.remote} whether it answers`,
        done: (yes: boolean) => (yes ? `${b.remote} answers` : `${b.remote} does not answer`),
        direction: "down",
        failed: (yes) => !yes,
      },
      () => env.remoteAnswers(clone),
    );
    checks.push(
      answers
        ? ok(name, `${b.folder}, remote ${b.remote}`)
        : warn(
            name,
            `${b.folder}: the remote ${b.remote} does not answer`,
            "check the network and your access to the repository; writes commit locally and sync publishes them later",
          ),
    );
  }
  return checks;
}

function pendingCheck(env: DoctorEnv): Check {
  const pending = Object.entries(readPending(env.home));
  if (pending.length === 0) return ok("pending publications", "none");
  const list = pending.map(([key, p]) => `${key} since ${p.since.slice(0, 10)} (${p.reason})`).join("; ");
  return warn(
    "pending publications",
    `${pending.length}: ${list}`,
    "kioku sync retries them; it runs at the start of every session",
  );
}

function syncCheck(env: DoctorEnv): Check {
  const state = readJson<{ brains?: Record<string, { at: string; status: string; message?: string }> }>(
    syncStatePath(env.home),
  );
  if (state === undefined || state === null) return ok("last sync", "none yet");
  const failed = Object.entries(state.brains ?? {}).filter(([, s]) => s.status === "failed");
  if (failed.length === 0) return ok("last sync", "no failures");
  return warn(
    "last sync",
    failed.map(([key, s]) => `${key} failed at ${s.at.slice(0, 16)}: ${s.message ?? "no message"}`).join("; "),
    "run `kioku sync` to see it fail or succeed in front of you",
  );
}

function indexCheck(env: DoctorEnv): Check {
  const path = indexPath(env.home);
  if (!existsSync(path))
    return warn("search index", `${path} does not exist`, "it is rebuilt at the next sync, or by the next search");
  try {
    // Read-only, so that doctor never rebuilds or changes the index.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version !== SCHEMA_VERSION)
        return warn(
          "search index",
          `schema ${version}, and this tool uses ${SCHEMA_VERSION}`,
          "it is rebuilt at the next sync, or by the next search",
        );
      const pages = (db.prepare("SELECT count(*) AS n FROM pages").get() as { n: number }).n;
      const pins = env.semantic?.pins ?? PINS;
      const embedded = coverageOf(db, pins.model.name);
      const detail = `${path}, ${pages} pages, ${embedded} of them indexed by meaning`;
      // What search says (§4.3): with the model here and more pages waiting than it embeds itself, full text alone.
      const waiting = pages - embedded;
      if (
        waiting > INLINE_EMBED_MAX &&
        semanticStatus(env.home, pins, env.semantic?.platform ?? currentPlatform()).ready
      ) {
        return warn(
          "search index",
          `${detail}; search answers with full text until the other ${waiting} are`,
          "kioku sync indexes them",
        );
      }
      return ok("search index", detail);
    } finally {
      db.close();
    }
  } catch (e) {
    return warn(
      "search index",
      `${path} cannot be read (${(e as Error).message})`,
      "it is rebuilt at the next sync, or by the next search",
    );
  }
}

/** The embedding engine and model (§4.3): present and matching their checksums, or why search uses full text only. */
function modelCheck(env: DoctorEnv): Check {
  if (configuredMode(env.home) === "full-text")
    return ok("embedding model", "not used: search is set to full text in the configuration");
  const pins = env.semantic?.pins ?? PINS;
  const platform = env.semantic?.platform ?? currentPlatform();
  const status = semanticStatus(env.home, pins, platform);
  if (status.ready) {
    const verified = verifySemantic(env.home, pins, platform);
    if (verified.ok)
      return ok("embedding model", `${pins.model.id} (int8) on ${pins.engine.version}, checksums verified`);
    return warn(
      "embedding model",
      verified.reason,
      "search answers with full text only; the next sync fetches it again",
    );
  }
  if (status.missing.length === 0)
    return warn("embedding model", status.reason!, "search answers with full text only on this machine");
  // A sync running now fetches what is missing (§4.3): say so, not that nothing has happened yet.
  const lock = syncLockPath(env.home);
  if (readSemanticState(env.home).failure === undefined && existsSync(lock) && !isStale(lock, readOwner(lock))) {
    return warn(
      "embedding model",
      `the search model is not on this machine yet; a sync running now is fetching it (about ${downloadMB(pins)} MB, once)`,
      "search answers with full text only until it is there; run kioku doctor again in a few minutes",
    );
  }
  return warn(
    "embedding model",
    status.reason!,
    `search answers with full text only until \`kioku sync\` fetches it into ~/.kioku/ (about ${downloadMB(pins)} MB, once)`,
  );
}

/** Brains the repository of the current folder names that this machine does not trust (§2.4): said, never silent. */
function trustCheck(env: DoctorEnv, config: MachineConfig): Check[] {
  if (env.cwd === undefined) return [];
  return resolveChain(env.cwd, config, env.home).untrusted.map((u) => {
    const owner = trustOwnerCommand(u);
    return warn(
      "trusted brains",
      `this folder names ${u.key} as its ${u.tier} brain at ${u.address}, an address this machine does not know for it: it is not loaded`,
      `if you trust it, run \`${trustCommand(u)}\` here in a terminal${owner === undefined ? "" : `, or \`${owner}\` for every brain of that owner`}, then start a new session`,
    );
  });
}

/**
 * A host (§6.2) found on the machine: its plugin is installed; one without it is said. A host not found says nothing.
 */
function hostChecks(harness: Harness, tool: string, origin: InstallOrigin, folder: string | undefined): Check[] {
  if (!harness.integration.found()) return [];
  const name = `${harness.name} plugin`;
  const fix = `kioku plugin ${harness.id} install`;
  const checks: Check[] = [];
  // The plugin follows the tool (§6.2): one older than the tool runs the hooks, mod and skill of that older version.
  const behind = pluginBehind(harness, tool);
  const version = harness.integration.plugin.version();
  // Where the host reads it from: the folder beside the tool, which follows it with no command (§6.2).
  const source = harness.integration.plugin.marketplace();
  const from = marketplaceWords(source);
  const beside = folder === undefined || (source?.kind === "directory" && resolve(source.path) === resolve(folder));
  const plugin = (): Check => {
    if (!harness.integration.plugin.installed())
      return warn(name, `${harness.name} is on this machine and does not use Kioku`, fix);
    if (!beside)
      return warn(
        name,
        `${harness.name} reads the Kioku plugin ${from}, not beside the tool, so it does not follow the tool`,
        `${fix} points it at ${folder}`,
      );
    if (behind !== undefined)
      return warn(
        name,
        `the Kioku plugin in ${harness.configDir} is ${behind}, older than Kioku ${tool}`,
        `${fix} updates it; it applies from ${harness.name}'s next session`,
      );
    if (version !== undefined && version !== tool)
      return warn(
        name,
        `the Kioku plugin in ${harness.configDir} is ${version}, newer than Kioku ${tool}`,
        `${origin === "installer" ? "kioku update" : (managerCommand(origin) ?? "updating Kioku the way it was installed")} brings the tool to it`,
      );
    return ok(
      name,
      `the Kioku plugin${version === undefined ? "" : ` ${version}`} is installed in ${harness.configDir}, read ${from}`,
    );
  };
  return [
    ...checks,
    plugin(),
    ...harness.checks().map((c) => (c.ok ? ok(c.name, c.detail) : warn(c.name, c.detail, c.fix ?? ""))),
  ];
}

/** Where a host has the plugin's marketplace from, as `doctor` says it. */
function marketplaceWords(source: MarketplaceSource | undefined): string {
  if (source === undefined) return "from no marketplace the host still knows";
  if (source.kind === "directory") return `from ${source.path}`;
  if (source.kind === "github") return `from the GitHub repository ${source.repo}`;
  return `from ${source.what}`;
}

/** How the tool is updated, and when a new version was last looked for (§6.4). Information, never a warning. */
function updatesCheck(env: DoctorEnv, config: MachineConfig | undefined): Check {
  const origin = env.origin ?? "other";
  if (origin !== "installer") {
    const command = managerCommand(origin);
    return ok(
      "kioku updates",
      command !== undefined
        ? `installed by Homebrew, which updates it: ${command}; no session looks for a new version`
        : "not installed by its installer, so updated the way it was installed; no session looks for a new version",
    );
  }
  const last = lastCheck(env.home);
  const when =
    last === undefined
      ? "never looked for a new version yet"
      : `last looked for a new version on ${last.toISOString().slice(0, 10)}`;
  if (mutes(config, "update-available"))
    return ok("kioku updates", `the daily look is off (update-available muted); ${when}; kioku update still works`);
  return ok(
    "kioku updates",
    `a session looks once a day and says when a newer version exists, and installs nothing; ${when}; kioku update installs it`,
  );
}

/** Where the tool is installed on this machine (§6.3). */
const dirsOf = (env: DoctorEnv): InstallDirs => installDirs(env.hostHome ?? env.home, env.env ?? {});

function launcherCheck(env: DoctorEnv): Check {
  const dirs = dirsOf(env);
  const path = launcherPath(dirs);
  if (!existsSync(path))
    return warn("kioku launcher", `${path} does not exist`, `run the installer: ${INSTALL_COMMAND}`);
  if (!onPath(dirs, env.pathVar))
    return warn(
      "kioku launcher",
      `${path} is not on this PATH`,
      `${path} setup, which links it or writes the line to your shell's profile (${lineFor(shellOf(env.env ?? {}), dirs)})`,
    );
  return ok("kioku launcher", path);
}

/** The version `current` runs, and whether this tool is it (§6.4); nothing to say on a machine with no install. */
function versionCheck(env: DoctorEnv): Check[] {
  const dirs = dirsOf(env);
  const current = currentVersion(dirs);
  if (current === undefined)
    return existsSync(dirs.install)
      ? [
          warn(
            "kioku version",
            `no version is installed under ${dirs.install}`,
            `run the installer: ${INSTALL_COMMAND}`,
          ),
        ]
      : [];
  if (VERSION !== "0.0.0-dev" && VERSION !== current)
    return [
      warn(
        "kioku version",
        `this is ${VERSION}, and ${dirs.install}/current is ${current}`,
        "run kioku through its launcher, or kioku update",
      ),
    ];
  return [ok("kioku version", `${current}, under ${dirs.install}`)];
}

/** Check what a person needs (§6.1, §6.3) and say how to fix what is missing. Reads only. */
export function runDoctor(env: DoctorEnv): DoctorReport {
  const checks: Check[] = [nodeCheck(env)];
  let config: MachineConfig | undefined;
  let configCheck: Check;
  if (!existsSync(configPath(env.home))) {
    configCheck = missing("configuration", `${configPath(env.home)} does not exist`, "run `kioku setup`");
  } else {
    try {
      config = readMachineConfig(env.home);
      configCheck = ok("configuration", configPath(env.home));
    } catch (e) {
      configCheck = missing(
        "configuration",
        (e as Error).message,
        "fix the file by hand; kioku never overwrites a configuration it cannot read",
      );
    }
  }
  checks.push(...gitChecks(env, config), configCheck);
  if (config !== undefined) checks.push(...brainChecks(env, config), ...trustCheck(env, config));
  checks.push(
    pendingCheck(env),
    syncCheck(env),
    indexCheck(env),
    modelCheck(env),
    launcherCheck(env),
    ...versionCheck(env),
    updatesCheck(env, config),
    ...(env.harnesses ?? allHarnesses(env.hostHome ?? env.home, env.env ?? {})).flatMap((h) =>
      hostChecks(h, env.tool ?? currentVersion(dirsOf(env)) ?? VERSION, env.origin ?? "other", env.pluginFolder),
    ),
  );
  return { ok: checks.every((c) => c.state !== "missing"), checks };
}
