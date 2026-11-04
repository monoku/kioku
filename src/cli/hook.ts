import { resolve } from "node:path";
import { machineReader, mutes, type MachineConfig } from "../core/config/machine.ts";
import { loadedRow, startSession } from "../core/session/start.ts";
import { currentVersion, installDirs, installOrigin, managerCommand, newerThan } from "../core/setup/install.ts";
import { dueForCheck, recordCheck, takeAvailable } from "../core/setup/update.ts";
import { entriesFor, labelled, nextTurn, ownTurn, record } from "../core/session/journal.ts";
import { labelsFor } from "../core/session/labels.ts";
import { newVersionPair } from "../core/session/versions.ts";
import { VERSION } from "../version.ts";
import {
  cmd,
  dim,
  layoutFor,
  messageColor,
  render,
  unmuted,
  type Layout,
  type Message,
} from "../core/session/message.ts";
import { PLUGIN_SKILL } from "../harness/claude-code-integration.ts";
import { DEFAULT_HARNESS, harnessFor, type Harness } from "../harness/index.ts";
import type { NamespaceAdd } from "../harness/harness.ts";
import type { Context, Handler, Outcome } from "./run.ts";
import { personHome } from "./home.ts";
import { parseVerb } from "./args.ts";

/** The adapter the hook speaks to: `--host <id>`, Claude Code when it is not given. */
function harnessOf(args: string[], ctx: Context): Harness {
  return harnessFor(flagsOf(args).host ?? DEFAULT_HARNESS, personHome(ctx), ctx.env);
}

/**
 * What a hook is given besides its verb, as the table declares it: the host it runs in. Read once; a flag it does not
 * know is refused as it comes, before any hook runs, as a usage error.
 */
const flagsOf = (args: string[]) => parseVerb("hook", args, { positionals: false }).values;

/** The machine configuration for one hook, read at most once. */
const machineOf = (ctx: Context): (() => MachineConfig | undefined) => ctx.machine ?? machineReader(ctx.home);

/**
 * A hook never fails a session (§6.2): whatever it did not foresee in what the host gave it ends in no answer, never
 * in an error printed. A call the tool cannot take, an unknown flag or host, is refused before this.
 */
const guarded =
  (hook: (harness: Harness, ctx: Context) => Outcome | undefined | Promise<Outcome | undefined>): Handler =>
  async (args, ctx) => {
    const harness = harnessOf(args, ctx);
    try {
      return await hook(harness, ctx);
    } catch {
      return undefined;
    }
  };

/**
 * The `SessionStart` hook (§4.1, §6.2): one sentence when the machine was never set up; otherwise start `sync` and, once a day, `update` in the background (§6.4), and inject the
 * summary of the chain. Never fails the session: a problem becomes one sentence for the person.
 */
export const sessionStart: Handler = async (args, ctx) => {
  const harness = harnessOf(args, ctx);
  const messages: Message[] = [];
  // What the person sees, as `display` says (§1.2); a configuration that cannot be read shows every message.
  let layout: Layout = layoutOf(undefined, ctx.env);
  let config: MachineConfig | undefined;
  const answer = (summary: string | undefined, said: Message[]) =>
    harness.sessionStartAnswer(
      summary,
      unmuted(said, config?.display?.mute).map((m) => render(m, layout)),
    );
  try {
    config = machineOf(ctx)();
    layout = layoutOf(config, ctx.env);
    const unreachable = harness.persistPath(personHome(ctx), ctx.env);
    if (unreachable !== undefined) messages.push({ level: "warn", head: [unreachable] });
    // Kioku makes no configuration and no brain on its own (§2.3, §6.3): a machine never set up is told how.
    if (config === undefined) {
      return answer(undefined, [
        ...messages,
        {
          level: "warn",
          head: ["not set up on this machine"],
          details: [["run ", cmd("kioku setup"), " in a terminal"]],
          name: "not-set-up",
        },
      ]);
    }
    // Where the installer installed the tool, a newer version is looked for once a day in the background, and the next
    // session says what the look found, once (§6.4); the stamp goes first, so one session looks. Nothing installs it but
    // the person. With the notice muted nothing would use the look, so there is none; a tool installed another way is
    // updated by what installed it, and never looks.
    const dirs = installDirs(personHome(ctx), ctx.env);
    const origin = installOrigin(dirs, ctx.bundle);
    const looks = origin === "installer" && !mutes(config, "update-available");
    if (looks && dueForCheck(ctx.home, ctx.now())) {
      recordCheck(ctx.home, ctx.now());
      ctx.startBackground(["update", "--check"]);
    }
    const running = currentVersion(dirs);
    const available = looks ? takeAvailable(ctx.home) : undefined;
    if (available !== undefined && (running === undefined || newerThan(available, running))) {
      const runs = running === undefined ? undefined : `this machine runs ${running}`;
      messages.push({
        head: [`${available} is available`],
        details: [...(runs === undefined ? [] : [[dim(runs)]]), ["run ", cmd("kioku update"), " in a terminal"]],
        name: "update-available",
      });
    }
    // A plugin of another version than the tool: everything runs, and the session says it once for each pair, with the
    // command for the side that is older (§6.2).
    const apart = newVersionPair(ctx.home, ctx.env.KIOKU_PLUGIN_VERSION?.trim() || undefined, ctx.version ?? VERSION);
    if (apart !== undefined) {
      const fix = newerThan(apart.tool, apart.plugin)
        ? `kioku plugin ${harness.id} install`
        : origin === "installer"
          ? "kioku update"
          : (managerCommand(origin) ?? "update Kioku the way it was installed");
      const what = `Kioku ${apart.tool} and its plugin ${apart.plugin} are different versions`;
      messages.push({
        level: "warn",
        head: [what],
        details: [["everything still runs; to bring them together: ", cmd(fix)]],
        name: "plugin-version",
      });
    }
    const input = harness.parseSessionStart(await ctx.stdin());
    const cwd = resolve(input.cwd ?? ctx.cwd);
    const started = await startSession(
      ctx.home,
      config,
      {
        cwd,
        ...(input.source !== undefined && { source: input.source }),
      },
      ctx.now(),
      (dir) => ctx.startBackground(["sync", "--cwd", dir, "--background"]),
    );
    // The person sees which brains the summary loaded (§1.2, §4.1), and the session's journal begins with it (§4.6).
    const labels = labelsFor(ctx.home, cwd, { machine: machineOf(ctx), ours: started.brains });
    // The summary is told in the rows' words, the history's `summary`, in one line (§1.2).
    const loaded =
      started.summary !== undefined && started.loaded !== undefined
        ? [loadedRow(started.loaded, labels.label, input.source)]
        : [];
    if (started.summary !== undefined && started.loaded !== undefined) {
      // Resumed or compacted, the summary loaded again is a turn of its own, and says why (§4.6).
      if (input.source === "resume" || input.source === "compact") ownTurn(ctx.home, input.sessionId, ctx.now());
      record(
        ctx.home,
        input.sessionId,
        [
          labelled(
            {
              what: "summary",
              arrow: "read",
              brain: started.loaded.brains.join(", "),
              count: started.loaded.pages,
              ...(input.source !== undefined && { source: input.source }),
            },
            labels,
          ),
        ],
        ctx.now(),
      );
    }
    return answer(started.summary, [...messages, ...started.messages, ...loaded]);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return answer(undefined, [...messages, { level: "error", head: ["could not start"], details: [[dim(why)]] }]);
  }
};

