import { isAbsolute, join } from "node:path";
import { userError } from "../errors.ts";
import type { MachineConfig } from "./machine.ts";

/** A brain: a repository on a git host, the whole of it (§2.2). */
export interface BrainRef {
  host: string;
  owner: string;
  repo: string;
  /** Where the repository is when that is not `https://<host>/<owner>/<repo>.git` (§2.2): an ssh address, a folder on disk. */
  url?: string;
}

/** The address a repository is cloned from when nothing says otherwise: the one its key names (§2.2). */
export const defaultUrl = (r: Pick<BrainRef, "host" | "owner" | "repo">): string =>
  `https://${r.host}/${r.owner}/${r.repo}.git`;

/** An ssh address of a repository, `git@host:owner/repo.git` or `ssh://…`: one that says both a brain's key and where it is (§2.2). */
export const isSshAddress = (input: string): boolean =>
  /^[\w.-]+@[\w.-]+:/.test(input.trim()) || /^ssh:\/\//i.test(input.trim());

/** The canonical key of the repository, `host/owner/repo`: how the machine configuration names a clone (§2.5). */
/**
 * A brain as a person types and reads it (§2.3, §6.1): `owner/repo` on github.com, `host/owner/repo` on another host.
 * A brain has no name of its own; programs read its key (`repoKey`).
 */
export const brainRepo = (r: Pick<BrainRef, "host" | "owner" | "repo">): string =>
  r.host === "github.com" ? `${r.owner}/${r.repo}` : `${r.host}/${r.owner}/${r.repo}`;

/** A brain known by its key, as a person reads it (§2.3); the key itself when it is not one. */
export const brainRepoOfKey = (key: string): string => {
  const ref = parseRepo(key);
  return ref === undefined ? key : brainRepo(ref);
};

/** A brain known only by its folder: its last two parts as `<owner>/<repo>`, as a managed clone is laid out. */
export const brainRepoOfFolder = (root: string): string => {
  const parts = root.replace(/\/+$/, "").split(/[\\/]/);
  return `${parts.at(-2) ?? ""}/${parts.at(-1) ?? ""}`;
};

export const repoKey = (r: BrainRef): string => `${r.host}/${r.owner}/${r.repo}`;

/** The canonical key of the owner of a repository, `host/owner`: what the configuration's `trusted` list names (§2.4). */
export const ownerKey = (r: Pick<BrainRef, "host" | "owner">): string => `${r.host}/${r.owner}`;

/** An owner as a person types it: `owner` (on github.com) or `host/owner`. Undefined for anything else, a repository included. */
export function parseOwner(input: string): { host: string; owner: string } | undefined {
  const t = input.trim().replace(/\/+$/, "");
  const one = /^[\w.-]+$/.exec(t);
  if (one) return { host: "github.com", owner: t };
  const two = /^([\w.-]+\.[\w-]+)\/([\w.-]+)$/.exec(t);
  return two ? { host: two[1]!.toLowerCase(), owner: two[2]! } : undefined;
}

export type RefResult = { ok: true; ref: BrainRef } | { ok: false; reason: string };

