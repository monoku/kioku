import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import type { TargetBrain } from "../core/write/apply.ts";
import { readBrainConfig } from "../core/brain/brain.ts";
import { setLanguage } from "../core/write/language.ts";
import { addNamespace, describeNamespace, renameNamespace } from "../core/write/namespace.ts";
import { promote } from "../core/write/promote.ts";
import {
  confirm,
  evolve,
  forget,
  link,
  retire,
  save,
  skillCandidates,
  supersede,
  update,
} from "../core/write/verbs.ts";
import { merge, restore } from "../core/write/merge.ts";
import { move, rename } from "../core/write/rewrite.ts";
import { type ChainBrain, chainBrains, locate, pickBrain, target } from "./chain.ts";
import type { Context } from "./run.ts";
import {
  acting,
  cloned,
  committed,
  env,
  list,
  NONE,
  outcome,
  page,
  PATH,
  required,
  stdinBody,
  told,
  TWO_PATHS,
  withWarnings,
  writing,
} from "./writing.ts";

/** `save` (§1.4): `--see-also` narrows the pages a created page links to; `--see-also none` links none. */
export const runSave = writing("page save", NONE, async (c) => {
  const { ctx, values } = c;
  const chain = chainBrains(ctx);
  const brain = acting(c.at, target(pickBrain(chain, required(values.brain, "brain"), ctx)));
  const text = await stdinBody(ctx);
  if (text.trim() === "") throw userError("the page's body comes on stdin", "usage");
  // The session's other brains, whose pages on the subject the answer names beside the brain's own (§1.4).
  const others = chain.filter((b) => b.cloned && b.key !== brain.key).map((b) => ({ key: b.key, root: b.root }));
  const seeAlso = list(values["see-also"])?.filter((p) => p !== "none");
  if (seeAlso !== undefined && !values.create) throw userError("--see-also goes with --create", "usage");
  const input = {
    kind: required(values.kind, "kind"),
    title: required(values.title, "title"),
    source: required(values.source, "source"),
    body: text,
    create: Boolean(values.create),
    ...c.given(["sub", "evidence", "summary", "aliases", "namespace", "stale-after", "source-version", "applies-to"]),
    ...(seeAlso !== undefined && { seeAlso }),
    ...(others.length > 0 && { others }),
  };
  return outcome("Saved", await save(brain, input, env(ctx)));
});

/** `link` (§3.3): two pages of one brain, each under the other's See also. */
export const runLink = writing("page link", TWO_PATHS, async (c) => {
  const { type } = c.values;
  if (type !== undefined && type !== "contradicts" && type !== "qualifies")
    throw userError(`--type is contradicts or qualifies, not "${type}"`, "usage");
  const where = page(c, c.positionals[0]!);
  const other = locate(c.ctx, c.positionals[1]!, c.values.brain);
  if (other.brain.key !== where.brain.key) {
    throw userError(
      `links are relative paths inside one brain, and ${where.rel} is in ${brainRepoOfKey(where.brain.key)} while ${other.rel} is in ${brainRepoOfKey(other.brain.key)}`,
      "different_brains",
    );
  }
  return outcome("Linked", await link(where.brain, where.rel, other.rel, env(c.ctx), type));
});

export const runUpdate = writing("page update", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  const text = await stdinBody(c.ctx);
  const input = {
    ...(text.trim() !== "" && { body: text }),
    ...c.given([
      "section",
      "evidence",
      "source",
      "note",
      "summary",
      "aliases",
      "stale-after",
      "source-version",
      "applies-to",
    ]),
  };
  return outcome("Updated", await update(where.brain, where.rel, input, env(c.ctx)));
});

export const runSupersede = writing("page supersede", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  const text = await stdinBody(c.ctx);
  if (text.trim() === "") throw userError("the new decision's body comes on stdin", "usage");
  const input = {
    title: required(c.values.title, "title"),
    source: required(c.values.source, "source"),
    body: text,
    ...c.given(["evidence", "summary", "aliases", "namespace", "stale-after", "source-version"]),
  };
  return outcome("Wrote", await supersede(where.brain, where.rel, input, env(c.ctx)));
});

export const runForget = writing("page forget", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  return outcome("Forgot", await forget(where.brain, where.rel, env(c.ctx)));
});

