import { basename } from "node:path";
import { knownBrains, type KnownBrain } from "../core/brains/list.ts";
import { parseRepoShort, brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import type { Context, Outcome } from "./run.ts";

/** A brain of this machine, by tier, key or repository; two that answer equally well are an error that lists them. */
export function pickKnown(brains: KnownBrain[], wanted: string): KnownBrain {
  const levels: ((b: KnownBrain) => boolean)[] = [
    (b) => b.key === wanted,
    (b) => b.tier === wanted,
    (b) => b.key === wanted,
    (b) => b.key.endsWith(`/${wanted}`) || basename(b.folder) === wanted,
  ];
  for (const test of levels) {
    const found = brains.filter(test);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) {
      throw userError(
        `"${wanted}" names more than one brain: ${found.map((b) => b.key).join(", ")}; use the key`,
        "brain_ambiguous",
      );
    }
  }
  const known = brains.map((b) => brainRepoOfKey(b.key)).join(", ") || "none";
  // A repository is a brain that may only be elsewhere yet: say how to bring it (§2.3), not only that it is missing.
  const repo = parseRepoShort(wanted);
  const bring =
    repo !== undefined
      ? `To bring it: kioku brain clone ${wanted}, or, to make it when it does not exist, kioku brain create ${wanted} --tier personal|project|team`
      : "To bring a brain: kioku brain clone <owner>/<repo>, or kioku brain create <owner>/<repo> --tier personal|project|team";
  throw userError(`no brain called "${wanted}" on this machine (${known}). ${bring}`, "brain_unknown");
}

/** A brain of this machine that is on disk, for the verbs that take one wherever the person is. */
export function located(ctx: Context, wanted: string | undefined, verb: string): KnownBrain {
  if (wanted === undefined || wanted.startsWith("-"))
    throw userError(`brain ${verb} takes a brain: a name, a tier, a key or a repository`, "usage");
  const brain = pickKnown(knownBrains(ctx.home), wanted);
  // On disk but refused is not "not cloned": the person is told what to fix in the file (§2.5).
  if (brain.problem !== undefined)
    throw userError(
      `the brain ${brain.key} is on this machine but cannot be read: ${brain.problem}`,
      "brain_config_invalid",
    );
  if (!brain.onDisk)
    throw userError(`the brain ${brain.key} is not on this machine yet; run kioku sync`, "brain_not_cloned");
  return brain;
}

/** `kioku brain path <brain>` (§6.1): the folder, to `cd` there, which a program cannot do for its parent shell. */
export function brainPath(args: string[], ctx: Context): Outcome {
  if (args.length !== 1) throw userError("brain path takes one brain", "usage");
  const brain = located(ctx, args[0], "path");
  return { data: { brain: brain.key, path: brain.folder }, text: brain.folder };
}
