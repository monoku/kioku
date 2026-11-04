import { brainRepoOfKey } from "../core/config/brain-ref.ts";
import { sectionBody, sectionsOf } from "../core/brain/file.ts";
import { userError } from "../core/errors.ts";
import { changesOf, pagesOf, showPage, type PageRecord, type ShownPage } from "../core/pages.ts";
import { recordOpened } from "../core/reads.ts";
import { parseVerb } from "./args.ts";
import { chainBrains, locate, pickBrain } from "./chain.ts";
import { windowOf, windowing } from "../core/limit.ts";
import { moreLine } from "./window.ts";
import { PLAIN, entry, type Ui } from "./render.ts";
import type { Handler } from "./run.ts";

/**
 * `kioku page list [--brain <b>] [--kind <k>] [--namespace <ns>] [--limit <n> [--offset <n>]] [--fields <a,b>] [--count]`
 * (§1.2, §6.1): every page of the chain's brains, or of one, with its fields, last touch and links; or a
 * window of them, 20 by default, so that a brain of thousands is read a piece at a time.
 */
export const runPages: Handler = (args, ctx) => {
  const parsed = parseVerb("page list", args);
  const v = parsed.values;
  const { limit, offset } = windowOf(v.limit, v.offset);
  const chain = chainBrains(ctx);
  const brains = v.brain === undefined ? chain.filter((b) => b.cloned) : [pickBrain(chain, v.brain, ctx)];
  let pages = brains.flatMap((b) => pagesOf(b, changesOf(ctx.home, b)));
  if (v.kind !== undefined) pages = pages.filter((p) => p.kind === v.kind);
  if (v.namespace !== undefined) pages = pages.filter((p) => p.namespace === v.namespace);
  const total = pages.length;

  if (v.count) return { data: { total }, text: `${total} page${total === 1 ? "" : "s"}` };

  let fields: string[] | undefined;
  if (v.fields !== undefined) {
    fields = v.fields
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f !== "");
    const known = pages[0] === undefined ? [] : Object.keys(pages[0]);
    const unknown = fields.filter((f) => pages[0] !== undefined && !known.includes(f));
    if (unknown.length > 0)
      throw userError(`unknown field ${unknown.join(", ")}; a page has ${known.join(", ")}`, "fields_unknown");
  }
  const { part, next } = windowing(pages, offset, limit);
  const shown =
    fields === undefined
      ? part
      : part.map((p) =>
          Object.fromEntries(
            ["brain", "path", ...fields!.filter((f) => f !== "brain" && f !== "path")].map((f) => [
              f,
              (p as unknown as Record<string, unknown>)[f],
            ]),
          ),
        );
  const lines = part.map((p) => describe(p, ctx.ui ?? PLAIN));
  const more = moreLine(total, offset, part.length);
  if (more !== undefined) lines.push(more);
  return {
    data: { pages: shown, total, offset, limit, next },
    text: lines.length === 0 ? nothingIn("No pages", brains) : lines.join("\n"),
  };
};

/**
 * `kioku page show <path> [--brain <b>] [--section <name> | --outline | --head <n>]` (§6.1): one page, the same fields,
 * its body and its history (§3.3). One slice of a long page can be asked for instead of the whole: a section, the
 * outline of its sections, or its first lines; the fields and the history stay.
 */
export const runShow: Handler = (args, ctx) => {
  const parsed = parseVerb("page show", args);
  if (parsed.positionals.length !== 1) throw userError("give the page's path", "usage");
  const slices = [parsed.values.section, parsed.values.outline, parsed.values.head].filter((v) => v !== undefined);
  if (slices.length > 1) throw userError("--section, --outline and --head are one slice each: pass one", "usage");
  const head = parsed.values.head === undefined ? undefined : Number(parsed.values.head);
  if (head !== undefined && (!Number.isInteger(head) || head < 1))
    throw userError("--head takes a whole number of lines, at least 1", "usage");

  const where = locate(ctx, parsed.positionals[0]!, parsed.values.brain);
  const page = showPage(where.brain, where.rel, changesOf(ctx.home, where.brain));
  if (page === undefined)
    throw userError(`${where.rel} is not a page of ${brainRepoOfKey(where.brain.key)}`, "not_a_page");
  // Opening a page is counted (§4.5), whole or in part; a count never fails a read.
  try {
    recordOpened(ctx.home, ctx.now(), where.brain.key, page.id);
  } catch {
    /* a count is only a count */
  }

  let shown: ShownPage & { slice?: Record<string, unknown> } = page;
  if (parsed.values.section !== undefined) {
    const text = sectionBody(page.body, parsed.values.section);
    if (text === undefined) {
      throw userError(
        `${where.rel} has no section "${parsed.values.section}"; it has ${
          sectionsOf(page.body)
            .map((s) => `"${s}"`)
            .join(", ") || "none"
        }`,
        "section_not_found",
      );
    }
    shown = { ...page, body: text, slice: { section: parsed.values.section } };
  } else if (parsed.values.outline) {
    const outline = sectionsOf(page.body);
    shown = { ...page, body: outline.map((s) => `## ${s}`).join("\n"), slice: { outline } };
  } else if (head !== undefined) {
    const lines = page.body.split("\n");
    shown = {
      ...page,
      body: lines.slice(0, head).join("\n"),
      slice: { head, lines: lines.length, truncated: lines.length > head },
    };
  }

  const { body, history, slice: _slice, ...record } = shown;
  const fields = (Object.entries(record) as [string, unknown][])
    .filter(
      ([k, v]) => k !== "brain" && k !== "path" && k !== "title" && v !== null && !(Array.isArray(v) && v.length === 0),
    )
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  const log =
    history.length === 0
      ? ""
      : `\n\nhistory:\n${history.map((h) => `  ${h.date}  ${h.commit.slice(0, 7)}  ${h.author}: ${h.message}`).join("\n")}`;
  const cut =
    shown.slice?.truncated === true
      ? `\n[… ${(shown.slice.lines as number) - (shown.slice.head as number)} more lines; kioku page show --section reads one part]`
      : "";
  return { data: shown, text: `${headline(record)}\n${fields.join("\n")}\n\n${body.trimEnd()}${cut}${log}` };
};

/** A page as one line, for the top of what `show` prints. */
function headline(p: PageRecord): string {
  const kind = p.subkind ? `${p.kind}/${p.subkind}` : (p.kind ?? "?");
  return `${brainRepoOfKey(p.brain)}: ${p.path} (${kind}) ${p.title}${p.touched ? ` · touched ${p.touched}` : ""}`;
}

/** A page as two lines: its title, with where it is from and when it was touched, and under it the path `show` takes. */
function describe(p: PageRecord, ui: Ui): string {
  const meta = [p.brain, p.subkind ?? p.kind ?? "?", ...(p.touched ? [p.touched] : [])].join(" · ");
  return entry(ui, p.title, meta, [{ text: p.path, keepEnd: true }]);
}

/** An answer with nothing to list says where it looked (§6.1): `No pages in sam/brain (personal), northwind/brain-acme (project).` */
export const nothingIn = (what: string, brains: { key: string; tier: string }[]): string =>
  brains.length === 0
    ? `${what}: no brain is loaded here (kioku brain create makes your personal brain, kioku brain clone brings it).`
    : `${what} in ${brains.map((b) => `${brainRepoOfKey(b.key)} (${b.tier})`).join(", ")}.`;
