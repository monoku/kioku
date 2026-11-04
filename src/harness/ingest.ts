/**
 * The text of the command that fills a brain from a source (§1.7), the same for every agent host:
 * written into each brain by `brain create`, refreshed by `brain refresh`. It tells the agent how to
 * distil a source into this brain through the ordinary verbs; the tool reads nothing for it. `call` is how the
 * person invokes it on that host.
 */
export const ingestDescription = (name: string): string =>
  `Fill the brain ${name} from a source the person names, keeping only what lasts.`;

export function ingestBody(name: string, call: string): string {
  return `This command belongs to the brain \`${name}\` and exists only in sessions opened in its folder; everything it writes goes to this brain. The session summary names it as the brain this session is inside. When it does not, say in one line that \`${call}\` runs from the brain's folder, and stop.

The person names a source: a file, a folder, a repository's docs, a URL, a Notion page, a mail thread, a PDF, an image. It may be anywhere outside this folder. Read it with what you already have: the files you can open, the PDFs and images you can read, the MCP servers the person connected. The tool reads nothing for you; it receives pages. Do nothing until the source is clear. This runs only when the person asks; never watch a source or run it on your own.

Ingesting is distilling, not copying. Keep only what passes both tests of the Kioku skill: it will still be true in months, and knowing it would change how you act in a future session. A long document yields a few pages, often none. A decision record becomes a decision, a procedure a playbook, a page that says who, where or what things are called becomes context, a lesson a memory. Nothing becomes a page because it is in the source.

Ask what the brain already took from it before reading: \`kioku brain sources "<the source as you will write it>" --brain ${name} --json\`. It lists the pages that come from that source and the version each was written from. Work out the source's version from what you have: a commit sha for a repository, the modified date or a hash for a file, the page's last-edited time for a Notion page; if it has none, leave the version out. When every page is already at the version you are reading, say so in a line and stop. When the version is different, or the pages name none, read the source and bring those pages up to date instead of writing new ones; \`kioku brain sources\` without a source lists everything the brain was filled from.

Propose before writing. Once you have read the source, show what you would do, one line per page: write, update or supersede, the kind, the title, the namespace, and where in the source it comes from; then what you leave out and why, in a line or two. Every page goes in a namespace; when none fits, or the brain has none yet, the proposal names the new ones with a line of description each, and you make them with \`kioku namespace add <path> --summary "…" --brain ${name}\` before the pages that go there, which the person confirms again. Wait for the person's answer: they may drop items, change a kind or a title, or say go. Write only what they approved. Skip the proposal only when the person asked for it explicitly, "without asking", "just do it", or the like; then write directly and give the account at the end as always.

For each thing worth keeping, use the ordinary verbs with \`--brain ${name}\`, one page at a time, always starting with \`kioku page save\` without \`--create\`:

- \`--source\`: the document itself: its path, URL or message, not the session; written the same way each time, so that the next ingest finds it;
- \`--source-version\`: the version you worked out above, when the source has one;
- \`--evidence\`: a short quote from the source, the words a person would check it by;
- \`--summary\`: one line, always;
- \`--namespace\`: the area it belongs to, from the proposal.

A page that is still right at the new version needs no rewrite: \`kioku page update <path> --brain ${name} --source-version <version>\` records that you read it again.

When \`save\` answers \`similar\`, read what it lists: update the page that is the same subject, supersede a decision that changed, or save again with \`--create\` for a related but different subject, narrowing the pages it links to with \`--see-also\` when some are not related.

Never saved holds with more weight here, mail and chat above all: nothing from the first layer in any brain; nothing a person wrote about themselves, about others, or in confidence in a project or team brain; when in doubt, leave it out. Do not save the source's wording wholesale, and do not save an attachment or an image as a page: save what it says that lasts, pointing at it.

Unlike an ordinary save, this ends with an account in your reply, because the person did not see the pages happen one by one: in words, what you wrote, what you updated, what you superseded, and what you left out and why, with no paths. A write that answered \`error\` is said in one line with the tool's reason.

Written by \`kioku brain create\`; \`kioku brain refresh\` brings it up to date.
`;
}
