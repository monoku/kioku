import { brainRepoOfKey } from "../config/brain-ref.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFrontPageAt } from "../brain/brain.ts";
import { parseBrainFile } from "../brain/file.ts";
import { isRetired } from "../brain/lifecycle.ts";
import { placementOf } from "../brain/kinds.ts";
import { afterCommit, userError } from "../errors.ts";
import type { TargetBrain } from "./apply.ts";
import type { WriteContext } from "./apply.ts";
import { forget, retire, save, type Done, type NeedsNamespace, type Similar } from "./verbs.ts";

/** How specific a tier is: a page is promoted up this scale, never down or across (§1.3). */
const RANK = { personal: 0, project: 1, team: 2 } as const;

export interface PromoteInput {
  /** The page as it should read in the destination: words fit for that brain (§1.3). */
  body: string;
  title?: string;
  summary?: string;
  aliases?: string[];
  namespace?: string;
  /** A short quote, when a person said it; never copied from the page being promoted, which may hold what is for one brain only. */
  evidence?: string;
  /** Write even when the destination has pages on the same subject (§1.4). */
  create?: boolean;
  /** What happens to the original: `retire` (the default; it stays, no longer current), `forget`, or `keep`. */
  original?: "retire" | "forget" | "keep";
}

export interface Promoted extends Done {
  /** What was done to the page that was promoted. */
  promotedFrom: { brain: string; path: string; action: "retired" | "forgotten" | "kept" | "already retired" };
}

/**
 * `kioku page promote <path> --to <brain>` (§1.3): a page of a more personal brain, written again for a more
 * shared one. The new page goes through `save`, so the destination's own rules apply: similar pages are returned
 * instead of writing, the validator keeps secrets out, and a shared brain publishes. Then the original is retired
 * (or forgotten, or kept), in its own brain: two commits in two repositories, destination first, so a failure leaves
 * the page in both places and never in neither.
 */
export async function promote(
  from: TargetBrain,
  rel: string,
  to: TargetBrain,
  input: PromoteInput,
  env: WriteContext,
): Promise<Promoted | Similar | NeedsNamespace> {
  if (RANK[to.tier] <= RANK[from.tier]) {
    throw userError(
      `${brainRepoOfKey(from.key)} is a ${from.tier} brain and ${brainRepoOfKey(to.key)} a ${to.tier} one; a page is promoted to a more shared brain (personal, project, team)`,
      "not_up",
    );
  }
  const path = join(from.root, rel);
  const place = placementOf(rel);
  if (!existsSync(path) || place === undefined || isFrontPageAt(rel))
    throw userError(`${rel} is not a page of ${brainRepoOfKey(from.key)}`, "not_a_page");
  const parsed = parseBrainFile(readFileSync(path, "utf8"));
  if (!parsed.ok) throw userError(`${rel} cannot be read: ${parsed.reason}`, "not_a_page");
  if (isRetired(parsed.file.front) && input.original !== "keep") {
    throw userError(`${rel} is retired; a page that is no longer current is not promoted`, "retired");
  }
  if (input.body.trim() === "")
    throw userError("the page's body, written for the destination, comes on stdin", "usage");
  if (place.kind === "skill")
    throw userError(
      "Skills come from evolving instincts in the brain that holds them; evolve there, or write the Skill in the destination",
      "usage",
    );

  const front = parsed.file.front;
  const title = input.title ?? front.getString("title") ?? rel;
  const summary = input.summary ?? front.getString("summary");
  const aliases = input.aliases ?? front.getList("aliases");
  const result = await save(
    to,
    {
      kind: place.kind,
      ...(place.sub !== undefined && { sub: place.sub }),
      title,
      source: `Promoted from ${brainRepoOfKey(from.key)}: ${rel}`,
      ...(summary !== undefined && { summary }),
      ...(aliases !== undefined && aliases.length > 0 && { aliases }),
      ...(input.namespace !== undefined && { namespace: input.namespace }),
      ...(input.evidence !== undefined && { evidence: input.evidence }),
      body: input.body,
      ...(input.create === true && { create: true }),
    },
    env,
  );
  if (result.status === "similar" || result.status === "namespace") return result;

  const original = input.original ?? "retire";
  let action: Promoted["promotedFrom"]["action"] = "kept";
  try {
    if (original === "forget") {
      await forget(from, rel, env);
      action = "forgotten";
    } else if (original === "retire") {
      if (isRetired(front)) action = "already retired";
      else {
        await retire(from, rel, { reason: `Promoted to ${brainRepoOfKey(to.key)}: ${title}` }, env);
        action = "retired";
      }
    }
  } catch (e) {
    // The page is in the destination, commit and all: the answer says so beside why the original stayed (§1.6).
    afterCommit(
      e,
      { brain: result.brain, path: result.path, commit: result.commit, publication: result.publication },
      `the page is in ${brainRepoOfKey(to.key)} (commit ${result.commit}) and the original ${rel} is still in ${brainRepoOfKey(from.key)} as it was`,
    );
  }
  return { ...result, promotedFrom: { brain: from.key, path: rel, action } };
}
