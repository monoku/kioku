/**
 * The verbs of the tool, each declared once (§6.1): what it is for, its usage as the reference writes it, its flags
 * with their type and the placeholder each shows, and what its first word takes. The parser reads the flags (`args.ts`),
 * `help` the usage and `does`, `completion` the hints and what each takes, and the tests hold docs/reference/cli.md to
 * all of it. A verb or a flag added here is known everywhere; a test fails until the reference names it.
 */
import { SEARCH_OPTIONS } from "../core/shell-words.ts";
import { SHELLS } from "../core/setup/path.ts";

/** What a flag or a positional takes: nothing, a free word, a brain of the machine, a brain or a tier, a configuration key, a file, or one of a few words. */
export type Takes = "none" | "free" | "brain" | "target" | "key" | "file" | { readonly choices: readonly string[] };

export interface Flag {
  readonly type: "string" | "boolean";
  /** The placeholder the usage shows after the flag, `<b>`: the word of description a shell shows. Empty when nothing follows it. */
  readonly hint: string;
  readonly takes: Takes;
  /** Given more than once, its values are gathered. */
  readonly multiple?: true;
  /** Read by the parser, shown nowhere: not for people. */
  readonly hidden?: true;
}

export interface Verb {
  readonly does: string;
  /** The usage, line by line, as docs/reference/cli.md writes it; a test holds both equal. */
  readonly usage: readonly string[];
  /** The flags, in the order the usage names them. */
  readonly flags: Readonly<Record<string, Flag>>;
  /** What the first word after the verb takes; `none` when the verb takes no positional argument. */
  readonly positional: Takes;
}

const BRAIN_HINTS: readonly string[] = ["<b>", "<brain>"];
const FILE_HINTS: readonly string[] = ["<dir>", "<folder>", "<new folder>", "<paths>"];

/** What a placeholder means to a shell: `<b>` a brain of the machine, `<key>` a configuration key, `<dir>` a file, `a|b` one of a few words; anything else a free word. */
export function takesOf(hint: string): Takes {
  if (hint === "") return "none";
  if (BRAIN_HINTS.includes(hint)) return "brain";
  if (hint === "<brain | tier>") return "target";
  if (hint === "<key>") return "key";
  if (/^<[a-z-]+(\|[a-z-]+)+>$/.test(hint)) return { choices: hint.slice(1, -1).split("|") };
  if (FILE_HINTS.includes(hint)) return "file";
  if (hint.startsWith("<")) return "free";
  if (/^[a-z-]+(\|[a-z-]+)+$/.test(hint)) return { choices: hint.split("|") };
  return "free";
}

/** A flag that takes a value, with the placeholder the usage shows; what it takes follows from the placeholder unless said. */
const str = (hint: string, takes: Takes = takesOf(hint)) => ({ type: "string", hint, takes }) as const;
/** A flag that takes a value and may be given more than once. */
const many = (hint: string) => ({ type: "string", hint, takes: takesOf(hint), multiple: true }) as const;
/** A flag that takes no value. */
const bool = (hint = "") => ({ type: "boolean", hint, takes: takesOf(hint) }) as const;
const hidden = <F extends Flag>(flag: F) => ({ ...flag, hidden: true }) as const;
/** One of a few words, kept as literal types: what a verb's first word takes can then be read back as a type (`HookVerb`). */
const choices = <const W extends readonly string[]>(...words: W) => ({ choices: words }) as const;

const v = <F extends Readonly<Record<string, Flag>>, P extends Takes = "none">(
  does: string,
  usage: string | readonly string[],
  flags: F,
  positional: P = "none" as P,
) => ({ does, usage: typeof usage === "string" ? [usage] : usage, flags, positional }) as const;

const section = <V extends Readonly<Record<string, Verb>>>(title: string, verbs: V) => ({ title, verbs }) as const;

/**
 * The flags of `page search` are declared in the core, since the journal reads the words of a search past them (§4.6):
 * here they take their placeholders.
 */
const searchFlags = {
  brain: { ...SEARCH_OPTIONS.brain, hint: "<b>", takes: takesOf("<b>") },
  limit: { ...SEARCH_OPTIONS.limit, hint: "<n>", takes: takesOf("<n>") },
  "include-retired": { ...SEARCH_OPTIONS["include-retired"], hint: "", takes: "none" },
} as const satisfies Readonly<Record<keyof typeof SEARCH_OPTIONS, Flag>>;

