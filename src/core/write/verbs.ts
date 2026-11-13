import { brainRepoOfKey } from "../config/brain-ref.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brainRel, isFrontPageAt, listMarkdown } from "../brain/brain.ts";
import {
  appendChangelog,
  appendEvidence,
  appendEvidenceNote,
  evidenceOf,
  parseBrainFile,
  sectionBody,
  serializeBrainFile,
  withoutChangelog,
  type BrainFile,
} from "../brain/file.ts";
import { placementOf, specFor, typeOf, isKind, isSub, type PageType } from "../brain/kinds.ts";
import { DEPRECATED, isRetired, setVerified } from "../brain/lifecycle.ts";
import { buildBody, createPage } from "../brain/page.ts";
import { APPLIES_MAX, cleanGlob, globProblem, isNone } from "../brain/applies.ts";
import { linkBetween, linksOf, pagePath, resolveLink } from "../brain/paths.ts";
import { namespaceOverview } from "../brain/namespaces.ts";
import { namedError, userError, type Field } from "../errors.ts";
import { openIndex } from "../index/db.ts";
import { updateIndex } from "../index/indexer.ts";
import { sameSubject, similarPages, type Subject } from "../index/similar.ts";
import { candidateOccasions, evolvedInstinct } from "../lint.ts";
import { lastTouched, touchedOf } from "../touched.ts";
import {
  applyChanges,
  bringIn,
  type Applied,
  type FileChange,
  type Seen,
  type TargetBrain,
  type WriteContext,
} from "./apply.ts";
import { RULE_LENGTH_LIMIT } from "../validate/validate.ts";
import {
  addSeeAlso,
  assembleBody,
  linkText,
  RELATION_OF_OTHER,
  relateSeeAlso,
  replaceSection,
  seeAlsoEntries,
  seedEvidence,
  type Relation,
} from "./body.ts";
import { plural } from "../util.ts";

/** The date a page or a line carries: the machine's local day, `YYYY-MM-DD`. */
export const today = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export interface SimilarPage {
  brain: string;
  path: string;
  title: string;
  kind: string | null;
  subkind: string | null;
  summary: string;
  /** The day of the last commit that changed it, or null before any (§3.3). */
  touched: string | null;
}

/**
 * `save` in a brain with more than one namespace and told none (§3.2): nothing is written, and the answer is each
 * namespace and what it is for, so that the agent chooses. A brain with one needs no choice.
 */
export interface NeedsNamespace {
  status: "namespace";
  brain: string;
  namespaces: { namespace: string; summary: string | null; pages: number; below: number }[];
}

export interface Done extends Applied {
  status: "done";
  brain: string;
  path: string;
  /** `save`: pages on the subject in the chain's other brains (§1.4); absent when there are none. */
  elsewhere?: ElsewherePage[];
  id?: string;
  /** What the page is (§6.1), as it stands after the write, or stood before a forget: for the session's journal (§4.6). */
  title?: string;
  kind?: string;
  subkind?: string | null;
  /** `supersede`: the decision the new one replaces. */
  supersedes?: string;
  /** `link`: the other page. */
  to?: string;
  /** `rename`: the path the page had. */
  from?: string;
  /** The namespace the page went to (`save`, `move`). */
  namespace?: string;
  /** `rename`: the pages whose links now point at the new path. */
  relinked?: string[];
  /** `forget`: the pages whose links now point at nothing. */
  linkedFrom?: string[];
  /** `evolve`: the instinct the Skill came from. */
  instinct?: string;
  /** The instinct written is now a candidate for a Skill (§3.6). */
  candidate?: true;
  /** `evolve --to rule|playbook`: what the instinct became; a Skill is the default and is not named. */
  evolvedAs?: "rule" | "playbook";
}

export interface Similar {
  status: "similar";
  brain: string;
  similar: SimilarPage[];
  /** Pages on the subject in the chain's other brains (§1.4); absent when there are none. */
  elsewhere?: ElsewherePage[];
}

export interface PageInput {
  title: string;
  source: string;
  /** Which version of the source this was written from: a sha, a date or a hash. */
  sourceVersion?: string;
  evidence?: string;
  summary?: string;
  aliases?: string[];
  namespace?: string;
  /** `YYYY-MM-DD`: after it the page needs a second look (§3.3). */
  staleAfter?: string;
  /** Globs of the project's files the page is about (§3.3). */
  appliesTo?: string[];
  /** The page's sections as Markdown, `## ` headings included. */
  body: string;
}

