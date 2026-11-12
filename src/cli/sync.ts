import { resolve } from "node:path";
import { parseVerb } from "./args.ts";
import { syncChain } from "../core/sync.ts";
import { PLAIN, paint, table } from "./render.ts";
import type { Context, Handler } from "./run.ts";
import { acquireLock } from "../core/fs/lock.ts";
import { firstLine } from "../core/errors.ts";
import { forwardLockPath } from "../core/state.ts";
import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import type { RefreshResult } from "../core/brains/refresh.ts";
import {
  describeForwarded,
  forwardDue,
  raiseOwnBrain,
  recordForward,
  recordForwardFailed,
} from "../core/setup/forward.ts";
import { refreshBrains } from "./update.ts";
import { VERSION } from "../version.ts";

/** `kioku sync [--cwd <dir>]` (§4.2): what the `SessionStart` hook starts in the background, in the foreground. */
export const runSync: Handler = async (args, ctx) => {
  const { values } = parseVerb("sync", args);
  const cwd = resolve(ctx.cwd, values.cwd ?? ".");
  // A session's sync brings the machine forward to the version it runs first, when nothing did yet (§4.2, §6.4).
  if (values.background) await forwardInBackground(ctx);
  // By hand the wait for the engine and the model is a step a person watches, with its size (§4.2, §6.1).
  const r = await syncChain({
    home: ctx.home,
    cwd,
    now: ctx.now(),
    semantic: ctx.semantic,
    background: Boolean(values.background),
  });
  if (r.busy) return { data: r, text: "Another sync is running; nothing done." };
  const ui = ctx.ui ?? PLAIN;
  const p = paint(ui);
  const color = (status: string, cell: string): string =>
    status === "failed"
      ? p.red(cell)
      : status === "conflict"
        ? p.yellow(cell)
        : status === "pushed" || status === "pulled"
          ? p.green(cell)
          : p.dim(cell);
  const lines: string[] =
    r.outcomes.length === 0
      ? []
      : [
          table(
            ui,
            ["BRAIN", "STATUS", "NOTE"],
            r.outcomes.map((o) => [o.key, o.status, o.message ?? ""]),
            {
              style: (c, row, cell) =>
                row === -1
                  ? p.title(cell)
                  : c === 0
                    ? p.name(cell)
                    : c === 1
                      ? color(r.outcomes[row]!.status, cell)
                      : p.dim(cell),
            },
          ),
        ];
  const note = (label: string, text: string): void => void lines.push(`${p.dim(`${label}:`)} ${text}`);
  if (r.index && "failed" in r.index) note("index", p.red(`failed (${r.index.failed})`));
  else if (r.index)
    note("index", `${r.index.indexed} reindexed, ${r.index.removed} removed, ${r.index.unchanged} unchanged`);
  if (r.semantic?.mode === "hybrid") {
    note(
      "meaning",
      `${r.semantic.fetched.length > 0 ? `fetched the ${r.semantic.fetched.join(" and ")}, ` : ""}${r.semantic.embedded} page${r.semantic.embedded === 1 ? "" : "s"} embedded`,
    );
  } else if (r.semantic) note("meaning", `full text only (${r.semantic.reason})`);
  const failed = r.outcomes.some((o) => o.status === "failed");
  return { data: r, text: lines.length > 0 ? lines.join("\n") : "Nothing to sync.", ...(failed && { exit: 1 }) };
};

/**
 * The brains' half of bringing the machine forward (§6.4), from a session's `sync`: the person's own brain raised, every
 * brain refreshed, then the version recorded with what was done, for the next session to say. One at a time: a sync
 * that finds another doing it leaves it to that one. A step that fails is recorded with its reason, and the next
 * session's sync tries again.
 */
async function forwardInBackground(ctx: Context): Promise<void> {
  const version = ctx.version ?? VERSION;
  if (!forwardDue(ctx.home, version)) return;
  let lock: Awaited<ReturnType<typeof acquireLock>>;
  try {
    lock = await acquireLock(forwardLockPath(ctx.home), { timeoutMs: 0 });
  } catch {
    return;
  }
  try {
    if (!forwardDue(ctx.home, version)) return;
    const forwarded = await raiseOwnBrain(ctx.home, ctx.now());
    const refreshed = await refreshBrains(ctx);
    const brains = (refreshed as { brains?: RefreshResult[] } | null)?.brains ?? [];
    const lines = [
      ...describeForwarded(forwarded).map((s) => s.text),
      ...brains
        .filter((r) => r.written.length > 0)
        .map((r) => `Refreshed the files Kioku owns in ${brainRepoOfKey(r.brain)}: ${r.written.join(", ")}`),
    ];
    recordForward(ctx.home, version, lines);
  } catch (e) {
    recordForwardFailed(ctx.home, version, firstLine(e));
  } finally {
    lock.release();
  }
}
