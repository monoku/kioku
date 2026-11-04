import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { readBrainConfig } from "../core/brain/brain.ts";
import { parseVerb } from "./args.ts";
import { knownBrains } from "../core/brains/list.ts";
import { refreshBrain, type RefreshResult } from "../core/brains/refresh.ts";
import { userError } from "../core/errors.ts";
import { VERSION } from "../version.ts";
import { brainsNamed } from "./brains-named.ts";
import { chainBrains } from "./chain.ts";
import type { Context, Outcome } from "./run.ts";

/** `kioku brain refresh [<brain>] [--all]` (§2.7, §6.1): the files the tool owns, brought to this version's text; `--all` for every brain on the machine, after an update. */
export async function runBrainRefresh(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain refresh", args);
  const all = Boolean(parsed.values.all);
  if (parsed.positionals.length > 1 || (all && parsed.positionals.length > 0))
    throw userError("brain refresh takes one brain, or --all", "usage");
  const known = knownBrains(ctx.home).filter((b) => b.onDisk);
  const chain = chainBrains(ctx);
  // A brain given as a folder may be one the machine knows under another path; one it does not know has no key to record.
  const keyOf = (root: string): string | undefined =>
    chain.find((b) => b.root === root)?.key ?? known.find((b) => b.folder === root)?.key;
  const roots = all ? known.map((b) => b.folder) : brainsNamed(parsed.positionals[0], ctx, "refresh");
  const version = ctx.version ?? VERSION;
  const results: RefreshResult[] = [];
  for (const root of roots) {
    const config = readBrainConfig(root);
    const key = keyOf(root);
    results.push(
      await refreshBrain(
        {
          key: key ?? root,
          known: key !== undefined,
          tier: config.tier,
          root,
        },
        version,
        ctx.home,
        ctx.now(),
        !all,
      ),
    );
  }
  const text = results
    .map((r) =>
      r.left === "newer"
        ? `${brainRepoOfKey(r.brain)}: left as they are; kioku ${r.held} wrote them, newer than ${version}.`
        : r.left === "build"
          ? `${brainRepoOfKey(r.brain)}: left as they are; ${version} is a build, not a release, which writes a shared brain only when it is named: kioku brain refresh ${brainRepoOfKey(r.brain)}.`
          : r.written.length === 0
            ? `${brainRepoOfKey(r.brain)}: the files kioku owns are current.`
            : `${brainRepoOfKey(r.brain)}: wrote ${r.written.join(", ")} (commit ${r.commit}, ${r.publication}).`,
    )
    .join("\n");
  return { data: { brains: results }, text };
}
