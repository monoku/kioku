import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { isFrontPageAt, NEWEST_FORMAT } from "../brain/brain.ts";
import { resolveChain, trustCommand, trustOwnerCommand } from "../config/chain.ts";
import { mutes, remindsUnpublished, type MachineConfig } from "../config/machine.ts";
import { writeAtomic } from "../fs/atomic.ts";
import { gitQuiet } from "../git.ts";
import { backupStatePath, indexPath, lintReportPath, syncStatePath } from "../state.ts";
import { readSemanticState, semanticStatus, writeSemanticState } from "../semantic/status.ts";
import { currentPlatform, PINS } from "../semantic/pins.ts";
import { readPending } from "../write/pending.ts";
import { anyHandoff, handoffsElsewhere, placeOf, pruneHandoffs, readHandoff } from "../handoff.ts";
import { recordSurfaced } from "../reads.ts";
import { brainsOfLinks } from "./labels.ts";
import { cmd, dim, historyRow, type Message } from "./message.ts";
import { sessionReads, type SessionReads } from "./session-reads.ts";
import { composeForSubagent, composeHandoff, composeHolds, composeUsage, type SummaryBrainSource } from "./summary.ts";
import { loadSummaryBrains } from "./summary-load.ts";
import { type RuleChange, takeRuleNews } from "./rule-news.ts";
import { holdViews, newSince, readViews, recordViews } from "./views.ts";
import { listWords, plural, readJson } from "../util.ts";

export interface StartInput {
  cwd: string;
  /** How the host started the session: `startup`, `resume`, `clear` or `compact`. */
  source?: string;
}

export interface StartResult {
  /** The summary's first part, how to use the memory (§4.1), as the hook's additional context; absent when no brain is on disk. */
  summary?: string;
  /** What the person must see regardless of the agent (§1.6), one notice each (§1.2). */
  messages: Message[];
  /** The brains the summary loaded and how many pages they hold, for the line of §1.2; absent with the summary. */
  loaded?: { brains: string[]; pages: number; counts: number[] };
  /** The session's brains by key, with their tiers: what the labels would resolve the chain again to learn. */
  brains: Map<string, string>;
}

/** The chain of a session's folder, read once for whichever part of the opening asks. */
function openChain(home: string, config: MachineConfig, cwd: string) {
  const reads = sessionReads();
  const chain = resolveChain(cwd, config, home, reads.folderConfig);
  const cloned = chain.links.filter((l) => l.cloned);
  const shared = cloned.filter((l) => l.tier !== "personal");
  return { reads, chain, cloned, shared };
}

/** Words that say what the session is about: the repository's folder and the project brain's repository (§4.1). */
const hintsOf = (chain: ReturnType<typeof resolveChain>, cwd: string, brains: SummaryBrainSource[]): string[] => [
  basename(chain.root ?? cwd),
  ...(chain.project !== undefined ? [brains.find((b) => b.isProject)?.link.ref.repo ?? ""] : []),
];

/**
 * What a subagent of a session in `cwd` is given at its start (§4.1): the Rules of the session's brains, inside a
 * brain that brain's alone, or nothing when they hold none. Reads files only; starts nothing and records nothing.
 */
export function startSubagent(home: string, config: MachineConfig, cwd: string): string | undefined {
  const { reads, chain, cloned } = openChain(home, config, cwd);
  if (cloned.length === 0) return undefined;
  return composeForSubagent(
    loadSummaryBrains(
      cloned.map((link) => ({ link, isProject: link.key === chain.project })),
      reads,
    ),
  );
}

/**
 * What a session that starts anew in `cwd` is given of the handoffs of its place (§4.8), by a hook of its own: the one
 * left for this folder and branch, whole, or that another branch of the folder has one; nothing for a session that
 * goes on, which has its conversation, or where there is none. Git is asked for the place only where the machine
 * holds a handoff at all.
 */
