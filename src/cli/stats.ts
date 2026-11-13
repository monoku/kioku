import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { parseSince, writesSince } from "../core/log.ts";
import { lintBrains } from "../core/lint.ts";
import { readReads } from "../core/reads.ts";
import { readStatsOf, statsOf, UNKNOWN_VIA, type BrainStats, type ReadStats } from "../core/stats.ts";
import { chainBrains, pickBrain } from "./chain.ts";
import { PLAIN, paint, table, type Ui } from "./render.ts";
import type { Handler } from "./run.ts";

/**
 * `kioku brain stats [--since <when>] [--brain <b>]` (§6.1): what the writes of the chain's brains over a span add
 * up to, `30d` by default, read from each brain's history as `log` is. No author is named.
 */
export const runStats: Handler = async (args, ctx) => {
  const parsed = parseVerb("brain stats", args);
  const sinceText = parsed.values.since ?? "30d";
  const since = parseSince(sinceText, ctx.now());
  if (since === undefined)
    throw userError(
      `--since takes today, yesterday, a date such as 2026-10-01, or a span such as 12h, 3d or 2w: ${sinceText}`,
      "usage",
    );

  const chain = chainBrains(ctx);
  const brains =
    parsed.values.brain === undefined ? chain.filter((b) => b.cloned) : [pickBrain(chain, parsed.values.brain, ctx)];
  // What this machine counted of the pages it opens (§4.5).
  const reads = readReads(ctx.home);
  const reports = await lintBrains(
    ctx.home,
    brains.map((b) => ({ key: b.key, root: b.root })),
    ctx.now(),
  );
  const stats = brains.map((b, i) => ({
    brain: b.key,
    ...statsOf(writesSince(b.root, since)),
    ...readStatsOf(reads, b.key, reports[i]?.unopened.length ?? 0),
  }));
  const text = stats.length === 0 ? "No brain to read." : describe(stats, since, ctx.ui ?? PLAIN);
  return { data: { since: since.toISOString(), brains: stats }, text };
};

/** One row per brain, counts in columns with the zeros dimmed; the opens are said only when this machine counts them. */
function describe(all: (BrainStats & ReadStats & { brain: string })[], since: Date, ui: Ui): string {
  const p = paint(ui);
  const counting = all.some((s) => s.counting_since !== null);
  const head = [
    "BRAIN",
    "WRITES",
    "SAVED",
    "UPDATED",
    "SUPERSEDED",
    "CONFIRMED",
    "FORGOTTEN",
    ...(counting ? ["OPENED", "UNOPENED", "RECALLED", "FOLLOWED"] : []),
  ];
  const rows = all.map((s) => [
    brainRepoOfKey(s.brain),
    String(s.writes),
    String(s.saved),
    String(s.by_verb.update),
    String(s.by_verb.supersede),
    String(s.by_verb.confirm),
    String(s.by_verb.forget),
    ...(counting
      ? s.counting_since === null
        ? ["-", "-", "-", "-"]
        : [String(s.opened), String(s.unopened), String(s.recalled), String(s.followed)]
      : []),
  ]);
  const out = [
    p.title(`Writes since ${since.toISOString().slice(0, 10)}`),
    "",
    table(ui, head, rows, {
      right: head.map((_, c) => c).slice(1),
      style: (c, r, cell) =>
        r === -1 ? p.title(cell) : c === 0 ? p.name(cell) : cell.trim() === "0" ? p.dim(cell) : cell,
    }),
  ];
  // How the writes arrived, when any commit says: never by person (§6.1).
  if (all.some((s) => Object.keys(s.by_via).some((v) => v !== UNKNOWN_VIA))) {
    const vhead = ["BRAIN", "VIA", "WRITES", "SAVED", "FORGOTTEN"];
    const vrows = all.flatMap((s) =>
      Object.entries(s.by_via).map(([via, v]) => [
        brainRepoOfKey(s.brain),
        via,
        String(v.writes),
        String(v.saved),
        String(v.reverted),
      ]),
    );
    out.push(
      "",
      table(ui, vhead, vrows, {
        right: [2, 3, 4],
        style: (c, r, cell) =>
          r === -1 ? p.title(cell) : c === 0 ? p.name(cell) : cell.trim() === "0" ? p.dim(cell) : cell,
      }),
    );
  }
  const since_ = all.find((s) => s.counting_since !== null)?.counting_since;
  if (since_ !== undefined && since_ !== null)
    out.push(
      "",
      p.dim(
        `Opens are counted on this machine since ${since_}; recalled is the times a prompt or a file brought a page, followed the times the session then opened it.`,
      ),
    );
  return out.join("\n");
}
