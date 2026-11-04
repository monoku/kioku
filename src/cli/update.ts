import { execFile } from "node:child_process";
import { readMachineConfig } from "../core/config/machine.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { currentBundle, installDirs, installOrigin, managerCommand } from "../core/setup/install.ts";
import {
  recordAvailable,
  recordCheck,
  RELEASE_VERSION,
  releasesUrl,
  updateFromRelease,
  type UpdateOutcome,
} from "../core/setup/update.ts";
import { runBrain } from "./brain.ts";
import type { Context, Handler } from "./run.ts";
import { personHome } from "./home.ts";
import { requireTerminal } from "./terminal.ts";
import { currentSteps } from "../core/steps.ts";
import { CHANGELOG_URL } from "../product.ts";

/**
 * `kioku update [<version>] [--check] [--dry-run]` (§6.1, §6.4): the latest release, when it is
 * newer than the version running, installed under `versions/` with its plugin beside it and made current, so each
 * host's next session loads that plugin (§6.2); then the rest handed over to that version: `kioku update --finish`,
 * run from the new bundle, brings the files the tool owns in each brain to it, texts the version that was running does
 * not carry. A version the person names asks for a terminal, since every `kioku` call then runs it.
 */

/** What finishing an update answers: what `brain refresh --all` said. */
export interface UpdateFinish {
  refreshed: unknown;
  /** Why the version installed could not be handed over to; absent when it was. */
  error?: string;
}

export const runUpdate: Handler = async (args, ctx) => {
  const { values, positionals } = parseVerb("update", args);
  if (positionals.length > 1) throw userError("update takes one version at most", "usage");
  const wanted = positionals[0]?.replace(/^v/, "");
  if (wanted !== undefined && !RELEASE_VERSION.test(wanted))
    throw userError(`${positionals[0]} is not a version, such as 1.2.0`, "usage");
  const dirs = installDirs(personHome(ctx), ctx.env);
  if (values.finish) {
    if (values.check || values["dry-run"] || wanted !== undefined)
      throw userError("--finish goes alone: it is what update calls in the version it installed", "usage");
    const done = await finishHere(ctx);
    return { data: done, text: describeFinish(done).trim() || "No brain to refresh." };
  }
  // A tool installed another way than by the installer is updated by what installed it (§6.4): nothing changes here.
  const origin = installOrigin(dirs, ctx.bundle);
  if (origin !== "installer") {
    const command = managerCommand(origin);
    return {
      data: { status: "managed", origin, ...(command !== undefined && { command }) },
      text:
        command !== undefined
          ? `Kioku was installed by Homebrew, which updates it: ${command}`
          : "Kioku was not installed by its installer: update it the way it was installed.",
    };
  }
  const dryRun = values["dry-run"] === true;
  if (wanted !== undefined && !values.check && !dryRun) {
    requireTerminal(
      ctx,
      `kioku update ${wanted}`,
      "every `kioku` call would then run that version, the agent's too, so which version is yours to say",
    );
  }
  const releases = releasesUrl(ctx.env);
  const outcome: UpdateOutcome = await updateFromRelease(
    dirs,
    ctx.semantic.download,
    releases,
    values.check ? "check" : dryRun ? "dry-run" : "install",
    wanted,
  );
  // The latest release was looked at: no session looks again today (§6.4).
  if (wanted === undefined) recordCheck(ctx.home, ctx.now());
  // `--check` is what a session's daily look runs: a newer version found is what the next session says (§6.4);
  // installing ends it.
  if (wanted === undefined && values.check)
    recordAvailable(ctx.home, outcome.status === "available" ? (outcome.version ?? undefined) : undefined);
  if (outcome.status === "updated") recordAvailable(ctx.home, undefined);
  // The version just installed finishes: it carries the texts the integration and the brains get (§6.4).
  const finished: UpdateFinish =
    outcome.status === "updated"
      ? await currentSteps().runAsync(
          {
            doing: `Bringing the brains' files up to ${outcome.version}`,
            done: `Brought the brains' files up to ${outcome.version}`,
            direction: "down",
            failed: (f) => f.error !== undefined,
          },
          () => (ctx.finishUpdate ?? (() => finishHere(ctx)))(currentBundle(dirs)),
        )
      : { refreshed: null };
  return {
    data: {
      ...outcome,
      refreshed: finished.refreshed,
      ...(finished.error !== undefined && { finishError: finished.error }),
    },
    text: describe(outcome, finished, wanted !== undefined ? `kioku update ${wanted}` : undefined),
  };
};