/** Globs as `applies_to` keeps them (§3.3): each one inside the project folder, ten at most, each once. */
function globsOf(given: string[]): string[] {
  const globs = [...new Set(given.map(cleanGlob))];
  for (const g of globs) {
    const problem = globProblem(g);
    if (problem !== undefined)
      throw namedError((n) => `${n.field("applies_to")} does not take "${g}": ${problem}`, "applies_to_invalid");
  }
  if (globs.length > APPLIES_MAX)
    throw namedError(
      (n) => `${n.field("applies_to")} takes ${APPLIES_MAX} globs at most, and this is ${globs.length}`,
      "applies_to_invalid",
    );
  return globs;
}

export interface SaveInput extends PageInput {
  kind: string;
  sub?: string;
  /** Write even when pages on the same subject exist (§1.4). */
  create?: boolean;
  /** With `create`: the pages to link under See also instead of every similar one; empty for none (§3.3). */
  seeAlso?: string[];
  /** The other brains of the session's chain, whose pages on the same subject the answer names beside its own (§1.4). */
  others?: { key: string; root: string }[];
}

/** The most pages of other brains one save names. */
const ELSEWHERE_MAX = 3;

/** A page of another brain of the chain on the subject of the one saved (§1.4): named, never a reason not to write. */
export type ElsewherePage = Omit<SimilarPage, "touched">;

/**
 * The pages on a subject in the chain's other brains (§1.4), by full text alone, three at most: those whose title and
 * aliases share most of what the shorter of the two says. Whatever goes wrong here, the write stands: it answers none.
 */
async function elsewhereOf(home: string, others: SaveInput["others"], subject: Subject): Promise<ElsewherePage[]> {
  if (others === undefined || others.length === 0) return [];
  try {
    const index = await openIndex(home);
    try {
      updateIndex(index, others);
      return others
        .flatMap((o) =>
          similarPages(index, o.key, subject)
            // Stricter than for the brain written to: this is only said, and a loose match said at every save is noise.
            .filter((h) => h.status === null && sameSubject(index, subject.title, subject.aliases ?? [], o.key, h))
            .map((h) => ({
              brain: o.key,
              path: h.path,
              title: h.title,
              kind: h.kind,
              subkind: h.subkind,
              summary: h.summary,
            })),
        )
        .slice(0, ELSEWHERE_MAX);
    } finally {
      index.close();
    }
  } catch {
    return [];
  }
}

export const oneLine = (s: string, field: Field): string => {
  const t = s.trim();
  if (t === "") throw namedError((n) => `${n.field(field)} is empty`);
  if (t.includes("\n")) throw namedError((n) => `${n.field(field)} is one line`);
  return t;
};

