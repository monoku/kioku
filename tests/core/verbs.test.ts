import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerb } from "../../src/cli/args.ts";
import { commands } from "../../src/cli/run.ts";
import {
  flagOf,
  GROUPS,
  groupVerbs,
  optionsOf,
  topLevel,
  VERB_NAMES,
  type VerbName,
  VERBS,
} from "../../src/cli/verbs.ts";
import { FIELDS } from "../../src/core/errors.ts";
import { SEARCH_OPTIONS } from "../../src/core/shell-words.ts";

/** The flags a usage names, in order, each with the placeholder after it: what the table must declare, no more and no less. */
function flagsInUsage(usage: readonly string[]): string[] {
  const text = usage.join(" ").replace(/\s+/g, " ");
  const seen: string[] = [];
  for (const m of text.matchAll(/--([a-z-]+)(?: (<[^>]+>(?:\|none)?|[a-z-]+(?:\|[a-z-]+)*(?=[\]\s]|$)))?/g)) {
    const raw = m[2] ?? "";
    // `<date>|none`: a date or the word `none`, which is a free word to a shell.
    const hint = raw.endsWith("|none") && raw.startsWith("<") ? raw.slice(0, -5) : raw;
    const entry = `${m[1]}${hint === "" ? "" : ` ${hint}`}`;
    if (!seen.includes(entry)) seen.push(entry);
  }
  return seen;
}

test("every verb's usage names the flags the table declares, in their order and with their placeholders; a hidden flag is not in it", () => {
  for (const verb of VERB_NAMES) {
    const declared = Object.entries(VERBS[verb].flags)
      .filter(([, f]) => f.hidden !== true)
      .map(([name, f]) => `${name}${f.hint === "" ? "" : ` ${f.hint}`}`);
    assert.deepEqual(flagsInUsage(VERBS[verb].usage), declared, `kioku ${verb}`);
  }
});

test("the groups are the first words of the verbs in two or more, and the first-level verbs are the table's", () => {
  const firsts = new Set(VERB_NAMES.filter((n) => n.includes(" ")).map((n) => n.split(" ")[0]!));
  assert.deepEqual([...firsts].sort(), [...GROUPS].sort());
  assert.deepEqual(Object.keys(commands).sort(), [...topLevel(), "hook"].sort());
  assert.deepEqual(groupVerbs("plugin"), ["claude-code install", "claude-code uninstall"]);
  assert.ok(groupVerbs("page").includes("save"));
});

test("the parser reads a verb's flags from the table: typed, gathered when repeated, and refused when the verb lacks them (§6.1)", () => {
  // `parseArgs` answers values with no prototype: spread, so that the comparison is of what they hold.
  const read = <V extends VerbName>(verb: V, args: string[]) => {
    const { values, positionals } = parseVerb(verb, args);
    return { values: { ...values }, positionals };
  };
  const save = read("page save", ["--brain", "x", "--aliases", "a", "--aliases", "b,c", "--create"]);
  assert.deepEqual(save, { values: { brain: "x", aliases: ["a", "b,c"], create: true }, positionals: [] });
  const show = read("page show", ["knowledge/x.md", "--outline"]);
  assert.deepEqual(show, { values: { outline: true }, positionals: ["knowledge/x.md"] });
  assert.throws(() => parseVerb("doctor", ["--nope"]), { code: "usage" });
  assert.throws(() => parseVerb("doctor", ["a-word"]), { code: "usage" }, "a verb with no positional takes none");
  assert.throws(() => parseVerb("page save", ["--brain"]), { code: "usage" }, "a value missing");
  assert.deepEqual(read("update", ["--finish"]).values, { finish: true }, "a hidden flag is read");
});

test("page search's flags are the core's, which the journal reads a search by, with their placeholders added", () => {
  assert.deepEqual(optionsOf("page search"), SEARCH_OPTIONS);
  assert.equal(VERBS["page search"].flags.brain!.hint, "<b>");
});

test("every field a core refusal may name is a flag of the table, as flagOf spells it (§6.1)", () => {
  const flags = new Set(Object.values(VERBS).flatMap((v) => Object.keys(v.flags).map((f) => `--${f}`)));
  for (const field of FIELDS) assert.ok(flags.has(flagOf(field)), `${field} has no flag`);
});
