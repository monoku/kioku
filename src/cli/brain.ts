import { parseVerb } from "./args.ts";
import { cloneBrain } from "../core/brains/clone.ts";
import { createBrain } from "../core/brains/create.ts";
import { publishBrain } from "../core/brains/publish.ts";
import { removeBrain } from "../core/brains/remove.ts";
import { linkOf, syncBrains } from "../core/sync.ts";
import { looksLikeOption, brainRepoOfKey } from "../core/config/brain-ref.ts";
import { trustCommand, trustOwnerCommand, type LinkTier } from "../core/config/chain.ts";
import { knownBrains, type KnownBrain } from "../core/brains/list.ts";
import { VERSION } from "../version.ts";
import { viaOf } from "./via.ts";
import { readMachineConfig, remindsUnpublished } from "../core/config/machine.ts";
import { userError } from "../core/errors.ts";
import { groupHelp, unknownVerb } from "./help.ts";
import { formatFinding, validateBrain, type Report } from "../core/validate/validate.ts";
import { brainPath, located } from "./brain-path.ts";
import { brainsNamed } from "./brains-named.ts";
import { runBrainConflicts } from "./brain-conflicts.ts";
import { runBrainLint } from "./brain-lint.ts";
import { runBrainRefresh } from "./brain-refresh.ts";
import { runLog } from "./log.ts";
import { runSources } from "./sources.ts";
import { runStats } from "./stats.ts";
import { requireTerminal } from "./terminal.ts";
import { upgradeBrain } from "../core/brains/upgrade.ts";
import { chainBrains, chainOf, folderArg, notLoadedBrains } from "./chain.ts";
import { checklist, PLAIN, paint, plural, shortRemote, table, tilde, type Mark } from "./render.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import type { GroupVerb } from "./verbs.ts";
import { runBrainLanguage } from "./write.ts";

/** The verbs of `kioku brain <verb>` (§6.1), the ones the table declares: the compiler holds both to one list. */
const verbs: Record<GroupVerb<"brain">, Handler> = {
  create,
  clone,
  sync: syncNamed,
  publish,
  list,
  path: brainPath,
  remove,
  log: runLog,
  stats: runStats,
  sources: runSources,
  validate,
  lint: runBrainLint,
  language: runBrainLanguage,
  refresh: runBrainRefresh,
  upgrade,
  conflicts: runBrainConflicts,
};

/** `kioku brain <verb>`. */
export const runBrain: Handler = (args, ctx) => {
  const [verb, ...rest] = args;
  if (verb === undefined) return groupHelp(ctx.ui ?? PLAIN, "brain");
  if (!Object.hasOwn(verbs, verb)) throw unknownVerb(verb, "brain");
  return verbs[verb as GroupVerb<"brain">](rest, ctx);
};

function validate(args: string[], ctx: Context): Outcome {
  if (args.length > 1) throw userError("brain validate takes at most one brain", "usage");
  const reports = brainsNamed(args[0], ctx, "validate").map((root) => validateBrain(root));
  const errors = reports.reduce((n, r) => n + r.errors, 0);
  const warnings = reports.reduce((n, r) => n + r.warnings, 0);
  return {
    data: { ok: errors === 0, errors, warnings, brains: reports },
    text: reports.map(describe).join("\n"),
    ...(errors > 0 && { exit: 1 }),
  };
}

function describe(r: Report): string {
  const lines = r.findings.map(formatFinding);
  lines.push(
    `${r.brain ?? r.root} (${r.root}): ${plural(r.errors, "error")}, ${plural(r.warnings, "warning")}, ${plural(r.files, "page")} read`,
  );
  return lines.join("\n");
}

/**
 * `kioku brain create <owner>/<repo> [--tier <tier>]` (§2.3, §6.1): a brain made on this machine with the name given,
 * asking no git host anything; personal unless `--tier` says. `kioku brain clone` brings one that exists; `kioku brain
 * publish` gives one made here its repository.
 */
