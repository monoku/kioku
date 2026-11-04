import { brainRepoAt } from "../core/brains/list.ts";
import { parseVerb } from "./args.ts";
import { plural } from "./render.ts";
import { conflictsOf, openConflict, repoOfKey, resolveConflict, showConflict } from "../core/conflicts.ts";
import { userError } from "../core/errors.ts";
import { brainKeyOf, brainsNamed } from "./brains-named.ts";
import { chainBrains } from "./chain.ts";
import type { Context, Outcome } from "./run.ts";

/**
 * `kioku brain conflicts [<brain>] [--branch <b> [--page <p>]] [--open <b>] [--resolve <b>]` (§1.6): the
 * changes of this machine kept aside because they conflicted with what others published. Lists them; shows both
 * versions of a page; opens one as a folder; and, once what should stand was written with `update`, resolves it.
 */
export function runBrainConflicts(args: string[], ctx: Context): Outcome {
  const parsed = parseVerb("brain conflicts", args);
  if (parsed.positionals.length > 1) throw userError("brain conflicts takes at most one brain", "usage");
  const { branch, page, open, resolve: toResolve } = parsed.values;
  if ([branch, open, toResolve].filter((v) => v !== undefined).length > 1)
    throw userError("--branch, --open and --resolve are one action each: pass one", "usage");
  if (page !== undefined && branch === undefined) throw userError("--page goes with --branch", "usage");
  const chain = chainBrains(ctx);
  const roots = brainsNamed(parsed.positionals[0], ctx, "conflicts");
  const named = (root: string) => ({ root, name: brainRepoAt(root, ctx.home), key: brainKeyOf(chain, root) });
  const wanted = branch ?? open ?? toResolve;

  if (wanted === undefined) {
    const brains = roots.map((root) => ({ brain: named(root).name, root, conflicts: conflictsOf(root) }));
    const text = brains
      .map((b) =>
        b.conflicts.length === 0
          ? `${b.brain}: no conflicts`
          : [
              `${b.brain}: ${plural(b.conflicts.length, "conflict")}`,
              ...b.conflicts.map(
                (c) =>
                  `  ${c.branch} (${c.date ?? "?"}): ${c.pages.join(", ") || "no page differs now"}${c.worktree ? `\n    opened at ${c.worktree}` : ""}`,
              ),
            ].join("\n"),
      )
      .join("\n");
    return { data: { brains }, text };
  }

  const root = roots.find((r) => conflictsOf(r).some((c) => c.branch === wanted));
  if (root === undefined)
    throw userError(
      `no brain here has a conflict branch called ${wanted}; kioku brain conflicts lists them`,
      "conflict_unknown",
    );
  const brain = named(root);
  if (branch !== undefined) {
    const pages = showConflict(root, branch, page);
    const text = pages
      .map((p) =>
        [
          `== ${p.page}`,
          "-- the team's, now:",
          p.theirs ?? "(gone)",
          "-- yours, kept aside:",
          p.mine ?? "(deleted)",
          ...(p.base !== null ? ["-- where both started:", p.base] : []),
        ].join("\n"),
      )
      .join("\n");
    return {
      data: { brain: brain.name, branch, pages },
      text: text === "" ? `${branch} changes no page that still differs; resolve it with --resolve ${branch}` : text,
    };
  }
  if (open !== undefined) {
    const o = openConflict(ctx.home, repoOfKey(brain.key), root, open);
    return {
      data: { brain: brain.name, branch: open, ...o },
      text: `${open} of ${brain.name} is open at ${o.brainFolder}; kioku brain conflicts ${brain.name} --resolve ${open} removes it with the branch.`,
    };
  }
  const r = resolveConflict(root, toResolve!);
  return {
    data: { brain: brain.name, ...r },
    text: `Resolved ${r.branch} of ${brain.name}${r.removedWorktree ? ", and removed its folder" : ""}.`,
  };
}