/** A date as `stale_after` takes it: a real calendar day, `YYYY-MM-DD`. */
export function dayOf(text: string): string {
  const t = text.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00Z`) : undefined;
  if (d === undefined || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
    throw namedError((n) => `${n.field("stale_after")} takes a date such as 2026-11-01, not "${text}"`);
  }
  return t;
}

function pageType(kind: string, sub: string | undefined): PageType {
  if (!isKind(kind))
    throw namedError((n) => `${n.field("kind")} must be memory, knowledge, rule or skill, not "${kind}"`);
  if (sub !== undefined && !isSub(sub))
    throw namedError((n) => `${n.field("sub")} must be decision, playbook, context or instinct, not "${sub}"`);
  const t = typeOf(kind, sub);
  if ("error" in t) throw namedError(t.error);
  return t;
}

/** A new page of `type` in `brain`, laid out from the template with a new id (§3.3, §3.4). */
function newPage(
  brain: TargetBrain,
  type: PageType,
  input: PageInput,
  env: WriteContext,
  seen: Seen,
  extra: { supersedes?: string } = {},
): { rel: string; file: BrainFile } {
  const namespace = input.namespace ?? seen.repo.config().namespaces[0];
  if (namespace === undefined) throw noNamespace(brain);
  const title = oneLine(input.title, "title");
  const rel = pagePath(type, namespace, title);
  if (existsSync(join(brain.root, rel)))
    throw userError(
      `${rel} already exists in ${brainRepoOfKey(brain.key)}; update it, supersede it, or choose another title`,
      "path_exists",
    );
  const date = today(env.now);
  const file = createPage({
    type,
    namespace,
    title,
    created: date,
    source: oneLine(input.source, "source"),
    ...(input.sourceVersion !== undefined && { sourceVersion: oneLine(input.sourceVersion, "source_version") }),
    ...(input.evidence !== undefined && { evidence: oneLine(input.evidence, "evidence") }),
    ...(input.summary !== undefined && { summary: oneLine(input.summary, "summary") }),
    ...(input.staleAfter !== undefined && { staleAfter: dayOf(input.staleAfter) }),
    ...(input.appliesTo !== undefined && input.appliesTo.length > 0 && { appliesTo: globsOf(input.appliesTo) }),
    ...(input.aliases !== undefined && input.aliases.length > 0 && { aliases: input.aliases }),
    ...(extra.supersedes !== undefined && { supersedes: extra.supersedes }),
    body: assembleBody(type, input.body),
  });
  if (specFor(type).evidence) seedEvidence(file, date, input.evidence ?? "first occasion", input.source.trim());
  return { rel, file };
}

/** The refusal of a write into a brain with no namespace yet (§3.2): the command that makes the first. */
const noNamespace = (brain: TargetBrain) =>
  namedError(
    (n) =>
      `${brainRepoOfKey(brain.key)} has no namespace yet, so nothing was written; make the first, named and described for what you save${n.cli(`: kioku namespace add <path> --summary "…" --brain ${brainRepoOfKey(brain.key)}`)}, which the person confirms, then save again`,
    "namespace_none",
  );

/** A page a new one links to under See also. */
interface Related {
  path: string;
  title: string;
}

/**
 * `kioku page save` (§1.4, §6.1): look for pages on the same subject in the brain and return them instead of writing;
 * with none, or with `--create`, write the page, validate it, commit, and publish in a shared brain. A page created
 * beside similar ones links to them under See also (§3.3): the agent judged them related but not the same.
 */
export async function save(
  brain: TargetBrain,
  input: SaveInput,
  env: WriteContext,
): Promise<Done | Similar | NeedsNamespace> {
  const seen = await bringIn(brain);
  const type = pageType(input.kind, input.sub);
  const declared = seen.repo.config().namespaces;
  // A brain starts with no namespace: nothing is written until the first is made, with its description (§3.2).
  if (declared.length === 0) throw noNamespace(brain);
  if (input.namespace !== undefined && !declared.includes(input.namespace)) {
    const wanted = input.namespace;
    throw namedError(
      (n) =>
        `${brainRepoOfKey(brain.key)} has no namespace "${wanted}" (it has ${declared.join(", ")})${n.cli(`; \`kioku namespace add ${wanted} --summary "…" --brain ${brainRepoOfKey(brain.key)}\` makes it, once the person confirms`)}`,
      "namespace_unknown",
    );
  }
  const subject: Subject = {
    title: input.title,
    ...(input.aliases && { aliases: input.aliases }),
    body: input.body,
  };
  let related: Related[] = [];
  if (!input.create || input.seeAlso === undefined) {
    const index = await openIndex(env.home);
    try {
      updateIndex(index, [{ key: brain.key, root: brain.root }]);
      const found = similarPages(index, brain.key, subject);
      if (found.length > 0 && !input.create) {
        const touched = lastTouched(brain.root);
        const elsewhere = await elsewhereOf(env.home, input.others, subject);
        return {
          status: "similar",
          brain: brain.key,
          ...(elsewhere.length > 0 && { elsewhere }),
          similar: found.map((h) => ({
            brain: brain.key,
            path: h.path,
            title: h.title,
            kind: h.kind,
            subkind: h.subkind,
            summary: h.summary,
            touched: touchedOf(touched, h.path),
          })),
        };
      }
      related = found.map((h) => ({ path: h.path, title: h.title }));
    } finally {
      index.close();
    }
  }
  if (input.seeAlso !== undefined) {
    related = input.seeAlso.map((given) => {
      const p = brainRel(given);
      if (p === undefined || !existsSync(join(brain.root, p)))
        throw namedError(
          (n) =>
            `${n.field("see_also")} names ${given}, which is not a page of ${brainRepoOfKey(brain.key)}; give its brain-relative path`,
          "not_found",
        );
      return { path: p, title: readPage(brain, p).file.front.getString("title") ?? p };
    });
  }
  // More than one namespace and none named: nothing is written; the agent chooses by what each is for (§3.2).
  if (input.namespace === undefined && declared.length > 1) {
    return {
      status: "namespace",
      brain: brain.key,
      namespaces: namespaceOverview(brain.root).map((n) => ({
        namespace: n.namespace,
        summary: n.summary,
        pages: n.total,
        below: n.below,
      })),
    };
  }
  const { rel, file } = newPage(brain, type, input, env, seen);
  const links = related.filter((r) => r.path !== rel);
  if (links.length > 0)
    file.body = addSeeAlso(
      file.body,
      links.map((r) => ({ title: r.title, href: linkBetween(rel, r.path) })),
    );
  const applied = await applyChanges(
    brain,
    [{ rel, text: serializeBrainFile(file) }],
    `save: ${file.front.getString("title")}`,
    env,
    seen,
  );
  // Said after the write, and never a reason not to make it: a more shared page on the subject is often why this one exists.
  const elsewhere = await elsewhereOf(env.home, input.others, subject);
  return {
    status: "done",
    brain: brain.key,
    path: rel,
    id: file.front.getString("id")!,
    ...described(rel, file.front),
    namespace: file.front.getString("namespace")!,
    ...applied,
    ...candidacy(type, rel, file),
    ...(elsewhere.length > 0 && { elsewhere }),
  };
}

/**
 * `kioku page link` (§3.3, §6.1): two pages of one brain found related later, by the agent or a person, each listed
 * under the other's See also. A direction already there is left alone; both there is a refusal. Kinds with a
 * Changelog get a line. One commit.
 */
export async function link(
  brain: TargetBrain,
  relA: string,
  relB: string,
  env: WriteContext,
  relation?: Relation,
): Promise<Done> {
  const seen = await bringIn(brain);
  if (relA === relB) throw userError("a page is not linked to itself", "usage");
  const a = readPage(brain, relA);
  const b = readPage(brain, relB);
  const date = today(env.now);
  /** `relation` is how `from` stands to `to`; a link already there is typed in place when it was not, and left when it was. */
  const join = (
    from: { file: BrainFile; type: PageType },
    fromRel: string,
    to: { file: BrainFile },
    toRel: string,
    relation?: Relation,
  ): boolean => {
    const title = to.file.front.getString("title") ?? toRel;
    const href = linkBetween(fromRel, toRel);
    const there = seeAlsoEntries(from.file.body).find((e) => resolveLink(fromRel, e.target) === toRel);
    if (there !== undefined) {
      if (relation === undefined || there.relation === relation) return false;
      from.file.body = relateSeeAlso(from.file.body, fromRel, toRel, relation);
    } else {
      from.file.body = addSeeAlso(from.file.body, [{ title, href, ...(relation !== undefined && { relation }) }]);
    }
    if (specFor(from.type).changelog)
      appendChangelog(
        from.file,
        date,
        `Linked to [${linkText(title)}](${href})${relation !== undefined ? ` (${relation})` : ""}.`,
      );
    return true;
  };
  const changes: FileChange[] = [];
  if (join(a, relA, b, relB, relation)) changes.push({ rel: relA, text: serializeBrainFile(a.file) });
  if (join(b, relB, a, relA, relation === undefined ? undefined : RELATION_OF_OTHER[relation]))
    changes.push({ rel: relB, text: serializeBrainFile(b.file) });
  if (changes.length === 0) throw userError(`${relA} and ${relB} already link to each other`, "already_linked");
  const message = `link: ${a.file.front.getString("title") ?? relA} <-> ${b.file.front.getString("title") ?? relB}`;
  const applied = await applyChanges(brain, changes, message, env, seen);
  return {
    status: "done",
    brain: brain.key,
    path: relA,
    id: a.file.front.getString("id")!,
    ...described(relA, a.file.front),
    to: relB,
    ...applied,
  };
}

/** An instinct with enough occasions says so in the result, which the session's journal keeps (§3.6, §4.6). */
const candidacy = (type: PageType, rel: string, file: BrainFile): { candidate?: true } =>
  type.sub === "instinct" && candidateOccasions(rel, file) !== undefined ? { candidate: true } : {};

/** A page of the brain, read; an error when it is not one. */
export function readPage(brain: TargetBrain, rel: string): { file: BrainFile; type: PageType } {
  if (brainRel(rel) !== rel)
    throw userError(`${rel} is not a path inside the brain ${brainRepoOfKey(brain.key)}`, "usage");
  const path = join(brain.root, rel);
  if (!existsSync(path)) throw userError(`there is no ${rel} in ${brainRepoOfKey(brain.key)}`, "not_found");
  const place = placementOf(rel);
  const parsed = parseBrainFile(readFileSync(path, "utf8"));
  if (place === undefined || isFrontPageAt(rel) || !parsed.ok)
    throw userError(`${rel} is not a page of ${brainRepoOfKey(brain.key)}`, "not_a_page");
  return { file: parsed.file, type: { kind: place.kind, ...(place.sub !== undefined && { sub: place.sub }) } };
}

export interface UpdateInput {
  /** The new body, or the new text of `section`. */
  body?: string;
  section?: string;
  /** An instinct's new occasion (§3.6). */
  evidence?: string;
  /** Where the new occasion comes from. */
  source?: string;
  /** The Changelog line, on a kind that has one. */
  note?: string;
  summary?: string;
  aliases?: string[];
  /** A new date after which the page needs a second look; `none` removes it. */
  staleAfter?: string;
  /** The globs of the project's files the page is about, replacing the ones it had; `none` removes them. */
  appliesTo?: string[];
  /** The version of the source the page now reflects, after reading it again; `none` removes it. */
  sourceVersion?: string;
}

/** The Changelog line of an update, by the first thing it changed; only aliases are left when none of these holds. */
const UPDATE_LINES: readonly [(input: UpdateInput) => boolean, (input: UpdateInput) => string][] = [
  [(i) => i.section !== undefined, (i) => `Updated ${i.section}.`],
  [(i) => Boolean(i.body?.trim()), () => "Rewrote the page."],
  [(i) => i.summary !== undefined, () => "Updated the summary."],
  [(i) => i.staleAfter !== undefined, () => "Updated the date after which it needs a second look."],
  [(i) => i.appliesTo !== undefined, () => "Updated the files it applies to."],
  [(i) => i.sourceVersion !== undefined && i.aliases === undefined, () => "Read the source again."],
];
const updateLine = (input: UpdateInput): string =>
  UPDATE_LINES.find(([holds]) => holds(input))?.[1](input) ?? "Updated the aliases.";

/**
 * `kioku page update` (§3.5, §6.1): correct a page in place. The body or one section is replaced; Knowledge, Rule and
 * Skill get a Changelog line; an instinct gets an Evidence line; a Memory relies on git. Of the front matter only
 * `summary`, `aliases`, `stale_after` and `source_version` change; the `id` never does.
 */
export async function update(brain: TargetBrain, rel: string, input: UpdateInput, env: WriteContext): Promise<Done> {
  const seen = await bringIn(brain);
  const { file, type } = readPage(brain, rel);
  const spec = specFor(type);
  const original = serializeBrainFile(file);
  const date = today(env.now);
  const body = input.body?.trim() ? input.body : undefined;
  if (body === undefined && input.section !== undefined)
    throw namedError((n) => `${n.field("section")} needs the section's new text${n.cli(" on stdin")}`);
  if (
    body === undefined &&
    input.evidence === undefined &&
    input.summary === undefined &&
    input.aliases === undefined &&
    input.staleAfter === undefined &&
    input.appliesTo === undefined &&
    input.sourceVersion === undefined
  ) {
    throw namedError(
      (n) =>
        `nothing to update: send a body${n.cli(" on stdin")}, or pass ${n.field("evidence")}, ${n.field("summary")}, ${n.field("aliases")}, ${n.field("stale_after")}, ${n.field("applies_to")} or ${n.field("source_version")}`,
    );
  }
  if (input.evidence !== undefined && !spec.evidence)
    throw namedError((n) => `${n.field("evidence")} is for instincts, and ${rel} is not one`, "not_instinct");
  if (input.evidence !== undefined && input.source === undefined)
    throw namedError((n) => `${n.field("evidence")} needs ${n.field("source")}: where this occasion comes from`);

  if (body !== undefined)
    file.body =
      input.section !== undefined
        ? replaceSection(file.body, input.section, body)
        : assembleBody(type, body, file.body);
  if (input.summary !== undefined) file.front.set("summary", oneLine(input.summary, "summary"));
  if (input.aliases !== undefined) {
    if (input.aliases.length === 0) file.front.delete("aliases");
    else file.front.set("aliases", input.aliases);
  }
  if (input.staleAfter !== undefined) {
    if (input.staleAfter.trim() === "none") file.front.delete("stale_after");
    else file.front.set("stale_after", dayOf(input.staleAfter), { raw: true });
  }
  if (input.appliesTo !== undefined) {
    if (input.appliesTo.length === 0 || isNone(input.appliesTo)) file.front.delete("applies_to");
    else file.front.set("applies_to", globsOf(input.appliesTo));
  }
  if (input.sourceVersion !== undefined) {
    if (input.sourceVersion.trim() === "none") file.front.delete("source_version");
    else file.front.set("source_version", oneLine(input.sourceVersion, "source_version"), { quoted: true });
  }
  if (input.evidence !== undefined)
    appendEvidence(file, date, oneLine(input.evidence, "evidence"), oneLine(input.source!, "source"));
  if (serializeBrainFile(file) === original)
    throw userError(`${rel} already says this; nothing was written`, "unchanged");
  if (spec.changelog) {
    appendChangelog(file, date, input.note !== undefined ? oneLine(input.note, "note") : updateLine(input));
  }
  const applied = await applyChanges(
    brain,
    [{ rel, text: serializeBrainFile(file) }],
    `update: ${file.front.getString("title")}`,
    env,
    seen,
  );
  return {
    status: "done",
    brain: brain.key,
    path: rel,
    id: file.front.getString("id")!,
    ...described(rel, file.front),
    ...applied,
    ...candidacy(type, rel, file),
  };
}

