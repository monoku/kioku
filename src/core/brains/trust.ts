import { ownerKey, parseOwner, parseRepoShort, repoKey } from "../config/brain-ref.ts";
import { readMachineConfig, updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { cloneMissing, type SyncOutcome } from "./clone.ts";

export interface TrustResult {
  /** What was made trusted: a repository's key, or an owner's `host/owner`. */
  trusted: string;
  kind: "brain" | "owner";
  /** False when it was trusted already. */
  added: boolean;
  /** What cloning the brains the folder's chain was missing did. */
  cloned: SyncOutcome[];
}

/**
 * `kioku brain trust <brain>` and `kioku brain trust --owner <owner>` (§2.4): let this machine load
 * brains a repository's `kioku.yaml` names. A repository is a brain registered in `brains`; an owner
 * (`github.com/northwind`, or `northwind` on github.com) goes in `trusted`, so every repository it publishes is accepted. The
 * caller says which it is: a word is never both. Then the chain of `cwd` is cloned, which is what the person wanted
 * when they trusted it. Never called for the agent: the verb refuses outside a terminal.
 */
export async function trust(home: string, cwd: string, what: string, asOwner = false): Promise<TrustResult> {
  const named = parseOwner(what);
  if (asOwner) {
    if (named === undefined)
      throw userError(
        `"${what}" is not an owner such as northwind or github.com/northwind; --owner trusts every brain of one`,
        "usage",
      );
  } else if (named !== undefined) {
    throw userError(
      `"${what}" names an owner, not a brain; to trust every brain of it: kioku brain trust --owner ${what}`,
      "usage",
    );
  }
  const owner = asOwner ? named : undefined;
  const repo = asOwner ? undefined : parseRepoShort(what);
  if (repo === undefined && owner === undefined) {
    throw userError(
      `"${what}" is not a brain such as github.com/owner/repo or owner/repo; --owner names an owner`,
      "usage",
    );
  }
  const key = repo !== undefined ? repoKey(repo) : ownerKey(owner!);
  const before = readMachineConfig(home);
  const had =
    repo !== undefined ? before?.repositories[key] !== undefined : before?.trust.owners.includes(key) === true;
  await updateMachineConfig((c) => {
    if (repo !== undefined) c.repositories[key] ??= {};
    else if (!c.trust.owners.includes(key)) c.trust.owners.push(key);
  }, home);
  const cloned = (await cloneMissing(cwd, home)).filter((o) => o.tier !== "personal");
  return { trusted: key, kind: repo !== undefined ? "brain" : "owner", added: !had, cloned };
}
