import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { initRepository } from "../core/brains/init.ts";
import { readMachineConfig, remindsUnpublished } from "../core/config/machine.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { VERSION } from "../version.ts";
import { folderArg } from "./chain.ts";
import { viaOf } from "./via.ts";
import type { Handler } from "./run.ts";
import { checklist, PLAIN, type Mark } from "./render.ts";

/** `kioku init [<brain>] [--team <brain>] [--create] [--dir <folder>]` (§2.4, §6.1); with no brain, the ones the folder's `kioku.yaml` names. */
export const runInit: Handler = async (args, ctx) => {
  const parsed = parseVerb("init", args);
  if (parsed.positionals.length > 1) {
    throw userError(
      "init takes one project brain, with --team a team brain, or both; with none, the ones the folder's kioku.yaml names",
      "usage",
    );
  }
  const r = await initRepository(ctx.home, ctx.cwd, {
    ...(parsed.positionals[0] !== undefined && { brain: parsed.positionals[0] }),
    ...(parsed.values.team !== undefined && { team: parsed.values.team }),
    ...(parsed.values.dir !== undefined && { dir: folderArg(ctx, parsed.values.dir) }),
    interactive: ctx.interactive === true,
    ...(parsed.values.create && { create: { version: VERSION, via: viaOf(ctx) } }),
  });
  const remind = remindsUnpublished(readMachineConfig(ctx.home));
  const named = [r.brain && `the project brain ${r.brain}`, r.team && `the team brain ${r.team}`]
    .filter(Boolean)
    .join(" and ");
  const failed = r.cloned.filter((o) => o.status === "failed");
  const items: [Mark, string][] = [
    r.wrote
      ? ["done", `Wrote ${r.file} linking this folder to ${named}`]
      : ["done", `Found ${r.file} already linking this folder to ${named}`],
    ...r.created.map((c): [Mark, string] => [
      "done",
      `Made the ${c.tier} brain ${brainRepoOfKey(c.brain)} at ${c.path}, on this machine${remind ? `; kioku brain publish ${brainRepoOfKey(c.brain)} puts it in a repository you make` : ""}`,
    ]),
    ...r.cloned.map((o): [Mark, string] => [
      o.status === "cloned" ? "done" : "failed",
      `${o.status === "cloned" ? "Cloned" : "Could not clone"} the ${o.tier} brain ${o.key}${o.message ? `: ${o.message}` : ""}`,
    ]),
  ];
  if (r.wrote && r.inRepository) items.push(["todo", `Commit ${r.file} with the code.`]);
  return {
    data: r,
    text: checklist(ctx.ui ?? PLAIN, items, [`Chain here: ${r.chain.map((l) => `${l.tier} ${l.key}`).join(" → ")}.`]),
    ...(failed.length > 0 && { exit: 1 }),
  };
};
