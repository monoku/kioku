import { defaultUrl, parseRepo, repoKey } from "../config/brain-ref.ts";
import { updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { gitQuiet } from "../git.ts";
import { recordedUrl } from "./clone.ts";
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
 * `kioku brain publish [<brain>] [--to <url>]` (§2.3, §6.1): the only verb that reaches a git host for a brain with no
 * remote, and only through git. The repository at `to`, else the one the brain's key says, must exist and be empty or
 * hold this brain; none is ever made, and when nothing is there nothing changes and the ways on are said. The address is
 * recorded when it is not the one the name says (§2.2). A brain that has a remote is left alone. Each wait on git is a step (§6.1).
 */
export async function publishBrain(
  brain: { key: string; folder: string; name?: string },
  home: string,
  to?: string,
): Promise<PublishResult> {
  const ref = parseRepo(brain.key)!;
  const root = brain.folder;
  const existing = gitQuiet(root, ["remote", "get-url", "origin"]);
  if (existing !== undefined) return { brain: brain.key, status: "exists", remote: existing };
  const url = to ?? defaultUrl(ref);
  const found = connectRepository(brain, url);
  if (found.status === "absent")
    throw userError(
      to !== undefined
        ? `there is no repository at ${to} to publish ${brain.key} to; make an empty one there first (git init --bare ${to}, or on its host), then run this again`
        : `found no repository at ${url} (git says: ${found.said}); nothing was changed, and Kioku makes no repository on a host. Two ways on:\n  create an empty private repository ${ref.owner}/${ref.repo} on ${ref.host}, then run this again (a host answers alike for a repository it does not have and one you cannot read: if it exists, check git's credentials for it)\n  or publish it to an empty repository elsewhere: kioku brain publish ${brain.key} --to <url>`,
      "remote_absent",
    );
  const status: PublishResult["status"] = found.status === "pushed" ? "pushed" : "connected";
  const remote = gitQuiet(root, ["config", "--get", "remote.origin.url"]) ?? url;
  const address = recordedUrl(ref, remote);
  await updateMachineConfig((c) => {
    const entry = (c.repositories[repoKey(ref)] ??= {});
    if (address !== undefined) entry.url = address;
    else delete entry.url;
  }, home);
  return { brain: brain.key, status, remote };
}
