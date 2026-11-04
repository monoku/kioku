import type { EngineInterface, Register } from "claude-code";

// `/kioku-evolve` (§3.6): one line to the agent in the person's name; the skill says what to do with it, and allows the
// tool. The candidates and the choice are a conversation, so unlike the memory history and the search it opens no pane.

const EVOLVE_COMMAND = "kioku-evolve";
const EVOLVE_PROMPT = "Use the Kioku skill: show the instincts that are candidates for a Skill and let me pick.";

async function registerCommand($: EngineInterface): Promise<void> {
  await $.command
    .register({ name: EVOLVE_COMMAND, description: "Kioku: turn the instincts you pick into Skills" })
    .catch(() => undefined);
}

/** When a session starts: `/kioku-evolve`. */
export async function evolveStart($: EngineInterface): Promise<void> {
  await registerCommand($);
}

/** After a reset of the session's state: the command is registered again. */
export async function evolveRestore($: EngineInterface): Promise<void> {
  await registerCommand($);
}

async function submit($: EngineInterface): Promise<void> {
  await $.prompt.submit({ text: EVOLVE_PROMPT }).catch(() => undefined);
}

/** `/kioku-evolve`: the engine refuses a prompt from a `command.run` hook, which holds the turn, so it goes on the next tick. */
export function registerEvolve(on: Parameters<Register>[0]): void {
  on("command.run", { command: EVOLVE_COMMAND }, ($, _e) => {
    $.clock.after(0, () => submit($));
    return {};
  });
}
