import type { EngineInterface, Register } from "claude-code";
import { searchFor, showAsk } from "./page";

// Search (§1.2): `/kioku-search <words>` runs `kioku page search` and lists the pages it found, to choose from, in the page
// viewer's pane. It reads and writes nothing of the memory, and the footer's counts do not move: the person searched, not
// the agent.

const SEARCH_COMMAND = "kioku-search";
async function registerCommand($: EngineInterface): Promise<void> {
  await $.command
    .register({
      name: SEARCH_COMMAND,
      description: "Kioku: search the memory and choose a page",
      argumentHint: "<words>",
      immediate: true,
    })
    .catch(() => undefined);
}

/** When a session starts: `/kioku-search`. */
export async function searchStart($: EngineInterface): Promise<void> {
  await registerCommand($);
}

/** After a reset of the session's state: the command is registered again. */
export async function searchRestore($: EngineInterface): Promise<void> {
  await registerCommand($);
}

/** `/kioku-search`: with words it searches; without, the pane opens with the field for them. */
export function registerSearch(on: Parameters<Register>[0]): void {
  on("command.run", { command: SEARCH_COMMAND }, async ($, e) => {
    const words = e.args.trim();
    if (words === "") await showAsk($);
    else await searchFor($, words);
    return {};
  });
}