const BRAIN = { brain: str("<b>") } as const;
/** The brains of a machine, or a tier: what `page promote --to` takes. */
const b = "<b>";

/** The verbs, in the sections `kioku help` shows (§6.1), each in the order it lists them. */
export const SECTIONS = [
  section("Machine", {
    setup: v(
      "once per machine: the configuration, kioku on your PATH, your shell's completion, the search model; no brain",
      "kioku setup [--shell fish|zsh|bash|all] [--no-model]",
      { shell: str("fish|zsh|bash|all"), "no-model": bool() },
    ),
    doctor: v("checks the machine and says how to fix what is missing", "kioku doctor", {}),
    update: v(
      "installs the latest release, or the one named, rewrites the agent integration and refreshes the brains",
      "kioku update [<version>] [--check] [--dry-run]",
      // `--prepare` and `--finish` are what `update` runs in the version it downloads, before and after it is made
      // active; `--archive` hands `--prepare` the installer's download (§6.4): not for people.
      {
        check: bool(),
        "dry-run": bool(),
        prepare: hidden(bool()),
        archive: hidden(str("<file>")),
        finish: hidden(bool()),
      },
      "free",
    ),
    completion: v(
      "prints your shell's completion script, which setup makes the shell source",
      `kioku completion ${SHELLS.join("|")}`,
      {},
      choices(...SHELLS),
    ),
    "plugin claude-code install": v(
      "adds Claude Code's integration as a plugin, with Claude Code's own commands; asks first",
      "kioku plugin claude-code install [--dry-run]",
      { "dry-run": bool() },
    ),
    "plugin claude-code uninstall": v(
      "removes that plugin and its marketplace",
      "kioku plugin claude-code uninstall [--dry-run]",
      { "dry-run": bool() },
    ),
    config: v(
      "lists, reads and sets the machine's preferences, the owners it trusts and its team",
      ["kioku config", "kioku config get <key>", "kioku config set <key> <value>", "kioku config unset <key>"],
      {},
      choices("get", "set", "unset"),
    ),
  }),
  section("In a project folder", {
    init: v(
      "links a project folder to its project brain, cloned from an address or made by name; alone, accepts and clones what its kioku.yaml names",
      "kioku init [<brain>]",
      {},
      // An address or a name, which may not be on the machine yet: no list here knows it.
      "free",
    ),
    sync: v(
      "pulls the brains of this folder's chain, pushes what is pending, updates the index",
      "kioku sync [--cwd <dir>] [--background]",
      { cwd: str("<dir>"), background: bool() },
    ),
  }),
  section("Brains", {
    "brain create": v(
      "makes a brain on this machine with the name you give it, with no remote and no network; personal unless --tier says",
      "kioku brain create <owner>/<repo> [--tier personal|project|team] [--language <tag>]",
      {
        tier: str("personal|project|team"),
        language: str("<tag>"),
      },
      "free",
    ),
    "brain clone": v(
      "brings a brain that exists to this machine from any address, under the name it holds",
      "kioku brain clone <address>",
      {},
      "free",
    ),
    "brain sync": v(
      "pulls and pushes a brain, or every brain, wherever you are",
      ["kioku brain sync <brain>", "kioku brain sync --all"],
      { all: bool() },
      "brain",
    ),
    "brain publish": v(
      "pushes a brain that lives only on this machine to an empty repository at the address you give; its name stays",
      "kioku brain publish <brain> --remote <address>",
      { remote: str("<address>") },
      "brain",
    ),
    "brain list": v("the brains this machine knows, and the chain of this folder", "kioku brain list", {}),
    "brain path": v("prints a brain's folder", "kioku brain path <brain>", {}, "brain"),
    "brain remove": v(
      "takes a brain off this machine, never off the git host: deletes its clone and forgets it; refuses what would lose work unless --force",
      "kioku brain remove <brain> [--force] [--dry-run]",
      { force: bool(), "dry-run": bool() },
      "brain",
    ),
    "brain log": v(
      "the writes of the chain's brains since today, or since when you say",
      "kioku brain log [--since <when>] [--brain <b>] [--limit <n> [--offset <n>]]",
      { since: str("<when>"), brain: str(b), limit: str("<n>"), offset: str("<n>") },
    ),
    "brain stats": v(
      "what the writes of the chain's brains add up to over a span, 30d unless you say: by verb, and how many saved pages were forgotten",
      "kioku brain stats [--since <when>] [--brain <b>]",
      { since: str("<when>"), brain: str(b) },
    ),
    "brain sources": v(
      "what the brains were filled from, with the version each page was written from",
      "kioku brain sources [<source>] [--brain <b>] [--all]",
      { brain: str(b), all: bool() },
      "free",
    ),
    "brain validate": v("checks a brain's files against the format", "kioku brain validate [<brain>]", {}, "brain"),
    "brain lint": v(
      "what to review: similar pages, quiet instincts, superseded decisions, and the rest",
      "kioku brain lint [<brain>] [--limit <n>]",
      { limit: str("<n>") },
      "brain",
    ),
    "brain language": v(
      "declares the language a brain's pages are written in; the summary tells the agent",
      "kioku brain language <tag> --brain <b>",
      BRAIN,
      "free",
    ),
    "brain upgrade": v(
      "raises a brain to the newest format, in one commit",
      "kioku brain upgrade <brain>",
      {},
      "brain",
    ),
    "brain refresh": v(
      "rewrites the files the tool owns in a brain, or in every brain",
      "kioku brain refresh [<brain>] [--all]",
      { all: bool() },
      "brain",
    ),
    "brain conflicts": v(
      "the changes kept aside after a conflict with the team's, and how to resolve them",
      "kioku brain conflicts [<brain>] [--branch <b> [--page <path>]] [--open <b>] [--resolve <b>]",
      // Its `<b>` is a branch, not a brain.
      { branch: str(b, "free"), page: str("<path>"), open: str(b, "free"), resolve: str(b, "free") },
      "brain",
    ),
  }),
  section("Pages, reading", {
    "page search": v(
      "searches the brains of this folder, by meaning and by text",
      "kioku page search <words> [--brain <b>] [--limit <n>] [--include-retired]",
      searchFlags,
      "free",
    ),
    "page list": v(
      "the pages, 20 at a time, with their fields",
      "kioku page list [--brain <b>] [--kind <k>] [--namespace <ns>] [--limit <n> [--offset <n>]] [--fields <a,b>] [--count]",
      {
        brain: str(b),
        kind: str("<k>"),
        namespace: str("<ns>"),
        limit: str("<n>"),
        offset: str("<n>"),
        fields: str("<a,b>"),
        count: bool(),
      },
    ),
    "page show": v(
      "one page, with its body, its links and its history",
      "kioku page show <path> [--brain <b>] [--section <name> | --outline | --head <n>]",
      { brain: str(b), section: str("<name>"), outline: bool(), head: str("<n>") },
      "free",
    ),
  }),
  section("Pages, writing (what the agent calls while it works)", {
    "page save": v(
      "writes a page, or answers the similar pages it found instead",
      [
        "kioku page save --brain <b> --kind <k> --title <t> --source <s> [--sub <decision|playbook|context|instinct>]",
        "           [--evidence <q>] [--summary <s>] [--aliases <a,b>] [--namespace <ns>]",
        "           [--stale-after <date>] [--source-version <v>] [--applies-to <glob,glob>]",
        "           [--create [--see-also <paths>]] < body",
      ],
      {
        brain: str(b),
        kind: str("<k>"),
        title: str("<t>"),
        source: str("<s>"),
        sub: str("<decision|playbook|context|instinct>"),
        evidence: str("<q>"),
        summary: str("<s>"),
        aliases: many("<a,b>"),
        namespace: str("<ns>"),
        "stale-after": str("<date>"),
        "source-version": str("<v>"),
        "applies-to": many("<glob,glob>"),
        create: bool(),
        "see-also": many("<paths>"),
      },
    ),
    "page update": v(
      "rewrites a page's body, or one section, keeping its history",
      [
        "kioku page update <path> [--brain <b>] [--section <name>] [--evidence <line> --source <s>]",
        "             [--note <line>] [--summary <s>] [--aliases <a,b>] [--stale-after <date>|none]",
        "             [--source-version <v>|none] [--applies-to <glob,glob>|none] < body",
      ],
      {
        brain: str(b),
        section: str("<name>"),
        evidence: str("<line>"),
        source: str("<s>"),
        note: str("<line>"),
        summary: str("<s>"),
        aliases: many("<a,b>"),
        "stale-after": str("<date>"),
        "source-version": str("<v>"),
        "applies-to": many("<glob,glob>"),
      },
      "free",
    ),
    "page supersede": v(
      "writes a new decision and marks the old one as replaced",
      [
        "kioku page supersede <old path> [--brain <b>] --title <t> --source <s> [--evidence <q>]",
        "                [--summary <s>] [--aliases <a,b>] [--namespace <ns>] [--stale-after <date>]",
        "                [--source-version <v>] < body",
      ],
      {
        brain: str(b),
        title: str("<t>"),
        source: str("<s>"),
        evidence: str("<q>"),
        summary: str("<s>"),
        aliases: many("<a,b>"),
        namespace: str("<ns>"),
        "stale-after": str("<date>"),
        "source-version": str("<v>"),
      },
      "free",
    ),
    "page forget": v("deletes a page; git keeps it", "kioku page forget <path> [--brain <b>]", BRAIN, "free"),
    "page confirm": v(
      "records that a page is still true",
      "kioku page confirm <path> [--brain <b>] [--note <line>]",
      { brain: str(b), note: str("<line>") },
      "free",
    ),
    "page retire": v(
      "marks a page as not current, kept as history",
      "kioku page retire <path> [--brain <b>] [--reason <line>] [--undo]",
      { brain: str(b), reason: str("<line>"), undo: bool() },
      "free",
    ),
    "page rename": v(
      "gives a page a new title; links follow",
      "kioku page rename <path> --title <new title> [--brain <b>]",
      { title: str("<new title>"), brain: str(b) },
      "free",
    ),
    "page move": v(
      "moves a page to another namespace of its brain; its id stays and links follow",
      "kioku page move <path> --namespace <ns> [--brain <b>]",
      { namespace: str("<ns>"), brain: str(b) },
      "free",
    ),
    "page link": v(
      "links two related pages, each under the other's See also",
      "kioku page link <path> <path> [--brain <b>] [--type contradicts|qualifies]",
      { brain: str(b), type: str("contradicts|qualifies") },
      "free",
    ),
    "page promote": v(
      "writes a page again in a more shared brain and retires the original",
      [
        "kioku page promote <path> --to <brain | tier> [--brain <b>] [--title <t>] [--summary <s>]",
        "              [--aliases <a,b>] [--namespace <ns>] [--evidence <q>] [--create]",
        "              [--keep | --forget] < body",
      ],
      {
        to: str("<brain | tier>"),
        brain: str(b),
        title: str("<t>"),
        summary: str("<s>"),
        aliases: many("<a,b>"),
        namespace: str("<ns>"),
        evidence: str("<q>"),
        create: bool(),
        keep: bool(),
        forget: bool(),
      },
      "free",
    ),
    "page evolve": v(
      "lists the instincts ready to become Skills, or converts one",
      "kioku page evolve [<instinct path> [--to skill|rule|playbook]] [--brain <b>]",
      { to: str("skill|rule|playbook"), brain: str(b) },
      "free",
    ),
  }),
  section("Namespaces", {
    "namespace list": v(
      "the namespaces of the brains of this folder, with the pages in each",
      "kioku namespace list [--brain <b>]",
      BRAIN,
    ),
    "namespace add": v(
      "declares a namespace, or one under another, and writes its index with what it is for",
      "kioku namespace add <path> --summary <text> --brain <b>",
      { summary: str("<text>"), brain: str(b) },
      "free",
    ),
    "namespace describe": v(
      "says what a namespace is for, in the paragraph under its index's title",
      "kioku namespace describe <path> --summary <text> [--brain <b>]",
      { summary: str("<text>"), brain: str(b) },
      "free",
    ),
    "namespace rename": v(
      "gives a namespace another path, with everything under it; its folder, its pages and the links into it follow",
      "kioku namespace rename <from> <to> [--brain <b>] [--dry-run]",
      { brain: str(b), "dry-run": bool() },
      "free",
    ),
  }),
  section("Used by the agent integration, not by people", {
    hook: v(
      "what the plugin's hooks call",
      "kioku hook session-start|session-start-holds|user-prompt-submit|pre-compact|subagent-start|pre-tool-use|pre-tool-path|post-tool-use [--host claude-code]",
      { host: str("claude-code") },
      choices(
        "session-start",
        "session-start-holds",
        "user-prompt-submit",
        "pre-compact",
        "subagent-start",
        "pre-tool-use",
        "pre-tool-path",
        "post-tool-use",
      ),
    ),
  }),
] as const;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
/** Every verb's declaration, by name, with the types the table gives each. */
type Specs = UnionToIntersection<(typeof SECTIONS)[number]["verbs"]>;

