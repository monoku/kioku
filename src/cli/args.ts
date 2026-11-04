import { parseArgs } from "node:util";
import { userError } from "../core/errors.ts";
import { optionsOf, type Values, type VerbName, VERBS } from "./verbs.ts";

/** What the parser said, in the tool's words (§6.1): a flag the verb does not have, a value missing or one it does not take, a word too many. */
function said(e: Error & { code?: string }, verb: VerbName): string {
  const quoted = /'([^']+)'/.exec(e.message)?.[1] ?? "";
  const flag = quoted.split(" ")[0]!;
  switch (e.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return `unknown flag ${flag}`;
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      return /does not take/.test(e.message) ? `${flag} takes no value` : `${flag} needs a value`;
    case "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL":
      return VERBS[verb].positional === "none" ? `${verb} takes no arguments` : `unexpected argument "${quoted}"`;
    default:
      return e.message;
  }
}

/**
 * A verb's arguments, read as its declaration says (§6.1): its flags, typed as the table declares them, and the words
 * that are not flags when the verb takes any. A flag the verb does not have, or a value missing, is told as `usage`, in
 * the tool's words; the verb's usage follows it wherever it is told (`run.ts`). `positionals: true` reads the words of
 * a verb that takes none, so that the verb tells its usage itself.
 */
export function parseVerb<V extends VerbName>(
  verb: V,
  args: string[],
  o: { positionals?: boolean } = {},
): { values: Values<V>; positionals: string[] } {
  const allowPositionals = o.positionals ?? VERBS[verb].positional !== "none";
  try {
    return parseArgs({ args, options: optionsOf(verb), allowPositionals, strict: true }) as unknown as {
      values: Values<V>;
      positionals: string[];
    };
  } catch (e) {
    throw userError(said(e as Error, verb), "usage");
  }
}
