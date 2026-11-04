import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { syncLogPath } from "../state.ts";

/**
 * Git may never stop to ask for a password: there is nobody to answer in the background. Its ssh asks for nothing
 * either, since every git call that reaches another machine runs with `NON_INTERACTIVE`.
 */
const NO_PROMPT_ENV: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };

/** Past this size the log starts over: it is for a person who looks at the last few commands, not a history. */
const LOG_LIMIT = 256 * 1024;

/**
 * Run the tool with `args` in a detached process, in `env`, and return at once (§4.2): the hook does not wait. Its output
 * goes to `~/.kioku/sync.log`, so nothing holds the hook's pipes open, after a line that says when and what: appended,
 * so that a second command in the same session does not wipe what the first wrote.
 */
export function startDetached(
  home: string,
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  now: Date = new Date(),
): void {
  mkdirSync(join(home, ".kioku"), { recursive: true });
  const path = syncLogPath(home);
  const log = openSync(path, (statSync(path, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT ? "w" : "a");
  try {
    writeSync(log, `--- ${now.toISOString()} kioku ${args.join(" ")}\n`);
    const child = spawn(process.execPath, [script, ...args], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...env, ...NO_PROMPT_ENV },
    });
    child.on("error", () => {});
    child.unref();
  } finally {
    closeSync(log);
  }
}
