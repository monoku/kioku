import type { EngineInterface, Register } from "claude-code";
import { evolveRestore, evolveStart, registerEvolve } from "./evolve";
import { historyRestore, historyStart, registerHistory } from "./history";
import { journalStart } from "./journal";
import { pageRestore, pageStart, registerPage } from "./page";
import { registerRows, rowsStart } from "./rows";
import { registerSearch, searchRestore, searchStart } from "./search";

// What the mod draws besides the footer (§1.2): the rows, the memory history, the page viewer and the search, each with its
// hooks, how a session starts it, and what it needs again after a reset. The calls are spelled out because the engine lets
// `$` go only to a function named at the call, never through a table. Rows need nothing restored: what they keep outlives
// a reset.

/** Every pane's hooks. */
export function panesRegister(on: Parameters<Register>[0]): void {
  registerHistory(on);
  registerRows(on);
  registerPage(on);
  registerSearch(on);
  registerEvolve(on);
}

/** When a session starts: each from nothing, with its command. */
export async function panesStart($: EngineInterface, cwd: string): Promise<void> {
  await journalStart($, cwd);
  await historyStart($);
  await rowsStart($);
  await pageStart($);
  await searchStart($);
  await evolveStart($);
}

/** After `/clear`, `/resume` or `/branch`, which reset the session's state and run no new start. */
export async function panesRestore($: EngineInterface): Promise<void> {
  await historyRestore($);
  await pageRestore($);
  await searchRestore($);
  await evolveRestore($);
}
