import { globProblem } from "../brain/applies.ts";
import {
  depthOf,
  isReservedNamespace,
  MAX_NAMESPACE_DEPTH,
  NAMESPACE_NAME,
  namespaceBreaksPaths,
  parentOf,
  segmentsOf,
} from "../brain/namespace-name.ts";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { linksIn } from "../brain/inside.ts";
import { join } from "node:path";
import { brainRepoOfFolder } from "../config/brain-ref.ts";
import { parseBrainFile, sectionsOf, withoutChangelog } from "../brain/file.ts";
import { FRONT_PAGE, isFrontPageAt, listMarkdown, NEWER_THAN_READ, NEWEST_FORMAT } from "../brain/brain.ts";
import { isKind, placementOf, specFor, type Placement } from "../brain/kinds.ts";
import { linksOf, resolveLink } from "../brain/paths.ts";
import { isUlid } from "../brain/ulid.ts";
import { AGENTS_MD } from "../brains/agents-md.ts";
import { folderFiles } from "../brains/owned.ts";
import { VERSION } from "../../version.ts";
import { parseFolderConfig, type BrainConfig } from "../config/folder-config.ts";
import { environmentError } from "../errors.ts";
import { DEPRECATED, STATUSES, verifiedShapeProblem } from "../brain/lifecycle.ts";
import { loadFirstOf, LOAD_FIRST_MAX } from "../brain/load-first.ts";
import { findSecrets } from "./secrets.ts";

/** The warnings of §5.1, by name. */
export type WarningId =
  | "summary-missing"
  | "changelog-missing"
  | "rule-too-long"
  | "evidence-missing"
  | "stale-after-invalid"
  | "applies-to-invalid"
  | "applies-to-not-project"
  | "status-invalid"
  | "verified-invalid"
  | "page-too-long"
  | "load-first-broken"
  | "load-first-long"
  | "namespace-name-invalid"
  | "namespace-name-reserved"
  | "namespace-too-deep"
  | "namespace-parent-missing"
  | "agents-md-missing"
  | "host-file-missing";

/** A page longer than this many lines is hard to read whole and costs the agent a lot to open (§5.1). */
export const PAGE_LINE_LIMIT = 500;

export interface Finding {
  severity: "error" | "warning";
  /** The rule of §5.1 an error breaks, 1 to 13. */
  rule?: number;
  /** The warning of §5.1. */
  warning?: WarningId;
  /** Brain-relative path, absent for the brain as a whole. */
  path?: string;
  line?: number;
  message: string;
}

export interface Report {
  root: string;
  /** The brain as a person reads it (§2.3), when the caller knows it. */
  brain?: string;
  files: number;
  errors: number;
  warnings: number;
  findings: Finding[];
}

/** One finding as a line: `path:line: error [rule 4] message`. */
export function formatFinding(f: Finding): string {
  const where = f.path === undefined ? "" : `${f.path}${f.line === undefined ? "" : `:${f.line}`}: `;
  return `${where}${f.severity} [${f.rule !== undefined ? `rule ${f.rule}` : f.warning}] ${f.message}`;
}

/** The longest a Rule may be before it is a warning: Rules go whole into the session summary (§3.4). */
export const RULE_LENGTH_LIMIT = 600;

class Sink {
  readonly findings: Finding[] = [];
  error(rule: number, message: string, path?: string, line?: number): void {
    this.findings.push({
      severity: "error",
      rule,
      message,
      ...(path !== undefined && { path }),
      ...(line !== undefined && { line }),
    });
  }
  warn(warning: WarningId, message: string, path?: string, line?: number): void {
    this.findings.push({
      severity: "warning",
      warning,
      message,
      ...(path !== undefined && { path }),
      ...(line !== undefined && { line }),
    });
  }
  report(root: string, files: number, name?: string): Report {
    const sorted = [...this.findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
    return {
      root,
      files,
      ...(name !== undefined && { name }),
      findings: sorted,
      errors: sorted.filter((f) => f.severity === "error").length,
      warnings: sorted.filter((f) => f.severity === "warning").length,
    };
  }
}

/** What validating one page needs to know about the rest of its brain. */
interface Context {
  root: string;
  config: BrainConfig;
  /** Whether a brain-relative path is a file of the brain, as the brain will stand once the change is written. */
  onDisk: (rel: string) => boolean;
}

/** The brain's `kioku.yaml`, or undefined after reporting why it cannot be used (rules 1, 2 and 10). Throws when the folder is no brain. */
function configOf(root: string, sink: Sink): BrainConfig | undefined {
  const path = join(root, "kioku.yaml");
  if (!existsSync(path)) throw environmentError(`${root} is not a brain: it has no kioku.yaml`, "not_a_brain");
  if (lstatSync(path).isSymbolicLink()) {
    sink.error(12, "kioku.yaml is a symbolic link; the tool reads nothing through one", "kioku.yaml");
    return undefined;
  }
  const parsed = parseFolderConfig(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    // A brain of `format: 2` with no name, or a name that is not `<owner>/<repo>`, breaks rule 13 (§2.2, §3.2).
    sink.error(parsed.syntax ? 1 : parsed.reason.startsWith("`name`") ? 13 : 2, parsed.reason, "kioku.yaml");
    return undefined;
  }
  if (parsed.value.form !== "brain") {
    sink.error(2, "kioku.yaml is a project folder's (it has `brain`), not a brain's", "kioku.yaml");
    return undefined;
  }
  if (parsed.value.format > NEWEST_FORMAT) {
    sink.error(10, `format ${parsed.value.format} is ${NEWER_THAN_READ}; update kioku`, "kioku.yaml");
    return undefined;
  }
  return parsed.value;
}

/** Every `id` in the brain by the pages that carry it, for rule 3's duplicates. Pages that cannot be read carry none. */
function idsOf(root: string, paths: string[]): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const rel of paths) addId(ids, rel, readFileSync(join(root, rel), "utf8"));
  return ids;
}

