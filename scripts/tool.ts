/**
 * The one way the repository's own scripts and tests run the tool in this process: the test world, the demo's maker and
 * check, and the bench's preparation. What the bench measures is not run here: a real call is a new process, whose start counts.
 */
import { defaultContext, run } from "../src/cli/run.ts";
import type { Context } from "../src/cli/run.ts";

/** Runs the tool with a context, and answers its exit code and what it wrote. */
export async function runTool(argv: string[], context: Context, tty = false): Promise<{ code: number; raw: string }> {
  let raw = "";
  const code = await run(argv, { stdout: (text) => (raw += text), isTty: tty }, context);
  return { code, raw };
}

/** The last line a `--json` run wrote: its answer. */
export const answerOf = (raw: string): any => JSON.parse(raw.trim().split("\n").at(-1)!);

/** The machine's context against another home and folder, which starts nothing in the background. */
export const contextIn = (home: string, cwd: string, more: Partial<Context> = {}): Context => ({
  ...defaultContext(),
  home,
  cwd,
  startBackground: () => {},
  ...more,
});