/** `evolve` (§3.6): without a path, the Skill candidates of the chain or of the brain named; with one, the instinct turned into a Skill. */
export const runEvolve = writing("page evolve", { ...PATH, optional: true }, async (c) => {
  const { ctx, values, positionals } = c;
  const to = values.to ?? "skill";
  if (to !== "skill" && to !== "rule" && to !== "playbook")
    throw userError(`--to is skill, rule or playbook, not "${to}"`, "usage");
  if (values.to !== undefined && positionals.length === 0)
    throw userError("--to says what an instinct becomes: give the instinct's path", "usage");
  if (positionals.length === 0) {
    const chain = cloned(ctx);
    const candidates = skillCandidates(
      (values.brain === undefined ? chain : [pickBrain(chain, values.brain, ctx)]).map(target),
    );
    const text =
      candidates.length === 0
        ? "No instinct is a candidate for a Skill."
        : candidates
            .map((s) => `${s.path} in ${brainRepoOfKey(s.brain)} (${s.occasions} occasions): ${s.when.split("\n")[0]}`)
            .join("\n");
    return { data: { candidates }, text };
  }
  const where = page(c, positionals[0]!);
  return outcome("Wrote", await evolve(where.brain, where.rel, env(ctx), to));
});

/** `confirm` (§3.3): the page is still true. */
export const runConfirm = writing("page confirm", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  return outcome("Confirmed", await confirm(where.brain, where.rel, c.given(["note"]), env(c.ctx)));
});

/** `retire` (§3.3): no longer current, kept as history. */
export const runRetire = writing("page retire", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  const r = await retire(where.brain, where.rel, c.given(["reason", "undo"]), env(c.ctx));
  return outcome(c.values.undo === true ? "Brought back" : "Retired", r);
});

/** `move` (§3.2): a page goes to another namespace of its brain; links follow. */
export const runMove = writing("page move", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  const input = { namespace: required(c.values.namespace, "namespace") };
  return outcome("Moved", await move(where.brain, where.rel, input, env(c.ctx)));
});

/** `rename` (§3.3): a new title and file name; links follow. */
export const runRename = writing("page rename", PATH, async (c) => {
  const where = page(c, c.positionals[0]!);
  const input = { title: required(c.values.title, "title") };
  return outcome("Renamed", await rename(where.brain, where.rel, input, env(c.ctx)));
});

/** `merge` (§3.5): two pages of one brain made one, the merged body on stdin; links follow. */
export const runMerge = writing("page merge", TWO_PATHS, async (c) => {
  const from = locate(c.ctx, c.positionals[0]!, c.values.brain);
  const into = page(c, c.positionals[1]!);
  if (from.brain.key !== into.brain.key) {
    throw userError(
      `two pages of one brain are merged, and ${from.rel} is in ${brainRepoOfKey(from.brain.key)} while ${into.rel} is in ${brainRepoOfKey(into.brain.key)}; kioku page promote takes a page to another brain`,
      "different_brains",
    );
  }
  const input = { body: await stdinBody(c.ctx) };
  return outcome(`Merged ${from.rel} into`, await merge(into.brain, from.rel, into.rel, input, env(c.ctx)));
});

/** `restore` (§3.5): a page that is gone, back as it was. The brain is named: nothing in it says where the page was. */
export const runRestore = writing("page restore", PATH, async (c) => {
  required(c.values.brain, "brain");
  const where = page(c, c.positionals[0]!);
  return outcome("Restored", await restore(where.brain, where.rel, env(c.ctx)));
});

/** `promote` (§1.3): the page again in a more shared brain. */
export const runPromote = writing("page promote", PATH, async (c) => {
  const { ctx, values } = c;
  if (values.keep === true && values.forget === true)
    throw userError("--keep and --forget are the two things that can happen to the original: pass one", "usage");
  const where = page(c, c.positionals[0]!);
  const destination = target(pickBrain(cloned(ctx), required(values.to, "to"), ctx));
  const input = {
    body: await stdinBody(ctx),
    ...c.given(["title", "summary", "aliases", "namespace", "evidence", "create"]),
    original:
      values.keep === true ? ("keep" as const) : values.forget === true ? ("forget" as const) : ("retire" as const),
  };
  return outcome("Promoted", await promote(where.brain, where.rel, destination, input, env(ctx)));
});

