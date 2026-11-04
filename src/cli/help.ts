import { userError, type KiokuError } from "../core/errors.ts";
import { CLI_REFERENCE_URL, TAGLINE } from "../product.ts";
import { PLAIN, paint, plural, type Ui } from "./render.ts";
import type { Handler, Outcome } from "./run.ts";
import {
  type Group,
  GROUP_DOES,
  GROUPS,
  groupUsageLine,
  groupVerbs,
  HELP_USAGE,
  helpUsageIn,
  isGroup,
  SECTIONS,
  TOOL_USAGE,
  topLevel,
  VERB_NAMES,
  VERBS,
  type VerbName,
} from "./verbs.ts";

/** One verb as `kioku help` answers it (§6.1): its usage, as the reference writes it, and what it is for in a line. The shape programs read. */
export interface VerbHelp {
  /** `setup`, or `page save`: the words after `kioku`. */
  verb: string;
  usage: string[];
  does: string;
}

const helpOf = (verb: VerbName): VerbHelp => ({ verb, usage: [...VERBS[verb].usage], does: VERBS[verb].does });
const all = (): VerbHelp[] => VERB_NAMES.map(helpOf);

/** The words of `text` in lines no wider than `width`; a word wider than that has a line of its own. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  return [...lines, line];
}

/**
 * Rows of a word and its sentence, the sentences in one column and wrapped under their own first word; `names` is the
 * widest word the column makes room for, when other columns are to line up with it.
 */
function column(ui: Ui, rows: [string, string][], bold = false, names = 0): string {
  const width = Math.max(names, ...rows.map(([a]) => a.length)) + 2;
  const hang = " ".repeat(INDENT.length + width);
  const p = paint(ui);
  const name = bold ? p.name : p.orange;
  return rows
    .map(([a, b]) => {
      const lines = wrapWords(b, Math.max(20, ui.columns - hang.length));
      return `${INDENT}${name(a)}${" ".repeat(width - a.length)}${lines.join(`\n${hang}`)}`;
    })
    .join("\n");
}
const INDENT = "  ";

/** A paragraph wrapped to the terminal. */
const paragraph = (ui: Ui, text: string): string => wrapWords(text, ui.columns).join("\n");

/** A paragraph that only points elsewhere, dimmed, line by line so the wrapping stays the plain one's. */
const aside = (ui: Ui, text: string): string =>
  wrapWords(text, ui.columns)
    .map((line) => paint(ui).dim(line))
    .join("\n");

/** A section's title: the brand's lavender, bold. */
const title = (ui: Ui, text: string): string => paint(ui).title(text);

/**
 * A line of usage in colour, its words unchanged: the command (`kioku page save`, given as `command`) bold, a flag
 * orange, a placeholder lavender, the brackets and bars that say what is optional dimmed. Lines that go on with the
 * form above them start with spaces and have no command.
 */
function usageLine(ui: Ui, line: string, command: string): string {
  if (!ui.color) return line;
  const p = paint(ui);
  const head = line.startsWith(command) ? p.bold(command) : "";
  const rest = head === "" ? line : line.slice(command.length);
  return (
    head +
    rest.replace(/(--?[a-z][a-z-]*)|(<[^>\s][^>]*>)|([[\]|])/g, (_, flag, slot, mark) =>
      flag !== undefined ? p.orange(flag) : slot !== undefined ? p.lavender(slot) : p.dim(mark),
    )
  );
}

/** A group's line in the overview: what it holds, and how many verbs. */
const groupLine = (g: Group): [string, string] => [g, `${GROUP_DOES[g]} (${plural(groupVerbs(g).length, "verb")})`];

/** The title the groups take in the overview when their verbs are not in a section of verbs of one word. */
const GROUPS_TITLE = "Brains, pages and namespaces";

/** The overview's first line (§6.1): the mark, `kioku.md`, and what Kioku is; `.md` in orange, as the logo has it. */
const heading = (ui: Ui): string => `${paint(ui).bold("kioku")}${paint(ui).name(".md")} · ${TAGLINE}`;

