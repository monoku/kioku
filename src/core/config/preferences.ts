import { userError } from "../errors.ts";
import { parseRepo, repoKey } from "./brain-ref.ts";
import { DISPLAY_COLORS, NOTICE_NAMES, SEARCH_MODES, type MachineConfig, type NoticeName } from "./machine.ts";
import { listWords } from "../util.ts";

/** What a preference holds: how its value is written on the command line and read back. */
export type PreferenceValue = string | boolean | string[];

interface Preference {
  key: string;
  /** What a value may be, for the person. */
  allowed: string;
  /** The value when the key is not in the file; undefined when there is none to state. */
  default?: PreferenceValue;
  /** What applies when there is no value and no default to state. */
  whenAbsent?: string;
  /** The typed value, or an error message naming what is allowed. */
  parse: (text: string) => PreferenceValue | { bad: string };
  get: (c: MachineConfig) => PreferenceValue | undefined;
  set: (c: MachineConfig, v: PreferenceValue) => void;
  unset: (c: MachineConfig) => void;
}

const bad = (message: string): { bad: string } => ({ bad: message });

const oneOf = (words: readonly string[]) => (text: string) =>
  words.includes(text) ? text : bad(listWords(words, "or"));

/** Drop the groups emptied by an `unset`, so the file does not keep an empty `search:`. */
function tidy(c: MachineConfig): void {
  if (c.display?.mute?.length === 0) delete c.display.mute;
  for (const g of ["search", "display"] as const) {
    const group = c[g];
    if (group !== undefined && Object.keys(group).length === 0) delete c[g];
  }
}

/**
 * What `set display.mute` takes (§1.2, §6.1): a list, `a,b`, or one name to add, `+a`, or to take out, `-a`; each a
 * name of §1.2. The text is checked here and applied by `set`, which knows the list it changes.
 */
const muteText = (text: string): PreferenceValue | { bad: string } => {
  const names = /^[+-]/.test(text) ? [text.slice(1)] : text.split(",").map((n) => n.trim());
  const unknown = names.find((n) => !(NOTICE_NAMES as readonly string[]).includes(n));
  return unknown === undefined ? text : bad(`a list of ${NOTICE_NAMES.join(", ")}, or one of them after + or -`);
};

function applyMute(c: MachineConfig, text: string): void {
  const now = new Set<NoticeName>(c.display?.mute ?? []);
  if (text.startsWith("+")) now.add(text.slice(1) as NoticeName);
  else if (text.startsWith("-")) now.delete(text.slice(1) as NoticeName);
  else {
    now.clear();
    for (const n of text.split(",")) now.add(n.trim() as NoticeName);
  }
  (c.display ??= {}).mute = NOTICE_NAMES.filter((n) => now.has(n));
  tidy(c);
}

/** The keys `kioku config set` takes, in the order the list shows them (§2.5). */
export const PREFERENCES: Preference[] = [
  {
    // The person's own team, where a project folder names none (§2.4). The command line turns a name into the brain's
    // key, having checked that this machine has it and that it is a team brain; here it is a key.
    key: "team",
    allowed: "a team brain this machine has, by key or repository",
    whenAbsent: "none where a project names none",
    parse: (text) => {
      const ref = parseRepo(text);
      return ref === undefined ? bad("a team brain this machine has, such as owner/repo") : repoKey(ref);
    },
    get: (c) => c.team,
    set: (c, v) => void (c.team = String(v)),
    unset: (c) => void delete c.team,
  },
  {
    key: "display.color",
    allowed: listWords(DISPLAY_COLORS, "or"),
    default: "auto",
    parse: oneOf(DISPLAY_COLORS),
    get: (c) => c.display?.color,
    set: (c, v) => void ((c.display ??= {}).color = v as NonNullable<MachineConfig["display"]>["color"]),
    unset: (c) => {
      if (c.display) delete c.display.color;
      tidy(c);
    },
  },
  {
    key: "display.mute",
    allowed: NOTICE_NAMES.join(", "),
    default: [],
    parse: muteText,
    get: (c) => (c.display?.mute?.length ? [...c.display.mute] : undefined),
    set: (c, v) => applyMute(c, String(v)),
    unset: (c) => {
      if (c.display) delete c.display.mute;
      tidy(c);
    },
  },
  {
    key: "search.mode",
    allowed: SEARCH_MODES.join(" or "),
    default: "hybrid",
    parse: oneOf(SEARCH_MODES),
    get: (c) => c.search?.mode,
    set: (c, v) => void ((c.search ??= {}).mode = v as NonNullable<MachineConfig["search"]>["mode"]),
    unset: (c) => {
      if (c.search) delete c.search.mode;
      tidy(c);
    },
  },
];

