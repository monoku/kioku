import { lstatSync, readFileSync } from "node:fs";
import { isMap, parseDocument, stringify } from "yaml";
import { parseBrainReference, parseName, referenceValue, type BrainRef } from "./brain-ref.ts";

/** Formats of a brain's files that this tool reads (§5.1 rule 10, §6.4). */
export const KNOWN_FORMATS: readonly number[] = [1, 2];
/** The format this tool writes: `2`, the brain's `name` in its `kioku.yaml` (§3.2). */
export const CURRENT_FORMAT = 2;
/** A language tag: two or three letters, with an optional region (`en`, `es`, `es-419`, `pt-BR`) (§3.2). */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export const TIERS = ["personal", "project", "team"] as const;
export type Tier = (typeof TIERS)[number];

/** The keys a project folder's `kioku.yaml` may hold (§2.4). */
export const CODE_REPO_KEYS = ["brain", "team"] as const;
/** The keys a brain's own `kioku.yaml` may hold (§5), from `format: 2`: none names another brain (§2.4). */
export const BRAIN_KEYS = ["format", "name", "tier", "namespaces", "language"] as const;
/** What `format: 1`, which 0.1.0 wrote, holds: the same, with no name (§3.2). */
const FORMAT_1_KEYS = ["format", "tier", "namespaces", "language"] as const;

/** A project folder's `kioku.yaml` (§2.4): the project brain it belongs to, a team brain, or both. */
export interface CodeRepoConfig {
  form: "code";
  brain?: BrainRef;
  team?: BrainRef;
}

/**
 * A brain's own `kioku.yaml` (§5). `format` and `tier` are kept as read so the validator can judge them. It holds the
 * brain's name from `format: 2` (§2.2, §3.2), and no other brain (§2.4).
 */
export interface BrainConfig {
  form: "brain";
  format: number;
  /** `<owner>/<repo>`, chosen when the brain was made and never changed (§2.2); absent in `format: 1`. */
  name?: string;
  tier: Tier;
  namespaces: string[];
  /** The language the brain's pages are written in, a convention the summary tells the agent (§3.2). */
  language?: string;
}

export type FolderConfig = CodeRepoConfig | BrainConfig;
/** `syntax` marks a file that is not YAML or not a mapping, as against a field that is wrong (§5.1, rules 1 and 2). */
export type ConfigResult<T> = { ok: true; value: T } | { ok: false; reason: string; syntax?: true };

const fail = <T>(reason: string, syntax?: true): ConfigResult<T> => ({ ok: false, reason, ...(syntax && { syntax }) });

/** Tells the two forms apart by content: `tier` or `format` make a brain's; otherwise `brain` or `team` a project folder's (§2.4). */
export function parseFolderConfig(text: string): ConfigResult<FolderConfig> {
  const doc = parseDocument(text, { version: "1.2", uniqueKeys: true });
  if (doc.errors.length > 0)
    return fail(`kioku.yaml is not valid YAML: ${doc.errors[0]!.message.split("\n")[0]}`, true);
  if (!isMap(doc.contents)) return fail("kioku.yaml is not a mapping", true);
  const raw = doc.toJS() as Record<string, unknown>;
  const isBrain = "tier" in raw || "format" in raw;
  if ("brain" in raw && isBrain)
    return fail("kioku.yaml has both `brain` (a project folder's) and `tier` or `format` (a brain's)");
  if (isBrain) return brain(raw);
  if ("brain" in raw || "team" in raw) return codeRepo(raw);
  return fail("kioku.yaml has neither `brain` or `team` (a project folder's) nor `tier` and `format` (a brain's)");
}

/** Like `parseFolderConfig`, from a file; a failure names the file. */
export function readFolderConfig(path: string): ConfigResult<FolderConfig> {
  let text: string;
  try {
    // A link is not read: its target is no folder's file, and a parse error would quote it (§3.1).
    if (lstatSync(path).isSymbolicLink()) return fail(`${path} is a symbolic link, which is not read`);
    text = readFileSync(path, "utf8");
  } catch (e) {
    return fail(`cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? "error"}`);
  }
  const parsed = parseFolderConfig(text);
  if (parsed.ok) return parsed;
  return {
    ...parsed,
    reason: parsed.reason.startsWith("kioku.yaml")
      ? parsed.reason.replace(/^kioku\.yaml/, path)
      : `${path}: ${parsed.reason}`,
  };
}