const DECISION: PageType = { kind: "knowledge", sub: "decision" };

/**
 * `kioku page supersede` (§3.5, §6.1): a decision that changed is not edited. The new decision is written with
 * `supersedes`, the old one gets `superseded_by` and a Changelog line, both are validated, one commit.
 */
export async function supersede(
  brain: TargetBrain,
  oldRel: string,
  input: PageInput,
  env: WriteContext,
): Promise<Done> {
  const seen = await bringIn(brain);
  const old = readPage(brain, oldRel);
  if (old.type.sub !== "decision")
    throw userError(`${oldRel} is not a decision; only decisions are superseded`, "not_a_decision");
  const already = old.file.front.getString("superseded_by");
  if (already !== undefined) throw userError(`${oldRel} is already superseded by ${already}`, "already_superseded");
  const namespace = input.namespace ?? old.file.front.getString("namespace");
  const rel = pagePath(DECISION, namespace ?? seen.repo.config().namespaces[0]!, input.title);
  const fresh = newPage(brain, DECISION, { ...input, ...(namespace !== undefined && { namespace }) }, env, seen, {
    supersedes: linkBetween(rel, oldRel),
  });
  const link = linkBetween(oldRel, fresh.rel);
  old.file.front.set("superseded_by", link);
  appendChangelog(old.file, today(env.now), `Superseded by ${link}.`);
  const title = fresh.file.front.getString("title");
  const applied = await applyChanges(
    brain,
    [
      { rel: fresh.rel, text: serializeBrainFile(fresh.file) },
      { rel: oldRel, text: serializeBrainFile(old.file) },
    ],
    `supersede: ${title} (replaces ${old.file.front.getString("title")})`,
    env,
    seen,
  );
  return {
    status: "done",
    brain: brain.key,
    path: fresh.rel,
    id: fresh.file.front.getString("id")!,
    ...described(fresh.rel, fresh.file.front),
    supersedes: oldRel,
    ...applied,
  };
}