export function startHandoff(home: string, config: MachineConfig, input: StartInput, now: Date): string | undefined {
  if (input.source === "resume" || input.source === "compact" || !anyHandoff(home)) return undefined;
  pruneHandoffs(home, now);
  const place = placeOf(input.cwd, resolveChain(input.cwd, config, home).root);
  const left = readHandoff(home, place, now);
  const elsewhere = handoffsElsewhere(home, place, now);
  if (left === undefined && elsewhere.length === 0) return undefined;
  return composeHandoff({
    ...(place.branch !== undefined && { branch: place.branch }),
    ...(left !== undefined && { at: left.at, text: left.text, ...(left.pages && { pages: left.pages }) }),
    elsewhere,
  });
}

/**
 * Opening a session (§4.1, §4.2), its first hook: resolve the chain, start `sync` in the background without waiting,
 * say what the person must see, and compose the summary's first part, how to use the memory, from what is on disk
 * now. What the memory holds, with the news, is the second hook's (`startHolds`): the two run at once. Reads files and
 * runs local git only: no network, no model.
 */
export async function startSession(
  home: string,
  config: MachineConfig,
  input: StartInput,
  now: Date,
  startSync: (cwd: string) => void,
): Promise<StartResult> {
  // One opening reads each file once, whichever part of it asks: the chain, the summary, the labels.
  const { reads, chain, cloned, shared } = openChain(home, config, input.cwd);
  const continuing = input.source === "resume" || input.source === "compact";

  startSync(input.cwd);

  const keys = new Set(chain.links.map((l) => l.key));
  const pending = Object.fromEntries(
    Object.entries(readPending(home))
      .filter(([k]) => keys.has(k))
      .map(([k, p]) => [k, p.reason]),
  );
  const sync =
    readJson<{ brains?: Record<string, { status: string; message?: string }> }>(syncStatePath(home))?.brains ?? {};
  const syncFailures = Object.fromEntries(
    Object.entries(sync)
      .filter(([k, s]) => keys.has(k) && s.status === "failed")
      .map(([k, s]) => [k, s.message ?? "no message"]),
  );
  // Changes of this machine that could not sit on top of what others published are kept on a branch until someone
  // looks at them; the branch is the record, so the notice stays until it is deleted.
  const conflicts: Record<string, { path: string; branches: string[] }> = {};
  for (const l of shared) {
    const branches = (gitQuiet(l.path, ["branch", "--list", "kioku/conflict-*", "--format=%(refname:short)"]) ?? "")
      .split("\n")
      .filter((b) => b !== "");
    if (branches.length > 0) conflicts[l.key] = { path: l.path, branches };
  }

  const brains: SummaryBrainSource[] = cloned.map((link) => ({ link, isProject: link.key === chain.project }));

  const messages: Message[] = [];
  if (chain.missing.length > 0) {
    const names = chain.missing.map((l) => l.ref.repo);
    const cloning = `cloning ${plural(names.length, "brain")} in the background`;
    messages.push({
      head: [cloning],
      details: [[dim(names.join(" · "))], [`${names.length === 1 ? "it" : "they"} will be in the next session`]],
      name: "cloning",
    });
  }
  if (chain.notLoaded.length > 0) {
    const tiers = listWords(chain.notLoaded.map((n) => n.tier));
    messages.push({
      head: [`${tiers} not loaded`],
      details: [
        [dim("in this chain")],
        ["this session was opened inside a brain"],
        ["a brain opened to work on it loads alone"],
      ],
    });
  }
  for (const u of chain.untrusted) {
    const owner = trustOwnerCommand(u);
    messages.push({
      level: "warn",
      head: [`did not load ${u.key}`],
      details: [
        [dim(`this folder's ${u.tier} brain`)],
        [`at ${u.address}, an address this machine does not know for it`],
        [
          "if you trust it, run ",
          cmd(trustCommand(u)),
          ...(owner === undefined ? [] : [", or ", cmd(owner), " for its owner,"]),
          " in a terminal, then start a new session",
        ],
      ],
      name: "untrusted",
    });
  }
  // A link by name alone works only on the machines that have that brain (§2.4).
  for (const l of chain.withoutAddress)
    messages.push({
      head: [`${l.key} is linked without its address`],
      details: [
        [dim(`this folder's ${l.tier} brain`)],
        ["a teammate cannot clone it from this file"],
        ["run ", cmd("kioku init"), " here, which writes its address"],
      ],
      name: "link-without-address",
    });
  for (const l of chain.notHere)
    messages.push({
      level: "warn",
      head: [`did not load ${l.key}`],
      details: [
        [dim(`this folder's ${l.tier} brain, named without an address`)],
        ["this machine does not have it"],
        ["a teammate who has it gives its address; then ", cmd("kioku init <address>")],
      ],
      name: "brain-not-here",
    });
  if (Object.keys(pending).length > 0) {
    const names = listWords(Object.keys(pending).map((k) => k.split("/").pop()!));
    messages.push({
      head: ["changes not published yet"],
      details: [[dim(`${names} · committed`)], ["they will be retried"]],
      name: "publication-pending",
    });
  }
  if (Object.keys(conflicts).length > 0) {
    const names = listWords(Object.keys(conflicts).map((k) => k.split("/").pop()!));
    messages.push({
      level: "warn",
      head: ["your changes conflicted with what others published"],
      details: [[dim(names)], ["they are kept aside"], ["ask the agent to look at them with you"]],
    });
  }
  // A Rule goes whole into this session, and a teammate wrote or changed it: said once, and never muted (§1.2).
  try {
    const news = await takeRuleNews(
      home,
      shared.map((l) => ({ key: l.key, root: l.path })),
    );
    const told = news.flatMap((n) => n.changes.map((c) => ({ ...c, tier: shared.find((l) => l.key === n.key)!.tier })));
    if (told.length > 0) messages.push(sayRuleNews(told));
  } catch {
    /* what the person is told never fails a session's start; the mark did not move, so the next one tells it */
  }
  if (cloned.length > 0 && !existsSync(indexPath(home))) {
    messages.push({
      head: ["building the search index in the background"],
      details: [[dim("first time on this machine")]],
      name: "index-building",
    });
  }
  if (cloned.length > 0) settleModelNotice(home, config);
  // A shared brain of an older format is the person's to raise, once its teammates have updated (§3.2).
  if (!continuing && !mutes(config, "format-behind")) {
    const behind = cloned
      .filter((l) => l.tier !== "personal")
      .filter((l) => {
        const found = reads.folderConfig(join(l.path, "kioku.yaml"));
        return found.ok && found.value.form === "brain" && found.value.format < NEWEST_FORMAT;
      })
      .map((l) => l.key);
    messages.push(...sayFormatBehind(home, behind, now));
  }
  if (!continuing) {
    const personal = cloned.find((l) => l.tier === "personal");
    // A muted notice is not even counted as said (§1.2).
    if (config.brain === undefined)
      messages.push(...(mutes(config, "no-personal-brain") ? [] : sayNoPersonal(home, now)));
    else if (remindsUnpublished(config)) messages.push(...nudgeBackup(home, personal?.path, now, reads));
  }

  const named = brainsOfLinks(chain.links);
  if (cloned.length === 0 && chain.missing.length === 0 && chain.untrusted.length === 0 && chain.notHere.length === 0)
    return { messages, brains: named };
  const composed = composeUsage({
    hints: hintsOf(chain, input.cwd, brains),
    brains: loadSummaryBrains(brains, reads),
    missing: chain.missing,
    untrusted: chain.untrusted,
    notHere: chain.notHere,
    ...(chain.inside !== undefined && { inside: chain.inside, notLoaded: chain.notLoaded }),
    ...(chain.teamFrom !== undefined && { teamFrom: chain.teamFrom }),
    ...(input.source === "compact" && { compacted: true }),
    problems: chain.problems,
    pending,
    syncFailures,
    conflicts,
    now,
  });
  return { summary: composed.usage, messages, loaded: composed.loaded, brains: named };
}