async function create(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain create", args);
  if (parsed.positionals.length !== 1)
    throw userError(
      "brain create takes the brain's name, <owner>/<repo>, such as sam/memoria; Kioku chooses none",
      "usage",
    );
  const r = await createBrain(ctx.home, VERSION, {
    ...(parsed.values.tier !== undefined && { tier: parsed.values.tier }),
    repo: parsed.positionals[0]!,
    ...(parsed.values.language !== undefined && { language: parsed.values.language }),
    via: viaOf(ctx),
  });
  const items: [Mark, string][] = [
    ["done", `Created the ${r.tier} brain ${brainRepoOfKey(r.brain)} at ${r.path} (commit ${r.commit})`],
  ];
  const then: string[] = [];
  if (r.language)
    items.push(["done", `Wrote its pages' language, ${r.language}; the summary tells the agent to write in it`]);
  if (remindsUnpublished(readMachineConfig(ctx.home)))
    then.push(
      `It lives on this machine, with no remote; kioku brain publish ${brainRepoOfKey(r.brain)} --remote <address> puts it in a repository you make, when you want one.`,
    );
  return { data: r, text: checklist(ctx.ui ?? PLAIN, items, then) };
}

/**
 * `kioku brain clone <address>` (§2.3, §6.1): a brain that already exists, cloned from any address and registered
 * under the name it holds, as its `kioku.yaml` says. It asks for a terminal: which brain is the person's, and which
 * the machine trusts, is theirs to say.
 */
async function clone(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain clone", args);
  if (parsed.positionals.length !== 1)
    throw userError(
      "brain clone takes one address, such as github.com/owner/repo, https://…, git@host:path or a folder",
      "usage",
    );
  requireTerminal(
    ctx,
    "kioku brain clone",
    "which brain is yours, and which this machine loads, is yours to say, so the agent does not do it",
  );
  const r = await cloneBrain(ctx.home, addressArg(ctx, parsed.positionals[0]!));
  const done = `Cloned the ${r.tier} brain ${brainRepoOfKey(r.brain)} from ${r.url} to ${r.path}`;
  const role = r.tier === "personal" ? "it is your personal brain on this machine" : "this machine trusts it";
  return { data: r, text: `${done}; ${role}.` };
}

/**
 * `kioku brain sync <brain> | --all` (§4.2, §6.1): a brain, or every brain of the machine, pulled and pushed wherever
 * the person is; `kioku sync` is the chain of a folder.
 */
async function syncNamed(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain sync", args);
  const all = Boolean(parsed.values.all);
  if (parsed.positionals.length > 1 || all === (parsed.positionals.length === 1))
    throw userError("brain sync takes one brain, or --all", "usage");
  const brains = all ? knownBrains(ctx.home).filter((b) => b.onDisk) : [located(ctx, parsed.positionals[0], "sync")];
  const r = await syncBrains(
    ctx.home,
    brains.map((b) => linkOf((b.tier ?? "project") as LinkTier, b.key, b.folder)),
    ctx.now(),
  );
  if (r.busy) return { data: r, text: "Another sync is running; nothing done." };
  const lines = r.outcomes.map((o) => `${o.key}: ${o.status}${o.message ? ` (${o.message})` : ""}`);
  if (r.index && "failed" in r.index) lines.push(`index: failed (${r.index.failed})`);
  else if (r.index)
    lines.push(`index: ${r.index.indexed} reindexed, ${r.index.removed} removed, ${r.index.unchanged} unchanged`);
  const failed = r.outcomes.some((o) => o.status === "failed");
  return {
    data: r,
    text: lines.length > 0 ? lines.join("\n") : "No brain on this machine to sync.",
    ...(failed && { exit: 1 }),
  };
}

/**
 * `kioku brain publish <brain> --remote <address>` (§2.3, §6.1): a brain that lives only on this machine pushed to a
 * repository that must exist and be empty or hold it, the brain and the destination always named; its name and folder
 * stay. It asks for a terminal: what goes to a git host is the person's to say.
 */
