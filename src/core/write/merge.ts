import { existsSync } from "node:fs";
import { join } from "node:path";
import { brainRel, isFrontPageAt } from "../brain/brain.ts";
import { brainRepoOfKey } from "../config/brain-ref.ts";
import { appendChangelog, evidenceOf, parseBrainFile, serializeBrainFile, type BrainFile } from "../brain/file.ts";
import { specFor } from "../brain/kinds.ts";
import { linkBetween, linksOf, resolveLink } from "../brain/paths.ts";
import { namedError, userError } from "../errors.ts";
import { git, gitQuiet } from "../git.ts";
import { applyChanges, bringIn, type TargetBrain, type WriteContext } from "./apply.ts";
import { assembleBody, joinSections, retargetLinks, SEE_ALSO, splitSections } from "./body.ts";
import { relink } from "./rewrite.ts";
import { described, readPage, today, type Done } from "./verbs.ts";

/**
 * The two verbs that make one page of two and bring back one that is gone (§3.5): `merge`, whose links follow as a
 * rename's do, and `restore`, the undo of whatever deleted a page.
 */

/** Evidence lines as an instinct keeps them, both pages' in the order of their dates, each once. */
function joinEvidence(into: BrainFile, from: BrainFile): void {
  const lines = [...evidenceOf(into), ...evidenceOf(from)]
    .map((e, at) => ({ at, date: e.date, line: `- ${e.date}: ${e.text} (${e.source})` }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
    .map((e) => e.line);
  const s = splitSections(into.body);
  const section = s.sections.find((x) => x.heading === "Evidence");
  if (section === undefined) return;
  // What is in the record and is no occasion, the note of an evolution, stays after them.
  const notes = section.text.split("\n").filter((l) => l.trim() !== "" && !lines.includes(l.trim()));
  section.text = [...new Set(lines), ...notes].join("\n");
  into.body = joinSections(s);
}

/**
 * The See also of the page that holds both (§3.3): its own entries, then those of the page taken in, written from
 * where it is; never one to itself or to the page that is gone, and each page once.
 */
function joinSeeAlso(into: BrainFile, intoRel: string, from: BrainFile, fromRel: string): void {
  const entriesOf = (file: BrainFile, rel: string) =>
    (splitSections(file.body).sections.find((x) => x.heading === SEE_ALSO)?.text ?? "").split("\n").flatMap((line) => {
      const written = linksOf(line)[0]?.target;
      const target = written === undefined ? undefined : resolveLink(rel, written);
      if (written === undefined || target === undefined) return line.trim() === "" ? [] : [{ line, target: line }];
      if (target === intoRel || target === fromRel) return [];
      return [
        { line: rel === intoRel ? line : line.replace(`(${written}`, `(${linkBetween(intoRel, target)}`), target },
      ];
    });
  const seen = new Set<string>();
  const lines = [...entriesOf(into, intoRel), ...entriesOf(from, fromRel)].flatMap((e) => {
    if (seen.has(e.target)) return [];
    seen.add(e.target);
    return [e.line];
  });
  const s = splitSections(into.body);
  const at = s.sections.findIndex((x) => x.heading === SEE_ALSO);
  if (lines.length === 0) {
    if (at >= 0) s.sections.splice(at, 1);
  } else if (at >= 0) s.sections[at]!.text = lines.join("\n");
  else {
    const tool = s.sections.findIndex((x) => x.heading === "Evidence" || x.heading === "Changelog");
    s.sections.splice(tool < 0 ? s.sections.length : tool, 0, { heading: SEE_ALSO, text: lines.join("\n") });
  }
  into.body = joinSections(s);
}

/**
 * `kioku page merge <from> <into>` (§3.5, §6.1): two pages on one subject become one, in one commit. `into` keeps its
 * `id` and takes the body sent; the title and the aliases of `from` become its aliases, so search still finds it by
 * them; an instinct keeps the occasions of both; its See also holds both pages'; every link of the brain to `from`
 * points to `into`, as a rename's do; `from` is deleted, and git keeps it. Only two pages of one kind and subkind,
 * and never a decision: a decision that changed is superseded.
 */
export async function merge(
  brain: TargetBrain,
  fromRel: string,
  intoRel: string,
  input: { body: string },
  env: WriteContext,
): Promise<Done> {
  const seen = await bringIn(brain);
  if (fromRel === intoRel) throw userError("a page is not merged into itself", "usage");
  const from = readPage(brain, fromRel);
  const into = readPage(brain, intoRel);
  const named = (t: typeof from.type) => (t.sub === undefined ? t.kind : `${t.kind} (${t.sub})`);
  if (from.type.kind !== into.type.kind || from.type.sub !== into.type.sub)
    throw userError(
      `${fromRel} is ${named(from.type)} and ${intoRel} is ${named(into.type)}; only two pages of one kind are merged`,
      "different_kinds",
    );
  if (into.type.sub === "decision")
    throw namedError(
      (n) =>
        `decisions are not merged: each stays as history; write the one that stands${n.cli(" with kioku page supersede")}, which replaces the old one`,
      "is_a_decision",
    );
  if (input.body.trim() === "")
    throw namedError((n) => `a merge needs the body of the page that holds both${n.cli(", on stdin")}`, "usage");

  const fromTitle = from.file.front.getString("title") ?? fromRel;
  const intoTitle = into.file.front.getString("title") ?? intoRel;
  const file = into.file;
  file.body = assembleBody(into.type, input.body, file.body);
  // A link the merged body, or the page's own, makes to the page that is going: it would point at nothing.
  file.body = retargetLinks(file.body, intoRel, fromRel, intoRel, fromTitle, intoTitle);
  joinSeeAlso(file, intoRel, from.file, fromRel);
  if (specFor(into.type).evidence) joinEvidence(file, from.file);
  const aliases = [
    ...new Set([...(file.front.getList("aliases") ?? []), fromTitle, ...(from.file.front.getList("aliases") ?? [])]),
  ].filter((a) => a !== intoTitle);
  if (aliases.length > 0) file.front.set("aliases", aliases);
  if (specFor(into.type).changelog) appendChangelog(file, today(env.now), `Merged with "${fromTitle}".`);

  const { changes, linked } = relink(brain, fromRel, intoRel, { old: fromTitle, new: intoTitle });
  const others = changes.filter((c) => c.rel !== intoRel);
  const applied = await applyChanges(
    brain,
    [{ rel: fromRel, text: null }, { rel: intoRel, text: serializeBrainFile(file) }, ...others],
    `merge: ${fromTitle} (into ${intoTitle})`,
    env,
    seen,
  );
  const relinked = linked.filter((rel) => rel !== intoRel);
  return {
    status: "done",
    brain: brain.key,
    path: intoRel,
    id: file.front.getString("id")!,
    ...described(intoRel, file.front),
    from: fromRel,
    ...applied,
    ...(relinked.length > 0 && { relinked }),
  };
}

/**
 * `kioku page restore <path>` (§3.5, §6.1): a page that is gone comes back as it was at the commit before the last one
 * that deleted it, a `forget` or a `merge`, in one commit, with its `id`. Refused where a page stands at the path,
 * and where the brain's history never deleted one there. It is validated as any write: a page whose links broke
 * since, or whose namespace is gone, is refused with what the validator found.
 */
export async function restore(brain: TargetBrain, rel: string, env: WriteContext): Promise<Done> {
  const seen = await bringIn(brain);
  const name = brainRepoOfKey(brain.key);
  if (brainRel(rel) !== rel) throw userError(`${rel} is not a path inside the brain ${name}`, "usage");
  if (!rel.endsWith(".md") || isFrontPageAt(rel)) throw userError(`${rel} is not a page of ${name}`, "not_a_page");
  if (existsSync(join(brain.root, rel)))
    throw userError(`${rel} is in ${name}: there is nothing to restore`, "path_exists");
  const deleted = gitQuiet(brain.root, ["log", "-1", "--diff-filter=D", "--no-renames", "--format=%H", "--", rel]);
  if (deleted === undefined)
    throw namedError(
      (n) =>
        `the history of ${name} deleted no page at ${rel}${n.cli("; kioku brain log lists the pages forgotten, each with its path")}`,
      "not_found",
    );
  // `./`: the path is the brain's, wherever the brain is in its repository.
  const text = `${git(brain.root, ["show", `${deleted}^:./${rel}`])}\n`;
  const parsed = parseBrainFile(text);
  const front = parsed.ok ? parsed.file.front : undefined;
  const applied = await applyChanges(brain, [{ rel, text }], `restore: ${front?.getString("title") ?? rel}`, env, seen);
  const id = front?.getString("id");
  return {
    status: "done",
    brain: brain.key,
    path: rel,
    ...(id !== undefined && { id }),
    ...described(rel, front),
    undoes: git(brain.root, ["rev-parse", "--short", deleted]),
    ...applied,
  };
}