/**
 * Opening a session, its second hook (§4.1): record what this session sees of each shared brain, and compose the
 * summary's second part, what the memory holds, with what is new since this machine's last session. A resumed or
 * compacted session keeps the view of the session it continues. It alone reads and records the views, so the two
 * hooks, which run at once, never race for them; it says nothing to the person, and absent when no brain reads.
 */
export async function startHolds(
  home: string,
  config: MachineConfig,
  input: StartInput,
  now: Date,
): Promise<string | undefined> {
  const { reads, chain, cloned, shared } = openChain(home, config, input.cwd);
  if (cloned.length === 0) return undefined;
  const continuing = input.source === "resume" || input.source === "compact";
  const views = continuing
    ? readViews(home)
    : await recordViews(
        home,
        shared.map((l) => ({ key: l.key, root: l.path })),
      );
  const lint = readJson<Record<string, { count?: number }>>(lintReportPath(home)) ?? {};
  const brains: SummaryBrainSource[] = cloned.map((link) => ({
    link,
    isProject: link.key === chain.project,
    ...(link.tier !== "personal" && { news: newSince(link.path, views[link.key], reads.brainFile) }),
    ...(typeof lint[link.key]?.count === "number" && { lint: lint[link.key]!.count! }),
  }));
  const composed = composeHolds({
    hints: hintsOf(chain, input.cwd, brains),
    brains: loadSummaryBrains(brains, reads),
    missing: chain.missing,
    ...(chain.inside !== undefined && { inside: chain.inside }),
    now,
  });
  // News this session does not show, because the cap cut it, waits for the next session (§4.1).
  if (!continuing) {
    const shown = new Set(composed.newsShown);
    await holdViews(
      home,
      brains.filter((b) => (b.news?.length ?? 0) > 0 && !shown.has(b.link.key)).map((b) => b.link.key),
    );
  }
  // What the summary offered is counted (§4.5): a count never fails a session.
  try {
    recordSurfaced(home, now, composed.offered);
  } catch {
    /* a count is only a count */
  }
  return composed.holds;
}