function addId(ids: Map<string, string[]>, rel: string, text: string): void {
  const parsed = parseBrainFile(text);
  const id = parsed.ok ? parsed.file.front.getString("id") : undefined;
  if (id !== undefined) ids.set(id, [...(ids.get(id) ?? []), rel]);
}

/** The pages of a brain: every `.md` that is not a front page. */
const pagePathsOf = (root: string): string[] => listMarkdown(root).filter((rel) => !isFrontPageAt(rel));

/** The whole brain: its configuration, its front pages and every page (§5.1). */
export function validateBrain(root: string, name: string = brainRepoOfFolder(root)): Report {
  const sink = new Sink();
  const config = configOf(root, sink);
  if (config === undefined) return sink.report(root, 0);
  const ctx: Context = { root, config, onDisk: (rel) => existsSync(join(root, rel)) };

  if (!existsSync(join(root, FRONT_PAGE)))
    sink.error(9, `${FRONT_PAGE} is missing at the root of the brain`, FRONT_PAGE);
  // Nothing is read through a link (§3.1): each is named, so that it is removed (rule 12).
  for (const link of linksIn(root))
    sink.error(12, `${link} is a symbolic link; the tool reads nothing through one`, link);
  // The files the tool owns in the brain's folder (§2.7); a brain that lacks them gets them from `brain refresh`.
  for (const f of folderFiles(name, config.tier, VERSION)) {
    if (existsSync(join(root, f.rel))) continue;
    if (f.rel === AGENTS_MD)
      sink.warn(
        "agents-md-missing",
        "no AGENTS.md at the root: an agent opened in this folder is not told what it is or how to work on it; kioku brain refresh writes it",
        f.rel,
      );
    else
      sink.warn(
        "host-file-missing",
        `${f.rel} is missing: an agent host opened in this folder lacks it; kioku brain refresh writes it`,
        f.rel,
      );
  }
  for (const ns of config.namespaces) {
    // A name that cannot be a folder's breaks every path under it (rule 11); the rest of what is odd about a name is a warning (§3.2).
    const broken = namespaceBreaksPaths(ns);
    if (broken !== undefined) {
      sink.error(11, broken, "kioku.yaml");
      continue;
    }
    const segments = segmentsOf(ns);
    if (segments.some(isReservedNamespace))
      sink.warn(
        "namespace-name-reserved",
        `the namespace "${ns}" has a part that is a name the brain already uses for a folder or a file`,
        "kioku.yaml",
      );
    else if (!segments.every((s) => NAMESPACE_NAME.test(s)))
      sink.warn(
        "namespace-name-invalid",
        `the namespace "${ns}" is not letters, digits, dots, dashes and underscores starting with a letter or a digit, in each part`,
        "kioku.yaml",
      );
    if (depthOf(ns) > MAX_NAMESPACE_DEPTH)
      sink.warn(
        "namespace-too-deep",
        `the namespace "${ns}" is ${depthOf(ns)} deep; past ${MAX_NAMESPACE_DEPTH} the agent has a tree to get lost in`,
        "kioku.yaml",
      );
    const parent = parentOf(ns);
    if (parent !== undefined && !config.namespaces.includes(parent))
      sink.warn(
        "namespace-parent-missing",
        `the namespace "${ns}" is declared but its parent "${parent}" is not`,
        "kioku.yaml",
      );
    const index = `knowledge/${ns}/INDEX.md`;
    if (!existsSync(join(root, index))) sink.error(9, `INDEX.md is missing in the namespace ${ns}`, index);
    const first = loadFirstOf(root, ns);
    if (first === undefined) continue;
    if (first.links.length > LOAD_FIRST_MAX)
      sink.warn(
        "load-first-long",
        `\`## Load first\` names ${first.links.length} pages; past ${LOAD_FIRST_MAX} it is a list nobody reads first`,
        index,
      );
    for (const l of first.links) {
      if (l.path === undefined || !existsSync(join(root, l.path)))
        sink.warn("load-first-broken", `\`## Load first\` names ${l.target}, which is not a page of the brain`, index);
    }
  }

  const paths = pagePathsOf(root);
  const ids = idsOf(root, paths);
  for (const rel of paths) checkPage(ctx, rel, readFileSync(join(root, rel), "utf8"), ids, sink);
  return sink.report(root, paths.length, name);
}