/** `setup`, or `page save`: the words after `kioku` of a verb the tool has. */
export type VerbName = keyof Specs & string;

/** The verbs, by name, in the order help shows them. */
export const VERBS: Readonly<Record<VerbName, Verb>> = Object.assign({}, ...SECTIONS.map((s) => s.verbs));

/** The names of the verbs, in the order help shows them. */
export const VERB_NAMES = Object.keys(VERBS) as VerbName[];

/** The groups a verb's first word may name (§6.1), in the order help and completion list them. */
export const GROUPS = ["page", "brain", "namespace", "plugin"] as const;
export type Group = (typeof GROUPS)[number];
export const isGroup = (word: string): word is Group => (GROUPS as readonly string[]).includes(word);

/** What each group holds, in a line a person reads: the overview and the shells show it beside the group's word. */
export const GROUP_DOES: Readonly<Record<Group, string>> = {
  page: "search, list and show the pages of this folder's brains, and write them",
  brain: "make, clone, sync, publish and check the brains of this machine",
  namespace: "list, add, describe and rename the namespaces of a brain",
  plugin: "install or uninstall a host's integration",
};

/** What `kioku help` does, in a line: the shells show it beside the word. */
export const HELP_DOES = "the verbs, a group's verbs, or how one verb is used";

/** How the tool is called, and how a group is: the first line of the overview and of a group's list. */
export const TOOL_USAGE = "kioku <verb> [arguments] [--json]";
export const groupUsageLine = (group: Group): string =>
  group === "plugin" ? "kioku plugin <host> <verb>" : `kioku ${group} <verb>`;