/** The pages of the brain whose relative links, `supersedes` or `superseded_by` point at `rel`. */
export function pagesLinkingTo(root: string, rel: string): string[] {
  const out: string[] = [];
  for (const from of listMarkdown(root)) {
    if (from === rel) continue;
    const text = readFileSync(join(root, from), "utf8");
    const parsed = parseBrainFile(text);
    const targets = [
      ...linksOf(parsed.ok ? parsed.file.body : text).map((l) => resolveLink(from, l.target)),
      ...(parsed.ok
        ? ["supersedes", "superseded_by"].flatMap((f) => {
            const v = parsed.file.front.getString(f);
            return v === undefined ? [] : [resolveLink(from, v), resolveLink("x", v)];
          })
        : []),
    ];
    if (targets.includes(rel)) out.push(from);
  }
  return out;
}

/** `kioku page forget` (§3.5, §6.1): delete the page with a commit; git keeps it. It never refuses a page that is there, readable or not; it says which pages linked to it. */
export async function forget(brain: TargetBrain, rel: string, env: WriteContext): Promise<Done> {
  const seen = await bringIn(brain);
  const path = join(brain.root, rel);
  if (!existsSync(path)) throw userError(`there is no ${rel} in ${brainRepoOfKey(brain.key)}`, "not_found");
  if (!rel.endsWith(".md") || isFrontPageAt(rel))
    throw userError(
      `${rel} is not a page of ${brainRepoOfKey(brain.key)}; front pages and kioku.yaml are not forgotten`,
      "not_a_page",
    );
  const parsed = parseBrainFile(readFileSync(path, "utf8"));
  const front = parsed.ok ? parsed.file.front : undefined;
  const linkedFrom = pagesLinkingTo(brain.root, rel);
  const applied = await applyChanges(
    brain,
    [{ rel, text: null }],
    `forget: ${front?.getString("title") ?? rel}`,
    env,
    seen,
  );
  const id = front?.getString("id");
  return {
    status: "done",
    brain: brain.key,
    path: rel,
    ...(id !== undefined && { id }),
    ...described(rel, front),
    linkedFrom,
    ...applied,
  };
}

