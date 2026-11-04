import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { userError } from "../core/errors.ts";
import { parseVerb } from "./args.ts";
import { changesOf, pagesOf } from "../core/pages.ts";
import { sourcesOf, type SourceRecord } from "../core/sources.ts";
import { chainBrains, pickBrain } from "./chain.ts";
import type { Handler } from "./run.ts";

/**
 * `kioku brain sources [<source>] [--brain <b>] [--all]` (§1.7): what has been ingested, derived from the
 * pages' `source` and `source_version`. With a source, the pages that come from it. Sessions are left out unless `--all`.
 */
export const runSources: Handler = (args, ctx) => {
  const parsed = parseVerb("brain sources", args);
  if (parsed.positionals.length > 1)
    throw userError("brain sources takes one source: give it as one argument, in quotes", "usage");
  const only = parsed.positionals[0]?.trim();
  if (only === "") throw userError("the source is empty", "usage");
  const chain = chainBrains(ctx);
  const brains =
    parsed.values.brain === undefined ? chain.filter((b) => b.cloned) : [pickBrain(chain, parsed.values.brain, ctx)];
  const sources = brains.flatMap((b) =>
    sourcesOf(pagesOf(b, changesOf(ctx.home, b)), {
      ...(parsed.values.all === true && { all: true }),
      ...(only !== undefined && { only }),
    }),
  );
  const text =
    sources.length === 0
      ? only === undefined
        ? "No sources."
        : `No page comes from "${only}".`
      : sources.map(describe).join("\n");
  return { data: { sources }, text };
};

function describe(s: SourceRecord): string {
  const version =
    s.version !== null
      ? `version ${s.version}`
      : s.versions.length === 0
        ? "no version"
        : `versions ${s.versions.join(", ")}, not all pages the same`;
  const head = `${brainRepoOfKey(s.brain)}: ${s.source} · ${s.count} page${s.count === 1 ? "" : "s"} · last ${s.last ?? "unknown"} · ${version}`;
  return s.pages === undefined
    ? head
    : `${head}\n${s.pages.map((p) => `  ${p.path}${p.source_version === null ? "" : ` @ ${p.source_version}`}  ${p.title}`).join("\n")}`;
}
