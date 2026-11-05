import { existsSync } from "node:fs";
import { configPath, readMachineConfig, remindsUnpublished, updateMachineConfig } from "../core/config/machine.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { installDirs, launcherPath, onPath, type InstallDirs } from "../core/setup/install.ts";
import { SHELLS, applyPath, lineFor, planPath, shellOf, type PathPlan, type Shell } from "../core/setup/path.ts";
import { applyCompletion, type CompletionPlan } from "../core/setup/completion.ts";
import { currentPlatform, downloadMB, PINS } from "../core/semantic/pins.ts";
import { configuredMode, readSemanticState, semanticStatus, writeSemanticState } from "../core/semantic/status.ts";
import { INSTALL_COMMAND } from "../product.ts";
import { allHarnesses } from "../harness/index.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import { personHome } from "./home.ts";
import { requireTerminal } from "./terminal.ts";
import { checklist, PLAIN, type Mark } from "./render.ts";

/**
 * `kioku setup [--shell fish|zsh|bash|all] [--no-model]` (§6.1, §6.3): what a machine needs, once and idempotently:
 * the configuration, which records nothing about who the person is (git does, §2.5), `kioku` on the person's PATH, the
 * shell's completion and
 * the search model fetched in the background (§4.3). It makes no brain (§2.3): while there is no personal brain it
 * says how to make or bring one, and it ends by naming the agent hosts found with no integration yet; adding one is
 * the person's own step, `kioku plugin <host> install` (§6.2).
 */
export const runSetup: Handler = async (args, ctx): Promise<Outcome> => {
  const { values } = parseVerb("setup", args);
  if (values.shell !== undefined && values.shell !== "all" && !(SHELLS as readonly string[]).includes(values.shell)) {
    throw userError(`--shell is ${SHELLS.join(", ")} or all, not ${values.shell}`, "usage");
  }
  // Before anything is written: the configuration and the PATH are the person's to set up, not an agent's.
  requireTerminal(ctx, "kioku setup", "it sets up your configuration and your PATH, so the agent does not do it");

  // The configuration (§2.5): setting a machine up decides nothing about who the person is.
  const config = readMachineConfig(ctx.home);
  const configuration: "created" | "nothing" = config === undefined ? "created" : "nothing";
  if (configuration === "created") await updateMachineConfig(() => undefined, ctx.home);
  const written = readMachineConfig(ctx.home);
  const personal = written?.brain;

  // The PATH: a link in a folder already on it, else the shell's profile; nothing when `kioku` resolves.
  const person = personHome(ctx);
  const dirs = installDirs(person, ctx.env);
  const launcher = { path: launcherPath(dirs), present: existsSync(launcherPath(dirs)) };
  const reachable = onPath(dirs, ctx.env.PATH);
  const shell = values.shell as Shell | "all" | undefined;
  let shellPath: PathPlan | undefined;
  const where = { dirs, person, env: ctx.env };
  if (launcher.present && !reachable) {
    shellPath = applyPath(
      planPath(where, shell === undefined ? {} : { shell }),
      where,
      shell === undefined ? {} : { shell },
    );
  }
  // The shell's completion: a file or a line that sources `kioku completion <shell>`, written once (§6.3).
  const completion: CompletionPlan | undefined = launcher.present
    ? applyCompletion(where, shell === undefined ? {} : { shell })
    : undefined;

  // The search model (§4.3): the first sync, which fetches it, started in the background and said once; or full text by choice.
  const model = await modelStep(ctx, values["no-model"] === true);

  // The agent hosts on this machine with no plugin yet: named, never added here (§6.3).
  const agents = allHarnesses(person, ctx.env).map((h) => ({
    host: h.id,
    name: h.name,
    found: h.integration.found(),
    added: h.integration.plugin.installed(),
  }));

  const modelChanged = model.action === "fetching" || (model.action === "full-text" && model.detail === "set");
  const unchanged =
    configuration === "nothing" && shellPath === undefined && completion?.action !== "written" && !modelChanged;
  const items: [Mark, string][] = [];
  const then: string[] = [];
  if (configuration === "created") items.push(["done", `Wrote the configuration, ${configPath(ctx.home)}`]);
  else if (unchanged) then.push("Already set up. Nothing to do.");
  if (shellPath !== undefined) items.push(...describePath(shellPath, dirs, shellOf(ctx.env)));
  else if (!launcher.present)
    items.push(["todo", `The launcher ${launcher.path} is not installed: run the installer (${INSTALL_COMMAND}).`]);
  if (completion?.action === "written")
    items.push([
      "done",
      `Gave ${completion.shell === "all" ? "fish, zsh and bash" : completion.shell} the completion of \`kioku\`: ${completion.files.join(" and ")}; it is there in a new terminal`,
    ]);
  else if (completion?.action === "unavailable")
    items.push(["failed", `Could not give your shell the completion of \`kioku\`: ${completion.reason}`]);
  if (model.action === "fetching")
    items.push([
      "done",
      `Started fetching the search model in the background (about ${model.mb} MB, once); kioku doctor says when it is there, and until then search uses full text`,
    ]);
  else if (model.action === "full-text" && model.detail === "set")
    items.push([
      "done",
      "Kept search on full text (search.mode: full-text); kioku config set search.mode hybrid, then kioku sync, fetches the model later",
    ]);
  else if (model.action === "failed")
    items.push(["todo", `Could not fetch the search model before (${model.detail}); kioku sync tries again.`]);
  for (const a of agents) {
    if (a.found && !a.added)
      items.push([
        "todo",
        `${a.name} is on this machine and does not use Kioku yet. To let it: kioku plugin ${a.host} install`,
      ]);
  }
  if (personal === undefined) {
    // The name is the person's to give (§2.3): Kioku works out none.
    items.push(["todo", "You have no personal brain on this machine yet; Kioku makes none on its own."]);
    then.push(
      "In a terminal,",
      "  kioku brain create <owner>/<repo>",
      "makes yours on this machine, with the name you give it, sam/memoria say, which needs no remote, or",
      "  kioku brain clone <address>",
      "brings it from its repository.",
      ...(remindsUnpublished(written)
        ? [
            "Then kioku brain publish, given the brain and --remote with an address, puts it in a repository you make, when you want one.",
          ]
        : []),
    );
  }

  return {
    data: {
      configuration,
      personal: personal ?? null,
      launcher: { path: launcher.path, present: launcher.present, onPath: reachable },
      ...(shellPath !== undefined && {
        shellPath: {
          action: shellPath.action,
          target: shellPath.target ?? null,
          files: shellPath.files,
          skipped: shellPath.skipped,
          line: shellPath.line ?? null,
        },
      }),
      ...(completion !== undefined && {
        completion: { shell: completion.shell ?? null, action: completion.action, files: completion.files },
      }),
      model,
      agents,
    },
    text: checklist(ctx.ui ?? PLAIN, items, then),
  };
};