/** Accepts `host/owner/repo`, `https://host/owner/repo(.git)` and `git@host:owner/repo(.git)`. */
export function parseRepo(input: string): BrainRef | undefined {
  let s = input.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(s);
  if (scp) s = `${scp[1]}/${scp[2]}`;
  s = s
    .replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const m = /^([\w.-]+)\/([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? { host: m[1]!.toLowerCase(), owner: m[2]!, repo: m[3]! } : undefined;
}

/** Like `parseRepo`, and `owner/repo` alone means a repository on github.com (§6.1). */
export function parseRepoShort(input: string): BrainRef | undefined {
  const t = input.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(t) ? parseRepo(`github.com/${t}`) : parseRepo(t);
}

/** A brain as a person or a file writes it: its name, and its ssh address kept as its `url` when it was given as one (§2.2). */
export function parseNamed(input: string, short = false): BrainRef | undefined {
  const ref = short ? parseRepoShort(input) : parseRepo(input);
  return ref !== undefined && isSshAddress(input) ? { ...ref, url: input.trim() } : ref;
}

/** An address git would read as one of its own options, `--upload-pack=…` say: refused wherever an address is taken (§2.2). */
export const looksLikeOption = (address: string): boolean => address.trim().startsWith("-");

/**
 * A brain reference as a `kioku.yaml` writes it (§2.4, §2.5): `github.com/owner/repo`, its ssh address, or
 * `{ repo: github.com/owner/repo, url: address }`. `field` names the key in messages.
 */
export function parseBrainReference(value: unknown, field: string): RefResult {
  if (typeof value === "string") {
    const ref = parseNamed(value);
    return ref
      ? { ok: true, ref }
      : { ok: false, reason: `\`${field}\` is not a brain URL such as github.com/owner/repo: ${value}` };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (k !== "repo" && k !== "url")
        return {
          ok: false,
          reason: `unknown key \`${field}.${k}\`; a brain reference holds \`repo\` and \`url\`, and a brain is a whole repository`,
        };
    }
    if (typeof obj.repo !== "string")
      return { ok: false, reason: `\`${field}.repo\` must be a brain URL such as github.com/owner/repo` };
    const named = parseNamed(obj.repo);
    if (!named) return { ok: false, reason: `\`${field}.repo\` is not a brain URL: ${obj.repo}` };
    if (obj.url !== undefined && (typeof obj.url !== "string" || obj.url.trim() === ""))
      return { ok: false, reason: `\`${field}.url\` must be the address of a git repository` };
    if (typeof obj.url === "string" && looksLikeOption(obj.url))
      return { ok: false, reason: `\`${field}.url\` begins with -, which git would read as an option: ${obj.url}` };
    return { ok: true, ref: obj.url === undefined ? named : { ...named, url: (obj.url as string).trim() } };
  }
  return { ok: false, reason: `\`${field}\` must be a brain URL such as github.com/owner/repo, or { repo, url }` };
}

/**
 * The value a `kioku.yaml` holds for this reference: the short string, or the ssh address it was given as; else
 * `{ repo, url }` for an address of its own (§2.2).
 */
export function referenceValue(ref: BrainRef): string | { repo: string; url: string } {
  if (ref.url === undefined) return repoKey(ref);
  // An ssh address says both the name and where the repository is, so it stands alone (§2.2).
  if (isSshAddress(ref.url) && parseRepo(ref.url) !== undefined && repoKey(parseRepo(ref.url)!) === repoKey(ref))
    return ref.url;
  return { repo: repoKey(ref), url: ref.url };
}

/** The host whose managed clones are not under a folder of their host's name: every clone before other hosts were (§2.5). */
const BARE_HOST = "github.com";

/** The managed clone of a repository (§2.5): `~/.kioku/brains/<owner>/<repo>/` on github.com, `~/.kioku/brains/<host>/<owner>/<repo>/` elsewhere. */
export const managedPath = (home: string, ref: BrainRef): string =>
  ref.host === BARE_HOST
    ? join(home, ".kioku", "brains", ref.owner, ref.repo)
    : join(home, ".kioku", "brains", ref.host, ref.owner, ref.repo);

/**
 * The reverse of `managedPath`: the brain whose clone is a folder under `~/.kioku/brains/`; undefined for any other
 * folder there, a folder inside a clone included. A first folder with a dot is a host: an owner on github.com has none.
 */
export function managedRef(sub: string): BrainRef | undefined {
  const parts = sub.split("/");
  const [host, rest] = parts[0]?.includes(".") ? [parts[0], parts.slice(1)] : [BARE_HOST, parts];
  const [owner, repo, ...inside] = rest;
  return owner && repo && inside.length === 0 ? { host: host!.toLowerCase(), owner, repo } : undefined;
}

/** `~` and `~/x` mean the home folder; a relative path is not allowed. */
export function expandPath(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  if (!isAbsolute(p)) throw userError(`a brain path must be absolute or start with ~: ${p}`, "path_invalid");
  return p;
}

/** The clone of a brain's repository: its override, else the managed location (§2.5). */
export function cloneOf(config: MachineConfig, ref: BrainRef, home: string): string {
  const override = config.repositories[repoKey(ref)]?.path;
  return override === undefined ? managedPath(home, ref) : expandPath(override, home);
}

/** Where a brain is, or will be cloned: its repository's clone. */
export const localPathOf = (config: MachineConfig, ref: BrainRef, home: string): string => cloneOf(config, ref, home);
