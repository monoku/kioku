import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { cappedReport, lintBrains, recordLint, STALE_INSTINCT_DAYS, type LintReport } from "../core/lint.ts";
import { windowOf } from "../core/limit.ts";
import { brainKeyOf, brainsNamed } from "./brains-named.ts";
import { chainBrains } from "./chain.ts";
import { PLAIN, paint, plural, type Ui } from "./render.ts";
import type { Context, Outcome } from "./run.ts";

/**
 * `kioku brain lint [<brain>] [--limit <n>]` (§4.4, §6.1): the brain's review, recorded for the summary when the machine
 * knows the brain; each list shows its first 20 entries and says how many it has (bounded answers).
 */
export async function runBrainLint(argv: string[], ctx: Context): Promise<Outcome> {
  const parsed = parseVerb("brain lint", argv);
  const args = parsed.positionals;
  const { limit } = windowOf(parsed.values.limit, undefined);
  if (args.length > 1) throw userError("brain lint takes at most one brain", "usage");
  const chain = chainBrains(ctx);
  const roots = brainsNamed(args[0], ctx, "lint");
  const targets = roots.map((root) => {
    const link = chain.find((b) => b.root === root);
    return {
      key: brainKeyOf(chain, root),
      root,
      known: link !== undefined,
    };
  });
  const reports = await lintBrains(ctx.home, targets, ctx.now());
  await recordLint(
    ctx.home,
    targets.flatMap((t, i) => (t.known ? [{ key: t.key, report: reports[i]! }] : [])),
    ctx.now(),
  );
  const shown = reports.map((r) => cappedReport(r, limit));
  return { data: { brains: shown }, text: shown.map((r) => describeLint(r, ctx.ui ?? PLAIN)).join("\n\n") };
}

function describeLint(r: LintReport & { totals?: Record<string, number> }, ui: Ui): string {
  const p = paint(ui);
  const lines = [
    `${p.name(brainRepoOfKey(r.brain))}  ${r.count === 0 ? p.green("nothing to review") : p.yellow(`${plural(r.count, "thing")} to review`)}`,
  ];
  const group = (title: string, items: string[], list?: string) => {
    const total = list === undefined ? undefined : r.totals?.[list];
    if (items.length > 0)
      lines.push(
        `  ${p.title(title)}${total === undefined ? "" : p.dim(` (${items.length} of ${total})`)}`,
        ...items.map((i) => `    ${i}`),
      );
  };
  group(
    "similar pages",
    r.similar.map((s) => `${s.a} ~ ${s.b}`),
    "similar",
  );
  group(
    `instincts with no occasion in ${STALE_INSTINCT_DAYS} days`,
    r.staleInstincts.map((s) => `${s.path} (last ${s.last ?? "never"})`),
    "staleInstincts",
  );
  group(
    "superseded decisions",
    r.superseded.map((s) => `${s.path}${s.by ? ` (by ${s.by})` : ""}`),
    "superseded",
  );
  group(
    "links whose target is gone",
    r.brokenLinks.map((b) => `${b.path} -> ${b.target}`),
    "brokenLinks",
  );
  group("pages without summary", r.missingSummary, "missingSummary");
  group(
    "Skill candidates",
    r.skillCandidates.map((c) => `${c.path} (${c.occasions} occasions)`),
    "skillCandidates",
  );
  group(
    "pages past their stale_after date",
    (r.expired ?? []).map((e) => `${e.path} (since ${e.stale_after})`),
    "expired",
  );
  group(
    "pages not changed or confirmed for a long time",
    (r.unconfirmed ?? []).map((u) => `${u.path} (${u.days} days since ${u.since})`),
    "unconfirmed",
  );
  group(
    "pages that link to a retired page",
    (r.retiredLinks ?? []).map((l) => `${l.path} -> ${l.target}`),
    "retiredLinks",
  );
  group(
    "contradictions nobody has settled",
    (r.contradictions ?? []).map((c) => `${c.a} <-> ${c.b}`),
    "contradictions",
  );
  group(
    `pages this machine has not opened${r.counting_since ? ` (counting since ${r.counting_since})` : ""}`,
    (r.unopened ?? []).map(
      (u) => `${u.path} (${u.days} days since ${u.since}${u.surfaced > 0 ? `, offered ${u.surfaced}` : ""})`,
    ),
    "unopened",
  );
  group("namespaces that do not say what they are for (kioku namespace describe)", r.undescribed ?? [], "undescribed");
  group(
    "changes of yours that conflicted with what others published (kioku brain conflicts)",
    (r.conflicts ?? []).map((c) => `${c.branch}: ${c.pages.join(", ") || "no page differs now"}`),
    "conflicts",
  );
  return lines.join("\n");
}
