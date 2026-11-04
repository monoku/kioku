import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { findConfigRoot } from "../core/config/chain.ts";
import { readFolderConfig } from "../core/config/folder-config.ts";
import { userError } from "../core/errors.ts";
import { located } from "./brain-path.ts";
import { chainBrains } from "./chain.ts";
import type { Context } from "./run.ts";

/**
 * The brains a `kioku brain <verb> [<brain>]` acts on: a folder; a brain of this machine by tier, key or
 * repository, wherever the person is (§6.1); or, with none named, the brain the folder is inside, else the chain's.
 */
/** The key a brain is recorded under on this machine, else `folder:<root>` for one only named by its folder. */
export const brainKeyOf = (chain: { root: string; key: string }[], root: string): string =>
  chain.find((b) => b.root === root)?.key ?? `folder:${root}`;

export function brainsNamed(arg: string | undefined, ctx: Context, verb: string): string[] {
  const chain = chainBrains(ctx);
  if (arg !== undefined) {
    const asPath = resolve(ctx.cwd, arg);
    if (existsSync(asPath) && statSync(asPath).isDirectory()) return [asPath];
    return [located(ctx, arg, verb).folder];
  }
  const nearest = findConfigRoot(ctx.cwd);
  if (nearest !== undefined) {
    const own = readFolderConfig(`${nearest}/kioku.yaml`);
    if (own.ok && own.value.form === "brain") return [nearest];
  }
  const cloned = chain.filter((b) => b.cloned).map((b) => b.root);
  if (cloned.length === 0) throw userError(`there is no brain to ${verb} here; pass a folder or a brain`, "brain_none");
  return cloned;
}
