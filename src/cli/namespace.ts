import { userError } from "../core/errors.ts";
import { listNamespaces } from "../core/write/namespace.ts";
import { parseVerb } from "./args.ts";
import { chainBrains, pickBrain } from "./chain.ts";
import { groupHelp, unknownVerb } from "./help.ts";
import { PLAIN, paint, table } from "./render.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import type { GroupVerb } from "./verbs.ts";
import { runAddNamespace, runDescribeNamespace, runRenameNamespace } from "./write.ts";

/** `kioku namespace list [--brain <b>]` (§3.2): each brain's namespaces with the pages in them. */
function runList(args: string[], ctx: Context): Outcome {
  // The words are read so that one given is told this verb's usage, not the parser's words.
  const parsed = parseVerb("namespace list", args, { positionals: true });
  if (parsed.positionals.length > 0) throw userError("namespace list takes no arguments", "usage");
  const chain = chainBrains(ctx).filter((b) => b.cloned);
  const chosen = parsed.values.brain === undefined ? chain : [pickBrain(chain, parsed.values.brain, ctx)];
  const brains = chosen.map((b) => ({ brain: b.key, tier: b.tier, namespaces: listNamespaces(b.root) }));
  const ui = ctx.ui ?? PLAIN;
  const p = paint(ui);
  const text =
    brains.length === 0
      ? "No brain of this folder's chain is on this machine."
      : brains
          .map((b) => {
            const rows = b.namespaces.map((n) => {
              const kinds = Object.entries(n.pages)
                .map(([k, c]) => `${c} ${k}`)
                .join(", ");
              const below = n.below > 0 ? `${n.below} more under it` : "";
              return [
                `${"  ".repeat(n.depth - 1)}${n.namespace}`,
                String(n.total),
                [kinds, below].filter((x) => x !== "").join("; "),
              ];
            });
            const grid = table(ui, ["NAMESPACE", "PAGES", "KINDS"], rows, {
              right: [1],
              indent: "  ",
              style: (c, r, cell) =>
                r === -1
                  ? p.title(cell)
                  : c === 0
                    ? p.name(cell)
                    : c === 1 && cell.trim() === "0"
                      ? p.dim(cell)
                      : c === 2
                        ? p.dim(cell)
                        : cell,
            });
            return `${p.name(b.brain)} ${p.dim(`(${b.tier})`)}\n${grid}`;
          })
          .join("\n\n");
  return { data: { brains }, text };
}

/** The verbs of `kioku namespace <verb>` (§6.1), the ones the table declares: the compiler holds both to one list. */
const verbs: Record<GroupVerb<"namespace">, Handler> = {
  list: runList,
  add: runAddNamespace,
  describe: runDescribeNamespace,
  rename: runRenameNamespace,
};

/** `kioku namespace <verb>`: what looks at and changes a brain's namespaces. */
export const runNamespace: Handler = (args, ctx) => {
  const [verb, ...rest] = args;
  if (verb === undefined) return groupHelp(ctx.ui ?? PLAIN, "namespace");
  if (!Object.hasOwn(verbs, verb)) throw unknownVerb(verb, "namespace");
  return verbs[verb as GroupVerb<"namespace">](rest, ctx);
};
