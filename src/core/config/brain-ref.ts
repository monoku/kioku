import { isAbsolute, join } from "node:path";
import { userError } from "../errors.ts";

/**
 * A brain (§2.2): its name, `<owner>/<repo>`, the same on every machine, and, apart from it, the address of its
 * repository when the reference gives one. The name says nothing of where the brain is.
 */
export interface BrainRef {
  owner: string;
  repo: string;
  /** Where the repository is: any address git clones from (§2.2). A name alone is a brain of this machine (§2.4). */
  url?: string;
}

/** One segment of a name: letters, digits, `-` and `_`, never a dot, so that no name reads as a host (§2.2). */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Whether `input` is a name, `<owner>/<repo>` (§2.2). */
export const isName = (input: string): boolean => parseName(input) !== undefined;

/** A name, `<owner>/<repo>`; undefined for anything else, an address included. */
export function parseName(input: string): BrainRef | undefined {
  const parts = input.trim().split("/");
  if (parts.length !== 2 || !parts.every((p) => SEGMENT.test(p))) return undefined;
  return { owner: parts[0]!, repo: parts[1]! };
}

/** A brain's name, `<owner>/<repo>`: its key on this machine and for programs (§2.2, §2.3). */
export const repoKey = (r: Pick<BrainRef, "owner" | "repo">): string => `${r.owner}/${r.repo}`;

/** A brain as a person reads it: its name (§2.3). */
export const brainRepo = repoKey;

/** A brain known by its key, as a person reads it: the key is its name (§2.3). */
export const brainRepoOfKey = (key: string): string => key;

/** A brain known only by its folder: its last two parts as `<owner>/<repo>`, as the managed folder lays it out (§2.5). */
export const brainRepoOfFolder = (root: string): string => {
  const parts = root.replace(/\/+$/, "").split(/[\\/]/);
  return `${parts.at(-2) ?? ""}/${parts.at(-1) ?? ""}`;
};

/** An address git would read as one of its own options, `--upload-pack=…` say: refused wherever an address is taken (§2.2). */
export const looksLikeOption = (address: string): boolean => address.trim().startsWith("-");

/** A folder, written as a path: what begins with `/`, `./`, `../` or `~` (§2.2). */
const isFolder = (s: string): boolean => /^(\/|\.{1,2}(\/|$)|~(\/|$))/.test(s);

/** `user@host:path`, git's short ssh form. */
const SCP = /^[\w.-]+@([\w.-]+):(.+)$/;

/**
 * Whether `input` is an address (§2.2): a URL (`https://`, `ssh://`, `file://` …), git's `user@host:path`, a folder, or
 * `host/path` whose first segment has a dot. A name never is one: it has two segments, no dot and no leading `/`, `.` or `~`.
 */
export function isAddress(input: string): boolean {
  const s = input.trim();
  if (s === "" || looksLikeOption(s)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || SCP.test(s) || isFolder(s)) return true;
  const parts = s.split("/");
  return parts.length >= 3 && parts[0]!.includes(".") && parts.every((p) => p !== "");
}

/** The address git is given for `input`: `host/path` is `https://<host>/<path>.git` (§2.2); anything else, as written. */
export function addressUrl(input: string): string {
  const s = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || SCP.test(s) || isFolder(s)) return s;
  return `https://${s.replace(/\/+$/, "").replace(/\.git$/, "")}.git`;
}