/** How messages are laid out, as the configuration's `display` and the terminal say (§1.2). */
const layoutOf = (config: MachineConfig | undefined, env: NodeJS.ProcessEnv): Layout =>
  layoutFor(messageColor(config?.display?.color, env));

/**
 * The `PostToolUse` hook (§1.2, §4.6, §6.2): writes what the tool's reading and writing verbs did into the session's
 * journal, from their own answers in the shell tool's output, and answers nothing: the mod draws the call's rows from
 * those entries. Unreadable input writes nothing.
 */
export const postToolUse: Handler = guarded(async (harness, ctx) => {
  const result = harness.parseToolResult(await ctx.stdin());
  if (result === undefined) return undefined;
  // Every read and write is an entry of the session's journal (§4.6). It keeps each brain by its key and, beside it,
  // as the person is shown it (§1.2).
  const labels = labelsFor(ctx.home, result.cwd ?? ctx.cwd, { machine: machineOf(ctx) });
  const entries = entriesFor(result.command, result.output, labels).map((e) =>
    result.callId === undefined ? e : { ...e, call: result.callId },
  );
  record(ctx.home, result.sessionId, entries, ctx.now());
  return undefined;
});

/**
 * The `PreToolUse` hooks (§6.2). On the skill tool: lets Claude Code load Kioku's own skill without asking, for that
 * skill and no other; a plugin cannot ship allow rules,
 * and a rule on `Bash(kioku *)` is not needed, since the skill allows its own tool once loaded. On the shell, before
 * `kioku namespace add`: has the host ask the person, with the path and the description, since a namespace is
 * structure and the person confirms each one (§3.2), whatever `display.mute` holds.
 */
export const preToolUse: Handler = guarded(async (harness, ctx) => {
  const raw = await ctx.stdin();
  const added = harness.parseNamespaceAdd(raw);
  if (added !== undefined) return harness.askAnswer(render(namespaceQuestion(added), { color: false }));
  if (harness.parseSkillUse(raw) !== PLUGIN_SKILL) return undefined;
  // Kioku's skill loaded is a read of the session's journal (§4.6).
  record(ctx.home, harness.parseSessionId(raw), [{ what: "skill", arrow: "read" }], ctx.now());
  return harness.allowSkillAnswer();
});

/** The question before a namespace is made (§3.2): its path and brain, and its description under it. */
function namespaceQuestion(n: NamespaceAdd): Message {
  const where = n.brain === undefined ? "" : ` in ${n.brain}`;
  return {
    level: "warn",
    head: [`create the namespace ${n.path}${where}?`],
    details: [[n.summary ?? "no description given"]],
  };
}

/**
 * The `UserPromptSubmit` hook (§4.6): each prompt is the session's next turn in its journal. It answers nothing and
 * never fails the prompt.
 */
export const userPromptSubmit: Handler = guarded(async (harness, ctx) => {
  const input = harness.parseUserPrompt(await ctx.stdin());
  if (input === undefined) return undefined;
  nextTurn(ctx.home, input.sessionId, ctx.now());
  return undefined;
});
