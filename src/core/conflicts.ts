import { mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { userError } from "./errors.ts";
import { git, gitQuiet } from "./git.ts";
import { conflictsPath } from "./state.ts";
import { parseName } from "./config/brain-ref.ts";

/**
 * The changes of this machine that could not sit on top of what others published. Each is a branch
 * `kioku/conflict-<commit>` of the brain's repository holding the commits as they were; the branch is the record,
 * there is no other state. Never pushed: only the current branch is.
 */
export const CONFLICT_PREFIX = "kioku/conflict-";

export interface BrainConflict {
  branch: string;
  /** The day of the branch's latest commit. */
  date: string | null;
  /** The commits that are not in the brain now, oldest first. */
  commits: { sha: string; message: string }[];
  /** The pages of this brain they changed that still differ from what the brain says now, brain-relative. */
  pages: string[];
  /** The folder the branch is opened in, when it is. */
  worktree?: string;
}

export interface ConflictView {
  page: string;
  /** What the page said where both sides started; null when it did not exist. */
  base: string | null;
  /** What this machine wrote; null when it deleted the page. */
  mine: string | null;
  /** What the brain says now, the team's; null when it is gone. */
  theirs: string | null;
}

/** Whether the brain's folder is a repository: a brain is a whole one (§2.2). */
const isRepository = (root: string): boolean => gitQuiet(root, ["rev-parse", "--show-toplevel"]) !== undefined;

const lines = (out: string | undefined): string[] => (out ?? "").split("\n").filter((l) => l !== "");

function worktreeOf(root: string, branch: string): string | undefined {
  const out = gitQuiet(root, ["worktree", "list", "--porcelain"]) ?? "";
  let path: string | undefined;
  for (const l of out.split("\n")) {
    if (l.startsWith("worktree ")) path = l.slice(9);
    if (l === `branch refs/heads/${branch}`) return path;
  }
  return undefined;
}

/** The conflicts a brain holds, oldest first. Empty when the folder is not a repository. */
export function conflictsOf(root: string): BrainConflict[] {
  if (!isRepository(root)) return [];
  const branches = lines(gitQuiet(root, ["branch", "--list", `${CONFLICT_PREFIX}*`, "--format=%(refname:short)"]));
  const out: BrainConflict[] = [];
  for (const branch of branches) {
    const base = gitQuiet(root, ["merge-base", "HEAD", branch]);
    const touched = new Set(lines(gitQuiet(root, ["diff", "--name-only", base ?? "HEAD", branch])));
    const differ = new Set(lines(gitQuiet(root, ["diff", "--name-only", "HEAD", branch])));
    const pages = [...touched].filter((f) => differ.has(f)).sort();
    const commits = lines(gitQuiet(root, ["cherry", "HEAD", branch]))
      .filter((l) => l.startsWith("+ "))
      .map((l) => {
        const sha = l.slice(2);
        return { sha: sha.slice(0, 7), message: gitQuiet(root, ["log", "-1", "--format=%s", sha]) ?? "" };
      });
    const date = gitQuiet(root, ["log", "-1", "--format=%as", branch]) ?? null;
    const worktree = worktreeOf(root, branch);
    out.push({ branch, date, commits, pages, ...(worktree !== undefined && { worktree }) });
  }
  return out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.branch.localeCompare(b.branch));
}

function must(root: string, branch: string): void {
  if (
    !isRepository(root) ||
    !branch.startsWith(CONFLICT_PREFIX) ||
    gitQuiet(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) === undefined
  ) {
    throw userError(
      `${root} has no conflict branch called ${branch}; kioku brain conflicts lists them`,
      "conflict_unknown",
    );
  }
}

/** Both versions of what a conflict changed: where they started, this machine's and the team's. */
export function showConflict(root: string, branch: string, page?: string): ConflictView[] {
  must(root, branch);
  const wanted = page !== undefined ? [page] : (conflictsOf(root).find((c) => c.branch === branch)?.pages ?? []);
  const base = gitQuiet(root, ["merge-base", "HEAD", branch]);
  const at = (rev: string | undefined, rel: string): string | null => {
    if (rev === undefined) return null;
    try {
      return git(root, ["show", `${rev}:${rel}`]) + "\n";
    } catch {
      return null;
    }
  };
  return wanted.map((rel) => ({ page: rel, base: at(base, rel), mine: at(branch, rel), theirs: at("HEAD", rel) }));
}

/** Open a conflict's branch as a folder under the machine's state, for a person or a program that wants the other version as a brain. */
export function openConflict(
  home: string,
  repo: { owner: string; repo: string },
  root: string,
  branch: string,
): { worktree: string; brainFolder: string } {
  must(root, branch);
  const existing = worktreeOf(root, branch);
  const worktree = existing ?? join(conflictsPath(home), repo.owner, repo.repo, branch.slice("kioku/".length));
  if (existing === undefined) {
    mkdirSync(dirname(worktree), { recursive: true });
    git(root, ["worktree", "add", "-q", worktree, branch]);
  }
  return { worktree, brainFolder: worktree };
}

/** The conflict is dealt with: its folder, if opened, and its branch go. What should stand was written with `update`. */
export function resolveConflict(root: string, branch: string): { branch: string; removedWorktree: boolean } {
  must(root, branch);
  const worktree = worktreeOf(root, branch);
  if (worktree !== undefined) git(root, ["worktree", "remove", "--force", worktree]);
  git(root, ["branch", "-D", branch]);
  return { branch, removedWorktree: worktree !== undefined };
}

/** The brain a key names, for the folder a conflict is opened in: its name (§2.2); a folder given by path has only its name. */
export function repoOfKey(key: string): { owner: string; repo: string } {
  const named = key.startsWith("folder:") ? undefined : parseName(key);
  return named ?? { owner: "local", repo: basename(key.replace(/^folder:/, "")) };
}
