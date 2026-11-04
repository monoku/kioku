// The steps of a verb that waits, as a person at a terminal sees them (§6.1): the step running is one line with a
// drop that moves, the steps done stay dimmed above it. git runs with spawnSync, which holds this thread until it
// ends, so the drop is drawn by a worker thread; the two share a lock so that a line is never drawn half over
// another.
import { writeSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { LAVENDER, ORANGE } from "../core/brand.ts";
import type { DisplayColor } from "../core/config/machine.ts";
import { NO_STEPS, type StepWords, type Steps } from "../core/steps.ts";
import { clip, paint, tilde, uiFor, type Ui } from "./render.ts";

/** `animated`: a live line; `plain`: one line per step as it starts; `silent`: nothing, for JSON and anything that is not a person. */
export type ProgressMode = "animated" | "plain" | "silent";

/**
 * The steps say nothing when the answer is JSON (`--json`, or standard output is not a terminal) or standard error is
 * not a terminal; with no colour (`display.color`, `NO_COLOR`, `TERM=dumb`) they are plain lines, nothing redrawn.
 */
export function progressMode(o: {
  json: boolean;
  stderrTty: boolean;
  env: NodeJS.ProcessEnv;
  setting?: DisplayColor;
}): ProgressMode {
  if (o.json || !o.stderrTty) return "silent";
  return uiFor(true, o.env, undefined, "", o.setting).color && o.env.TERM !== "dumb" ? "animated" : "plain";
}

/** Steps a verb runs, and what is left to put back on the terminal when the verb ends. */
export interface Progress extends Steps {
  /** The verb has ended: a blank line sets what it says next, its answer or its error, apart from the steps above. */
  close(): void;
}

/** The step running is drawn only once it has lasted this long: a quick one shows only its line in the past. */
const DELAY_MS = 150;
const FRAME_MS = 110;
/** The drop, falling; rising is the same frames the other way. The footer's colours: lavender down, orange up. */
const FRAMES = ["˙", "·", ".", " "];

const stderr = (text: string): void => {
  writeSync(2, text);
};

export function progressFor(
  mode: ProgressMode,
  ui: Ui,
  env: NodeJS.ProcessEnv,
  write: (text: string) => void = stderr,
): Progress {
  if (mode === "silent") return { ...NO_STEPS, close: () => {} };
  if (mode === "plain") return plain(ui, env.TERM === "dumb" ? "-" : "⬢", write);
  return animated(ui, write);
}

/**
 * A step's words in `max` characters: a path under the home is written `~/…`, and when that is not enough the last
 * path is cut at its start, so its end stays, as the tool's other text does; then the words are cut at their end.
 */
export function fit(ui: Ui, text: string, max: number): string {
  const words =
    ui.home === ""
      ? text
      : text
          .split(" ")
          .map((w) => tilde(ui, w))
          .join(" ");
  if (words.length <= max) return words;
  const at = words.lastIndexOf(" ") + 1;
  const path = words.slice(at);
  if (!path.includes("/")) return clip(words, max);
  const room = max - at;
  return room >= 12 ? `${words.slice(0, at)}${clip(path, room, true)}` : clip(words, max);
}

const doneText = <T>(words: StepWords<T>, result: T): string =>
  typeof words.done === "function" ? words.done(result) : words.done;

function plain(ui: Ui, icon: string, write: (text: string) => void): Progress {
  let shown = false;
  let depth = 0;
  // A step inside another is the outer one's work, not a line of its own.
  const start = (words: StepWords<unknown>): void => {
    if (depth++ > 0) return;
    shown = true;
    write(`${icon} ${fit(ui, words.doing, ui.columns - 3)}…\n`);
  };
  return {
    run(words, work) {
      start(words as StepWords<unknown>);
      try {
        return work();
      } finally {
        depth--;
      }
    },
    async runAsync(words, work) {
      start(words as StepWords<unknown>);
      try {
        return await work();
      } finally {
        depth--;
      }
    },
    close: () => {
      if (shown) write("\n");
      shown = false;
    },
  };
}

// The worker draws the step running, after DELAY_MS, every FRAME_MS, while the shared slot still names that step.
// It is CommonJS evaluated from this text, so the bundle needs no file beside it.
const WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const { writeSync } = require("node:fs");
const shared = new Int32Array(workerData.buffer);
const { frames, delay, every, colours } = workerData;
let step;
parentPort.on("message", (m) => { step = { ...m, since: Date.now(), frame: 0 }; });
setInterval(() => {
  if (step === undefined || Atomics.load(shared, 0) !== step.id || Date.now() - step.since < delay) return;
  while (Atomics.compareExchange(shared, 1, 0, 1) !== 0);
  try {
    if (Atomics.load(shared, 0) === step.id) {
      const order = step.direction === "down" ? frames : [...frames].reverse();
      const drop = order[step.frame++ % order.length];
      writeSync(2, "\\r\\x1b[2K\\x1b[1;" + colours[step.direction] + "m" + drop + "\\x1b[0m " + step.label + "…");
    }
  } finally {
    Atomics.store(shared, 1, 0);
  }
}, every);
`;

function animated(ui: Ui, write: (text: string) => void): Progress {
  const p = paint(ui);
  // [0]: the step being drawn, 0 for none; [1]: the lock around a write to the terminal.
  const shared = new Int32Array(new SharedArrayBuffer(8));
  let worker: Worker | undefined;
  let next = 1;
  let depth = 0;
  let shown = false;
  const lock = () => {
    while (Atomics.compareExchange(shared, 1, 0, 1) !== 0);
  };
  const unlock = () => Atomics.store(shared, 1, 0);
  // Stopped midway, the verb leaves no half-drawn line and gives the cursor back.
  const interrupted = () => {
    end("");
    stop();
    process.exit(130);
  };
  // The cursor hides while a step is drawn and comes back after it, so a question between steps has one.
  const begin = (words: StepWords<unknown>): void => {
    if (worker === undefined) {
      worker = new Worker(WORKER, {
        eval: true,
        workerData: {
          buffer: shared.buffer,
          frames: FRAMES,
          delay: DELAY_MS,
          every: FRAME_MS,
          colours: { down: LAVENDER, up: ORANGE },
        },
      });
      worker.unref();
      process.once("SIGINT", interrupted);
    }
    shown = true;
    write("\x1b[?25l");
    const id = next++;
    worker.postMessage({ id, label: fit(ui, words.doing, ui.columns - 3), direction: words.direction });
    Atomics.store(shared, 0, id);
  };
  const end = (line: string) => {
    lock();
    try {
      Atomics.store(shared, 0, 0);
      write(`\r\x1b[2K${line === "" ? "" : `${line}\n`}\x1b[?25h`);
    } finally {
      unlock();
    }
  };
  const ended = <T>(words: StepWords<T>, result: T) => {
    const text = fit(ui, doneText(words, result), ui.columns - 2);
    end(words.failed?.(result) === true ? p.red(`✕ ${text}`) : `${p.dim("✓")} ${p.dim(text)}`);
  };
  const failed = (words: StepWords<unknown>) => end(p.red(`✕ ${fit(ui, words.doing, ui.columns - 2)}`));
  const stop = () => {
    if (worker === undefined) return;
    void worker.terminate();
    worker = undefined;
    process.removeListener("SIGINT", interrupted);
  };
  return {
    run(words, work) {
      // A step inside another is the outer one's work, not a line of its own.
      if (depth > 0) return work();
      depth++;
      begin(words as StepWords<unknown>);
      let result;
      try {
        result = work();
      } catch (e) {
        failed(words as StepWords<unknown>);
        throw e;
      } finally {
        depth--;
      }
      ended(words, result);
      return result;
    },
    async runAsync(words, work) {
      if (depth > 0) return work();
      depth++;
      begin(words as StepWords<unknown>);
      let result;
      try {
        result = await work();
      } catch (e) {
        failed(words as StepWords<unknown>);
        throw e;
      } finally {
        depth--;
      }
      ended(words, result);
      return result;
    },
    close: () => {
      stop();
      if (shown) write("\n");
      shown = false;
    },
  };
}
