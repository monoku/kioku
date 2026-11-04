/** Exit codes: 0 success, 1 user error, 2 the brain refused the write, 3 the environment is missing something. */

/** A commit a failed write made before it failed (§1.6): what its answer carries beside the reason, never `null`. */
export interface Written {
  brain: string;
  path?: string;
  commit: string;
  /** Whether that commit left the machine; null for one kept aside on a conflict's branch. */
  publication: "pushed" | "pending" | "local" | null;
}

/**
 * The fields of a page, a write or a list that a refusal may name. The core says the field, as the page's format
 * writes it, whoever calls it; the command line says the flag with the same name.
 */
export const FIELDS = [
  "aliases",
  "evidence",
  "kind",
  "limit",
  "note",
  "offset",
  "reason",
  "section",
  "see_also",
  "source",
  "source_version",
  "stale_after",
  "sub",
  "summary",
  "title",
] as const;
export type Field = (typeof FIELDS)[number];

/** How a refusal says what depends on where it is read: a field's name, and the words only a command line can act on. */
export interface Naming {
  field(name: Field): string;
  cli(words: string): string;
}

/** What a message says everywhere but on the command line. */
export const PLAIN: Naming = { field: (name) => name, cli: () => "" };

export class KiokuError extends Error {
  readonly exit: 1 | 2 | 3;
  /** Stable name of the failure, for the `--json` error object (§6.1). */
  readonly code: string;
  /** The commit that exists in spite of the failure, when one does (§1.6). */
  written?: Written;
  /** The message again, for a surface with its own way of naming: the command line's (`src/cli/write.ts`). */
  said?: (n: Naming) => string;

  constructor(exit: 1 | 2 | 3, code: string, message: string, written?: Written) {
    super(message);
    this.exit = exit;
    this.code = code;
    if (written !== undefined) this.written = written;
  }
}

/**
 * A failure met after a commit was made, told as the tool's error with that commit beside it (§1.6): the message says
 * what exists, then why the rest did not happen. The error stays the one that was thrown, so what the refusal says of
 * it besides its code, the validator's findings or a conflict, stays too. Anything that is not the tool's error is
 * thrown as it came.
 */
export function afterCommit(e: unknown, written: Written, exists: string): never {
  if (!(e instanceof KiokuError)) throw e;
  e.message = `${exists}, but ${e.message}`;
  const said = e.said;
  if (said !== undefined) e.said = (n) => `${exists}, but ${said(n)}`;
  e.written = written;
  throw e;
}

/** The person typed something wrong, or a file they own is wrong: exit 1. */
export const userError = (message: string, code = "invalid"): KiokuError => new KiokuError(1, code, message);
/** `userError` for a message that names fields or commands: every surface reads `message`, plain, but the command line. */
export function namedError(said: (n: Naming) => string, code = "usage"): KiokuError {
  const e = userError(said(PLAIN), code);
  e.said = said;
  return e;
}
/** The brain refused the write (its lock is held, or its format is newer): exit 2. */
export const refusedError = (message: string, code = "refused"): KiokuError => new KiokuError(2, code, message);
/** The environment is missing something, such as the brain folder: exit 3. */
export const environmentError = (message: string, code = "environment"): KiokuError => new KiokuError(3, code, message);
/** The first line of a caught error's message: what a report or a summary line shows of it. */
export const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
