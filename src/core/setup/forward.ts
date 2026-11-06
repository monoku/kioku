import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { brainFolder, expandPath, legacyManagedPath, parseLegacyKey, parseName } from "../config/brain-ref.ts";
import { CURRENT_FORMAT, readFolderConfig } from "../config/folder-config.ts";
import { configPath, readMachineConfig, writeMachineConfig } from "../config/machine.ts";
import { gitQuiet } from "../git.ts";
import { knownBrains } from "../brains/list.ts";
import { upgradeBrain, type UpgradeResult } from "../brains/upgrade.ts";
import { firstLine } from "../errors.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { forwardStatePath } from "../state.ts";
import { readJson } from "../util.ts";

/** What bringing a machine forward did (§2.5, §3.2, §6.4). */
export interface Forwarded {
  /** The configuration was in the form 0.1.0 wrote, and is now in this one. */
  rewrote: boolean;
  /** Brains moved to their folder under their name, from where 0.1.0 kept them. */
  moved: { brain: string; from: string; to: string }[];
  /** Brains left where they were, and why: two keys that give one name, or a folder that could not move. */
  kept: { brain: string; at: string; why: string }[];
  /** The person's own brain, raised to the newest format (§3.2). */
  raised?: UpgradeResult;
  /** Project and team brains of an older format, left as they are for the person to raise (`format-behind`). */
  behind: string[];
}

/** What bringing forward did, a sentence each, and whether each is done or left for the person; none when nothing. */
export function describeForwarded(f: Forwarded | undefined): { done: boolean; text: string }[] {
  if (f === undefined) return [];
  const out: { done: boolean; text: string }[] = [];
  if (f.rewrote) out.push({ done: true, text: "Rewrote the machine's configuration by the brains' names." });
  for (const m of f.moved) out.push({ done: true, text: `Moved ${m.brain} to ${m.to}.` });
  for (const k of f.kept) out.push({ done: false, text: `Left ${k.brain} at ${k.at}: ${k.why}.` });
  if (f.raised !== undefined && f.raised.from !== f.raised.to)
    out.push({ done: true, text: `Raised your brain ${f.raised.brain} to format ${f.raised.to}.` });
  if (f.behind.length > 0) {
    const one = f.behind.length === 1;
    out.push({
      done: true,
      text: `${f.behind.join(", ")} ${one ? "is" : "are"} of an older format, left as ${one ? "it is" : "they are"} for teammates on an older version; kioku brain upgrade raises one once they have updated.`,
    });
  }
  return out;
}

/** Remove the folders `folder` leaves empty, up to the managed folder. */
function tidyUp(folder: string, top: string): void {
  for (let dir = dirname(folder); dir.startsWith(top) && dir !== top; dir = dirname(dir)) {
    try {
      if (readdirSync(dir).length > 0) return;
      rmdirSync(dir);
    } catch {
      return;
    }
  }
}

/**
 * Bring forward what an older version left (§2.5, §3.2), in `kioku setup` (§6.3) and in the hand-over of `kioku update`
 * (§6.4): a configuration 0.1.0
 * wrote is rewritten by name, each brain kept elsewhere, in a `path` of the person's or under its host, moved to its
 * folder under that name with its files unchanged, and the address of each brain with a remote recorded; two keys that
 * give one name are left as they were, and said. Then the person's own brain is raised to the newest format; a project
 * or team brain of an older format is left, and said. Idempotent: a machine already forward changes nothing.
 */
export async function bringForward(home: string, now: Date): Promise<Forwarded> {
  const out = await bringConfigForward(home);
  if (readMachineConfig(home) === undefined) return out;
  return raiseOwnBrain(home, now, out);
}

/**
 * The configuration's half of bringing forward (§2.5, §6.4): a configuration 0.1.0 wrote rewritten by name, and the
 * brains it kept elsewhere moved to their folders. Nothing but the machine's own files, and no time: what the
 * `SessionStart` hook does before it reads the configuration.
 */
