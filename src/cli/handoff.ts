import { resolve } from "node:path";
import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { resolveChain } from "../core/config/chain.ts";
import { userError } from "../core/errors.ts";
import {
  clearHandoff,
  handoffsElsewhere,
  placeOf,
  readHandoff,
  setHandoff,
  type HandoffPage,
  type Place,
} from "../core/handoff.ts";
import { parseVerb } from "./args.ts";
import type { Handler } from "./run.ts";

/** The pages a handoff names, for a person: what the session that left it wrote and opened. */
const pagesText = (pages: HandoffPage[] | undefined): string =>
  pages === undefined || pages.length === 0
    ? ""
    : `\n\nPages that session wrote or opened:\n${pages.map((p) => `  ${p.did}: ${p.title} (${brainRepoOfKey(p.brain)}, ${p.path})`).join("\n")}`;

/** A place in a person's words: its folder, and its branch when it has one. */
const where = (p: Place): string => (p.branch === undefined ? p.folder : `${p.folder} on ${p.branch}`);

/**
 * `kioku handoff set|show|clear [--cwd <dir>] [--branch <b>]` (§4.8): where the last session of this place stopped, for
 * the next one, on this machine alone. `set` takes it on stdin, for the folder and the branch it is run in, and
 * replaces the one there was; `show` and `clear` take another branch of the folder with `--branch`.
 */
export const runHandoff: Handler = async (args, ctx) => {
  const { values, positionals } = parseVerb("handoff", args);
  const what = positionals[0];
  const cwd = resolve(ctx.cwd, values.cwd ?? ".");
  const config = ctx.machine?.();
  const here = placeOf(cwd, config === undefined ? undefined : resolveChain(cwd, config, ctx.home).root);
  if (what === "set") {
    if (values.branch !== undefined)
      throw userError("a handoff is left for the branch the folder is on; --branch is for show and clear", "usage");
    const left = setHandoff(ctx.home, here, await ctx.stdin(), ctx.now());
    return {
      data: { status: "done", folder: here.folder, branch: here.branch ?? null, at: left.at },
      text: `Left the handoff of ${where(here)}.`,
    };
  }
  const place: Place = values.branch === undefined ? here : { folder: here.folder, branch: values.branch };
  if (what === "clear") {
    const had = clearHandoff(ctx.home, place, ctx.now());
    return {
      data: { status: "done", folder: place.folder, branch: place.branch ?? null, cleared: had },
      text: had ? `Dropped the handoff of ${where(place)}.` : `${where(place)} had no handoff.`,
    };
  }
  if (what === "show") {
    const handoff = readHandoff(ctx.home, place, ctx.now());
    const elsewhere = handoffsElsewhere(ctx.home, place, ctx.now());
    const others =
      elsewhere.length === 0
        ? ""
        : `\n\nOther handoffs of this folder: ${elsewhere.map((e) => `${e.branch ?? "(no branch)"}, left ${e.at.slice(0, 10)}`).join("; ")} (kioku handoff show --branch <branch>).`;
    return {
      data: {
        folder: place.folder,
        branch: place.branch ?? null,
        handoff: handoff === undefined ? null : { ...handoff, pages: handoff.pages ?? [] },
        elsewhere,
      },
      text:
        handoff === undefined
          ? `${where(place)} has no handoff.${others}`
          : `Left ${handoff.at.slice(0, 10)} in ${where(place)}:\n\n${handoff.text}${pagesText(handoff.pages)}${others}`,
    };
  }
  throw userError("kioku handoff takes set, show or clear", "usage");
};
