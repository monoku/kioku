import { brainRepoOfKey } from "../config/brain-ref.ts";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertWritableFormat, brainRel, isFrontPageAt } from "../brain/brain.ts";
import { parseFolderConfig, type BrainConfig, type Tier } from "../config/folder-config.ts";
import { KiokuError, type Naming, PLAIN, userError } from "../errors.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { commitOrRestore, gitQuiet, type Change } from "../git.ts";
import { validatePages, type Finding } from "../validate/validate.ts";
import { clearPending, recordPending } from "./pending.ts";
import { type BrainRepo, freshen, lockBrain, pushBrain, repoOf, type Conflict } from "./publish.ts";

/** The brain a verb writes to, resolved from the chain. */
export interface TargetBrain {
  key: string;
  tier: Tier;
  root: string;
  /** Its `kioku.yaml` as the chain read it, so that the write does not read it again. */
  config?: BrainConfig;
}

/** Whether the commit left the machine (§1.6): pushed, pending a retry by `sync`, or local (a brain with no remote). */
export type Publication = "pushed" | "pending" | "local";

/** A write the validator refused: its findings come back with it (§5.1). */
export class ValidationRefused extends KiokuError {
  readonly findings: Finding[];
  constructor(findings: Finding[]) {
    const errors = findings.filter((f) => f.severity === "error");
    super(
      1,
      "invalid_page",
      `the page breaks ${errors.length === 1 ? "a rule" : `${errors.length} rules`} of the validator: ${errors.map((f) => `rule ${f.rule}: ${f.message}`).join("; ")}`,
    );
    this.findings = findings;
  }
}

/**
 * The commits of this machine could not sit on top of what others published. Nothing of the change is on the
 * brain's branch: it is kept on another, and the pages say what the others wrote. Found before a write's commit, the
 * write made nothing; found when publishing it, the commit exists on that branch and the error carries it (§1.6).
 */
export class PublishConflict extends KiokuError {
  readonly conflict: Conflict;
  constructor(brain: { key: string; root: string }, conflict: Conflict, commit?: string) {
    const pages = conflict.pages.join(", ");
    const what =
      commit === undefined
        ? `nothing was written: your changes to ${pages}`
        : `your change was committed (${commit}), but it and your changes to ${pages}`;
    const said = (n: Naming) =>
      `${what} could not sit on top of what others published first. They are kept on the branch ${conflict.branch} of ${brainRepoOfKey(brain.key)}, and the pages now say what the others wrote. Read both with kioku brain conflicts ${brainRepoOfKey(brain.key)}${n.cli(` --branch ${conflict.branch}`)}, decide with the person what should stand, write it with kioku page update, then run kioku brain conflicts ${brainRepoOfKey(brain.key)}${n.cli(` --resolve ${conflict.branch}`)}`;
    super(
      1,
      "conflict",
      said(PLAIN),
      commit === undefined ? undefined : { brain: brain.key, commit, publication: null },
    );
    this.conflict = conflict;
    this.said = said;
  }
}

/**
 * Another write on this machine, or a `sync`, changed a page this write is about to write after the verb read it
 * (§1.6). Nothing is written: run again, the verb reads the version there now.
 */
export class ChangedMeanwhile extends KiokuError {
  readonly pages: string[];
  constructor(brain: { key: string }, pages: string[]) {
    super(
      2,
      "changed",
      `nothing was written: ${pages.join(", ")} changed in ${brainRepoOfKey(brain.key)} while this write was being prepared, by another write on this machine or what sync brought in. Run it again: it starts from the version there now`,
    );
    this.pages = pages;
  }
}

/** What a verb read before it wrote: the commit its pages were at, which `applyChanges` compares with under the lock, and the repository as this write sees it. */
export interface Seen {
  head: string | undefined;
  repo: BrainRepo;
}

/**
 * Bring in what was published before a verb reads a page of a brain with a remote; with none, `freshen` leaves it
 * alone. Returns the commit the verb then reads at, for `applyChanges`, and the write's view of the repository,
 * which the verb reads the brain's configuration through.
 */
export async function bringIn(brain: TargetBrain): Promise<Seen> {
  const repo = repoOf(brain);
  const conflict = await freshen(repo);
  if (conflict !== undefined) throw new PublishConflict(brain, conflict);
  return { head: gitQuiet(brain.root, ["rev-parse", "HEAD"]), repo };
}

/**
 * The configuration the pages of a change are validated against (§5.1): the `kioku.yaml` the change itself writes, a
 * namespace added or renamed in the same commit as its pages, else the one the write read. Undefined when the change
 * writes one the validator cannot use, which it then reports from the disk.
 */
function configFor(changes: FileChange[], repo: BrainRepo): BrainConfig | undefined {
  const yaml = changes.find((c) => c.rel === "kioku.yaml");
  if (yaml === undefined) return repo.config();
  if (yaml.text === null) return undefined;
  const parsed = parseFolderConfig(yaml.text);
  return parsed.ok && parsed.value.form === "brain" ? parsed.value : undefined;
}