/** What a write's answer says of its page (§6.1): its title, kind and subkind, as the page has them. */
export function described(
  rel: string,
  front: BrainFile["front"] | undefined,
): { title?: string; kind?: string; subkind: string | null } {
  const title = front?.getString("title");
  const kind = front?.getString("kind");
  return {
    ...(title !== undefined && { title }),
    ...(kind !== undefined && { kind }),
    subkind: placementOf(rel)?.sub ?? null,
  };
}

const SKILL: PageType = { kind: "skill" };

/** An instinct with enough occasions to become a Skill, as `kioku page evolve` lists it. */
export interface Candidate {
  brain: string;
  path: string;
  title: string;
  /** The instinct's When: what the person reads to choose. */
  when: string;
  occasions: number;
}

/** `kioku page evolve` without a path (§3.6, §6.1): the instincts of these brains that are candidates for a Skill. */
export function skillCandidates(brains: TargetBrain[]): Candidate[] {
  return brains.flatMap((b) =>
    listMarkdown(b.root)
      .filter((rel) => placementOf(rel)?.sub === "instinct")
      .flatMap((rel) => {
        const parsed = parseBrainFile(readFileSync(join(b.root, rel), "utf8"));
        if (!parsed.ok) return [];
        const occasions = candidateOccasions(rel, parsed.file);
        if (occasions === undefined) return [];
        const title = parsed.file.front.getString("title") ?? rel;
        return [{ brain: b.key, path: rel, title, when: sectionBody(parsed.file.body, "When") ?? "", occasions }];
      }),
  );
}