/** A page as a write is about to put it: its brain-relative path and its whole text. */
export interface PendingPage {
  rel: string;
  text: string;
}

/** The change the pages belong to, as the validator should see the brain once it is written (§1.6). */
export interface PendingChange {
  /** The brain's `kioku.yaml`, read already by the caller, or the one the change writes; read from disk when absent. */
  config?: BrainConfig;
  /** Every file the change puts in place, pages or not: a link to one of them points at something. */
  added?: string[];
  /** Every file the change removes: a link to one of them points at nothing, and its `id` is gone. */
  removed?: string[];
}

/**
 * The pages of one change, each at a brain-relative path, in the context of their brain, before they are written:
 * what `save`, `update` and `supersede` check before they touch the disk (§1.6, §5.1). The brain-wide rules (9)
 * are not run. The rest of the brain is read once for all of them: each `id` is compared with the other pages' on
 * disk, less the ones the change removes, and with the other pages of the change; a link resolves against the disk
 * as the change leaves it. A `config` the caller has read already is not read again; one it has not is read here,
 * and reported on when it cannot be used.
 */
export function validatePages(root: string, pages: PendingPage[], change: PendingChange = {}): Report {
  const sink = new Sink();
  const known = change.config ?? configOf(root, sink);
  if (known === undefined) return sink.report(root, 0);
  const pending = new Set(pages.map((p) => p.rel));
  const added = new Set(change.added ?? []);
  const removed = new Set(change.removed ?? []);
  const ids = idsOf(
    root,
    pagePathsOf(root).filter((p) => !pending.has(p) && !removed.has(p)),
  );
  for (const p of pages) addId(ids, p.rel, p.text);
  const ctx: Context = {
    root,
    config: known,
    onDisk: (rel) => pending.has(rel) || added.has(rel) || (!removed.has(rel) && existsSync(join(root, rel))),
  };
  for (const p of pages) checkPage(ctx, p.rel, p.text, ids, sink);
  return sink.report(root, pages.length, brainRepoOfFolder(root));
}

/** One page, as `validatePages` checks it. */
export const validatePage = (root: string, rel: string, text: string): Report => validatePages(root, [{ rel, text }]);

const REQUIRED = ["namespace", "title", "created", "source"] as const;

