// Writes the verbs of docs/reference/cli.md from the table that declares them, src/cli/verbs.ts (§6.1): each verb's
// heading, usage and what it does. The prose under each verb's `<!-- /generated -->`, and under each group's
// heading, is the reference's own and is kept. `node scripts/cli-reference.ts` writes the file; `--check` exits 1 when
// it is not current. tests/docs.test.ts holds the file to what this renders.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SECTIONS, type Verb } from "../src/cli/verbs.ts";

export const REFERENCE = fileURLToPath(new URL("../docs/reference/cli.md", import.meta.url));
const START = "<!-- verbs: written by `pnpm docs:cli` from src/cli/verbs.ts; edit only the prose under each verb -->";
const END = "<!-- /verbs -->";
const MARK = "<!-- /generated -->";

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** A verb's heading, its usage, what it does and the flags its usage does not show; the usage names every other flag. */
function top(name: string, verb: Verb): string {
  const out = [`### \`kioku ${name}\``, "", "```text", ...verb.usage, "```", "", sentence(verb.does)];
  for (const [flag, f] of Object.entries(verb.flags))
    if (f.hidden) out.push("", `\`--${flag}\` is what the tool passes itself; not for people.`);
  out.push(MARK);
  return out.join("\n");
}

/** The prose the file holds under each heading of the verbs' part, by heading. */
function proseOf(part: string): Map<string, string> {
  const prose = new Map<string, string>();
  const blocks = part.split(/^(?=#{2,3} )/m);
  for (const block of blocks) {
    const heading = /^(#{2,3} .*)$/m.exec(block)?.[1];
    if (heading === undefined) continue;
    const text: string = heading.startsWith("### ")
      ? block.includes(MARK)
        ? block.slice(block.indexOf(MARK) + MARK.length)
        : ""
      : block.slice(heading.length);
    prose.set(heading, text.replace(/^\n+/, "").replace(/\s+$/, ""));
  }
  return prose;
}

/** The file as it should be, from the file as it is. */
export function render(current: string): string {
  const s = current.indexOf(START);
  const e = current.indexOf(END);
  if (s < 0 || e < s) throw new Error(`${REFERENCE}: the markers of the verbs' part are missing`);
  const prose = proseOf(current.slice(s + START.length, e));
  const parts = [];
  for (const section of SECTIONS) {
    const heading = `## ${section.title}`;
    const intro = prose.get(heading);
    parts.push(intro ? `${heading}\n\n${intro}` : heading);
    for (const [name, verb] of Object.entries(section.verbs)) {
      const own = prose.get(`### \`kioku ${name}\``);
      parts.push(own ? `${top(name, verb)}\n\n${own}` : top(name, verb));
    }
  }
  return `${current.slice(0, s)}${START}\n\n${parts.join("\n\n")}\n\n${current.slice(e)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const current = readFileSync(REFERENCE, "utf8");
  const wanted = render(current);
  if (process.argv.includes("--check")) {
    if (wanted !== current) {
      console.error("docs/reference/cli.md is not current: run pnpm docs:cli");
      process.exit(1);
    }
  } else if (wanted !== current) {
    writeFileSync(REFERENCE, wanted);
    console.log("wrote docs/reference/cli.md");
  }
}
