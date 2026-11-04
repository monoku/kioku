import { spawnSync } from "node:child_process";
import { environmentError, userError } from "../core/errors.ts";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentVersion, installDirs, installOrigin, pluginFolder, whichOnPath } from "../core/setup/install.ts";
import { PLUGIN_MARKETPLACE, PLUGIN_SELECTOR } from "../harness/claude-code-integration.ts";
import { harnessFor, harnessIdOf } from "../harness/index.ts";
import { parseVerb } from "./args.ts";
import { groupHelp, unknownVerb } from "./help.ts";
import { PLAIN } from "./render.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import { personHome } from "./home.ts";
import { requireTerminal } from "./terminal.ts";
import { currentSteps } from "../core/steps.ts";
import { VERSION } from "../version.ts";

/**
 * `kioku plugin <host> install|uninstall [--dry-run]` (§6.2): the integration as the host's own plugin, added and
 * removed with the host's own commands (`claude plugin …`). The marketplace is the folder beside the tool that holds
 * the plugin, which the host reads in place, and holds nothing else, so `uninstall` removes it with the plugin.
 * Changing the host is the person's, so both ask for a terminal; `--dry-run` only says.
 */
export const runPlugin: Handler = async (args, ctx) => {
  const [host, verb, ...rest] = args;
  if (host === undefined) return groupHelp(ctx.ui ?? PLAIN, "plugin");
  const id = harnessIdOf(host);
  if (verb === undefined) return groupHelp(ctx.ui ?? PLAIN, "plugin", id);
  if (verb !== "install" && verb !== "uninstall") throw unknownVerb(verb);
  return change(id, verb, rest, ctx);
};

function run(program: string, args: string[], ctx: Context): void {
  const done = spawnSync(program, args, { env: ctx.env, encoding: "utf8" });
  if (done.error !== undefined || done.status !== 0) {
    const why = (done.stderr || done.stdout || done.error?.message || `exit ${done.status}`)
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ");
    throw environmentError(`claude ${args.join(" ")} failed: ${why}`, "plugin_command_failed");
  }
}

/** The tool's version a plugin is held to (§6.2): the one `current` runs, else this build's. */
export const toolVersion = (ctx: Context): string =>
  currentVersion(installDirs(personHome(ctx), ctx.env)) ?? ctx.version ?? VERSION;

async function change(
  id: "claude-code",
  verb: "install" | "uninstall",
  args: string[],
  ctx: Context,
): Promise<Outcome> {
  const parsed = parseVerb(`plugin ${id} ${verb}`, args);
  const dryRun = parsed.values["dry-run"] === true;
  const command = `kioku plugin ${id} ${verb}`;
  if (!dryRun) requireTerminal(ctx, command, "it changes the agent's own plugins, so the agent does not do it");

  const person = personHome(ctx);
  const h = harnessFor(id, person, ctx.env);
  const installed = h.integration.plugin.installed();
  const source = h.integration.plugin.marketplace();

  // The plugin is the folder beside the tool, read in place (§6.2): a marketplace of the same name from elsewhere,
  // an earlier version's on GitHub say, is pointed at it by the same command, and the plugin follows.
  const folder = verb === "install" ? pluginBesideTool(ctx) : undefined;
  const here = source?.kind === "directory" && folder !== undefined && resolve(source.path) === resolve(folder);
  const steps: string[][] =
    verb === "install"
      ? [
          ...(here ? [] : [["plugin", "marketplace", "add", folder!]]),
          ...(installed ? [] : [["plugin", "install", PLUGIN_SELECTOR]]),
        ]
      : [
          ...(installed ? [["plugin", "uninstall", PLUGIN_SELECTOR]] : []),
          ...(source !== undefined ? [["plugin", "marketplace", "remove", PLUGIN_MARKETPLACE]] : []),
        ];
  const commands = steps.map((s) => `claude ${s.join(" ")}`);

  if (steps.length === 0) {
    const text =
      verb === "install"
        ? `${h.name} has the Kioku plugin; nothing to change.`
        : `${h.name} has no Kioku plugin; nothing to remove.`;
    return { data: { host: id, status: "unchanged", commands: [], dryRun }, text };
  }
  const listing = commands.map((c) => `  ${c}`).join("\n");
  if (dryRun) {
    return {
      data: { host: id, status: "planned", commands, dryRun },
      text: `Nothing ${verb === "install" ? "added" : "removed"}. ${command} would:\n\n${listing}\n\nRun it without --dry-run to ${verb}; it asks first.`,
    };
  }
  const claude = whichOnPath("claude", ctx.env);
  if (claude === undefined)
    throw environmentError("`claude` is not on the PATH; Kioku does not install it", "agent_missing");
  if (!ctx.json) ctx.out?.(`${command} will:\n\n${listing}\n\n`);
  const yes = await (ctx.ask ?? (async () => true))(verb === "install" ? "Go ahead?" : "Remove these?");
  if (!yes)
    return {
      data: { host: id, status: "cancelled", commands, dryRun },
      text: verb === "install" ? "Nothing installed." : "Nothing removed.",
      exit: 1,
    };
  for (const s of steps) {
    const shown = `claude ${s.join(" ")}`;
    currentSteps().run({ doing: `Running ${shown}`, done: `Ran ${shown}`, direction: "down" }, () =>
      run(claude, s, ctx),
    );
  }
  const text =
    verb === "install"
      ? installed
        ? `${h.name} reads the Kioku plugin beside the tool from its next session, and follows the tool from then on.`
        : `Installed. ${h.name} uses Kioku from its next session, and its plugin follows the tool from then on.`
      : `Removed. ${h.name} no longer uses Kioku; the brains and the tool stay.`;
  return { data: { host: id, status: "done", commands, dryRun }, text };
}

/**
 * The folder that holds the plugin beside the tool that runs (§6.2), when it is there; refused for a tool that carries
 * none, a build a person runs from where they put it, and for one whose folder is missing.
 */
function pluginBesideTool(ctx: Context): string {
  const dirs = installDirs(personHome(ctx), ctx.env);
  const origin = installOrigin(dirs, ctx.bundle);
  const folder = pluginFolder(dirs, origin, ctx.bundle);
  if (folder === undefined)
    throw userError(
      "this Kioku was not installed by its installer or Homebrew, so no plugin travels with it; install Kioku with one of them, or load plugins/claude-code from a checkout with claude --plugin-dir",
      "plugin_missing",
    );
  if (!existsSync(join(folder, ".claude-plugin", "marketplace.json")))
    throw environmentError(
      `the plugin that travels with Kioku is not in ${folder}; run the installer again to put it back`,
      "plugin_missing",
    );
  return folder;
}