/** How help is called (§6.1): a group's verbs, one verb's usage, and one verb's after the verb; and a verb of a group. */
export const HELP_USAGE = { group: "kioku <group>", verb: "kioku help <verb>", after: "kioku <verb> --help" } as const;
export const helpUsageIn = (words: string): string => `kioku help ${words} <verb>`;

/** The verbs of a group, without the group's word: `save` of `page save`, `claude-code install` of `plugin claude-code install`. */
export type GroupVerb<G extends Group> = VerbName extends infer N
  ? N extends `${G} ${infer Rest}`
    ? Rest
    : never
  : never;
export const groupVerbs = <G extends Group>(group: G): GroupVerb<G>[] =>
  VERB_NAMES.filter((n) => n.startsWith(`${group} `)).map((n) => n.slice(group.length + 1) as GroupVerb<G>);

/** The words that may follow `kioku` and are for people (§6.1): the verbs in one word, the groups, and `help`; `hook` is not for people. */
export const topLevel = (): string[] => [
  ...VERB_NAMES.filter((n) => !n.includes(" ") && n !== "hook"),
  ...GROUPS,
  "help",
];

type ValueOf<F> = F extends { type: "boolean" } ? boolean : F extends { multiple: true } ? string[] : string;
/** A verb's flags as the parser answers them: each absent, or of the type the table declares. */
export type Values<V extends VerbName> = { [K in keyof Specs[V]["flags"]]?: ValueOf<Specs[V]["flags"][K]> };

/** A verb's flags as `parseArgs` takes them. */
export function optionsOf(verb: VerbName): Record<string, { type: "string" | "boolean"; multiple?: true }> {
  return Object.fromEntries(
    Object.entries(VERBS[verb].flags).map(([name, f]) => [
      name,
      { type: f.type, ...(f.multiple && { multiple: true }) },
    ]),
  );
}

/** The flag that gives a field of the core's refusals (`stale_after`, `--stale-after`); a test holds each to the table. */
export const flagOf = (field: string): string => `--${field.replaceAll("_", "-")}`;

/** The hooks `kioku hook <verb>` takes, as the table declares them: what the plugin's hooks call. */
export type HookVerb = Specs["hook"]["positional"]["choices"][number];