export type EvolveTo = "skill" | "rule" | "playbook";

const RULE: PageType = { kind: "rule" };
const PLAYBOOK: PageType = { kind: "knowledge", sub: "playbook" };

const stripDot = (s: string): string => s.trim().replace(/[.\s]+$/, "");
const lowerFirst = (s: string): string => (s === "" ? s : s[0]!.toLowerCase() + s.slice(1));

/** A Rule reads an instinct's When and Do as one sentence, with its occasions as the Why, and must fit what a Rule may be. */
function ruleFrom({ when, doText, occasions }: InstinctParts): string {
  const sentence = `When ${lowerFirst(stripDot(when))}, ${lowerFirst(stripDot(doText))}.`;
  const why =
    occasions.length === 0
      ? "Learned from experience."
      : `Seen on ${plural(occasions.length, "occasion")}; the latest: ${stripDot(occasions.at(-1)!.text)}.`;
  const body = buildBody(RULE, { Rule: sentence, Why: why });
  const length = withoutChangelog(body).length;
  if (length > RULE_LENGTH_LIMIT) {
    throw namedError(
      (n) =>
        `as a Rule this is ${length} characters and a Rule goes whole into every summary, so it may be ${RULE_LENGTH_LIMIT}; evolve it to a playbook instead${n.cli(" (--to playbook)")}`,
      "rule_too_long",
    );
  }
  return body;
}

interface InstinctParts {
  when: string;
  doText: string;
  occasions: ReturnType<typeof evidenceOf>;
}

/** What an instinct can become: the page's type, what its record calls it, and the body made from its parts. */
const EVOLUTIONS: Record<EvolveTo, { type: PageType; noun: string; body: (parts: InstinctParts) => string }> = {
  skill: {
    type: SKILL,
    noun: "Skill",
    body: ({ when, doText }) => buildBody(SKILL, { "When to use": when, Steps: doText }),
  },
  rule: { type: RULE, noun: "Rule", body: ruleFrom },
  playbook: {
    type: PLAYBOOK,
    noun: "playbook",
    body: ({ when, doText }) => buildBody(PLAYBOOK, { When: when, Steps: `1. ${doText}` }),
  },
};

/**
 * `kioku page evolve <path> [--to skill|rule|playbook]` (§3.6, §6.1): turn an instinct into a Skill, a Rule or
 * a playbook in the same brain. A Skill and a playbook take When and Do (as When to use and Steps, or When and
 * Steps); a Rule reads them as one sentence, with the occasions as its Why, and must fit what a Rule may be. The new
 * page's `source` is the instinct's path and its `summary` the instinct's; the instinct's record gets a line linking
 * it, which ends its candidacy. Both are validated, one commit.
 */