/** The most Rules one notice names; the rest are counted, with the command that lists them. */
export const RULE_NEWS_MAX = 5;

/**
 * The notice of the Rules others changed in the session's shared brains (§1.2): each with what happened to it, its
 * title, its brain as a message names one, who changed it, and the command that reads it. It has no name: a Rule acts
 * on every session, so the notice is not one to mute.
 */
function sayRuleNews(told: (RuleChange & { tier: string })[]): Message {
  const shown = told.slice(0, RULE_NEWS_MAX);
  const more = told.length - shown.length;
  return {
    head: [
      told.length === 1 ? "a Rule of a shared brain changed" : `${told.length} Rules of the shared brains changed`,
    ],
    details: [
      ...shown.flatMap((c) => [
        [`${c.change} · ${c.title}`, dim(` · ${c.tier} · by ${c.author}`)],
        ...(c.change === "removed" ? [] : [["  ", cmd(`kioku page show ${c.path} --brain ${c.tier}`)]]),
      ]),
      ...(more > 0 ? [[`and ${more} more: `, cmd("kioku page list --kind rule")]] : []),
    ],
  };
}

/** How many days pass between two reminders that the personal brain has no backup, or that there is none. */
export const BACKUP_NUDGE_DAYS = 7;

/** When the reminders below were last given. */
interface BackupState {
  nudged?: string;
  /** When the hook last said the machine has no personal brain; said once a week until there is one. */
  noPersonal?: string;
  /** When the hook last said a shared brain of the chain is of an older format (§3.2); once a week. */
  formatBehind?: string;
}

/**
 * Say once a week which shared brains of the chain are of an older format than this version writes (§3.2): they are
 * read and written as they are, and `kioku brain upgrade` raises one once its teammates have updated.
 */