/** What `setup` did about the search model. */
interface ModelStep {
  /** `fetching`: the sync that fetches it was started now; `pending`: an earlier run started it and sync owns it since; the rest: nothing to start. */
  action: "fetching" | "pending" | "ready" | "failed" | "full-text" | "unavailable";
  detail?: string;
  mb?: number;
}

/**
 * The search model (§4.3): fetched by `sync`, which `setup` starts in the background, and said once, so that a `setup` run again leaves it to `sync`. `--no-model` chooses full text instead.
 */
async function modelStep(ctx: Context, noModel: boolean): Promise<ModelStep> {
  if (noModel) {
    if (configuredMode(ctx.home) === "full-text") return { action: "full-text", detail: "already" };
    await updateMachineConfig((c) => void ((c.search ??= {}).mode = "full-text"), ctx.home);
    return { action: "full-text", detail: "set" };
  }
  if (configuredMode(ctx.home) === "full-text") return { action: "full-text", detail: "already" };
  const pins = ctx.semantic.pins ?? PINS;
  const status = semanticStatus(ctx.home, pins, ctx.semantic.platform ?? currentPlatform());
  if (status.ready) return { action: "ready" };
  if (status.missing.length === 0) return { action: "unavailable", detail: status.reason! };
  const state = readSemanticState(ctx.home);
  if (state.failure !== undefined) return { action: "failed", detail: state.failure.reason };
  if (state.announced !== undefined) return { action: "pending" };
  writeSemanticState(ctx.home, (s) => ({ ...s, announced: ctx.now().toISOString() }));
  ctx.startBackground(["sync", "--cwd", ctx.cwd, "--background"]);
  return { action: "fetching", mb: downloadMB(pins) };
}

/** What the PATH step did, in words. */
function describePath(plan: PathPlan, dirs: InstallDirs, shell: Shell | undefined): [Mark, string][] {
  const items: [Mark, string][] = [];
  for (const s of plan.skipped) items.push(["done", `Left ${s.path} alone: ${s.reason}`]);
  if (plan.action === "already") items.push(["done", "Found `kioku` already on your PATH; nothing to do"]);
  else if (plan.action === "linked")
    items.push(["done", `Linked ${plan.target} to ${launcherPath(dirs)}; \`kioku\` works now, in every shell`]);
  else if (plan.action === "profile") {
    if (plan.files.length === 0)
      items.push(["todo", "Your shell's profile already puts it on the PATH; open a new terminal."]);
    else
      items.push(["done", `Added the line to ${plan.files.join(" and ")}; open a new terminal and \`kioku\` is there`]);
  } else {
    const line = plan.line ?? (shell !== undefined ? lineFor(shell, dirs) : undefined);
    items.push([
      "failed",
      `Could not put \`kioku\` on the PATH: ${plan.reason ?? "nothing to do"}${line !== undefined ? `\n  ${line}` : ""}`,
    ]);
  }
  return items;
}
