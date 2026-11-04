import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneMissing, type SyncOutcome, type SyncStatus } from "./brains/clone.ts";
import { resolveChain, type ChainLink, type LinkTier } from "./config/chain.ts";
import { readMachineConfig, updateMachineConfig } from "./config/machine.ts";
import { repoKey } from "./config/brain-ref.ts";
import { firstLine, KiokuError } from "./errors.ts";
import { writeAtomic } from "./fs/atomic.ts";
import { acquireLock } from "./fs/lock.ts";
import { git, gitQuiet } from "./git.ts";
import { openIndex } from "./index/db.ts";
import { purgeReads, readReads } from "./reads.ts";
import { lintBrain, recordLint } from "./lint.ts";
import { updateIndex, type IndexReport } from "./index/indexer.ts";
import type { SemanticDeps } from "./semantic/meaning.ts";
import { refreshSemantic, type SemanticOutcome } from "./semantic/refresh.ts";
import { syncLeftPath, syncLockPath, syncStatePath } from "./state.ts";
import { clearPending, readPending, recordPending } from "./write/pending.ts";
import { NON_INTERACTIVE, rebaseOntoRemote, repoOf, underLock } from "./write/publish.ts";
import { currentSteps } from "./steps.ts";
import { readJson } from "./util.ts";

/**
 * `sync` (§4.2): for every brain of the chain, clone it when it is missing, pull with rebase, push what is
 * waiting — the commits a write could not publish — then reindex what changed. The
 * `SessionStart` hook starts it in the background; it also runs by hand. It never prompts and never loses a commit:
 * a rebase that cannot complete is undone and the brain is reported as failed.
 */

export type { SyncOutcome, SyncStatus };

export interface SyncResult {
  /** Another sync held the machine's lock, so this one did nothing. */
  busy: boolean;
  outcomes: SyncOutcome[];
  /** What reindexing did, or why it failed. */
  index?: IndexReport | { failed: string };
  /** What the meaning half of search did: fetched, embedded, or why search stays on full text. */
  semantic?: SemanticOutcome;
}

export interface SyncOptions {
  home: string;
  cwd: string;
  now: Date;
  /** Fetch and run the embedding model; without it, `sync` leaves meaning alone. */
  semantic?: SemanticDeps;
  /** Started by the session hook: a recent failed fetch is not retried yet. */
  background?: boolean;
}

/**
 * Pull one brain with rebase and push what it has ahead. The rebase runs under the brain's writer lock, so no `save`
 * lands in the middle of it; the fetch and the push wait on the network outside it, so a `save` meanwhile is not
 * refused. Never throws.
 */
