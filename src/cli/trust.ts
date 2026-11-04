import { trust } from "../core/brains/trust.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import type { Context, Handler } from "./run.ts";
import { requireTerminal } from "./terminal.ts";

/**
 * `kioku brain trust <brain>` and `kioku brain trust --owner <owner>` (§2.4, §6.1). It asks for a
 * terminal: a brain a repository names is loaded only because a person decided so, and an agent running a command it
 * was told to by a page it read is not that person. An owner is the wider grant, so it is named by a flag.
 */
export const runTrust: Handler = async (args, ctx: Context) => {
  const parsed = parseVerb("brain trust", args);
  if (parsed.positionals.length !== 1)
    throw userError(
      "brain trust takes one brain, such as github.com/owner/repo, or with --owner one owner, such as github.com/owner",
      "usage",
    );
  requireTerminal(
    ctx,
    "kioku brain trust",
    "trusting a brain lets a repository's files reach the agent's context, so the agent does not do it",
  );
  const r = await trust(ctx.home, ctx.cwd, parsed.positionals[0]!, parsed.values.owner === true);
  const what = r.kind === "owner" ? `every brain of ${r.trusted}` : r.trusted;
  const lines = [r.added ? `This machine now trusts ${what}.` : `This machine already trusted ${what}.`];
  for (const o of r.cloned)
    lines.push(
      `${o.status === "cloned" ? "Cloned" : "Could not clone"} the ${o.tier} brain ${o.key}${o.message ? `: ${o.message}` : ""}.`,
    );
  return { data: r, text: lines.join("\n"), ...(r.cloned.some((o) => o.status === "failed") && { exit: 1 }) };
};
