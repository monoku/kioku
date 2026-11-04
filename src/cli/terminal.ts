import { userError } from "../core/errors.ts";
import type { Context } from "./run.ts";

/**
 * What a verb that is the person's to run asks first: an agent that ran a
 * command a page told it to run is not that person. Nothing has been written when this refuses.
 */
export function requireTerminal(ctx: Context, verb: string, why: string): void {
  if (!ctx.interactive) throw userError(`${verb} is for you to run in a terminal: ${why}`, "needs_terminal");
}