/** Keys `set` leaves to the verbs that guard them, and the verb for each. */
export const READ_ONLY_KEYS: Record<string, string> = {
  brain: "kioku brain create or kioku brain clone",
  repositories: "kioku init, kioku brain create, kioku brain clone or kioku brain trust",
  "trust.owners": "kioku brain trust --owner",
};

export interface PreferenceState {
  key: string;
  /** What is in force: the file's value, else the default, else null. */
  value: PreferenceValue | null;
  default: PreferenceValue | null;
  source: "file" | "default";
  editable: boolean;
  allowed?: string;
  /** What applies when the key has neither a value nor a stated default. */
  whenAbsent?: string;
}

export function preferenceByKey(key: string): Preference {
  const found = PREFERENCES.find((p) => p.key === key);
  if (found !== undefined) return found;
  const owner = READ_ONLY_KEYS[key];
  if (owner !== undefined)
    throw userError(`\`${key}\` is not set with kioku config: ${owner} owns it`, "config_key_readonly");
  const all = [...PREFERENCES.map((p) => p.key), ...Object.keys(READ_ONLY_KEYS)];
  throw userError(`unknown key \`${key}\`; the keys are ${all.join(", ")}`, "config_key_unknown");
}

/** The state of one key: for `get` and the list. Read-only keys are readable too. */
export function stateOf(config: MachineConfig, key: string): PreferenceState {
  if (key in READ_ONLY_KEYS) {
    const value =
      key === "brain"
        ? (config.brain ?? null)
        : key === "repositories"
          ? Object.keys(config.repositories)
          : config.trust.owners;
    const set = Array.isArray(value) ? value.length > 0 : value !== null;
    return { key, value, default: null, source: set ? "file" : "default", editable: false };
  }
  const p = preferenceByKey(key);
  const own = p.get(config);
  const set = own !== undefined;
  return {
    key,
    value: own ?? p.default ?? null,
    default: p.default ?? null,
    source: set ? "file" : "default",
    editable: true,
    allowed: p.allowed,
    ...(p.whenAbsent !== undefined && { whenAbsent: p.whenAbsent }),
  };
}

export const allKeys = (): string[] => [...PREFERENCES.map((p) => p.key), ...Object.keys(READ_ONLY_KEYS)];

/** A typed value for `key` from what was typed, or the refusal naming what is allowed and the default. */
export function parseValue(key: string, text: string): PreferenceValue {
  const p = preferenceByKey(key);
  const parsed = p.parse(text);
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    const fallback =
      p.default !== undefined ? `the default is ${String(p.default)}` : `without it: ${p.whenAbsent ?? "nothing"}`;
    throw userError(`\`${key}\` is ${parsed.bad}, not ${JSON.stringify(text)} (${fallback})`, "config_value_invalid");
  }
  return parsed;
}

export function applyPreference(config: MachineConfig, key: string, value: PreferenceValue): void {
  preferenceByKey(key).set(config, value);
}

export function clearPreference(config: MachineConfig, key: string): void {
  preferenceByKey(key).unset(config);
}