function sayFormatBehind(home: string, behind: string[], now: Date): Message[] {
  if (behind.length === 0) return [];
  const last = readBackupState(home).formatBehind;
  if (last !== undefined && now.getTime() - Date.parse(last) < BACKUP_NUDGE_DAYS * 86_400_000) return [];
  writeBackupState(home, { formatBehind: now.toISOString() });
  return [
    {
      head: [`${listWords(behind)} ${behind.length === 1 ? "is" : "are"} of an older brain format`],
      details: [
        [dim(`this version writes format ${NEWEST_FORMAT}`)],
        ["teammates on an older version still write to it as it is"],
        ["once they have updated: ", cmd(`kioku brain upgrade ${behind[0]}`)],
      ],
      name: "format-behind",
    },
  ];
}

const readBackupState = (home: string): BackupState => readJson<BackupState>(backupStatePath(home)) ?? {};
const writeBackupState = (home: string, change: Partial<BackupState>): void =>
  writeAtomic(backupStatePath(home), `${JSON.stringify({ ...readBackupState(home), ...change })}\n`);

/**
 * Say once a week, while the personal brain has no remote and holds pages, that they live only on this machine,
 * with the command that publishes it (§2.3), unless `unpublished` is muted. Any remote ends it. Runs local git only.
 */
function nudgeBackup(home: string, personal: string | undefined, now: Date, reads: SessionReads): Message[] {
  if (personal === undefined || gitQuiet(personal, ["remote"]) !== undefined) return [];
  const pages = reads.markdown(personal).filter((rel) => !isFrontPageAt(rel)).length;
  if (pages === 0) return [];
  const last = readBackupState(home).nudged;
  if (last !== undefined && now.getTime() - Date.parse(last) < BACKUP_NUDGE_DAYS * 86_400_000) return [];
  writeBackupState(home, { nudged: now.toISOString() });
  const count = plural(pages, "page");
  return [
    {
      level: "warn",
      head: ["your personal brain is only on this machine"],
      details: [[dim(`${count}, no remote`)], ["back it up: ", cmd("kioku brain publish <brain> --remote <address>")]],
      name: "unpublished",
    },
  ];
}

/**
 * Say once a week that the machine has no personal brain (§2.3): Kioku makes none on its own, so nothing personal is saved
 * until the person makes one or brings theirs.
 */
function sayNoPersonal(home: string, now: Date): Message[] {
  const last = readBackupState(home).noPersonal;
  if (last !== undefined && now.getTime() - Date.parse(last) < BACKUP_NUDGE_DAYS * 86_400_000) return [];
  writeBackupState(home, { noPersonal: now.toISOString() });
  return [
    {
      level: "warn",
      head: ["no personal brain on this machine"],
      details: [
        ["nothing personal is saved"],
        [
          "run ",
          cmd("kioku brain create <owner>/<repo>"),
          " to make one here, named as you like, or ",
          cmd("kioku brain clone <address>"),
          " to bring yours",
        ],
      ],
      name: "no-personal-brain",
    },
  ];
}

/**
 * The search model's fetch is said by `setup`, not by the session (§4.3): the hook only forgets that it was said once
 * the model is ready, so that `setup` says it again if the model goes missing. Reads a few small files; never loads
 * the engine.
 */
function settleModelNotice(home: string, config: MachineConfig): void {
  if (
    readSemanticState(home).announced !== undefined &&
    semanticStatus(home, PINS, currentPlatform(), config.search?.mode ?? "hybrid").ready
  )
    writeSemanticState(home, ({ announced: _, ...s }) => s);
}

/**
 * The message of a session's start (§1.2, §4.1): the history's `summary` row on the brand's line: why it was loaded,
 * its pages and its brains.
 */
export function loadedRow(
  loaded: { brains: string[]; pages: number },
  label: (brain: string) => string,
  source?: string,
): Message {
  const why = source === "resume" ? "resumed" : source === "compact" ? "after /compact" : "session summary";
  return historyRow("summary", `${why} · ${plural(loaded.pages, "page")}`, loaded.brains.map(label));
}