async function pullAndPush(link: ChainLink, home: string, now: Date): Promise<SyncOutcome> {
  const base = { key: link.key, tier: link.tier, path: link.path };
  const root = link.path;
  if (gitQuiet(root, ["remote", "get-url", "origin"]) === undefined) return { ...base, status: "no-remote" };
  try {
    const branch = gitQuiet(root, ["branch", "--show-current"]) ?? "main";
    const before = gitQuiet(root, ["rev-parse", "HEAD"]);
    let conflicted: string | undefined;
    const name = repoOf(root).label();
    const steps = currentSteps();
    steps.run({ doing: `Fetching ${name}`, done: `Fetched ${name}`, direction: "down" }, () =>
      git(root, ["fetch", "-q", "origin"], NON_INTERACTIVE),
    );
    const remote = `origin/${branch}`;
    const remoteExists = gitQuiet(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}`]) !== undefined;
    const ahead = await underLock(root, () => {
      if (remoteExists) {
        // Commits that overlap with what others published are kept on a branch and the brain keeps receiving.
        const r = rebaseOntoRemote(root, branch);
        if (r.status === "conflict") {
          const c = r.conflict;
          conflicted = `your changes to ${c.pages.join(", ")} could not sit on top of what others published; they are kept on the branch ${c.branch} and the pages now say what the others wrote`;
        }
      }
      return remoteExists ? Number(gitQuiet(root, ["rev-list", "--count", `${remote}..HEAD`]) ?? "0") : 1;
    });
    if (ahead > 0) {
      try {
        steps.run({ doing: `Pushing ${name}`, done: `Pushed ${name}`, direction: "up" }, () =>
          git(root, ["push", "-q", "-u", "origin", `HEAD:${branch}`], NON_INTERACTIVE),
        );
      } catch (e) {
        await recordPending(home, link.key, root, firstLine(e), now);
        throw e;
      }
      await clearPending(home, link.key);
      return {
        ...base,
        ...(conflicted !== undefined
          ? { status: "conflict" as const, message: conflicted }
          : { status: "pushed" as const }),
      };
    }
    await clearPending(home, link.key);
    if (conflicted !== undefined) return { ...base, status: "conflict", message: conflicted };
    return { ...base, status: gitQuiet(root, ["rev-parse", "HEAD"]) === before ? "up-to-date" : "pulled" };
  } catch (e) {
    return { ...base, status: "failed", message: firstLine(e) };
  }
}

/** Reindexing the pages, as a step (§6.1). */
function indexStep(work: () => IndexReport): IndexReport {
  return currentSteps().run({ doing: "Indexing the pages", done: "Indexed the pages", direction: "down" }, work);
}

/** Merge these outcomes into the state file; brains this run did not touch keep their last outcome. */
function recordState(home: string, outcomes: SyncOutcome[], now: Date): void {
  let state: { brains: Record<string, { at: string; status: SyncStatus; message?: string }> } = { brains: {} };
  const raw = readJson<typeof state | null>(syncStatePath(home));
  if (raw && typeof raw.brains === "object" && raw.brains !== null) state = raw;
  for (const o of outcomes)
    state.brains[o.key] = {
      at: now.toISOString(),
      status: o.status,
      ...(o.message !== undefined && { message: o.message }),
    };
  writeAtomic(syncStatePath(home), `${JSON.stringify(state, null, 2)}\n`);
}

/** A brain known only by its key and folder, as `pullAndPush` takes it. */
export const linkOf = (tier: LinkTier, key: string, path: string): ChainLink => ({
  tier,
  key,
  path,
  cloned: true,
  ref: { host: "", owner: "", repo: key },
});

/** What `kioku brain sync` did: each brain's pull and push, and the full-text index of those brains. */
export interface BrainsSyncResult {
  busy: boolean;
  outcomes: SyncOutcome[];
  index?: IndexReport | { failed: string };
}

/**
 * `kioku brain sync <brain> | --all` (§4.2, §6.1): the brains named, wherever the person is, not the chain of a
 * folder: each clone pulled and pushed once, under the sync lock, then their pages indexed for full text; meaning
 * catches up at the next `kioku sync`. Another sync running is said, not waited for.
 */
export async function syncBrains(home: string, links: ChainLink[], now: Date): Promise<BrainsSyncResult> {
  mkdirSync(join(home, ".kioku"), { recursive: true });
  let lock;
  try {
    lock = await acquireLock(syncLockPath(home), { timeoutMs: 0 });
  } catch (e) {
    if (e instanceof KiokuError) return { busy: true, outcomes: [] };
    throw e;
  }
  try {
    const outcomes: SyncOutcome[] = [];
    const roots = new Set<string>();
    for (const link of links) {
      const top = gitQuiet(link.path, ["rev-parse", "--show-toplevel"]) ?? link.path;
      if (roots.has(top)) continue;
      roots.add(top);
      outcomes.push(await pullAndPush(link, home, now));
    }
    recordState(home, outcomes, now);
    let index: BrainsSyncResult["index"];
    try {
      const db = await openIndex(home);
      try {
        const brains = links.map((l) => ({ key: l.key, name: repoOf(l.path).label(), root: l.path }));
        index = indexStep(() => updateIndex(db, brains));
      } finally {
        db.close();
      }
    } catch (e) {
      index = { failed: (e as Error).message };
    }
    return { busy: false, outcomes, index };
  } finally {
    lock.release();
  }
}

/** The folders left for the running sync, emptied as they are taken. */
function takeLeft(home: string): string[] {
  try {
    const left = readJson(syncLeftPath(home));
    if (left === undefined) return [];
    rmSync(syncLeftPath(home), { force: true });
    return Array.isArray(left) ? left.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** Leave a folder for the sync that is running, which syncs its chain before it ends (§4.2). */
function leaveFor(home: string, cwd: string): void {
  const left = takeLeft(home);
  writeAtomic(syncLeftPath(home), `${JSON.stringify([...new Set([...left, cwd])])}\n`);
}

/** `kioku sync` (§4.2): this folder's chain, then each folder a busy sync left for it, under one lock. */
export async function syncChain(opts: SyncOptions): Promise<SyncResult> {
  const { home, cwd } = opts;
  mkdirSync(join(home, ".kioku"), { recursive: true });
  let lock;
  try {
    lock = await acquireLock(syncLockPath(home), { timeoutMs: 0 });
  } catch (e) {
    if (e instanceof KiokuError) {
      leaveFor(home, cwd);
      return { busy: true, outcomes: [] };
    }
    throw e;
  }
  try {
    const result = await syncOnce(opts);
    for (let left = takeLeft(home); left.length > 0; left = takeLeft(home)) {
      for (const folder of left) {
        const again = await syncOnce({ ...opts, cwd: folder });
        result.outcomes.push(...again.outcomes);
      }
    }
    return result;
  } finally {
    lock.release();
  }
}

/** One chain's sync, under the lock the caller holds. */
async function syncOnce(opts: SyncOptions): Promise<SyncResult> {
  const { home, cwd, now } = opts;
  const outcomes: SyncOutcome[] = [];

  outcomes.push(...(await cloneMissing(cwd, home)));

  // Every brain the chain uses is known to this machine (§2.5), however it arrived.
  const chain = resolveChain(cwd, readMachineConfig(home), home);
  const unknown = chain.links.filter(
    (l) => l.cloned && readMachineConfig(home)?.repositories[repoKey(l.ref)] === undefined,
  );
  if (unknown.length > 0 && readMachineConfig(home) !== undefined) {
    await updateMachineConfig((c) => {
      for (const l of unknown) c.repositories[repoKey(l.ref)] ??= {};
    }, home);
  }

  // Pull and push each brain of the chain once: each is a clone of its own.
  const done = new Set(outcomes.map((o) => o.key));
  for (const link of chain.links.filter((l) => l.cloned && !done.has(l.key)))
    outcomes.push(await pullAndPush(link, home, now));
  // A pending publication of a brain outside this chain is still retried.
  for (const [key, p] of Object.entries(readPending(home))) {
    if (chain.links.some((l) => l.key === key) || !existsSync(p.path)) continue;
    outcomes.push(await pullAndPush(linkOf("project", key, p.path), home, now));
  }
  recordState(home, outcomes, now);

  let index: SyncResult["index"];
  let semantic: SyncResult["semantic"];
  try {
    const db = await openIndex(home);
    try {
      const brains = resolveChain(cwd, readMachineConfig(home), home)
        .links.filter((l) => l.cloned)
        .map((l) => ({ key: l.key, name: repoOf(l.path).label(), root: l.path }));
      index = indexStep(() => updateIndex(db, brains));
      // What this machine counts of the pages it opens (§4.5): pages gone are dropped, and the rest is what lint reads.
      const ids = Object.fromEntries(
        brains.map((b) => [
          b.key,
          new Set(
            (
              db.db.prepare("SELECT id FROM pages WHERE brain = ? AND id IS NOT NULL").all(b.key) as { id: string }[]
            ).map((r) => r.id),
          ),
        ]),
      );
      purgeReads(home, ids);
      const reads = readReads(home);
      await recordLint(
        home,
        brains.map((b) => ({
          key: b.key,
          report: lintBrain(b, db, now, reads),
        })),
        now,
      );
      if (opts.semantic !== undefined) {
        try {
          semantic = await refreshSemantic(
            home,
            db,
            brains.map((b) => b.key),
            opts.semantic,
            now,
            opts.background ?? false,
          );
        } catch (e) {
          semantic = { mode: "full-text", reason: firstLine(e) };
        }
      }
    } finally {
      db.close();
    }
  } catch (e) {
    index = { failed: (e as Error).message };
  }
  return { busy: false, outcomes, index, ...(semantic !== undefined && { semantic }) };
}