async function publish(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain publish", args);
  if (parsed.positionals.length !== 1)
    throw userError(
      "brain publish takes one brain, named, and --remote <address>: kioku brain publish <brain> --remote <address>",
      "usage",
    );
  requireTerminal(
    ctx,
    "kioku brain publish",
    "it puts a brain on a git host, which is yours to decide, so the agent does not do it",
  );
  const brain = located(ctx, parsed.positionals[0], "publish");
  const r = await publishBrain(
    brain,
    ctx.home,
    parsed.values.remote === undefined ? undefined : addressArg(ctx, parsed.values.remote),
  );
  const name = brain.key;
  const lines = [
    r.status === "pushed"
      ? `Pushed ${name} to ${r.remote}, which was empty; kioku sync keeps it current.`
      : r.status === "connected"
        ? `${r.remote} already held ${name}: this machine's copy, which had no page, is now that one, and kioku sync keeps it current.`
        : `${name} already has a remote (${r.remote}); nothing to do.`,
  ];
  // A project folder that links the brain by name alone needs its address, for a teammate to clone it (§2.4).
  if (r.status !== "exists")
    lines.push(
      `A project folder whose kioku.yaml names ${name} without its address: run kioku init there, which writes it.`,
    );
  return { data: r, text: lines.join("\n") };
}

/**
 * `kioku brain upgrade <brain>` (§3.2, §6.1): a brain raised to the newest format, in one commit, pushed when it has a
 * remote. It asks for a terminal: a shared brain raised is one teammates on an older version no longer write to.
 */
async function upgrade(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain upgrade", args);
  if (parsed.positionals.length !== 1) throw userError("brain upgrade takes one brain", "usage");
  requireTerminal(
    ctx,
    "kioku brain upgrade",
    "a shared brain raised is one teammates on an older version can no longer write to, which is yours to decide",
  );
  const brain = located(ctx, parsed.positionals[0], "upgrade");
  const r = await upgradeBrain(ctx.home, brain, ctx.now());
  return {
    data: r,
    text:
      r.from === r.to
        ? `${r.brain} is in format ${r.to} already; nothing to do.`
        : `Raised ${r.brain} from format ${r.from} to ${r.to} (commit ${r.commit})${r.published === "pushed" ? ", and pushed it" : ""}.`,
  };
}

/** An address given to `brain clone` or `--remote`: a folder, relative or with `~`, made absolute; anything else, as written. */
export function addressArg(ctx: Context, value: string, orName = false): string {
  if (looksLikeOption(value))
    throw userError(
      `"${value}" begins with -, which git would read as an option; give the repository's address${orName ? " or the brain's name" : ""}`,
      "usage",
    );
  return /^(\.{1,2}(\/|$)|~(\/|$)|\/)/.test(value) ? folderArg(ctx, value) : value;
}

/**
 * `kioku brain remove <brain> [--force] [--dry-run]` (§2.5, §6.1): a brain off this machine, never off the git host.
 * It asks for a terminal: deleting what a person may not have saved elsewhere is theirs to say.
 */
async function remove(args: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain remove", args);
  if (parsed.positionals.length !== 1) throw userError("brain remove takes one brain", "usage");
  requireTerminal(
    ctx,
    "kioku brain remove",
    "it deletes a brain's files from this machine, which is yours to decide, so the agent does not do it",
  );
  const brain = located(ctx, parsed.positionals[0], "remove");
  const r = await removeBrain(ctx.home, brain, {
    force: Boolean(parsed.values.force),
    dryRun: Boolean(parsed.values["dry-run"]),
  });
  const name = brain.key ?? brain.key;
  const notes = [
    r.published
      ? `Its repository on the git host is untouched; kioku brain clone ${r.remote ?? "<address>"} brings it back.`
      : r.removed === "folder"
        ? `It had no remote, so ${r.dryRun ? "that would be" : "that was"} its only copy.`
        : `It had no remote; its files are only in ${r.folder}.`,
  ];
  if (r.dryRun) {
    const lines = [
      `Would remove ${name} from this machine: ${r.removed === "folder" ? `delete ${r.folder}` : `forget it, leaving ${r.folder}`}.`,
      ...notes,
    ];
    if (r.personal) lines.push(`${name} was your personal brain; this machine would have none.`);
    if (r.team) lines.push(`${name} was this machine's team; this machine would have none.`);
    return { data: r, text: lines.join("\n") };
  }
  const items: [Mark, string][] = [
    r.removed === "folder" ? ["done", `Deleted ${r.folder}`] : ["done", `Left ${r.folder} as it was`],
    ["done", `Forgot ${name} on this machine, and dropped its pages from the index`],
  ];
  if (r.personal) items.push(["done", `Forgot your personal brain: this machine has none now`]);
  if (r.team) items.push(["done", `Forgot this machine's team: it has none now`]);
  return { data: r, text: checklist(ctx.ui ?? PLAIN, items, [`Removed ${name} from this machine.`, ...notes]) };
}