/** Every brain refreshed by the version this process runs (§6.4); its plugin is already beside it (§6.2). */
export async function finishHere(ctx: Context): Promise<UpdateFinish> {
  return { refreshed: await refreshBrains(ctx) };
}

/** `kioku update --finish` run from `bundle`, so that the version just installed does the finishing (§6.4). */
export function finishByBundle(bundle: string): Promise<UpdateFinish> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [bundle, "update", "--finish", "--json"],
      { timeout: 600_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        const why = error ? error.message.split("\n")[0]! : "it gave no answer";
        try {
          const answer = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
            refreshed?: unknown;
            error?: unknown;
          };
          // The answer of a version's `--finish` is what it refreshed; a later version may say more, read by no one here.
          if (typeof answer === "object" && answer !== null && "refreshed" in answer)
            return resolve({ refreshed: answer.refreshed ?? null });
          const said =
            typeof answer.error === "object" && answer.error !== null
              ? (answer.error as { message?: unknown }).message
              : undefined;
          resolve({ refreshed: null, error: typeof said === "string" ? said : why });
        } catch {
          resolve({ refreshed: null, error: why });
        }
      },
    );
  });
}

/** `kioku brain refresh --all`, when there is a configuration to find the brains in; what it answered. */
async function refreshBrains(ctx: Context): Promise<unknown> {
  if (readMachineConfig(ctx.home) === undefined) return null;
  return (await runBrain(["refresh", "--all"], ctx))?.data ?? null;
}

/** What finishing did, as sentences; empty when there was nothing. */
function describeFinish(f: UpdateFinish): string {
  const brains =
    f.refreshed !== null &&
    typeof f.refreshed === "object" &&
    Array.isArray((f.refreshed as { brains?: unknown }).brains)
      ? (f.refreshed as { brains: unknown[] }).brains.length
      : 0;
  return brains > 0 ? ` Refreshed the files Kioku owns in ${brains} brain${brains === 1 ? "" : "s"}.` : "";
}

/** `again`: the command that installs what the person named, a version or a bundle; undefined for the latest release. */
function describe(o: UpdateOutcome, f: UpdateFinish, again?: string): string {
  const was = o.was ?? "no version";
  if (o.status === "current" && o.latest !== undefined)
    return `Kioku ${o.was} is newer than the latest release, ${o.latest}; it stays until a newer release is the latest.`;
  if (o.status === "current")
    return again !== undefined
      ? `Kioku ${o.version} is already installed and active; nothing to do.`
      : `Kioku ${o.was ?? "(nothing installed)"} is the latest version.`;
  if (o.status === "available")
    return `Kioku ${o.version} is available; this machine runs ${was}. Run ${again ?? "kioku update"} to install it.`;
  const pruned = o.pruned.length > 0 ? ` Removed ${o.pruned.join(", ")}.` : "";
  const rest =
    f.error !== undefined
      ? ` Could not hand over to it (${f.error}): run kioku brain refresh --all.`
      : describeFinish(f);
  // The person is told what changed and how to go back, the version before being kept for it (§6.4).
  const back = o.was !== null ? ` To go back: kioku update ${o.was}, in a terminal.` : "";
  return `Installed Kioku ${o.version} (was ${was}); every kioku call now runs it. What changed: ${CHANGELOG_URL}.${back}${pruned}${rest}`;
}
