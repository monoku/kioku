import { join } from "node:path";
import { brainRepoOfFolder } from "../config/brain-ref.ts";
import { readBrainConfig } from "../brain/brain.ts";
import type { BrainConfig } from "../config/folder-config.ts";
import { gitQuiet, git, type GitOptions } from "../git.ts";
import { firstLine } from "../errors.ts";
import { acquireLock, type Lock } from "../fs/lock.ts";
import { currentSteps } from "../steps.ts";

/**
 * One write's view of a brain's repository: what does not change while the write runs, read once and kept no longer.
 * Made where the write starts (`bringIn`, or `applyChanges` for a write with no bring-in) and dropped with it, never
 * kept at module level, since the scripts and tests run many writes in one process and `brain publish` or `connect`
 * change a remote between two.
 */
export class BrainRepo {
  readonly root: string;
  #remote: { url: string | undefined } | undefined;
  #branch: string | undefined;
  #gitDir: string | undefined;
  #config: BrainConfig | undefined;
  /**
   * HEAD holds everything `origin/<branch>` held at this write's fetch (§1.6): the push that follows needs no fetch
   * and no rebase first. A push someone beat anyway is a race like any other, and fetches and rebases then.
   */
  fresh = false;

  constructor(root: string, config?: BrainConfig) {
    this.root = root;
    this.#config = config;
  }

  /** The url of `origin`; undefined for a brain with no remote. */
  remote(): string | undefined {
    this.#remote ??= { url: gitQuiet(this.root, ["remote", "get-url", "origin"]) };
    return this.#remote.url;
  }