export async function evolve(
  brain: TargetBrain,
  rel: string,
  env: WriteContext,
  to: EvolveTo = "skill",
): Promise<Done> {
  const seen = await bringIn(brain);
  const instinct = readPage(brain, rel);
  if (instinct.type.sub !== "instinct")
    throw userError(`${rel} is not an instinct; only instincts evolve`, "not_instinct");
  if (evolvedInstinct(rel, instinct.file))
    throw userError(`${rel} already links to what it evolved into`, "already_evolved");
  const front = instinct.file.front;
  const title = front.getString("title") ?? "";
  const summary = front.getString("summary");
  const namespace = front.getString("namespace");
  const when = sectionBody(instinct.file.body, "When") ?? "";
  const doText = sectionBody(instinct.file.body, "Do") ?? "";
  const occasions = evidenceOf(instinct.file);

  const { type, noun, body: bodyOf } = EVOLUTIONS[to];
  const body = bodyOf({ when, doText, occasions });
  const made = newPage(
    brain,
    type,
    {
      title,
      source: rel,
      ...(summary !== undefined && { summary }),
      ...(namespace !== undefined && { namespace }),
      body,
    },
    env,
    seen,
  );
  appendEvidenceNote(
    instinct.file,
    today(env.now),
    `Evolved into the ${noun} [${linkText(title)}](${linkBetween(rel, made.rel)}).`,
  );
  const applied = await applyChanges(
    brain,
    [
      { rel: made.rel, text: serializeBrainFile(made.file) },
      { rel, text: serializeBrainFile(instinct.file) },
    ],
    `evolve: ${made.file.front.getString("title")}`,
    env,
    seen,
  );
  return {
    status: "done",
    brain: brain.key,
    path: made.rel,
    id: made.file.front.getString("id")!,
    ...described(made.rel, made.file.front),
    instinct: rel,
    ...(to !== "skill" && { evolvedAs: to }),
    ...applied,
  };
}

/** An ISO 8601 moment in UTC, to the second: what `verified` carries. */
const momentOf = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * `kioku page confirm` (§3.3): the page is still true. It says so on the page, who by and when, without
 * touching what the page says, so that the date of the last touch is not the only sign of a page being looked at.
 * A Changelog line records it on the kinds that have one.
 */
export async function confirm(
  brain: TargetBrain,
  rel: string,
  input: { note?: string },
  env: WriteContext,
): Promise<Done> {
  const seen = await bringIn(brain);
  const { file, type } = readPage(brain, rel);
  if (isRetired(file.front)) {
    throw namedError(
      (n) =>
        `${rel} is retired, and confirming it would say it is current; bring it back${n.cli(" with kioku page retire --undo")}, or write the page that replaces it`,
      "retired",
    );
  }
  setVerified(file.front, { by: `human:${env.user?.() ?? "unknown"}`, at: momentOf(env.now) });
  if (specFor(type).changelog)
    appendChangelog(
      file,
      today(env.now),
      input.note !== undefined ? `Confirmed: ${oneLine(input.note, "note")}` : "Confirmed.",
    );
  const applied = await applyChanges(
    brain,
    [{ rel, text: serializeBrainFile(file) }],
    `confirm: ${file.front.getString("title")}`,
    env,
    seen,
  );
  return {
    status: "done",
    brain: brain.key,
    path: rel,
    id: file.front.getString("id")!,
    ...described(rel, file.front),
    ...applied,
  };
}

/**
 * `kioku page retire` (§3.3): the page is no longer current and has no page that replaces it. It stays, so
 * that links to it still arrive somewhere, and leaves the session summary and the default search. `undo` brings it
 * back. A decision that a newer one replaces is superseded, not retired.
 */
export async function retire(
  brain: TargetBrain,
  rel: string,
  input: { reason?: string; undo?: boolean },
  env: WriteContext,
): Promise<Done> {
  const seen = await bringIn(brain);
  const { file, type } = readPage(brain, rel);
  const retired = isRetired(file.front);
  const date = today(env.now);
  const title = file.front.getString("title");
  if (input.undo === true) {
    if (!retired) throw userError(`${rel} is not retired`, "not_retired");
    file.front.delete("status");
    if (specFor(type).changelog) appendChangelog(file, date, "Brought back.");
    // Its own verb's message (§3.5): `brain log` and `brain stats` count an undone retire as a retire, not an update.
    const applied = await applyChanges(brain, [{ rel, text: serializeBrainFile(file) }], `retire: ${title}`, env, seen);
    return {
      status: "done",
      brain: brain.key,
      path: rel,
      id: file.front.getString("id")!,
      ...described(rel, file.front),
      ...applied,
    };
  }
  if (retired) throw userError(`${rel} is already retired`, "already_retired");
  file.front.set("status", DEPRECATED, { raw: true });
  if (specFor(type).changelog)
    appendChangelog(
      file,
      date,
      input.reason !== undefined ? `Retired: ${oneLine(input.reason, "reason")}` : "Retired.",
    );
  const linkedFrom = pagesLinkingTo(brain.root, rel);
  const applied = await applyChanges(brain, [{ rel, text: serializeBrainFile(file) }], `retire: ${title}`, env, seen);
  return {
    status: "done",
    brain: brain.key,
    path: rel,
    id: file.front.getString("id")!,
    ...described(rel, file.front),
    ...applied,
    ...(linkedFrom.length > 0 && { linkedFrom }),
  };
}
