import type { JournalEntry } from "./journal.ts";

/**
 * Before the host compacts a session (§1.1): what the conversation held and the agent did not save is about to become
 * a summary, so the summary is asked to keep it, under a heading the session's next start sends the agent to. The host
 * gives a hook no turn of the agent's before it compacts, so nothing can be saved then: it is kept, and saved after.
 */

/** The heading the summary keeps those lines under, and the opening of a compacted session names (§4.1). */
export const UNSAVED_HEADING = "Not yet saved to Kioku";

/** The titles of what the session saved that the instructions name, so the summary does not keep them again. */
const SAVED_MAX = 20;
const TITLE_MAX = 120;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The titles of the pages this session wrote, the newest first, each once: what the journal holds, never a page's text. */
export function savedTitles(journal: JournalEntry[]): string[] {
  const titles = journal
    .filter((e) => e.arrow === "write" && e.what !== "forgot" && e.title !== undefined)
    .map((e) => oneLine(e.title!).slice(0, TITLE_MAX))
    .filter((t) => t !== "")
    .reverse();
  return [...new Set(titles)].slice(0, SAVED_MAX);
}

/** What the host's compaction is asked to keep (§1.1): one paragraph, as instructions for its summary. */
export function compactInstructions(saved: string[]): string {
  return [
    `For Kioku, this session's memory: under a heading "${UNSAVED_HEADING}", keep, one line each and in the person's own words, everything the person said in this conversation that will still be true in months and would change how an agent acts in a later session: a correction and what they wanted instead, a preference of tool, style or workflow, a decision and why, an error and how it was resolved, context about the project that its repository does not hold.`,
    saved.length === 0
      ? "Nothing was saved to Kioku in this session yet."
      : `Leave out what the session already saved to Kioku: ${saved.map((t) => `"${t}"`).join("; ")}.`,
    "Leave out secrets, the steps of the task at hand, and what the repository shows. With nothing to keep, leave the heading out.",
  ].join(" ");
}

/** Said in the opening of a session that was just compacted (§4.1): what the summary kept is saved now. */
export const AFTER_COMPACT = `This session was just compacted. If the summary of the conversation holds "${UNSAVED_HEADING}", or any correction, preference or decision of the person's that passes the two tests above and is in no brain, save each now, before going on: load the \`kioku\` skill, and say nothing of it in your reply.`;