/** What `kioku brain list` answers. */
interface BrainList {
  brains: KnownBrain[];
  /** The team link says where it came from (§2.4): the folder's `kioku.yaml`, or the machine's `team`. */
  chain: { tier: string; key: string; folder: string; onDisk: boolean; from?: "folder" | "machine" }[];
  inside: string | null;
  /** Inside a brain (§2.7), the brains of the chain that are not loaded; the chain is that brain alone. */
  notLoaded: { tier: string; key: string }[];
  /** Brains the folder's repository names that this machine does not trust (§2.4). */
  untrusted: { tier: string; key: string; address?: string }[];
}

function brainListData(ctx: Context): BrainList {
  const brains = knownBrains(ctx.home);
  const resolved = chainOf(ctx);
  const inside = resolved.inside ?? null;
  const chain = chainBrains(ctx).map((b) => ({
    tier: b.tier,
    key: b.key,
    folder: b.root,
    onDisk: b.cloned,
    ...(b.tier === "team" && resolved.teamFrom !== undefined && { from: resolved.teamFrom }),
  }));
  const notLoaded = notLoadedBrains(ctx).map((b) => ({ tier: b.tier, key: b.key }));
  return {
    brains,
    chain,
    inside,
    notLoaded,
    untrusted: resolved.untrusted.map((u) => ({
      tier: u.tier,
      key: u.key,
      ...(u.address !== undefined && { address: u.address }),
    })),
  };
}

/** `kioku brain list`: the brains this machine knows, the chain of the current folder and, inside a brain, which one (§2.7). */
function list(args: string[], ctx: Context): Outcome {
  if (args.length > 0) throw userError("brain list takes no arguments", "usage");
  const { brains, chain, inside, notLoaded, untrusted } = brainListData(ctx);
  const ui = ctx.ui ?? PLAIN;
  const p = paint(ui);
  const lines =
    brains.length === 0
      ? []
      : [
          table(
            ui,
            ["REPOSITORY", "TIER", "FOLDER", "REMOTE"],
            brains.map((b) => [
              brainRepoOfKey(b.key),
              b.onDisk ? (b.tier ?? "?") : "not on disk",
              tilde(ui, b.folder),
              b.remote ? shortRemote(b.remote) : "no remote",
            ]),
            {
              keepEnd: [2],
              style: (c, r, cell) =>
                r === -1
                  ? p.title(cell)
                  : c === 0
                    ? p.name(cell)
                    : c === 1 && !brains[r]!.onDisk
                      ? p.yellow(cell)
                      : c === 3 && !brains[r]!.remote
                        ? p.dim(cell)
                        : cell,
            },
          ),
          "",
        ];
  lines.push(
    chain.length > 0
      ? `${p.dim("Chain here:")} ${chain.map((l) => `${l.tier} ${brainRepoOfKey(l.key)}${l.from === "machine" ? " (this machine's)" : ""}${l.onDisk ? "" : " (not on disk)"}`).join(" → ")}`
      : "No chain here.",
  );
  const within = chain.find((l) => l.key === inside);
  if (within !== undefined)
    lines.push(`This folder is inside the brain ${brainRepoOfKey(within.key)}, which works on its own.`);
  for (const n of notLoaded) lines.push(`In the chain, not loaded: the ${n.tier} brain ${brainRepoOfKey(n.key)}.`);
  for (const u of untrusted)
    lines.push(
      `Not trusted, so not loaded: the ${u.tier} brain ${u.key}${u.address === undefined ? "" : ` at ${u.address}`}. To trust it: ${trustCommand(u)}${trustOwnerCommand(u) === undefined ? "" : `, or ${trustOwnerCommand(u)} for every brain of that owner`}`,
    );
  return { data: { brains, chain, inside, notLoaded, untrusted }, text: lines.join("\n") };
}
