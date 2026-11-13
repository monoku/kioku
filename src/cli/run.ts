// The command-line tool (§6.1): dispatches a verb and prints its result as JSON
// (--json, or stdout is not a terminal) or as text.
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { isAbsolute, resolve } from "node:path";
import { CLI_CONTRACT, VERSION } from "../version.ts";
import { KNOWN_FORMATS } from "../core/config/folder-config.ts";
import { machineReader, type DisplayColor, type MachineConfig } from "../core/config/machine.ts";
import { KiokuError } from "../core/errors.ts";
import { startDetached } from "../core/session/background.ts";
import { loadEmbedder } from "../core/semantic/embedder.ts";
import { httpDownload } from "../core/semantic/install.ts";
import type { SemanticDeps } from "../core/semantic/meaning.ts";
import type { RecallTuning } from "../core/session/recall.ts";
import { runBrain } from "./brain.ts";
import { runPage } from "./page.ts";
import { runNamespace } from "./namespace.ts";
import { runConfig } from "./config.ts";
import { misuse, runHelp, unknownVerb, verbIn } from "./help.ts";
import { runCompletion } from "./completion.ts";
import {
  postToolUse,
  preCompact,
  preToolUse,
  sessionStart,
  sessionStartHolds,
  subagentStart,
  userPromptSubmit,
} from "./hook.ts";
import { runSync } from "./sync.ts";
import { runInit } from "./init.ts";
import { runDoctorVerb } from "./doctor.ts";
import { runPlugin } from "./plugin.ts";
import { runSetup } from "./setup.ts";
import { finishByBundle, runUpdate, type UpdateFinish, prepareByBundle } from "./update.ts";
import { paint, uiFor, type Ui } from "./render.ts";
import { progressFor, progressMode, type Progress } from "./progress.ts";
import { useSteps } from "../core/steps.ts";
import type { HookVerb } from "./verbs.ts";
import { personHome } from "./home.ts";

export { VERSION };

export interface Io {
  stdout: (text: string) => void;
  isTty: boolean;
  /** How wide the terminal is, when standard output is one. */
  columns?: number;
  /** Standard error is a terminal: where the steps of a verb that waits are shown (§6.1). Absent: it is not. */
  stderrTty?: boolean;
}

/** What a verb is given besides its arguments. */
export interface Context {
  /** The folder that holds `.kioku/`: the person's home, or the folder `KIOKU_HOME` names (§2.5). */
  home: string;
  /** Where the agent host keeps its own settings, `~/.claude`: the person's home even when `KIOKU_HOME` moves Kioku's. Absent: `home`. */
  hostHome?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The bundle file the tool is running from; absent when it runs from source. What `startBackground` runs. */
  bundle?: string;
  /** Everything on standard input; empty when it is a terminal. */
  stdin: () => Promise<string>;
  /** A person is at a terminal: both standard input and output are one. What a verb that must not run for an agent asks for. */
  interactive?: boolean;
  /** Ask the person a yes-or-no question at the terminal; yes when there is nobody to ask. */
  ask?: (question: string) => Promise<boolean>;
  /** The answer is JSON (`--json`, or standard output is not a terminal). */
  json?: boolean;
  /** Colour and width for the words a person reads; plain and 100 wide when absent. */
  ui?: Ui;
  /** Standard output, for a verb that says something while it runs, not only when it ends. */
  out?: (text: string) => void;
  now: () => Date;
  /** Start the tool with these arguments in the background and return at once (§4.2). */
  startBackground: (args: string[]) => void;
  /** Where the embedding engine and model come from, and how they load (§4.3). */
  semantic: SemanticDeps;
  /** Finish an update from the bundle just installed, `kioku update --finish` run from it (§6.4); absent, this process finishes it. */
  finishUpdate?: (bundle: string) => Promise<UpdateFinish>;
  /** Have the bundle just downloaded put its plugin beside it, `kioku update --prepare` run from it (§6.4); throws when it could not. */
  prepareUpdate?: (bundle: string) => Promise<void>;
  /** The version the files a brain refresh writes are taken to be (§2.7); absent, this build's. For tests. */
  version?: string;
  /** How a prompt's recall is tuned (§4.7); absent, as the spec says. For tests, which work on a few pages. */
  recall?: RecallTuning;
  /** The machine configuration, read at most once in this run: for the hooks, which write nothing to it. A verb that writes it reads the file. */
  machine?: () => MachineConfig | undefined;
}

/** What a verb answers: the data for `--json`, the words for a person, and the exit code when it is not 0. */
export interface Outcome {
  data: unknown;
  text: string;
  exit?: number;
  /** The text is what a program wants too, such as a script to source: JSON only when `--json` is asked for. */
  raw?: boolean;
}

export type Handler = (args: string[], ctx: Context) => Outcome | undefined | Promise<Outcome | undefined>;

// Hook subcommands read the host's JSON on stdin and answer in the host's format: one per hook the table declares.
const hookSubcommands = {
  "session-start": sessionStart,
  "session-start-holds": sessionStartHolds,
  "post-tool-use": postToolUse,
  "pre-tool-use": preToolUse,
  "user-prompt-submit": userPromptSubmit,
  "pre-compact": preCompact,
  "subagent-start": subagentStart,
} satisfies Record<HookVerb, Handler>;

