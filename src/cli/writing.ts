import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { parseVerb } from "./args.ts";
import { KiokuError, type Naming, userError } from "../core/errors.ts";
import { PublishConflict, ValidationRefused, type TargetBrain } from "../core/write/apply.ts";
import type { WriteContext } from "../core/write/apply.ts";
import type { Done, NeedsNamespace, Similar } from "../core/write/verbs.ts";
import type { Finding } from "../core/validate/validate.ts";
import { type ChainBrain, chainBrains, locate } from "./chain.ts";
import { viaOf } from "./via.ts";
import { knownUser } from "../core/setup/personal.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import { misuse } from "./help.ts";
import { flagOf, type Values, type VerbName, VERBS } from "./verbs.ts";

export const env = (ctx: Context): WriteContext => {
  // Who confirms a page (§3.3), and authors a commit where git knows no one: the name git or the system knows (§2.3),
  // asked of git only when a write needs it, and once.
  let user: { name: string | undefined } | undefined;
  return {
    home: ctx.home,
    now: ctx.now(),
    via: viaOf(ctx),
    user: () => (user ??= { name: knownUser() }).name,
  };
};

/** The brains of this folder's chain that are on this machine. */
export const cloned = (ctx: Context): ChainBrain[] => chainBrains(ctx).filter((b) => b.cloned);

/** The writing verbs' shape of a write's warnings (§6.1). */
const shownWarnings = (warnings: Finding[]): Pick<Finding, "path" | "warning" | "message">[] =>
  warnings.map((w) => ({ path: w.path, warning: w.warning, message: w.message }));

/** A change to a brain's configuration, answered as a write is: its warnings in the writing verbs' shape (§6.1). */
export function withWarnings<T extends { warnings?: Finding[] }>(r: T) {
  const { warnings, ...rest } = r;
  return { ...rest, ...(warnings !== undefined && warnings.length > 0 && { warnings: shownWarnings(warnings) }) };
}

export const list = (v: string[] | undefined): string[] | undefined =>
  v
    ?.flatMap((x) => x.split(","))
    .map((x) => x.trim())
    .filter(Boolean);

export const required = (v: string | undefined, flag: string): string => {
  if (v === undefined) throw userError(`--${flag} is required`, "usage");
  return v;
};

const PUBLICATION: Record<Done["publication"], string> = {
  pushed: "published",
  pending: "publication pending; sync retries it",
  local: "local; sync pushes it",
};

/** The end of a configuration write's line: its commit and whether it left the machine. */
export const committed = (r: { commit?: string | null; publication?: Done["publication"] | null }): string =>
  `(commit ${r.commit}, ${PUBLICATION[r.publication!]})`;

/** The one result shape of the writing verbs (§6.1): status, brain, path, commit, publication. */
/** What a person is told of the pages on the subject in the chain's other brains (§1.4). */
const elsewhereLine = (pages: Done["elsewhere"]): string =>
  pages === undefined || pages.length === 0
    ? ""
    : `\nOn the same subject in other brains: ${pages.map((e) => `${e.path} (${e.title}; ${brainRepoOfKey(e.brain)})`).join("; ")}`;

export function outcome(verb: string, r: Done | Similar | NeedsNamespace): Outcome {
  const nothing = { brain: r.brain, path: null, commit: null, publication: null };
  if (r.status === "namespace") {
    const lines = r.namespaces.map(
      (n) =>
        `${n.namespace}: ${n.summary ?? "(not described)"} (${n.pages} page${n.pages === 1 ? "" : "s"}${n.below > 0 ? `, ${n.below} under it` : ""})`,
    );
    return {
      data: { status: "namespace", ...nothing, namespaces: r.namespaces },
      text: `Nothing written: ${brainRepoOfKey(r.brain)} has more than one namespace; say which with --namespace <path>.\n${lines.join("\n")}`,
    };
  }
  if (r.status === "similar") {
    return {
      data: { status: "similar", ...nothing, similar: r.similar, ...(r.elsewhere && { elsewhere: r.elsewhere }) },
      text: `Nothing written: ${brainRepoOfKey(r.brain)} has pages on the same subject. Update or supersede one, or save again with --create.\n${r.similar.map((s) => `${s.path} (${s.title})`).join("; ")}${elsewhereLine(r.elsewhere)}`,
    };
  }
  const { status, brain, path, commit, publication, warnings, ...rest } = r;
  const data = {
    status,
    brain,
    path,
    commit,
    publication,
    ...rest,
    ...(warnings.length > 0 && { warnings: shownWarnings(warnings) }),
  };
  const extra =
    r.linkedFrom && r.linkedFrom.length > 0 ? `\nThese pages linked to it: ${r.linkedFrom.join(", ")}.` : "";
  const what = r.to === undefined ? r.path : `${r.path} and ${r.to}`;
  return {
    data,
    text: `${verb} ${what} in ${brainRepoOfKey(r.brain)} (commit ${r.commit}, ${PUBLICATION[r.publication]}).${extra}${elsewhereLine(r.elsewhere)}`,
  };
}

