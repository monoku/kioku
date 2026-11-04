import type { Context } from "./run.ts";

/**
 * The person's home: where the agent host keeps its settings and the installer lays the tool, even when `KIOKU_HOME`
 * moves Kioku's own state elsewhere (§2.5). `hostHome` when the context names it, else `home`.
 */
export const personHome = (ctx: Pick<Context, "home" | "hostHome">): string => ctx.hostHome ?? ctx.home;
