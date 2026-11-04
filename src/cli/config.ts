import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { knownBrains } from "../core/brains/list.ts";
import { readMachineConfig, emptyConfig, updateMachineConfig } from "../core/config/machine.ts";
import {
  allKeys,
  applyPreference,
  clearPreference,
  parseValue,
  preferenceByKey,
  stateOf,
  type PreferenceState,
} from "../core/config/preferences.ts";
import { userError } from "../core/errors.ts";
import { pickKnown } from "./brain-path.ts";
import { PLAIN, paint, table } from "./render.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import { requireTerminal } from "./terminal.ts";

const show = (v: PreferenceState["value"]): string =>
  v === null ? "(not set)" : Array.isArray(v) ? (v.length === 0 ? "(none)" : v.join(", ")) : String(v);

const noteOf = (s: PreferenceState): string =>
  !s.editable
    ? "read only here"
    : s.source === "file"
      ? "set"
      : s.whenAbsent !== undefined && s.value === null
        ? s.whenAbsent
        : "default";

function listing(keys: PreferenceState[], ctx: Context): string {
  const ui = ctx.ui ?? PLAIN;
  const p = paint(ui);
  return table(
    ui,
    ["KEY", "VALUE", "NOTE"],
    keys.map((s) => [s.key, show(s.value), noteOf(s)]),
    {
      style: (c, r, cell) =>
        r === -1
          ? p.title(cell)
          : c === 0
            ? p.name(cell)
            : c === 1 && keys[r]!.value === null
              ? p.dim(cell)
              : c === 2 && noteOf(keys[r]!) === "default"
                ? p.dim(cell)
                : cell,
    },
  );
}

/** Writing is the person's, in a terminal: an agent does not change who the person is. */
const needTerminal = (ctx: Context, verb: string): void =>
  requireTerminal(ctx, verb, "it changes how Kioku runs on this machine, so the agent does not do it");

/** `kioku config [get <key> | set <key> <value> | unset <key>]` (§6.1). */
export const runConfig: Handler = async (args, ctx) => {
  const [verb, ...rest] = args;
  const current = readMachineConfig(ctx.home) ?? emptyConfig();
  if (verb === undefined) {
    const keys = allKeys().map((k) => stateOf(current, k));
    return { data: { keys }, text: listing(keys, ctx) };
  }
  if (verb === "get") {
    if (rest.length !== 1) throw userError("config get takes one key", "usage");
    const s = stateOf(current, rest[0]!);
    // The list has no room for the names `display.mute` takes; `get` says them (§6.1).
    return { data: s, text: s.key === "display.mute" ? `${show(s.value)}\nthe names: ${s.allowed}` : show(s.value) };
  }
  if (verb === "set") {
    if (rest.length !== 2) throw userError("config set takes a key and its value", "usage");
    return write(ctx, rest[0]!, rest[1]!);
  }
  if (verb === "unset") {
    if (rest.length !== 1) throw userError("config unset takes one key", "usage");
    return write(ctx, rest[0]!, undefined);
  }
  throw userError(`config takes get, set or unset, not ${verb}`, "usage");
};

/**
 * The brain `config set team` names, as its key: one this machine has cloned, by key or repository, and a team
 * brain (§2.5). One it does not have is refused with the command that brings it.
 */
function teamKey(ctx: Context, text: string): string {
  const brain = pickKnown(knownBrains(ctx.home), text);
  if (!brain.onDisk)
    throw userError(
      `the brain ${brain.key} is not on this machine yet; kioku brain clone ${brain.key} brings it`,
      "brain_not_cloned",
    );
  if (brain.tier !== "team")
    throw userError(
      `\`team\` is a team brain, and ${brainRepoOfKey(brain.key)} is a ${brain.tier} brain`,
      "config_value_invalid",
    );
  return brain.key;
}

async function write(ctx: Context, key: string, text: string | undefined): Promise<Outcome> {
  // The terminal first: an agent that is refused learns nothing about which keys and values are valid.
  needTerminal(ctx, `kioku config ${text === undefined ? "unset" : "set"}`);
  preferenceByKey(key);
  const value = text === undefined ? undefined : parseValue(key, key === "team" ? teamKey(ctx, text) : text);
  const config = await updateMachineConfig(
    (c) => (value === undefined ? clearPreference(c, key) : applyPreference(c, key, value)),
    ctx.home,
  );
  const s = stateOf(config, key);
  return {
    data: s,
    text:
      value === undefined
        ? `${key} unset${s.value === null ? "" : `; the default is ${show(s.value)}`}`
        : `${key}: ${show(s.value)}`,
  };
}
