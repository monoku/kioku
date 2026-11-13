import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { parseSince, writesSince, type Write } from "../core/log.ts";
import { chainBrains, pickBrain } from "./chain.ts";
import { PLAIN, entry, paint, type Ui } from "./render.ts";
import type { Handler } from "./run.ts";
import { windowOf, windowing } from "../core/limit.ts";
import { moreLine } from "./window.ts";

/**
 * `kioku brain log [--since <when>] [--brain <b>] [--limit <n> [--offset <n>]]` (§6.1): the writes of the chain's
 * brains since a moment, today by default, newest first: verb, title, brain, path, date, author and commit, read from
 * each brain's history; 20 at a time.
 */
export const runLog: Handler = (args, ctx) => {
  const parsed = parseVerb("brain log", args);
  const sinceText = parsed.values.since ?? "today";
  const since = parseSince(sinceText, ctx.now());
  if (since === undefined)
    throw userError(
      `--since takes today, yesterday, a date such as 2026-10-01, or a span such as 12h, 3d or 2w: ${sinceText}`,
      "usage",
    );

  const chain = chainBrains(ctx);
  const brains =
    parsed.values.brain === undefined ? chain.filter((b) => b.cloned) : [pickBrain(chain, parsed.values.brain, ctx)];
  const { limit, offset } = windowOf(parsed.values.limit, parsed.values.offset);
  const all = writesOf(brains, since);
  const { part: writes, next } = windowing(all, offset, limit);
  const lines = writes.map((w) => describe(w, ctx.ui ?? PLAIN));
  const more = moreLine(all.length, offset, writes.length);
  if (more !== undefined) lines.push(more);
  const text =
    lines.length === 0
      ? paint(ctx.ui ?? PLAIN).dim(`Nothing written since ${since.toLocaleString()}.`)
      : lines.join("\n");
  return { data: { since: since.toISOString(), writes, total: all.length, offset, limit, next }, text };
};

/** The writes of these brains since a moment, newest first, each naming its brain; what `log` answers. */
function writesOf(brains: { key: string; root: string }[], since: Date): (Write & { brain: string })[] {
  return brains
    .flatMap((b) => writesSince(b.root, since).map((w): Write & { brain: string } => ({ ...w, brain: b.key })))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** A write as two lines: what was written, with the verb, the brain and the minute, and under it the path, who wrote it and how it arrived. */
function describe(w: Write & { brain: string }, ui: Ui): string {
  const meta = [w.verb, brainRepoOfKey(w.brain), w.date.slice(0, 16).replace("T", " ")].join(" · ");
  const replaces = w.replaces === undefined ? "" : ` · replaces ${w.replaces}`;
  const via = w.via === null ? "" : ` · via ${w.via}`;
  const into = w.into === undefined ? "" : ` · into ${w.into}`;
  return entry(ui, w.title, meta, [{ text: `${w.path} · ${w.author}${via}${replaces}${into}`, keepEnd: true }]);
}