const verbs: Record<string, Handler> = {
  hook: (args, ctx) => {
    // A hook this version does not know, which a newer plugin may call, answers nothing and ends with success (§6.2).
    const handler = (hookSubcommands as Partial<Record<string, Handler>>)[args[0] ?? ""];
    return handler === undefined ? undefined : handler(args.slice(1), ctx);
  },
  brain: runBrain,
  setup: runSetup,
  plugin: runPlugin,
  page: runPage,
  namespace: runNamespace,
  sync: runSync,
  init: runInit,
  doctor: runDoctorVerb,
  config: runConfig,
  update: runUpdate,
  help: runHelp,
  completion: runCompletion,
};

/** The verbs, by name, as data: a program that embeds the tool lists or mounts them instead of spawning it (§6.1). */
export const commands: Readonly<Record<string, Handler>> = verbs;

/**
 * The folder that holds `.kioku/` (§2.5): `KIOKU_HOME` when it is set, else the person's home. It replaces only
 * where Kioku keeps its own state and brains; the agents' settings stay in the person's home (`Context.hostHome`).
 */
export function kiokuHome(env: NodeJS.ProcessEnv, cwd: string): string {
  const given = env.KIOKU_HOME?.trim();
  if (given === undefined || given === "") return homedir();
  return isAbsolute(given) ? given : resolve(cwd, given);
}

export function defaultContext(bundle?: string): Context {
  return {
    home: kiokuHome(process.env, process.cwd()),
    hostHome: homedir(),
    cwd: process.cwd(),
    env: process.env,
    ...(bundle !== undefined && { bundle }),
    stdin: readStdin,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    now: () => new Date(),
    semantic: { download: httpDownload, loadEmbedder },
    finishUpdate: finishByBundle,
    prepareUpdate: prepareByBundle,
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
      } finally {
        rl.close();
      }
    },
    startBackground: (args) => {
      const script = bundle ?? process.argv[1];
      if (script !== undefined) startDetached(kiokuHome(process.env, process.cwd()), script, args, process.env);
    },
  };
}

/** The verb's words: what comes before the first flag (`page save` of `kioku page save --brain x --help`). */
function verbWords(argv: string[]): string[] {
  const words: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-")) break;
    words.push(a);
  }
  return words;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Runs the tool and returns the process exit code. */
export async function run(argv: string[], io: Io, ctx: Context = defaultContext()): Promise<number> {
  // What follows `--` is not the tool's own: `--json` there is left as it is.
  const end = argv.indexOf("--");
  const own = end === -1 ? argv : argv.slice(0, end);
  const json = own.includes("--json") || !io.isTty;
  const args = [...own.filter((a) => a !== "--json"), ...(end === -1 ? [] : argv.slice(end))];
  // `kioku` alone and `kioku --help` are `kioku help`; `--help` or `-h` after a verb is `kioku help <verb>` (§6.1).
  const asked = own.includes("--help") || own.includes("-h") ? ["help", ...verbWords(own)] : args;
  try {
    if (args[0] === "--version" || args[0] === "-v" || args[0] === "-V") {
      io.stdout(
        json
          ? `${JSON.stringify({ version: VERSION, contract: CLI_CONTRACT, formats: [...KNOWN_FORMATS] })}\n`
          : `${VERSION}\n`,
      );
      return 0;
    }
    const first = asked[0] ?? "help";
    const handler = verbs[first];
    if (!handler) throw unknownVerb(first);
    // Made here, so that a run shares it with nothing else, a call in the same process included.
    const machine = machineReader(ctx.home);
    const setting = colorSetting(machine);
    const ui = ctx.ui ?? uiFor(io.isTty, ctx.env, io.columns, personHome(ctx), setting);
    // The steps of a verb that waits (§6.1), for whichever part of the core waits.
    const progress: Progress = progressFor(
      progressMode({ json, stderrTty: io.stderrTty === true, env: ctx.env, setting }),
      ui,
      ctx.env,
    );
    const restore = useSteps(progress);
    let outcome: Outcome | undefined;
    try {
      outcome = await handler(asked.slice(1), { ...ctx, json, out: io.stdout, ui, machine });
    } finally {
      // On every path, before the answer or the error is printed: the worker that draws ends, and the steps before come back.
      progress.close();
      restore();
    }
    // A verb with nothing to say in text, such as one that has just handed the terminal back, prints no empty line.
    // A script to source is text even through a pipe; only `--json` asked for makes it JSON.
    const asJson = json && !(outcome?.raw === true && !own.includes("--json"));
    if (outcome !== undefined && (asJson || outcome.text !== ""))
      io.stdout(asJson ? `${JSON.stringify(outcome.data)}\n` : `${outcome.text}\n`);
    return outcome?.exit ?? 0;
  } catch (e) {
    const error =
      e instanceof KiokuError ? e : new KiokuError(1, "internal", e instanceof Error ? e.message : String(e));
    // A verb misused is told with its usage and where help says more (§6.1).
    const verb = error.code === "usage" ? verbIn(asked) : undefined;
    // An error goes to stderr: its colour is for whether stderr is a terminal.
    const ui = json
      ? undefined
      : uiFor(io.stderrTty === true, ctx.env, io.columns, "", colorSetting(machineReader(ctx.home)));
    const told = verb === undefined ? { text: error.message, message: error.message } : misuse(verb, error.message, ui);
    if (json) io.stdout(`${JSON.stringify({ error: { code: error.code, message: told.message } })}\n`);
    else process.stderr.write(`${ui === undefined ? "kioku:" : paint(ui).red("kioku:")} ${told.text}\n`);
    return error.exit;
  }
}

/** `display.color` from the machine configuration (§1.2); a configuration that cannot be read leaves it to the terminal. */
function colorSetting(machine: () => MachineConfig | undefined): DisplayColor | undefined {
  try {
    return machine()?.display?.color;
  } catch {
    return undefined;
  }
}
