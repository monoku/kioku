import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { initRepository } from "../core/brains/init.ts";
import { readMachineConfig, remindsUnpublished } from "../core/config/machine.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { VERSION } from "../version.ts";
import { viaOf } from "./via.ts";
import type { Handler } from "./run.ts";
import { checklist, PLAIN, type Mark } from "./render.ts";
import { addressArg } from "./brain.ts";

/** `kioku init [<brain>]` (§2.4, §6.1): the project brain, by address or name; alone, what the folder's `kioku.yaml` names. */
export const runInit: Handler = async (args, ctx) => {
  const parsed = parseVerb("init", args);
  if (parsed.positionals.length > 1)
    throw userError(
      "init takes one project brain, an address or a name; with none, the ones the folder's kioku.yaml names. A folder's team is written by hand",
      "usage",
    );
  const given = parsed.positionals[0];
  const r = await initRepository(ctx.home, ctx.cwd, {
    ...(given !== undefined && { brain: addressArg(ctx, given, true) }),
    interactive: ctx.interactive === true,
    version: VERSION,
    via: viaOf(ctx),
  });
  const remind = remindsUnpublished(readMachineConfig(ctx.home));
  const named = [r.brain && `the project brain ${r.brain}`, r.team && `the team brain ${r.team}`]
    .filter(Boolean)
    .join(" and ");
  const failed = r.cloned.filter((o) => o.status === "failed");
  const items: [Mark, string][] = [
    ...(r.brought !== undefined
      ? [
          ["done", `Cloned the project brain ${r.brought.brain} from ${r.brought.url} to ${r.brought.path}`] as [
            Mark,
            string,
          ],
        ]
      : []),
    ...r.created.map((c): [Mark, string] => [
      "done",
      `Made the ${c.tier} brain ${brainRepoOfKey(c.brain)} at ${c.path}, on this machine${remind ? `; kioku brain publish ${brainRepoOfKey(c.brain)} --remote <address> puts it in a repository you make` : ""}`,
    ]),
    r.wrote
      ? ["done", `Wrote ${r.file} linking this folder to ${named}`]
      : ["done", `Found ${r.file} already linking this folder to ${named}`],
    ...r.addressed.map((k): [Mark, string] => [
      "done",
      `Wrote the address of ${k}, published since, so a teammate can clone it`,
    ]),
    ...r.cloned.map((o): [Mark, string] => [
      o.status === "cloned" ? "done" : "failed",
      `${o.status === "cloned" ? "Cloned" : "Could not clone"} the ${o.tier} brain ${o.key}${o.message ? `: ${o.message}` : ""}`,
    ]),
    ...r.notHere.map((k): [Mark, string] => [
      "todo",
      `${k} is named without an address and is not on this machine: a teammate who has it gives its address, and kioku init <address> links it`,
    ]),
  ];
  // A link by name alone works on the machines that have that brain and no others (§2.4).
  const local = [r.brain, r.team].filter(
    (k) => k !== undefined && !r.addressed.includes(k) && r.chain.some((l) => l.key === k && l.ref.url === undefined),
  );
  const then: string[] = [`Chain here: ${r.chain.map((l) => `${l.tier} ${l.key}`).join(" → ")}.`];
  for (const k of local)
    then.push(
      `${k} has no remote, so the file links it on this machine alone; once kioku brain publish ${k} --remote <address> gives it one, kioku init writes its address.`,
    );
  if (r.wrote && r.inRepository) items.push(["todo", `Commit ${r.file} with the code.`]);
  return {
    data: r,
    text: checklist(ctx.ui ?? PLAIN, items, then),
    ...(failed.length > 0 && { exit: 1 }),
  };
};
