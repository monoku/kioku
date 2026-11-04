import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import { printed } from "./tool-double";

// `/kioku-evolve` (§3.6), run against the engine: `claude plugin test plugins/claude-code`.

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1];

function machine(on: On) {
  const registered: string[] = [];
  const submitted: string[] = [];
  const clock = mock.clock(on);
  mock.env(on, { HOME: "/home/sam" });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "s1" }) as never);
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("fs.read", (_, e) => {
    throw new Error(`no ${e.path}`);
  });
  on("process.run", () => printed());
  on("command.register", (_, e) => {
    registered.push(e.name);
    return { value: undefined } as never;
  });
  on("prompt.submit", (_, e) => {
    submitted.push(e.text);
    return { text: e.text } as never;
  });
  return { registered, submitted, clock };
}

const start = async ($: Engine): Promise<void> => {
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
};
const evolve = async ($: Engine): Promise<unknown> => $.command.run({ command: "kioku-evolve", args: "" } as never);

test("/kioku-evolve is one line to the agent, naming the skill (§3.6)", async ($, on) => {
  const { registered, submitted, clock } = machine(on);
  await start($);
  expect(registered).toContain("kioku-evolve");
  await evolve($);
  await clock.advance(1);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatch(/Kioku skill/);
});