function checkPage(ctx: Context, rel: string, text: string, ids: Map<string, string[]>, sink: Sink): void {
  const parsed = parseBrainFile(text);
  if (!parsed.ok) return sink.error(1, parsed.reason, rel);
  const file = parsed.file;
  const { front, body } = file;

  // Rule 2: required fields, and `kind` in its list.
  const rawKind = front.getString("kind");
  const kind = rawKind !== undefined && isKind(rawKind) ? rawKind : undefined;
  if (rawKind === undefined) sink.error(2, "`kind` is missing", rel);
  else if (kind === undefined)
    sink.error(2, `\`kind\` is "${rawKind}", which is not one of memory, knowledge, rule, skill`, rel);
  for (const field of REQUIRED) if (front.getString(field) === undefined) sink.error(2, `\`${field}\` is missing`, rel);

  // Rule 3: the id is present, a ULID, and unique in the brain.
  const id = front.getString("id");
  if (id === undefined) sink.error(3, "`id` is missing", rel);
  else if (!isUlid(id)) sink.error(3, "`id` is not a ULID", rel);
  else {
    const others = (ids.get(id) ?? []).filter((p) => p !== rel);
    if (others.length > 0) sink.error(3, `\`id\` is also on ${others.join(", ")}`, rel);
  }

  // Rule 4: the namespace is declared.
  const namespace = front.getString("namespace");
  if (namespace !== undefined && !ctx.config.namespaces.includes(namespace)) {
    sink.error(4, `namespace "${namespace}" is not declared in kioku.yaml (${ctx.config.namespaces.join(", ")})`, rel);
  }

  // Rule 5: the folder matches the kind and, in knowledge, the namespace.
  const place = placementOf(rel);
  let located: Placement | undefined;
  if (kind !== undefined) {
    if (place === undefined)
      sink.error(5, `not in the folder of any kind; ${kind} pages live in ${folderHint(kind)}`, rel);
    else if (place.kind !== kind)
      sink.error(5, `a ${kind} page in the folder of ${place.kind}; it belongs in ${folderHint(kind)}`, rel);
    else if (place.namespace !== undefined && namespace !== undefined && place.namespace !== namespace) {
      sink.error(5, `a page of namespace "${namespace}" in the folder of "${place.namespace}"`, rel);
    } else located = place;
  }

  // Rule 6: the sections of its type.
  const headings = sectionsOf(body);
  const spec = located === undefined ? undefined : specFor(located);
  if (spec !== undefined) {
    for (const section of spec.sections)
      if (!headings.includes(section)) sink.error(6, `the section \`## ${section}\` is missing`, rel);
  }

  // Rule 7: every relative link, `supersedes` and `superseded_by` points at a page that exists.
  const bodyStart = text.split("\n").length - body.split("\n").length + 1;
  for (const link of linksOf(body, bodyStart)) {
    if (!exists(ctx, resolveLink(rel, link.target)))
      sink.error(7, `the link to ${link.target} points at nothing`, rel, link.line);
  }
  for (const field of ["supersedes", "superseded_by"]) {
    const target = front.getString(field);
    if (target !== undefined && !exists(ctx, resolveLink(rel, target)) && !exists(ctx, resolveLink("x", target))) {
      sink.error(7, `\`${field}\` points at ${target}, which does not exist`, rel);
    }
  }

  // Rule 8: nothing that is never saved, in any field or the body.
  for (const hit of findSecrets(text))
    sink.error(8, `looks like ${hit.what}; it is never saved in a brain`, rel, hit.line);

  // Warnings.
  if (front.getString("summary") === undefined)
    sink.warn("summary-missing", "no `summary`: the session summary shows nothing for this page", rel);
  if (spec?.changelog && !headings.includes("Changelog"))
    sink.warn("changelog-missing", "no `## Changelog` section", rel);
  if (kind === "rule" && withoutChangelog(body).length > RULE_LENGTH_LIMIT) {
    sink.warn(
      "rule-too-long",
      `a Rule goes whole into the session summary and this one passes ${RULE_LENGTH_LIMIT} characters`,
      rel,
    );
  }
  if (front.getString("source")?.startsWith("Session") && front.getString("evidence") === undefined) {
    sink.warn("evidence-missing", "its source is a session and it has no `evidence`", rel);
  }
  const staleAfter = front.getString("stale_after");
  if (staleAfter !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(staleAfter)) {
    sink.warn(
      "stale-after-invalid",
      `\`stale_after\` is "${staleAfter}"; it takes a date such as 2026-11-01, so lint cannot tell when the page needs a second look`,
      rel,
    );
  }
  const appliesTo = front.getList("applies_to") ?? [];
  for (const glob of appliesTo) {
    const problem = globProblem(glob);
    if (problem !== undefined)
      sink.warn("applies-to-invalid", `\`applies_to\` holds "${glob}", which matches no file: ${problem}`, rel);
  }
  if (appliesTo.length > 0 && ctx.config.tier !== "project")
    sink.warn(
      "applies-to-not-project",
      `\`applies_to\` names files of a project, and this is a ${ctx.config.tier} brain: the page is named for no file`,
      rel,
    );
  const status = front.getString("status");
  if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
    sink.warn("status-invalid", `\`status\` is "${status}"; a page is stable (no status) or ${DEPRECATED}`, rel);
  }
  const verifiedProblem = verifiedShapeProblem(front);
  if (verifiedProblem !== undefined) sink.warn("verified-invalid", verifiedProblem, rel);
  const lines = text.split("\n").length;
  if (lines > PAGE_LINE_LIMIT)
    sink.warn(
      "page-too-long",
      `${lines} lines; past ${PAGE_LINE_LIMIT} it is better as two pages, and \`kioku page show --section\` reads one part`,
      rel,
    );
}

const exists = (ctx: Context, rel: string | undefined): boolean => rel !== undefined && ctx.onDisk(rel);

const folderHint = (kind: string): string =>
  kind === "knowledge"
    ? "knowledge/<namespace>/decisions, playbooks or context"
    : kind === "memory"
      ? "memory/ or memory/instincts/"
      : `${kind}s/`;
