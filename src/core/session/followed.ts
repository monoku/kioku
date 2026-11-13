import type { JournalEntry } from "./journal.ts";

interface PageKey {
  brain: string;
  path: string;
}
const keyOf = (p: PageKey): string => `${p.brain}\n${p.path}`;

/**
 * The pages among `opened` that a recall named to this session before, and that it had not opened since (§4.5): each
 * with the `id` its recall kept, which a recall from before ids were kept does not have. Read from the journal as it
 * was before these openings were written to it, so that a page opened twice is one recall followed.
 */
export function followedIn(journal: JournalEntry[], opened: PageKey[]): { brain: string; id: string }[] {
  const out: { brain: string; id: string }[] = [];
  for (const page of opened) {
    const key = keyOf(page);
    let id: string | undefined;
    for (const e of journal) {
      if (e.what === "recalled") id = e.hits?.find((h) => keyOf(h) === key)?.id ?? id;
      else if (e.what === "opened" && e.brain !== undefined && e.path !== undefined && keyOf(e as PageKey) === key)
        id = undefined;
    }
    if (id !== undefined) out.push({ brain: page.brain, id });
  }
  return out;
}
