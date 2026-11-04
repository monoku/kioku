import { isFrontPageAt, listMarkdown } from "../brain/brain.ts";
import { parseFolderConfig } from "../config/folder-config.ts";
import { environmentError, firstLine, userError } from "../errors.ts";
import { git, gitQuiet } from "../git.ts";
import { currentSteps } from "../steps.ts";
import { NON_INTERACTIVE } from "../write/publish.ts";
import { ABSENT } from "./clone.ts";
import { plural } from "../util.ts";

/**
 * What became of a brain that had no remote when its repository was looked for on the git host (§2.3): `absent`, no
 * such repository as far as git could tell, with git's own words; `pushed`, an empty one now holds this brain; `adopted`, it held this brain already and this machine's
 * copy, which had no page, is now that one.
 */
export type Connection = { status: "absent"; said: string } | { status: "pushed" | "adopted"; remote: string };

/**
 * Connect a brain that has no `origin` to the repository at `url`, when there is one, never making one (§2.3): an empty
 * repository takes this brain; one that holds a brain of the same tier replaces this machine's copy when that copy has
 * no page, so nothing is lost. Two brains with their own pages under one name are never merged here: nothing changes
 * and the person is told how to do it by hand. A host that cannot be reached is an error. Only `brain publish` calls it.
 * Looking, pushing and fetching are each a step (§6.1).
 */
export function connectRepository(brain: { key: string; folder: string; name?: string }, url: string): Connection {
  const steps = currentSteps();
  const root = brain.folder;
  const name = brain.name ?? brain.key;
  let said = "";
  const refs = steps.run(
    {
      doing: `Looking for ${url}`,
      done: (r) =>
        r === undefined
          ? `Found no repository at ${url}`
          : r.trim() === ""
            ? `Found an empty repository at ${url}`
            : `Found a repository at ${url}`,
      direction: "down",
    },
    () => {
      try {
        return git(undefined, ["ls-remote", "--symref", "--", url], { ...NON_INTERACTIVE, timeoutMs: 20_000 });
      } catch (e) {
        if (ABSENT.test(String(e instanceof Error ? e.message : e))) {
          said = firstLine(e);
          return undefined;
        }
        throw environmentError(
          `could not reach ${url} to see whether it exists: ${firstLine(e)}`,
          "remote_unreachable",
        );
      }
    },
  );
  if (refs === undefined) return { status: "absent", said };
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(refs)?.[1] ?? "main";
  git(root, ["remote", "add", "origin", url]);
  const undo = () => gitQuiet(root, ["remote", "remove", "origin"]);
  try {
    if (refs.trim() === "") {
      steps.run({ doing: `Pushing ${name} to ${url}`, done: `Pushed ${name} to ${url}`, direction: "up" }, () =>
        git(root, ["push", "-q", "-u", "origin", `HEAD:${branch}`], NON_INTERACTIVE),
      );
      return { status: "pushed", remote: url };
    }
    steps.run({ doing: `Fetching what ${url} holds`, done: `Fetched what ${url} holds`, direction: "down" }, () =>
      git(root, ["fetch", "-q", "origin"], NON_INTERACTIVE),
    );
    const theirs = parseFolderConfig(gitQuiet(root, ["show", `origin/${branch}:kioku.yaml`]) ?? "");
    const ours = parseFolderConfig(gitQuiet(root, ["show", "HEAD:kioku.yaml"]) ?? "");
    const pages = listMarkdown(brain.folder).filter((rel) => !isFrontPageAt(rel)).length;
    const byHand = [
      `git -C ${root} remote add origin ${url}`,
      `git -C ${root} fetch origin`,
      `git -C ${root} merge --allow-unrelated-histories origin/${branch}`,
    ];
    if (!theirs.ok || theirs.value.form !== "brain") {
      throw userError(
        `${url} already holds something that is not this brain; nothing was changed. Choose another repository for it, or empty that one`,
        "remote_not_a_brain",
      );
    }
    if (ours.ok && ours.value.form === "brain" && theirs.value.tier !== ours.value.tier) {
      throw userError(
        `${url} holds a ${theirs.value.tier} brain and this one is a ${ours.value.tier} brain; nothing was changed`,
        "remote_other_tier",
      );
    }
    if (pages > 0) {
      throw userError(
        `${url} already holds a brain with its own history, and this one has ${plural(pages, "page")} that live only here: two brains under one name. Kioku never merges them on its own; nothing was changed. To merge them by hand:\n  ${byHand.join("\n  ")}`,
        "remote_diverged",
      );
    }
    git(root, ["checkout", "-q", "-B", branch, `origin/${branch}`]);
    git(root, ["reset", "-q", "--hard", `origin/${branch}`]);
    git(root, ["branch", "-q", "-u", `origin/${branch}`]);
    return { status: "adopted", remote: url };
  } catch (e) {
    undo();
    throw e;
  }
}
