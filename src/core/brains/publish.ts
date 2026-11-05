import { addressUrl, isAddress, looksLikeOption } from "../config/brain-ref.ts";
import { readMachineConfig, updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { gitQuiet } from "../git.ts";
import { brainAtAddress } from "./clone.ts";
import { connectRepository } from "./connect.ts";

export interface PublishResult {
  brain: string;
  /**
   * `pushed`: an empty repository now holds the brain; `connected`: the repository held this brain, and this machine's
   * copy is now that one; `exists`: the brain already had a remote, and nothing was done.
   */
  status: "pushed" | "connected" | "exists";
  remote: string;
}

/**
 * `kioku brain publish <brain> --remote <destination>` (§2.3, §6.1): the only verb that reaches a git host for a brain
 * with no remote, and only through git. The repository at the destination, any address of §2.2, must exist and be
 * empty or hold this brain; none is ever made, and when nothing is there nothing changes. The brain's name and folder
 * do not change; the address is recorded under its name (§2.5). A destination that is another brain's address here
 * is refused. A brain that has a remote is left alone. Each wait on git is a step (§6.1).
 */
export async function publishBrain(
  brain: { key: string; folder: string; name?: string },
  home: string,
  to?: string,
): Promise<PublishResult> {
  const root = brain.folder;
  const existing = gitQuiet(root, ["config", "--get", "remote.origin.url"]);
  if (existing !== undefined) return { brain: brain.key, status: "exists", remote: existing };
  if (to === undefined)
    throw userError(
      `${brain.key} has no remote; name the repository to publish it to, which must exist and be empty: kioku brain publish ${brain.key} --remote <address>`,
      "usage",
    );
  if (looksLikeOption(to) || !isAddress(to))
    throw userError(
      `"${to}" is not an address git clones from, such as github.com/owner/repo, https://…, git@host:path or a folder`,
      "usage",
    );
  const url = addressUrl(to);
  const other = brainAtAddress(home, url, readMachineConfig(home));
  if (other !== undefined && other !== brain.key)
    throw userError(
      `${url} is the repository of ${other} on this machine; one repository is never two brains`,
      "brain_exists",
    );
  const found = connectRepository(brain, url);
  if (found.status === "absent")
    throw userError(
      `found no repository at ${url} (git says: ${found.said}); nothing was changed, and Kioku makes no repository on a host. Create an empty repository there, then run this again (a host answers alike for a repository it does not have and one you cannot read: if it exists, check git's credentials for it)`,
      "remote_absent",
    );
  const status: PublishResult["status"] = found.status === "pushed" ? "pushed" : "connected";
  const remote = gitQuiet(root, ["config", "--get", "remote.origin.url"]) ?? url;
  await updateMachineConfig((c) => void (c.repositories[brain.key] = remote), home);
  return { brain: brain.key, status, remote };
}