export async function bringConfigForward(home: string): Promise<Forwarded> {
  const out: Forwarded = { rewrote: false, moved: [], kept: [], behind: [] };
  const config = readMachineConfig(home);
  if (config === undefined) return out;
  if (config.legacy !== undefined) {
    const top = join(home, ".kioku", "brains");
    const count = new Map<string, number>();
    for (const l of config.legacy) count.set(l.name, (count.get(l.name) ?? 0) + 1);
    for (const l of config.legacy) {
      const old = parseLegacyKey(l.key)!;
      const from = l.path !== undefined ? expandPath(l.path, home) : legacyManagedPath(home, old);
      const ref = parseName(l.name);
      if (ref === undefined) {
        out.kept.push({ brain: l.key, at: from, why: `its key gives no name of letters, digits, - and _` });
        delete config.repositories[l.name];
        continue;
      }
      const to = brainFolder(home, ref);
      if ((count.get(l.name) ?? 0) > 1) {
        out.kept.push({
          brain: l.key,
          at: from,
          why: `another brain's key gives the same name, ${l.name}; remove one`,
        });
        delete config.repositories[l.name];
        continue;
      }
      if (from !== to && existsSync(from)) {
        if (existsSync(to) && readdirSync(to).length > 0) {
          out.kept.push({ brain: l.key, at: from, why: `${to} is taken` });
          continue;
        }
        try {
          mkdirSync(dirname(to), { recursive: true });
          renameSync(from, to);
          out.moved.push({ brain: l.name, from, to });
          if (from.startsWith(top)) tidyUp(from, top);
        } catch (e) {
          out.kept.push({
            brain: l.key,
            at: from,
            why: `it could not be moved to ${to}: ${firstLine(e)}; move it by hand`,
          });
          continue;
        }
      }
      // 0.1.0 named no address for a brain at the one its key said: its clone's `origin` says it, as written in the
      // clone; a brain with none, made on this machine, has no address to accept (§2.5).
      const origin = existsSync(join(to, ".git")) ? gitQuiet(to, ["config", "--get", "remote.origin.url"]) : undefined;
      const url = l.url ?? origin;
      if (url !== undefined) config.repositories[l.name] = url;
      else delete config.repositories[l.name];
    }
    delete config.legacy;
    await writeMachineConfig(config, home);
    out.rewrote = true;
  }
  return out;
}

/**
 * The brains' half of bringing forward (§3.2, §6.4): the person's own brain raised to the newest format, a project or
 * team brain of an older format left and said. It commits, so a session leaves it to the `sync` in the background.
 */
export async function raiseOwnBrain(
  home: string,
  now: Date,
  out: Forwarded = { rewrote: false, moved: [], kept: [], behind: [] },
): Promise<Forwarded> {
  // The person's own brain is raised by the version that brings a newer format; a shared one, by the person (§3.2).
  for (const b of knownBrains(home)) {
    if (!b.onDisk || b.format === undefined || b.format >= CURRENT_FORMAT) continue;
    if (b.personal && b.tier === "personal") {
      try {
        out.raised = await upgradeBrain(home, b, now);
      } catch (e) {
        out.kept.push({ brain: b.key, at: b.folder, why: `it could not be raised: ${firstLine(e)}` });
      }
    } else {
      const found = readFolderConfig(join(b.folder, "kioku.yaml"));
      if (found.ok) out.behind.push(b.key);
    }
  }
  return out;
}

/**
 * What the machine keeps of bringing forward (§6.4): the version that last did it whole, and what the next session
 * says of the last time, once: what was done, or why a step failed.
 */
export interface ForwardState {
  version?: string;
  said?: { version: string; lines: string[] };
  failed?: { version: string; reason: string };
}

export function readForwardState(home: string): ForwardState {
  const raw = readJson<Record<string, unknown> | null>(forwardStatePath(home));
  if (raw === undefined || raw === null || typeof raw !== "object") return {};
  const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  const said = raw.said as { version?: unknown; lines?: unknown } | undefined;
  const failed = raw.failed as { version?: unknown; reason?: unknown } | undefined;
  return {
    ...(text(raw.version) !== undefined && { version: text(raw.version)! }),
    ...(said !== undefined &&
      text(said.version) !== undefined &&
      Array.isArray(said.lines) && {
        said: { version: text(said.version)!, lines: said.lines.filter((l): l is string => typeof l === "string") },
      }),
    ...(failed !== undefined &&
      text(failed.version) !== undefined &&
      text(failed.reason) !== undefined && {
        failed: { version: text(failed.version)!, reason: text(failed.reason)! },
      }),
  };
}

function writeForwardState(home: string, state: ForwardState): void {
  mkdirSync(dirname(forwardStatePath(home)), { recursive: true });
  writeAtomic(forwardStatePath(home), `${JSON.stringify(state)}\n`);
}

/** Whether the machine has yet to be brought forward to `version`: set up some way, and another version recorded. */
export const forwardDue = (home: string, version: string): boolean =>
  existsSync(configPath(home)) && readForwardState(home).version !== version;

/**
 * Bringing forward to `version` is done whole (§6.4). `lines`, what it did, are for the next session to say, when a
 * session did it; `kioku update` and `setup` say it themselves.
 */
export function recordForward(home: string, version: string, lines: string[] = []): void {
  writeForwardState(home, { version, ...(lines.length > 0 && { said: { version, lines } }) });
}

/** A step of bringing forward to `version` failed: the next session says why, and its `sync` tries again. */
export function recordForwardFailed(home: string, version: string, reason: string): void {
  const { said: _, failed: __, ...kept } = readForwardState(home);
  writeForwardState(home, { ...kept, failed: { version, reason } });
}

/** What the next session says of bringing forward, once: taken and forgotten. */
export function takeForwardSaid(home: string): Pick<ForwardState, "said" | "failed"> {
  const state = readForwardState(home);
  if (state.said === undefined && state.failed === undefined) return {};
  const { said, failed, ...kept } = state;
  writeForwardState(home, kept);
  return { ...(said !== undefined && { said }), ...(failed !== undefined && { failed }) };
}
