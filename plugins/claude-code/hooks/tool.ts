import type { EngineInterface } from "claude-code";
import { session } from "./session";

// The mod's one way to the tool: through the plugin's wrapper, in the session's folder, and its answers as JSON lines.

export type Answer = Record<string, unknown>;

/** Each line of a text that is a JSON object; any other line is passed over. */
export function jsonObjects(lines: string): Answer[] {
  return lines.split("\n").flatMap((line) => {
    if (!line.trim().startsWith("{")) return [];
    try {
      const r: unknown = JSON.parse(line);
      return r !== null && typeof r === "object" && !Array.isArray(r) ? [r as Answer] : [];
    } catch {
      return [];
    }
  });
}

export const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** When a session starts: the folder the tool runs in, which is how it finds the brains of that folder. */
export function toolStart(cwd: string): void {
  session.cwd = cwd;
}

/** Runs the tool as the plugin's hooks do, and answers its first JSON line; nothing when it cannot run. */
export async function kioku($: EngineInterface, args: string[], timeoutMs = 20_000): Promise<Answer | undefined> {
  const ran = await $.process
    .run(["bash", `${$.plugin.root}/hooks/kioku.sh`, ...args], { cwd: session.cwd, timeoutMs })
    .catch(() => undefined);
  return ran === undefined ? undefined : jsonObjects(ran.stdout)[0];
}