/**
 * A refusal in the same shape, so an agent reads one kind of result. A failure met after a commit was made carries
 * that commit, its brain and its publication, never `null` (§1.6): the agent never reports as failed a write that
 * exists.
 */
export function refusal(e: unknown, brain: string | null, path: string | null, text?: string): Outcome {
  if (!(e instanceof KiokuError)) throw e;
  const error = {
    code: e.code,
    message: e.message,
    ...(e instanceof ValidationRefused && { findings: e.findings }),
    ...(e instanceof PublishConflict && { conflict: e.conflict }),
  };
  const w = e.written;
  return {
    data: {
      status: "error",
      brain: w?.brain ?? brain,
      path: w?.path ?? path,
      commit: w?.commit ?? null,
      publication: w?.publication ?? null,
      error,
    },
    text: w === undefined ? `Not written: ${text ?? e.message}` : `Written, then failed: ${text ?? e.message}`,
    exit: e.exit,
  };
}

/** The core's refusals name a field; here a person types a flag and has stdin, and every command applies. */
const ON_THE_COMMAND_LINE: Naming = { field: flagOf, cli: (words) => words };

export async function stdinBody(ctx: Context): Promise<string> {
  return (await ctx.stdin()).replace(/\r\n?/g, "\n");
}

type Camel<S extends string> = S extends `${infer A}-${infer B}` ? `${A}${Capitalize<Camel<B>>}` : S;
/** What `given` answers for these flags: each under its field's name, when it was passed. */
type Given<V extends VerbName, K extends keyof Values<V> & string> = {
  [F in K as Camel<F>]?: NonNullable<Values<V>[F]>;
};

/** One call of a writing verb: its parse, and where its refusal says it was once that is known. */
interface Call<V extends VerbName> {
  ctx: Context;
  values: Values<V>;
  positionals: string[];
  at: { brain: string | null; path: string | null };
  /** The flags passed, as the core's fields: `--stale-after` is `staleAfter`; one the table lets repeat is a list. */
  given<K extends keyof Values<V> & string>(flags: readonly K[]): Given<V, K>;
}

/** How many positionals a verb takes, and what a wrong count is told. */
interface Words {
  count: number;
  usage?: string;
  optional?: true;
}
export const NONE: Words = { count: 0 };
export const PATH: Words = { count: 1, usage: "give the page's path" };
export const TWO_PATHS: Words = { count: 2, usage: "give the paths of the two pages" };
export const told = (verb: VerbName, count: number): Words => ({
  count,
  usage: `${verb} takes ${count === 1 ? "one argument" : `${count} arguments`}`,
});

/** A writing verb: parsed by its declaration, and whatever it throws answered as a refusal in its one shape (§6.1). */
export function writing<V extends VerbName>(
  verb: V,
  words: Words,
  act: (c: Call<V>) => Outcome | Promise<Outcome>,
): Handler {
  return async (args, ctx) => {
    const at: Call<V>["at"] = { brain: null, path: null };
    try {
      const { values, positionals } = parseVerb(verb, args);
      if (positionals.length !== words.count && !(words.optional && positionals.length === 0))
        throw userError(words.usage ?? "this verb takes no positional argument", "usage");
      const given: Call<V>["given"] = (flags) =>
        Object.fromEntries(
          flags.flatMap((flag) => {
            const value = values[flag] as string | boolean | string[] | undefined;
            if (value === undefined) return [];
            const field = flag.replace(/-(.)/g, (_, c: string) => c.toUpperCase());
            return [[field, VERBS[verb].flags[flag]!.multiple ? list(value as string[]) : value]];
          }),
        ) as never;
      return await act({ ctx, values, positionals, at, given });
    } catch (e) {
      if (e instanceof KiokuError && e.said !== undefined) e.message = e.said(ON_THE_COMMAND_LINE);
      // A verb misused is told with its usage and where help says more (§6.1).
      const told = e instanceof KiokuError && e.code === "usage" ? misuse(verb, e.message, ctx.ui) : undefined;
      if (told !== undefined) (e as KiokuError).message = told.message;
      return refusal(e, at.brain, at.path, told?.text);
    }
  };
}

/** The page a word names, which is from here on where the verb's refusal says it was. */
export function page(c: Pick<Call<VerbName>, "ctx" | "at"> & { values: { brain?: string } }, word: string) {
  const where = locate(c.ctx, word, c.values.brain);
  c.at.brain = where.brain.key;
  c.at.path = where.rel;
  return where;
}

/** The brain a verb acts on, which is from here on where its refusal says it was. */
export function acting(at: { brain: string | null }, brain: TargetBrain): TargetBrain {
  at.brain = brain.key;
  return brain;
}
