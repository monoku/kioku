import type { Tier } from "../config/folder-config.ts";

/** The file an agent opened in a brain's folder reads first (§2.7): the one convention every agent host shares. */
export const AGENTS_MD = "AGENTS.md";

/** What the comment at the end of `AGENTS.md` starts with, before the version that wrote it (§2.7). */
const WRITTEN_BY = "Written by kioku";

/** The version that wrote an `AGENTS.md`, read from its last comment; undefined when it names none (§2.7). */
export function writtenBy(text: string): string | undefined {
  const m = new RegExp(`<!-- ${WRITTEN_BY} (\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)[;\\s]`).exec(text);
  return m?.[1];
}

/**
 * What the folder is and what can be done in it: a pointer, not policy. Context still arrives by the hook and
 * behaviour by the skill; this file reaches the agent before either, and a person reading the repository.
 * Each agent host reaches it through its own pointer (Claude Code through `CLAUDE.md`), which is also where anything
 * specific to that host goes; this text names none.
 */
export function agentsMd(repo: string, tier: Tier, version: string): string {
  return `# ${repo}: a Kioku brain

This folder is the ${tier} brain \`${repo}\`: memory for coding agents, kept as Markdown pages with git
history and read and written by the \`kioku\` tool. Written by \`kioku brain create\`; \`kioku brain refresh\` brings
it up to date.

Start with \`BRAIN.md\`, which says what this brain is for, which repositories it serves and who looks after it.

What is here:

- \`rules/\`: how the agent works in this brain, always on.
- \`skills/\`: techniques the agent runs on its own when they apply.
- \`knowledge/<namespace>/\`: what is true, for people: \`decisions/\` (what and why), \`playbooks/\` (how things are
  done here), \`context/\` (people, clients, glossary, where things are).
- \`memory/\`: lessons and facts the agent learned; \`memory/instincts/\`: learned "when X, do Y" with the occasions
  that support them.

Work on it through the tool, never by editing pages by hand, so that every change is validated and committed:

- read: \`kioku page search <words>\`, \`kioku page list\`, \`kioku page show <path>\`, \`kioku brain log\`, \`kioku brain stats\` (\`page list\` and \`brain log\` answer a part at a time, and say the \`--offset\` that reads on);
- write: \`kioku page save\`, \`kioku page update\`, \`kioku page supersede\`, \`kioku page link\`, \`kioku page forget\`, \`kioku page evolve\`,
  \`kioku page confirm\`, \`kioku page retire\`, \`kioku page rename\`, \`kioku page promote\`;
- structure: \`kioku namespace list\`, \`kioku namespace add\`, \`kioku namespace describe\`, \`kioku namespace rename\`, \`kioku page move\`; a new namespace is the person's to agree to;
- keep it clean: \`kioku brain lint\`, \`kioku brain validate\`.

One file is yours to write: a namespace's \`knowledge/<namespace>/INDEX.md\` may have a \`## Load first\` section
naming the few pages (five at most) an agent should read before working there, which the session summary lists.

A session opened in this folder loads this brain, and the Kioku skill says how to behave in it; the agent's
\`/ingest\` command, offered only here, fills it from a source. The tool is \`kioku\` on the PATH; the skill and the hooks are the agent's
integration, installed by \`kioku plugin\`.

<!-- ${WRITTEN_BY} ${version}; kioku brain refresh rewrites it. -->
`;
}