  branch(): string {
    return (this.#branch ??= gitQuiet(this.root, ["branch", "--show-current"]) ?? "main");
  }

  gitDir(): string {
    return (this.#gitDir ??= git(this.root, ["rev-parse", "--absolute-git-dir"]));
  }

  /** The brain's `kioku.yaml`, as it stands after the bring-in. Throws when it cannot be read. */
  config(): BrainConfig {
    return (this.#config ??= readBrainConfig(this.root));
  }

  /** The brain as a step names it (§6.1): its folder's name. */
  label(): string {
    return brainRepoOfFolder(this.root);
  }

  /** The working tree changed under the write (a rebase brought in what others published): what was read of it is read again. */
  changed(): void {
    this.#config = undefined;
  }
}

/** A `BrainRepo` for a brain, or the one a write already made. */
export const repoOf = (target: string | BrainRepo | { root: string; config?: BrainConfig }): BrainRepo =>
  target instanceof BrainRepo
    ? target
    : typeof target === "string"
      ? new BrainRepo(target)
      : new BrainRepo(target.root, target.config);

/**
 * The brain's writer lock (§1.6): held while its working tree changes, a write or a rebase, and never across the
 * network, so that a write waits seconds for another and not for a push. Not reentrant: a holder that calls
 * `pushBrain` or `freshen`, which take it themselves, waits for itself.
 */
export function lockBrain(target: string | BrainRepo): Promise<Lock> {
  return acquireLock(join(repoOf(target).gitDir(), "kioku.lock"));
}

/** Run `work` under the brain's writer lock. */
export async function underLock<T>(target: string | BrainRepo, work: () => T): Promise<T> {
  const lock = await lockBrain(target);
  try {
    return work();
  } finally {
    lock.release();
  }
}

/** A fetch or push that takes longer is a hung network. Chosen, not measured. */
export const NETWORK_TIMEOUT_MS = 60_000;

/**
 * Git must never stop to ask for a password or a host key: a hook or an agent cannot answer. ssh runs in batch mode
 * through git's configuration for the call, which a `GIT_SSH_COMMAND` of the person's still overrides, as git
 * itself decides, so nothing here reads the environment.
 */
export const NON_INTERACTIVE: GitOptions = {
  timeoutMs: NETWORK_TIMEOUT_MS,
  env: { GIT_TERMINAL_PROMPT: "0" },
  config: { "core.sshCommand": "ssh -o BatchMode=yes" },
};

/** What was set aside when the commits of this machine could not sit on top of what others published. */
export interface Conflict {
  /** The branch that holds every unpublished commit as they were. */
  branch: string;
  /** The pages those commits touched that could not be put back, brain-relative. */
  pages: string[];
  /** The commits set aside, oldest first. */
  commits: { sha: string; message: string }[];
}

export type PushResult =
  | { status: "pushed" }
  | { status: "no-remote" }
  | { status: "failed"; reason: string }
  | { status: "conflict"; conflict: Conflict };

/**
 * Put the commits of this machine on top of the remote's (§1.6). When they cannot go, the brain is not left half way and
 * does not stop receiving what others publish: every unpublished commit is kept on a branch as it was, and the brain
 * goes back to the remote's state. The commits set aside, and the pages they touched, are the conflict. Throws when it
 * cannot even do that, for a working tree with changes nobody committed: the rebase is undone and the brain is as it was.
 */
export function rebaseOntoRemote(
  root: string,
  branch: string,
): { status: "ok" } | { status: "conflict"; conflict: Conflict } {
  const remote = `origin/${branch}`;
  try {
    git(root, ["rebase", "-q", "--autostash", remote]);
    return { status: "ok" };
  } catch (e) {
    gitQuiet(root, ["rebase", "--abort"]);
    if (git(root, ["status", "--porcelain"]) !== "") throw e;
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const commits = git(root, ["rev-list", "--reverse", `${remote}..HEAD`])
    .split("\n")
    .filter((c) => c !== "");
  const kept = `kioku/conflict-${head.slice(0, 7)}`;
  git(root, ["branch", "-f", kept, head]);
  git(root, ["reset", "-q", "--hard", remote]);
  const pages = new Set<string>();
  for (const sha of commits)
    for (const f of git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).split("\n"))
      if (f !== "") pages.add(f);
  return {
    status: "conflict",
    conflict: {
      branch: kept,
      pages: [...pages].sort(),
      commits: commits.map((sha) => ({ sha: sha.slice(0, 7), message: git(root, ["log", "-1", "--format=%s", sha]) })),
    },
  };
}

/**
 * Publish a shared brain's commits (§1.6): fetch, rebase on the default branch, push. Only the rebase, which changes
 * the working tree, runs under the brain's lock; the fetch and the push wait on the network outside it, so the caller
 * must not hold it. A write whose bring-in just found nothing behind pushes at once, with no second fetch and no
 * rebase; when that push is beaten by someone else's it fetches and rebases as any other, so a race costs one more
 * push and never a write. On a failure the commits stay as they are and the reason comes back; commits that overlap
 * with what others published are set aside on a branch and come back as a `conflict`. A push that lost a race with
 * another one is a failure like any other: `sync` retries it.
 */
export async function pushBrain(target: string | BrainRepo): Promise<PushResult> {
  const repo = repoOf(target);
  const root = repo.root;
  if (repo.remote() === undefined) return { status: "no-remote" };
  const branch = repo.branch();
  const name = repo.label();
  const push = () => git(root, ["push", "-q", "-u", "origin", `HEAD:${branch}`], NON_INTERACTIVE);
  return currentSteps().runAsync<PushResult>(
    {
      doing: `Publishing to ${name}`,
      done: (r) =>
        r.status === "pushed"
          ? `Published to ${name}`
          : r.status === "conflict"
            ? `Kept this machine's changes to ${name} aside`
            : `Could not publish to ${name}`,
      direction: "up",
      failed: (r) => r.status === "failed",
    },
    async () => {
      try {
        if (repo.fresh) {
          try {
            push();
            return { status: "pushed" };
          } catch {
            // Someone published between this write's fetch and its push, or the network went: from here as any write.
            repo.fresh = false;
          }
        }
        git(root, ["fetch", "-q", "origin"], NON_INTERACTIVE);
        if (gitQuiet(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]) !== undefined) {
          const r = await underLock(repo, () => rebaseOntoRemote(root, branch));
          repo.changed();
          if (r.status === "conflict") return r;
        }
        push();
        return { status: "pushed" };
      } catch (e) {
        return { status: "failed", reason: firstLine(e) };
      }
    },
  );
}

/** A fetch before a write is not worth a minute of waiting: offline, the write goes on from what the machine has. */
const FRESHEN_TIMEOUT_MS = 10_000;

/**
 * Before a write in a shared brain, bring in what others published, so that the page a verb reads and
 * rewrites is the team's latest and not this machine's last sync. Best effort: no remote, no network or a tree with
 * changes nobody committed leave the brain as it is. The fetch runs outside the brain's lock and the look at the tree
 * and the rebase under it, so a write putting its files in place is never stashed under itself. Returns the conflict
 * when unpublished commits of this machine had to be set aside to do it. When it leaves HEAD on top of what the
 * remote holds, by finding nothing behind or by rebasing, the repo is marked `fresh`, and the push that ends the
 * write needs no fetch of its own.
 */
export async function freshen(target: string | BrainRepo): Promise<Conflict | undefined> {
  const repo = repoOf(target);
  const root = repo.root;
  if (repo.remote() === undefined) return undefined;
  const branch = repo.branch();
  const name = repo.label();
  const fetched = currentSteps().run(
    {
      doing: `Bringing in what others published to ${name}`,
      done: (ok: boolean) =>
        ok
          ? `Brought in what others published to ${name}`
          : `Could not reach ${name}'s remote; writing on what this machine has`,
      direction: "down",
      failed: (ok) => !ok,
    },
    () => {
      try {
        git(root, ["fetch", "-q", "origin"], { ...NON_INTERACTIVE, timeoutMs: FRESHEN_TIMEOUT_MS });
        return true;
      } catch {
        return false;
      }
    },
  );
  if (!fetched) return undefined;
  try {
    const remote = `origin/${branch}`;
    return await underLock(repo, () => {
      // The count fails when the remote has no such branch yet, or HEAD is unborn: nothing to be behind, nothing to sit on.
      const behind = gitQuiet(root, ["rev-list", "--count", `HEAD..${remote}`]);
      if (behind === undefined) return undefined;
      if (behind === "0") {
        repo.fresh = true;
        return undefined;
      }
      if (git(root, ["status", "--porcelain"]) !== "") return undefined;
      const r = rebaseOntoRemote(root, branch);
      repo.changed();
      if (r.status === "ok") repo.fresh = true;
      return r.status === "conflict" ? r.conflict : undefined;
    });
  } catch {
    return undefined;
  }
}