/**
 * The overview (§6.1): its heading, then the verbs of one word in their sections, a group in the section of its verbs when that section
 * has verbs of one word (`plugin` in Machine), the other groups under a title of their own, and how to see more. `hook`,
 * which only the host calls, is not in it.
 */
function overview(ui: Ui): string {
  const shown = new Set<Group>();
  const firstSection = (g: Group): number =>
    SECTIONS.findIndex((s) => Object.keys(s.verbs).some((v) => v.startsWith(`${g} `)));
  const sections: { title: string; rows: [string, string][] }[] = [];
  SECTIONS.forEach((s, i) => {
    const ones = Object.entries(s.verbs).filter(([verb]) => !verb.includes(" ") && verb !== "hook");
    if (ones.length === 0) return;
    const groups = GROUPS.filter((g) => firstSection(g) === i);
    for (const g of groups) shown.add(g);
    sections.push({
      title: s.title,
      rows: [...ones.map(([verb, spec]) => [verb, spec.does] as [string, string]), ...groups.map(groupLine)],
    });
  });
  const rest = [...GROUPS].filter((g) => !shown.has(g)).sort((a, b) => firstSection(a) - firstSection(b));
  if (rest.length > 0) sections.push({ title: GROUPS_TITLE, rows: rest.map(groupLine) });
  const rows = sections.flatMap((s) => s.rows);
  // One column for every section, so that the sentences line up down the page.
  const names = Math.max(...rows.map(([a]) => a.length));
  const body = sections.map((s) => `${title(ui, s.title)}\n${column(ui, s.rows, true, names)}`);
  const more = `${HELP_USAGE.group} lists a group's verbs; ${HELP_USAGE.verb}, or ${HELP_USAGE.after}, one verb's usage; the reference has them all: ${CLI_REFERENCE_URL}`;
  return `${heading(ui)}\n\n${usageLine(ui, TOOL_USAGE, "kioku")}\n\n${body.join("\n\n")}\n\n${aside(ui, more)}`;
}

/** The reference's section for a verb: its heading, as the git host anchors it. */
const referenceOf = (h: VerbHelp): string => `${CLI_REFERENCE_URL}#kioku-${h.verb.replace(/ /g, "-")}`;

const sentence = (does: string): string => `${does[0]!.toUpperCase()}${does.slice(1)}.`;

