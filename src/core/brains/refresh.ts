import { brainRepoOfKey } from "../config/brain-ref.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertWritableFormat, readBrainConfig } from "../brain/brain.ts";
import { userError } from "../errors.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { commitOrRestore, gitQuiet, type Change } from "../git.ts";
import { knownUser } from "../setup/personal.ts";
import { publish, type Publication, type TargetBrain } from "../write/apply.ts";
import { lockBrain, pushBrain } from "../write/publish.ts";
import { newerThan, versionParts } from "../setup/install.ts";
import { AGENTS_MD, writtenBy } from "./agents-md.ts";
import { folderFiles } from "./owned.ts";

export interface RefreshResult {
  brain: string;
  path: string;
  /** The files written, relative to the brain's repository; none when everything was already current. */
  written: string[];
  commit: string | null;
  publication: Publication | null;
  /**
   * Why a shared brain's files were left as they are (§2.7): `newer`, a newer version wrote them, `held` names it;
   * `build`, this version is a build that is not a release (its version has a pre-release part, as one run from a
   * checkout does) and the brain was not named.
   */
  left?: "newer" | "build";
  held?: string;
}

/** Whether a version is a build that is not a release: one with a pre-release part, as a checkout's `0.0.0-dev` (§6.4). */
const isBuild = (version: string): boolean => versionParts(version).pre.length > 0;

/**
 * `kioku brain refresh` (§2.7, §6.1): bring the files the tool owns in a brain to the text of this version.
 * Writes only what differs, in one commit, published like any write in a shared brain; nothing when everything is
 * current. Pages are never touched. A brain this machine does not know
 * (`known: false`, given as a folder) is pushed but never recorded for `sync`, which could not find it.
 * In a shared brain the files only move forward: a version older than the one `AGENTS.md` names leaves them, and so
 * does a build that is not a release unless the person `named` the brain.
 */
export async function refreshBrain(
  brain: TargetBrain & { known: boolean },
  version: string,
  home: string,
  now: Date,
  named = true,
): Promise<RefreshResult> {
  assertWritableFormat(brain.root);
  const config = readBrainConfig(brain.root);
  const top = brain.root;
  if (gitQuiet(top, ["rev-parse", "--show-toplevel"]) === undefined)
    throw userError(`${top} is not inside a git repository`, "not_a_git_repository");
  if (config.tier !== "personal") {
    // The version that wrote them: the one `AGENTS.md` names (§2.7).
    const agents = join(brain.root, AGENTS_MD);
    const held = existsSync(agents) ? writtenBy(readFileSync(agents, "utf8")) : undefined;
    const leave = (left: "newer" | "build"): RefreshResult => ({
      brain: brain.key,
      path: brain.root,
      written: [],
      commit: null,
      publication: null,
      left,
      ...(held !== undefined && { held }),
    });
    if (held !== undefined && newerThan(held, version)) return leave("newer");
    if (isBuild(version) && !named) return leave("build");
  }
  const files = folderFiles(brainRepoOfKey(brain.key), config.tier, version);
  const changed = files.filter(
    (f) => !existsSync(join(top, f.rel)) || readFileSync(join(top, f.rel), "utf8") !== f.text,
  );
  if (changed.length === 0) return { brain: brain.key, path: brain.root, written: [], commit: null, publication: null };

  const lock = await lockBrain(brain.root);
  let commit: string;
  try {
    const before: Change[] = changed.map((f) => ({
      rel: f.rel,
      before: existsSync(join(top, f.rel)) ? readFileSync(join(top, f.rel), "utf8") : undefined,
    }));
    for (const f of changed) {
      mkdirSync(dirname(join(top, f.rel)), { recursive: true });
      writeAtomic(join(top, f.rel), f.text);
    }
    commit = commitOrRestore(top, `Refresh the files kioku ${version} owns in ${brainRepoOfKey(brain.key)}`, before, {
      via: "kioku",
      author: knownUser(),
    });
  } finally {
    lock.release();
  }
  // Published with the lock released, as every write is (§1.6).
  const publication = brain.known ? await publish(brain, home, now) : await unrecordedPush(brain);
  return { brain: brain.key, path: brain.root, written: changed.map((f) => f.rel), commit, publication };
}

/** Publish without touching `pending.json`: the brain is not in the machine's configuration, so `sync` would never retry it. */
async function unrecordedPush(brain: TargetBrain): Promise<Publication> {
  if (brain.tier === "personal") return "local";
  const pushed = await pushBrain(brain.root);
  return pushed.status === "pushed" ? "pushed" : pushed.status === "no-remote" ? "local" : "pending";
}
