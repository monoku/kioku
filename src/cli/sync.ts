import { resolve } from "node:path";
import { parseVerb } from "./args.ts";
import { syncChain } from "../core/sync.ts";
import { PLAIN, paint, table } from "./render.ts";
import type { Handler } from "./run.ts";

/** `kioku sync [--cwd <dir>]` (§4.2): what the `SessionStart` hook starts in the background, in the foreground. */
export const runSync: Handler = async (args, ctx) => {
  const { values } = parseVerb("sync", args);
  const cwd = resolve(ctx.cwd, values.cwd ?? ".");
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