function unknownKey(raw: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(raw).find((k) => !allowed.includes(k));
}

function codeRepo(raw: Record<string, unknown>): ConfigResult<FolderConfig> {
  const extra = unknownKey(raw, CODE_REPO_KEYS);
  if (extra !== undefined)
    return fail(
      `kioku.yaml has an unknown key \`${extra}\`; a project folder's file holds \`brain\`, \`team\` or both`,
    );
  const value: CodeRepoConfig = { form: "code" };
  for (const field of CODE_REPO_KEYS) {
    if (raw[field] === undefined) continue;
    const r = parseBrainReference(raw[field], field);
    if (!r.ok) return fail(r.reason);
    value[field] = r.ref;
  }
  return { ok: true, value };
}

function brain(raw: Record<string, unknown>): ConfigResult<FolderConfig> {
  if (typeof raw.format !== "number" || !Number.isInteger(raw.format)) return fail("`format` must be a whole number");
  // A newer format may add keys; the validator refuses it by its number (§5.1 rule 10), so the keys are not judged here.
  const keys = raw.format === 1 ? FORMAT_1_KEYS : BRAIN_KEYS;
  const extra = KNOWN_FORMATS.includes(raw.format) ? unknownKey(raw, keys) : undefined;
  if (extra !== undefined)
    return fail(
      `kioku.yaml has an unknown key \`${extra}\`; a brain's file holds ${keys.map((k) => `\`${k}\``).join(", ")}`,
    );
  // From `format: 2` a brain carries its name (§2.2, §5.1 rule 13).
  if (raw.format >= 2 && KNOWN_FORMATS.includes(raw.format)) {
    if (typeof raw.name !== "string" || parseName(raw.name) === undefined)
      return fail("`name` must be the brain's name, `<owner>/<repo>`, such as northwind/app-brain");
  }
  if (typeof raw.tier !== "string" || !(TIERS as readonly string[]).includes(raw.tier)) {
    return fail(`\`tier\` must be one of ${TIERS.join(", ")}`);
  }
  const ns = raw.namespaces;
  // A brain starts with no namespace: each is made when there is something to put in it (§3.2).
  if (!Array.isArray(ns) || !ns.every((n) => typeof n === "string" && n !== "")) {
    return fail("`namespaces` must be a list of names, empty in a brain that has none yet");
  }
  const value: BrainConfig = {
    form: "brain",
    format: raw.format,
    ...(typeof raw.name === "string" && { name: raw.name.trim() }),
    tier: raw.tier as Tier,
    namespaces: ns as string[],
  };
  if (raw.language !== undefined) {
    if (typeof raw.language !== "string" || !LANGUAGE_TAG.test(raw.language))
      return fail("`language` must be a language tag such as `en`, `es`, `es-419` or `pt-BR`");
    value.language = raw.language;
  }
  return { ok: true, value };
}

/** A reference as §2.2 writes it: the name, or `{ name: …, url: … }` on one line. */
function referenceYaml(ref: BrainRef): string {
  const v = referenceValue(ref);
  return typeof v === "string" ? v : `{ name: ${v.name}, url: ${stringify(v.url).trim()} }`;
}

/** The file's text: the keys in the order of the example in §2.5. */
export function stringifyFolderConfig(config: FolderConfig): string {
  if (config.form === "code")
    return CODE_REPO_KEYS.filter((k) => config[k] !== undefined)
      .map((k) => `${k}: ${referenceYaml(config[k]!)}\n`)
      .join("");
  const head = stringify(
    { format: config.format, ...(config.name !== undefined && { name: config.name }), tier: config.tier },
    { lineWidth: 0 },
  );
  const language = config.language === undefined ? "" : stringify({ language: config.language }, { lineWidth: 0 });
  return `${head}${stringify({ namespaces: config.namespaces }, { lineWidth: 0 })}${language}`;
}
