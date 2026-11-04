import { colorFor, LAVENDER, ORANGE, sgr } from "../core/brand.ts";
import type { DisplayColor } from "../core/config/machine.ts";

// How a verb's words look to a person at a terminal (§6.1). Nothing here reads the environment: the outermost layer
// decides whether there is colour and how wide the terminal is, and hands it in as a `Ui`.

/** What a verb is told about the terminal its words go to. */
export interface Ui {
  color: boolean;
  /** Characters across; the widest line a verb should print. */
  columns: number;
  /** The person's home folder, so that a path under it is written `~/…`. */
  home: string;
}

/** No colour, 100 columns, no home: what a test or a pipe gets. */
export const PLAIN: Ui = { color: false, columns: 100, home: "" };

/**
 * Colour is for a terminal, unless the person asked for none (https://no-color.org); `display.color` (§1.2) can say
 * `always` or `never` instead.
 */
export function uiFor(
  isTty: boolean,
  env: NodeJS.ProcessEnv,
  columns: number | undefined,
  home: string,
  setting?: DisplayColor,
): Ui {
  const color = colorFor(setting, env, isTty);
  return { color, columns: columns !== undefined && columns >= 40 ? columns : 100, home };
}

export interface Paint {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  /** The brand's two colours (§1.2). */
  orange: (s: string) => string;
  lavender: (s: string) => string;
  /** A title: a section's, a table's header. Bold, in lavender. */
  title: (s: string) => string;
  /** The name of what a line is about: a verb, a brain, a page, a key. Bold, in orange. */
  name: (s: string) => string;
}

export function paint(ui: Ui): Paint {
  const wrap = (open: number, close: number) => sgr(ui.color, open, close);
  const bold = wrap(1, 22);
  return {
    bold,
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    orange: sgr(ui.color, ORANGE, 39),
    lavender: sgr(ui.color, LAVENDER, 39),
    title: (s) => bold(sgr(ui.color, LAVENDER, 39)(s)),
    name: (s) => bold(sgr(ui.color, ORANGE, 39)(s)),
  };
}

/** A path under the person's home is written `~/…`. */
export { plural } from "../core/util.ts";

export function tilde(ui: Ui, path: string): string {
  return ui.home !== "" && (path === ui.home || path.startsWith(`${ui.home}/`))
    ? `~${path.slice(ui.home.length)}`
    : path;
}

/** The text cut to `max` characters, ending in `…` when it was cut; from the start when `fromStart`, as a path keeps its end. */
export function clip(text: string, max: number, fromStart = false): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - 1);
  return fromStart ? `…${text.slice(text.length - room)}` : `${text.slice(0, room)}…`;
}

/** A remote written the short way: without its scheme or its `.git`. */
export function shortRemote(url: string): string {
  return url
    .replace(/^(https?|ssh|git):\/\//, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/\.git$/, "");
}

export interface TableOptions {
  /** Columns whose cells line up on their right edge, such as counts. */
  right?: number[];
  /** Columns that keep their end when cut, such as a path. */
  keepEnd?: number[];
  /** Gives a cell its look once it has been padded. */
  style?: (column: number, row: number, padded: string) => string;
  /** Written before every line. */
  indent?: string;
}

/**
 * Rows in columns that line up. The header is the first row, and `style` gets `row` -1 for it. When the table is wider
 * than the terminal the widest column gives up width first, and its cells are cut.
 */
export function table(ui: Ui, head: string[], rows: string[][], options: TableOptions = {}): string {
  const gap = 2;
  const indent = options.indent ?? "";
  const all = [head, ...rows];
  const widths = head.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
  const total = () => indent.length + widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  while (total() > ui.columns) {
    let widest = 0;
    widths.forEach((w, c) => {
      if (w > widths[widest]!) widest = c;
    });
    if (widths[widest]! <= Math.max(8, head[widest]!.length)) break;
    widths[widest]!--;
  }
  const line = (cells: string[], row: number): string => {
    // The cells after the last one with something in it are not written, and the last one is not padded: no trailing spaces.
    let last = cells.length - 1;
    while (last > 0 && (cells[last] ?? "") === "") last--;
    const out = cells.slice(0, last + 1).map((cell, c) => {
      const shown = clip(cell, widths[c]!, options.keepEnd?.includes(c));
      const padded = options.right?.includes(c)
        ? shown.padStart(widths[c]!)
        : c === last
          ? shown
          : shown.padEnd(widths[c]!);
      return options.style ? options.style(c, row, padded) : padded;
    });
    return `${indent}${out.join(" ".repeat(gap))}`;
  };
  return [line(head, -1), ...rows.map((r, i) => line(r, i))].join("\n");
}

/**
 * An item with a name, such as a page, as lines: the title on the left with what it is on the right, edge to edge, and
 * under it what the person needs to act on it, indented. A detail is dimmed unless it is the words themselves.
 */
export function entry(
  ui: Ui,
  title: string,
  meta: string,
  details: { text: string; dim?: boolean; keepEnd?: boolean }[],
): string {
  const p = paint(ui);
  const room = Math.max(20, ui.columns - meta.length - 2);
  const head = `${p.name(clip(title, room).padEnd(room))}  ${p.dim(meta)}`;
  return [
    head,
    ...details
      .filter((d) => d.text !== "")
      .map((d) => {
        const shown = clip(d.text, ui.columns - 2, d.keepEnd);
        return `  ${d.dim === false ? shown : p.dim(shown)}`;
      }),
  ].join("\n");
}

/** The words a search matched are marked `[like this]` by the index; on a terminal they are bold, in lavender, instead. */
export function highlight(ui: Ui, snippet: string): string {
  return ui.color ? snippet.replace(/\[([^\]]+)\]/g, (_, w: string) => paint(ui).title(w)) : snippet;
}

/** `done`: something the verb did; `todo`: something left for the person; `failed`: something it could not do. */
export type Mark = "done" | "todo" | "failed";

/**
 * What a verb that does several things did, in the look of the steps of §6.1: one line each, a thing done dimmed
 * after `✓`, one that failed in red after `✕`, one left to the person after `⚠`; then, after a blank line, what
 * follows them, such as the commands to run.
 */
export function checklist(ui: Ui, items: [Mark, string][], then: string[] = []): string {
  const p = paint(ui);
  const bare = (text: string) => text.replace(/\.$/, "");
  const line = ([mark, text]: [Mark, string]): string =>
    mark === "done"
      ? `${p.dim("✓")} ${p.dim(bare(text))}`
      : mark === "failed"
        ? p.red(`✕ ${bare(text)}`)
        : `${p.yellow("⚠")} ${text}`;
  return [...items.map(line), ...(items.length > 0 && then.length > 0 ? [""] : []), ...then].join("\n");
}
