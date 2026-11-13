import { groupHelp, unknownVerb } from "./help.ts";
import { PLAIN } from "./render.ts";
import { runSearch } from "./search.ts";
import { runPages, runShow } from "./pages.ts";
import {
  runConfirm,
  runEvolve,
  runForget,
  runLink,
  runMerge,
  runMove,
  runPromote,
  runRename,
  runRestore,
  runRetire,
  runSave,
  runSupersede,
  runUpdate,
} from "./write.ts";
import type { Handler } from "./run.ts";
import type { GroupVerb } from "./verbs.ts";

/** The verbs of `kioku page <verb>` (§6.1), the ones the table declares: the compiler holds both to one list. */
const verbs: Record<GroupVerb<"page">, Handler> = {
  save: runSave,
  update: runUpdate,
  supersede: runSupersede,
  forget: runForget,
  confirm: runConfirm,
  retire: runRetire,
  rename: runRename,
  move: runMove,
  merge: runMerge,
  restore: runRestore,
  link: runLink,
  promote: runPromote,
  evolve: runEvolve,
  search: runSearch,
  list: runPages,
  show: runShow,
};

/** `kioku page <verb>`. */
export const runPage: Handler = (args, ctx) => {
  const [verb, ...rest] = args;
  if (verb === undefined) return groupHelp(ctx.ui ?? PLAIN, "page");
  if (!Object.hasOwn(verbs, verb)) throw unknownVerb(verb, "page");
  return verbs[verb as GroupVerb<"page">](rest, ctx);
};
