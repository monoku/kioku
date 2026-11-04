import { WRITING_VERBS } from "../log.ts";

/**
 * The verbs whose result is an entry of a write in the session's journal (§1.2, §4.6): the writing verbs, and `promote`,
 * which has no commit of its own but writes through `save` and `retire` in two brains. The hooks' filters, the journal
 * and the mod's rows all come from it.
 */
export const JOURNAL_WRITES = [...WRITING_VERBS, "promote"] as const;

/** The verbs that read the memory (§1.2): the ones whose answer makes an entry of a read in the session's journal. */
export const JOURNAL_READS = [
  "page show",
  "page search",
  "page list",
  "brain log",
  "brain stats",
  "brain lint",
] as const;