/** The files of `changes` that a commit since `seen` changed: what the verb read is no longer what is there. */
function changedSince(root: string, seen: Seen, changes: FileChange[]): string[] {
  const head = gitQuiet(root, ["rev-parse", "HEAD"]);
  if (seen.head === undefined || head === seen.head) return [];
  const changed = gitQuiet(root, [
    "diff",
    "--name-only",
    "--no-renames",
    seen.head,
    head ?? "HEAD",
    "--",
    ...changes.map((c) => c.rel),
  ]);
  return changed === undefined ? [] : changed.split("\n").filter((f) => f !== "");
}

/** A file the write puts in place, or removes (`text: null`). */
export interface FileChange {
  rel: string;
  text: string | null;
}

export interface Applied {
  commit: string;
  publication: Publication;
  /** The validator's warnings on the pages written; they do not block. */
  warnings: Finding[];
}

/** What a write needs of its surroundings: where the machine keeps its state, the time, how it arrived and who the person is. */
export interface WriteContext {
  home: string;
  now: Date;
  /** How the write arrived, for the `Kioku-Via` trailer of its commit (§1.6); no trailer when absent. */
  via?: string;
  /**
   * The name the person goes by (§2.3), worked out only when a write needs it: who a confirmation is by (§3.3), and the
   * commit's author where git knows no one (§6.3).
   */
  user?: () => string | undefined;
}

/**
 * The one writing path (§1.6, §3.5, §5.1): under the brain's lock, check that no page it writes changed since the
 * verb read it at `seen`, validate every page it is about to write in its brain, reading the brain once for all of
 * them and before any file is touched, so that a refusal leaves the tree as it was; then put the files in place and
 * commit exactly those paths, or put everything back. Then, in a brain with a remote, publish, with the lock
 * released: a push waits on the network, and another write must not wait on it. A failed push leaves the commit and
 * records the brain as pending. Commits carry git's own identity, else the name the person goes by.
 */
export async function applyChanges(
  brain: TargetBrain,
  changes: FileChange[],
  message: string,
  w: WriteContext,
  seen: Seen,
): Promise<Applied> {
  const repo = seen.repo;
  assertWritableFormat(brain.root, repo.config());
  // Every path a verb writes stays inside the brain, whatever reached the verb (§1.6).
  const outside = changes.find((c) => brainRel(c.rel) !== c.rel);
  if (outside !== undefined)
    throw userError(`${outside.rel} is not a path inside the brain ${brainRepoOfKey(brain.key)}`, "usage");
  const lock = await lockBrain(repo);
  let commit: string;
  let findings: Finding[];
  try {
    const changed = changedSince(brain.root, seen, changes);
    if (changed.length > 0) throw new ChangedMeanwhile(brain, changed);
    // Only pages are validated as pages: a namespace's `INDEX.md`, `kioku.yaml` and the like are not (§3.1). The
    // validator sees the change as it will be: the pages it writes, and the files it removes gone.
    const isPage = (rel: string) => rel.endsWith(".md") && !isFrontPageAt(rel);
    const pages = changes.flatMap((c) => (c.text === null || !isPage(c.rel) ? [] : [{ rel: c.rel, text: c.text }]));
    findings = validatePages(brain.root, pages, {
      config: configFor(changes, repo),
      removed: changes.flatMap((c) => (c.text === null ? [c.rel] : [])),
      added: changes.flatMap((c) => (c.text === null ? [] : [c.rel])),
    }).findings;
    if (findings.some((f) => f.severity === "error")) throw new ValidationRefused(findings);
    const before: Change[] = changes.map((c) => {
      const path = join(brain.root, c.rel);
      return { rel: c.rel, before: existsSync(path) ? readFileSync(path, "utf8") : undefined };
    });
    const restore = () => {
      for (const b of before) {
        const path = join(brain.root, b.rel);
        if (b.before === undefined) rmSync(path, { force: true });
        else writeAtomic(path, b.before);
      }
    };
    try {
      for (const c of changes) {
        const path = join(brain.root, c.rel);
        if (c.text === null) rmSync(path, { force: true });
        else {
          mkdirSync(dirname(path), { recursive: true });
          writeAtomic(path, c.text);
        }
      }
      commit = commitOrRestore(brain.root, message, before, { via: w.via, author: w.user });
    } catch (e) {
      restore();
      throw e;
    }
  } finally {
    lock.release();
  }
  return { commit, publication: await publish(brain, w.home, w.now, repo, commit), warnings: findings };
}

/**
 * Publish a commit (§1.6): pushed, or pending with the brain recorded for `sync` to retry; local when the brain has
 * no remote. The caller does not hold the brain's lock: the push takes it for its rebase alone. Given the write's
 * `repo`, a push after a bring-in that found nothing behind goes without a fetch and a rebase of its own. A conflict
 * found here comes after the commit, which the error then carries, since it exists on the conflict's branch.
 */
export async function publish(
  brain: TargetBrain,
  home: string,
  now: Date,
  repo?: BrainRepo,
  commit?: string,
): Promise<Publication> {
  const pushed = await pushBrain(repo ?? brain.root);
  if (pushed.status === "pushed") {
    await clearPending(home, brain.key);
    return "pushed";
  }
  if (pushed.status === "no-remote") return "local";
  if (pushed.status === "conflict") throw new PublishConflict(brain, pushed.conflict, commit);
  await recordPending(home, brain.key, brain.root, pushed.reason, now);
  return "pending";
}