/** The host and the path of a repository's address; undefined for a folder or `file://`, which have no host. */
export function addressParts(url: string): { host: string; path: string } | undefined {
  const s = url.trim();
  const scp = SCP.exec(s);
  let host: string;
  let path: string;
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(s);
    if (!m) {
      if (isFolder(s) || /^file:\/\//i.test(s) || /:\/\//.test(s)) return undefined;
      const parts = s.split("/");
      if (parts.length < 3 || !parts[0]!.includes(".")) return undefined;
      host = parts[0]!;
      path = parts.slice(1).join("/");
    } else {
      host = m[1]!;
      path = m[2]!;
    }
  }
  path = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .replace(/^~[^/]*\//, "");
  return path === "" ? undefined : { host: host.toLowerCase(), path };
}

/**
 * The name an address says when its brain carries none (§3.2, a brain of `format: 1`): the last two segments of its
 * path, `https://github.com/northwind/app-brain.git` is `northwind/app-brain`; a folder's last two folders.
 */
export function nameOfAddress(url: string): BrainRef | undefined {
  const path = addressParts(url)?.path ?? url.trim().replace(/^file:\/\//i, "");
  const parts = path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter((p) => p !== "");
  return parts.length >= 2 ? parseName(`${parts.at(-2)}/${parts.at(-1)}`) : undefined;
}

/** The owner of an address, `host/owner`, the host and the first segment of its path (§2.4); undefined for a folder. */
export function ownerOfAddress(url: string): string | undefined {
  const parts = addressParts(url);
  const first = parts?.path.split("/")[0];
  return parts === undefined || first === undefined || first === "" ? undefined : `${parts.host}/${first}`;
}

/** Whether two addresses are one repository: the same text, or the https and ssh forms of one host and path (§2.4). */
export function sameRepository(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const x = addressParts(a);
  const y = addressParts(b);
  return x !== undefined && y !== undefined && x.host === y.host && x.path === y.path;
}

/** The canonical key of an owner of addresses, `host/owner`: what `trust.owners` holds (§2.4). */
export const ownerKey = (r: { host: string; owner: string }): string => `${r.host}/${r.owner}`;

/** An owner of addresses as a person types it, `host/owner`, the host with a dot (§2.4); undefined for anything else. */
export function parseOwner(input: string): { host: string; owner: string } | undefined {
  const t = input.trim().replace(/\/+$/, "");
  const m = /^([\w-]+(?:\.[\w-]+)+)\/([\w.-]+)$/.exec(t);
  return m ? { host: m[1]!.toLowerCase(), owner: m[2]! } : undefined;
}

export type RefResult = { ok: true; ref: BrainRef } | { ok: false; reason: string };

/** An address checked for what git would misread: one that begins with `-`. */
function addressOf(value: string, field: string): RefResult | string {
  if (looksLikeOption(value))
    return { ok: false, reason: `\`${field}\` begins with -, which git would read as an option: ${value}` };
  return addressUrl(value);
}

/**
 * A brain reference as a project folder's `kioku.yaml` writes it (§2.2, §2.4): a name, `northwind/app-brain`; a name
 * and its address, `{ name, url }`; or an address alone, as 0.1.0 wrote it, read with the name its path says. `field`
 * names the key in messages.
 */
export function parseBrainReference(value: unknown, field: string): RefResult {
  if (typeof value === "string") {
    const named = parseName(value);
    if (named !== undefined) return { ok: true, ref: named };
    if (isAddress(value)) {
      const url = addressOf(value, field);
      if (typeof url !== "string") return url;
      const name = nameOfAddress(url);
      return name === undefined
        ? {
            ok: false,
            reason: `\`${field}\` is an address that says no name; write \`{ name: <owner>/<repo>, url: ${value} }\``,
          }
        : { ok: true, ref: { ...name, url } };
    }
    return { ok: false, reason: `\`${field}\` is not a brain's name, such as northwind/app-brain: ${value}` };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (k !== "name" && k !== "url")
        return { ok: false, reason: `unknown key \`${field}.${k}\`; a brain reference holds \`name\` and \`url\`` };
    }
    const named = typeof obj.name === "string" ? parseName(obj.name) : undefined;
    if (named === undefined)
      return { ok: false, reason: `\`${field}.name\` must be a brain's name, such as northwind/app-brain` };
    if (obj.url === undefined) return { ok: true, ref: named };
    if (typeof obj.url !== "string" || obj.url.trim() === "")
      return { ok: false, reason: `\`${field}.url\` must be the address of a git repository` };
    const url = addressOf(obj.url, `${field}.url`);
    if (typeof url !== "string") return url;
    return { ok: true, ref: { ...named, url } };
  }
  return {
    ok: false,
    reason: `\`${field}\` must be a brain's name, such as northwind/app-brain, or { name, url }`,
  };
}

/** The value a `kioku.yaml` holds for this reference: the name alone, or `{ name, url }` once it has an address (§2.2). */
export function referenceValue(ref: BrainRef): string | { name: string; url: string } {
  return ref.url === undefined ? repoKey(ref) : { name: repoKey(ref), url: ref.url };
}

/** The managed folder, where every brain lives (§2.5). */
export const brainsFolder = (home: string): string => join(home, ".kioku", "brains");

/** A brain's folder, its name under the managed folder: `sam/memoria` is `~/.kioku/brains/sam/memoria/` (§2.5). */
export const brainFolder = (home: string, ref: Pick<BrainRef, "owner" | "repo">): string =>
  join(brainsFolder(home), ref.owner, ref.repo);

/** The reverse of `brainFolder`: the brain whose folder is `sub` under the managed folder; undefined for any other folder. */
export function managedRef(sub: string): BrainRef | undefined {
  return parseName(sub);
}

/** `~` and `~/x` mean the home folder; a relative path is not allowed. */
export function expandPath(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  if (!isAbsolute(p)) throw userError(`a path must be absolute or start with ~: ${p}`, "path_invalid");
  return p;
}

/** A key of a configuration 0.1.0 wrote, `host/owner/repo` (§2.5): read only to bring that configuration forward. */
export function parseLegacyKey(input: string): { host: string; owner: string; repo: string } | undefined {
  const m = /^([\w-]+(?:\.[\w-]+)+)\/([\w.-]+)\/([\w.-]+)$/.exec(input.trim());
  return m ? { host: m[1]!.toLowerCase(), owner: m[2]!, repo: m[3]! } : undefined;
}

/** Where 0.1.0 kept a brain it managed: `<owner>/<repo>` on github.com, `<host>/<owner>/<repo>` elsewhere. */
export const legacyManagedPath = (home: string, k: { host: string; owner: string; repo: string }): string =>
  k.host === "github.com"
    ? join(brainsFolder(home), k.owner, k.repo)
    : join(brainsFolder(home), k.host, k.owner, k.repo);
