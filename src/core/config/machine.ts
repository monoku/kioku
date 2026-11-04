import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMap, parseDocument, stringify } from "yaml";
import { looksLikeOption, ownerKey, parseOwner, parseRepo, repoKey } from "./brain-ref.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { acquireLock } from "../fs/lock.ts";
import { userError } from "../errors.ts";
import { listWords } from "../util.ts";

/** How search runs (§4.3): meaning on top of full text, or full text alone, with nothing downloaded. */
export const SEARCH_MODES = ["hybrid", "full-text"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
/** Every key `search` may hold. */
export const SEARCH_KEYS = ["mode"] as const;

export const DISPLAY_COLORS = ["auto", "always", "never"] as const;
export type DisplayColor = (typeof DISPLAY_COLORS)[number];
/** Every key `display` may hold. */
export const DISPLAY_KEYS = ["color", "mute"] as const;

/** The notices the person may mute, by name (§1.2). Errors, conflicts, questions and the summary have none. */
export const NOTICE_NAMES = [
  "not-set-up",
  "update-available",
  "plugin-version",
  "cloning",
  "untrusted",
  "publication-pending",
  "index-building",
  "no-personal-brain",
  "unpublished",
] as const;
export type NoticeName = (typeof NOTICE_NAMES)[number];

/**
 * `~/.kioku/config.yaml`: where things are and the person's own preferences, per machine (§2.5). It never records
 * which project applies, nor the team of a project folder that names one: those are facts about the folder (§2.1).
 */
export interface MachineConfig {
  /** Canonical key of the personal brain (§2.3). */
  brain?: string;
  /** Canonical key of the person's own team brain, which loads where a project folder names none (§2.4). */
  team?: string;
  /** What the person sees (§1.2): colour, and the notices muted. */
  display?: { color?: DisplayColor; mute?: NoticeName[] };
  /** How search runs (§4.3); hybrid when absent. */
  search?: { mode?: SearchMode };
  /** Owners, `host/owner`, whose repositories a project folder may name as its brains without being asked (§2.4). */
  trust: { owners: string[] };
  /**
   * Known repositories by canonical key, each with an optional local folder for its clone and the address it is cloned
   * from when that is not `https://<key>.git` (§2.2).
   */
  repositories: Record<string, BrainEntry>;
}

/** An entry of `repositories`: where the clone is, when not in the managed folder, and where the repository is, when not where its key says. */
export interface BrainEntry {
  path?: string;
  url?: string;
}

/** Whether the person muted a notice (§1.2). */
export const mutes = (c: MachineConfig | undefined, name: NoticeName): boolean =>
  c?.display?.mute?.includes(name) === true;

/** Whether a brain with no remote is to be mentioned as unpublished (§2.3): unless `unpublished` is muted. */
export const remindsUnpublished = (c: MachineConfig | undefined): boolean => !mutes(c, "unpublished");

/** Every key the file may hold. A project is not one of them. */
export const MACHINE_KEYS = ["brain", "team", "display", "search", "trust", "repositories"] as const;
/** The comment the tool writes at the top of the file: what it is, and where its keys are listed. */
export const CONFIG_HEADER =
  "# Kioku's machine configuration. kioku config lists every key, its value and what it takes.";
/** Every key an entry of `repositories` may hold. */
export const BRAIN_ENTRY_KEYS = ["path", "url"] as const;

export const configPath = (home: string): string => join(home, ".kioku", "config.yaml");

export function emptyConfig(): MachineConfig {
  return { repositories: {}, trust: { owners: [] } };
}

/**
 * The configuration, or undefined when there is no file: the machine is not set up, which is a state and not an
 * error. A malformed file is an error naming the file and the key, never silently replaced.
 */
export function readMachineConfig(home: string): MachineConfig | undefined {
  const path = configPath(home);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text, { version: "1.2", uniqueKeys: true });
  if (doc.errors.length > 0)
    throw userError(`${path} is not valid YAML: ${doc.errors[0]!.message.split("\n")[0]}`, "config_invalid");
  if (doc.contents === null) return emptyConfig();
  if (!isMap(doc.contents)) throw userError(`${path} is not a mapping`, "config_invalid");
  return fromRaw(doc.toJS() as Record<string, unknown>, path);
}