/** The one brain of the chain that has this namespace, if any; two are for `--brain` to tell apart. */
function holderOf(chain: ChainBrain[], namespace: string): ChainBrain | undefined {
  const having = chain.filter((b) => readBrainConfig(b.root).namespaces.includes(namespace));
  if (having.length > 1)
    throw userError(
      `${having.map((b) => b.key).join(" and ")} have a namespace ${namespace}; name one with --brain`,
      "brain_ambiguous",
    );
  return having[0];
}

/** The brain a write with nothing to find it by acts on, always named (§6.1): `namespace add`, `brain language`. */
function namedBrain(ctx: Context, named: string): TargetBrain {
  return target(pickBrain(cloned(ctx), named, ctx));
}

/** The brain `namespace describe` acts on: `--brain`, else the one that has the namespace, else the only brain of the chain. */
function namespaceBrain(ctx: Context, named: string | undefined, namespace: string): TargetBrain {
  const chain = cloned(ctx);
  if (named !== undefined) return target(pickBrain(chain, named, ctx));
  const holder = holderOf(chain, namespace);
  if (holder !== undefined) return target(holder);
  if (chain.length === 1) return target(chain[0]!);
  if (chain.length === 0) throw userError("no brain of this folder's chain is on this machine", "not_found");
  throw userError(`name the brain with --brain (${chain.map((b) => b.key).join(", ")})`, "brain_ambiguous");
}

/** `namespace rename` (§3.2): its folder, its pages' `namespace`, `kioku.yaml` and the links into it follow, in one commit. */
export const runRenameNamespace = writing("namespace rename", told("namespace rename", 2), async (c) => {
  const { ctx, values } = c;
  const [from, to] = c.positionals as [string, string];
  const chain = cloned(ctx);
  const found = values.brain !== undefined ? pickBrain(chain, values.brain, ctx) : holderOf(chain, from);
  if (found === undefined) throw userError(`no brain of this folder's chain has a namespace ${from}`, "not_found");
  const brain = acting(c.at, target(found));
  const r = await renameNamespace(brain, { from, to, dryRun: values["dry-run"] === true }, env(ctx));
  const files = `${r.moved.length} file${r.moved.length === 1 ? "" : "s"} moved, ${r.rewritten.length} page${r.rewritten.length === 1 ? "" : "s"} rewritten`;
  const text =
    r.status === "dry-run"
      ? `Would rename the namespace ${from} to ${to} in ${brainRepoOfKey(r.brain)}: ${files}. Nothing was written.`
      : `Renamed the namespace ${from} to ${to} in ${brainRepoOfKey(r.brain)}: ${files} ${committed(r)}.`;
  return { data: withWarnings(r), text };
});

/** `namespace add` (§3.2): a namespace is declared and its index written. */
export const runAddNamespace = writing("namespace add", told("namespace add", 1), async (c) => {
  const summary = required(c.values.summary, "summary");
  const brain = acting(c.at, namedBrain(c.ctx, required(c.values.brain, "brain")));
  const r = await addNamespace(brain, { namespace: c.positionals[0]!, summary }, env(c.ctx));
  return {
    data: withWarnings(r),
    text: `Added the namespace ${r.namespace} to ${brainRepoOfKey(r.brain)} ${committed(r)}.`,
  };
});

/** `brain language` (§3.2): the language the brain's pages are written in. */
export const runBrainLanguage = writing("brain language", told("brain language", 1), async (c) => {
  const brain = acting(c.at, namedBrain(c.ctx, required(c.values.brain, "brain")));
  const r = await setLanguage(brain, { language: c.positionals[0]! }, env(c.ctx));
  return {
    data: withWarnings(r),
    text: `${brainRepoOfKey(r.brain)} now says its pages are written in ${r.language} ${committed(r)}.`,
  };
});

/** `namespace describe` (§3.2): what a namespace is for. */
export const runDescribeNamespace = writing("namespace describe", told("namespace describe", 1), async (c) => {
  const summary = required(c.values.summary, "summary");
  const namespace = c.positionals[0]!;
  const brain = acting(c.at, namespaceBrain(c.ctx, c.values.brain, namespace));
  const r = await describeNamespace(brain, { namespace, summary }, env(c.ctx));
  return {
    data: withWarnings(r),
    text: `Described the namespace ${r.namespace} of ${brainRepoOfKey(r.brain)} ${committed(r)}.`,
  };
});