function one(ui: Ui, h: VerbHelp): string {
  const usage = h.usage.map((line) => usageLine(ui, line, `kioku ${h.verb}`)).join("\n");
  return `${usage}\n\n${paragraph(ui, sentence(h.does))}\n\n${aside(ui, `More in the reference, under \`kioku ${h.verb}\`: ${referenceOf(h)}`)}`;
}

/**
 * A group's verbs (§6.1), what `kioku <group>` and `kioku help <group>` print: the group's usage and what it holds, its
 * verbs a line each, and how to see one. `kioku plugin <host>` lists that host's.
 */
export function groupHelp(ui: Ui, group: Group, host?: string): Outcome {
  const prefix = host === undefined ? `${group} ` : `${group} ${host} `;
  const verbs = all().filter((h) => h.verb.startsWith(prefix));
  const usage = host === undefined ? groupUsageLine(group) : groupUsageLine(group).replace("<host>", host);
  const words = prefix.trim();
  return {
    data: { verbs },
    text: `${usageLine(ui, usage, `kioku ${words}`)}\n\n${paragraph(ui, sentence(GROUP_DOES[group]))}\n\n${column(
      ui,
      verbs.map((h) => [h.verb.slice(prefix.length), h.does]),
      true,
    )}\n\n${aside(ui, `${helpUsageIn(words)} shows one.`)}`,
  };
}

/** The verb a line of words runs, when the tool has it: `page save` of `page save x --brain y`. */
export function verbIn(words: string[]): VerbName | undefined {
  for (let n = Math.min(3, words.length); n > 0; n--) {
    const verb = words.slice(0, n).join(" ");
    if (Object.hasOwn(VERBS, verb)) return verb as VerbName;
  }
  return undefined;
}

/**
 * A verb misused (§6.1), told as what is wrong, then the verb's usage and where help says more: at a terminal a line
 * each, the usage in help's colours, in JSON one line.
 */
export function misuse(verb: VerbName, what: string, ui: Ui = PLAIN): { text: string; message: string } {
  const usage = VERBS[verb].usage;
  // A line that starts with spaces goes on with the form above it; a line that starts with the tool's name is another form.
  const forms: string[] = [];
  for (const line of usage) {
    if (line.startsWith(" ") && forms.length > 0) forms[forms.length - 1] += ` ${line.trim()}`;
    else forms.push(line);
  }
  return {
    text: `${what}\n${usage.map((line) => usageLine(ui, line, `kioku ${verb}`)).join("\n")}\n${paint(ui).dim(`kioku help ${verb} says more`)}`,
    message: `${what}; ${forms.join(", or ")}`,
  };
}

/** Edit distance, for a word typed a letter or two away from a verb. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The verbs a word resembles (§6.1): at the first level, a group's verb typed on its own (`search` for `page search`),
 * or a verb a letter or two away (`pages` for `page`); inside a group, the group's own verbs only.
 */
export function suggest(word: string, group?: Group): string[] {
  const candidates: { full: string; last: string }[] =
    group === undefined
      ? [
          ...topLevel().map((w) => ({ full: w, last: w })),
          ...GROUPS.flatMap((g) => groupVerbs(g).map((s) => ({ full: `${g} ${s}`, last: s }))),
        ]
      : groupVerbs(group).map((s) => ({ full: `${group} ${s}`, last: s }));
  const lower = word.toLowerCase();
  const exact = candidates.filter((c) => c.last === lower && c.full !== lower);
  if (exact.length > 0) return exact.map((c) => c.full);
  const allowed = lower.length <= 4 ? 1 : 2;
  return candidates
    .map((c) => ({ c, d: distance(lower, c.last) }))
    .filter(({ d }) => d <= allowed)
    .sort((x, y) => x.d - y.d)
    .map(({ c }) => c.full);
}

/** The error for a verb the tool does not have, naming the one it resembles when one does (§6.1). */
export function unknownVerb(word: string | undefined, group?: Group): KiokuError {
  const where = group === undefined ? "" : ` in kioku ${group}`;
  const lists = group === undefined ? "kioku help lists the verbs" : `kioku help ${group} lists its verbs`;
  if (word === undefined) return userError(`a verb is missing${where} (${lists})`, "unknown_verb");
  const near = suggest(word, group);
  const hint =
    near.length === 0
      ? ""
      : `: did you mean ${near
          .slice(0, 3)
          .map((n) => `kioku ${n}`)
          .join(" or ")}?`;
  return userError(`unknown verb "${word}"${where}${hint} (${lists})`, "unknown_verb");
}

/** `kioku help [<verb> [<verb>]]` (§6.1): the overview; a group's verbs; or one verb's usage. */
export const runHelp: Handler = (args, ctx): Outcome => {
  const ui = ctx.ui ?? PLAIN;
  if (args.length === 0 || (args.length === 1 && args[0] === "help"))
    return { data: { verbs: all() }, text: overview(ui) };
  const want = args.join(" ");
  const found = all().find((h) => h.verb === want);
  if (found !== undefined) return { data: { verbs: [found] }, text: one(ui, found) };
  if (args.length === 1 && isGroup(args[0]!)) return groupHelp(ui, args[0]);
  if (args.length === 2 && args[0] === "plugin" && all().some((h) => h.verb.startsWith(`plugin ${args[1]} `)))
    return groupHelp(ui, "plugin", args[1]);
  const inGroup = args.length > 1 && isGroup(args[0]!);
  throw unknownVerb(inGroup ? args.slice(1).join(" ") : want, inGroup ? (args[0] as Group) : undefined);
};