/**
 * The configuration read at most once, however many times it is asked for, its failure included: what one run of a
 * hook shares. A verb that writes the file keeps `readMachineConfig`, which always sees what is on disk.
 */
export function machineReader(home: string): () => MachineConfig | undefined {
  let read: (() => MachineConfig | undefined) | undefined;
  return () => {
    if (read === undefined) {
      try {
        const config = readMachineConfig(home);
        read = () => config;
      } catch (e) {
        read = () => {
          throw e;
        };
      }
    }
    return read();
  };
}

const invalid = (message: string) => userError(message, "config_invalid");

function fromRaw(raw: Record<string, unknown>, path: string): MachineConfig {
  const unknown = Object.keys(raw).find((k) => !(MACHINE_KEYS as readonly string[]).includes(k));
  if (unknown !== undefined) {
    throw invalid(
      `${path}: unknown key \`${unknown}\`; the file holds ${MACHINE_KEYS.map((k) => `\`${k}\``).join(", ")}`,
    );
  }
  const config = emptyConfig();
  const mute = (name: NoticeName): void => {
    const d = (config.display ??= {});
    if (!(d.mute ??= []).includes(name)) d.mute.push(name);
  };
  if (raw.brain !== undefined) config.brain = key(raw.brain, "brain", path);
  if (raw.team !== undefined) config.team = key(raw.team, "team", path);

  if (raw.display !== undefined && raw.display !== null) {
    const d = groupOf(raw.display, "display", DISPLAY_KEYS, path);
    if (d.color !== undefined) {
      if (typeof d.color !== "string" || !(DISPLAY_COLORS as readonly string[]).includes(d.color)) {
        throw invalid(
          `${path}: \`display.color\` must be ${DISPLAY_COLORS.join(", ")}, not ${JSON.stringify(d.color)}`,
        );
      }
      (config.display ??= {}).color = d.color as DisplayColor;
    }
    if (d.mute !== undefined && d.mute !== null) {
      const names = Array.isArray(d.mute) ? d.mute : [undefined];
      const bad = names.find((n) => typeof n !== "string" || !(NOTICE_NAMES as readonly string[]).includes(n));
      if (bad !== undefined || !Array.isArray(d.mute))
        throw invalid(
          `${path}: \`display.mute\` is a list of ${NOTICE_NAMES.join(", ")}${bad === undefined ? "" : `, not ${JSON.stringify(bad)}`}`,
        );
      for (const n of names as NoticeName[]) mute(n);
    }
  }
  if (raw.search !== undefined && raw.search !== null) config.search = searchOf(raw.search, path);
  if (raw.trust !== undefined && raw.trust !== null) {
    const t = groupOf(raw.trust, "trust", ["owners"], path);
    if (t.owners !== undefined && t.owners !== null) config.trust.owners = ownersOf(t.owners, "trust.owners", path);
  }
  const repositories = raw.repositories ?? {};
  if (typeof repositories !== "object" || repositories === null || Array.isArray(repositories))
    throw invalid(`${path}: \`repositories\` must be a mapping`);
  for (const [k, v] of Object.entries(repositories)) {
    const canonical = key(k, `repositories.${k}`, path);
    const entry = v === null ? {} : groupOf(v, `repositories.${k}`, BRAIN_ENTRY_KEYS, path);
    if (entry.path !== undefined && typeof entry.path !== "string")
      throw invalid(`${path}: \`repositories.${k}.path\` must be a string`);
    if (entry.url !== undefined && (typeof entry.url !== "string" || entry.url.trim() === ""))
      throw invalid(`${path}: \`repositories.${k}.url\` must be the address of a git repository`);
    if (typeof entry.url === "string" && looksLikeOption(entry.url))
      throw invalid(`${path}: \`repositories.${k}.url\` begins with -, which git would read as an option`);
    config.repositories[canonical] = {
      ...(entry.path !== undefined && { path: entry.path as string }),
      ...(entry.url !== undefined && { url: entry.url as string }),
    };
  }
  return config;
}

