import { allHarnesses } from "../harness/index.ts";
import type { Context } from "./run.ts";
import { personHome } from "./home.ts";

/**
 * How a write by this process arrives (§1.6), for the `Kioku-Via` trailer of its commit: `terminal` for a person at
 * one, else the id of the agent host whose environment this is, else `agent`.
 */
export function viaOf(ctx: Pick<Context, "interactive" | "env" | "home" | "hostHome">): string {
  if (ctx.interactive) return "terminal";
  return allHarnesses(personHome(ctx), ctx.env).find((h) => h.runsIn(ctx.env))?.id ?? "agent";
}