/** A mapping that holds only `keys`. */
function groupOf(value: unknown, name: string, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid(`${path}: \`${name}\` must be a mapping`);
  const raw = value as Record<string, unknown>;
  const extra = Object.keys(raw).find((k) => !keys.includes(k));
  const holds = listWords(keys.map((k) => `\`${k}\``));
  if (extra !== undefined) throw invalid(`${path}: unknown key \`${name}.${extra}\`; \`${name}\` holds ${holds}`);
  return raw;
}

/** A list of owners, `host/owner`, each once. */
function ownersOf(list: unknown, name: string, path: string): string[] {
  const owners = Array.isArray(list)
    ? list.map((o) => (typeof o === "string" ? parseOwner(o) : undefined))
    : [undefined];
  if (!Array.isArray(list) || owners.some((o) => o === undefined)) {
    throw invalid(`${path}: \`${name}\` must be a list of owners such as github.com/northwind`);
  }
  return [...new Set(owners.map((o) => ownerKey(o!)))];
}

function searchOf(value: unknown, path: string): NonNullable<MachineConfig["search"]> {
  const raw = groupOf(value, "search", SEARCH_KEYS, path);
  const search: NonNullable<MachineConfig["search"]> = {};
  if (raw.mode !== undefined) {
    if (typeof raw.mode !== "string" || !(SEARCH_MODES as readonly string[]).includes(raw.mode)) {
      throw invalid(`${path}: \`search.mode\` must be ${SEARCH_MODES.join(" or ")}, not ${JSON.stringify(raw.mode)}`);
    }
    search.mode = raw.mode as SearchMode;
  }
  return search;
}

function key(value: unknown, field: string, path: string): string {
  const ref = typeof value === "string" ? parseRepo(value) : undefined;
  if (!ref) throw invalid(`${path}: \`${field}\` is not a brain URL: ${String(value)}`);
  return repoKey(ref);
}

/** The file's text, keys in the order of §2.5; a group with nothing in it is left out. */
export function stringifyMachineConfig(config: MachineConfig): string {
  const out: Record<string, unknown> = {};
  const some = (o: Record<string, unknown>): Record<string, unknown> | undefined => {
    const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    return Object.keys(kept).length > 0 ? kept : undefined;
  };
  if (config.brain !== undefined) out.brain = config.brain;
  if (config.team !== undefined) out.team = config.team;
  const display = some({
    color: config.display?.color,
    mute: config.display?.mute?.length ? config.display.mute : undefined,
  });
  if (display !== undefined) out.display = display;
  const search = some({ mode: config.search?.mode });
  if (search !== undefined) out.search = search;
  if (config.trust.owners.length > 0) out.trust = { owners: config.trust.owners };
  out.repositories = Object.fromEntries(
    Object.entries(config.repositories).map(([k, v]) => [
      k,
      { ...(v.path !== undefined && { path: v.path }), ...(v.url !== undefined && { url: v.url }) },
    ]),
  );
  // One comment line opens the file, for whoever opens it by hand: the keys are `kioku config`'s to list (§2.5).
  return `${CONFIG_HEADER}\n${stringify(out, { lineWidth: 0, flowCollectionPadding: false })}`;
}

/** Atomic and locked: the lock is the configuration folder's `lock`, so two kioku processes never interleave. */
export async function writeMachineConfig(config: MachineConfig, home: string): Promise<void> {
  const path = configPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const lock = await acquireLock(join(dirname(path), "lock"));
  try {
    writeAtomic(path, stringifyMachineConfig(config));
  } finally {
    lock.release();
  }
}

/** Replace the file with `update` applied to what is on disk (an empty configuration when none), under the lock, so concurrent updates are not lost. */
export async function updateMachineConfig(update: (c: MachineConfig) => void, home: string): Promise<MachineConfig> {
  const path = configPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const lock = await acquireLock(join(dirname(path), "lock"));
  try {
    const config = readMachineConfig(home) ?? emptyConfig();
    update(config);
    writeAtomic(path, stringifyMachineConfig(config));
    return config;
  } finally {
    lock.release();
  }
}
