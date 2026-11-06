import { kiokuCall } from "../core/shell-words.ts";
import type { HookAnswer, NamespaceAdd, SessionStartInput, ToolResult, UserPromptInput } from "./harness.ts";

/**
 * The hook JSON Claude Code sends and takes back: `cwd` and `source` to a session start, the shell command in
 * `tool_input.command`, and `hookSpecificOutput.additionalContext` and `systemMessage` in answer. Kept apart from the
 * adapter so that another host with the same shape can share it.
 */

const record = (raw: string): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
};

export function parseSessionStart(raw: string): SessionStartInput {
  const r = record(raw);
  return {
    ...(typeof r?.cwd === "string" && { cwd: r.cwd }),
    ...(typeof r?.source === "string" && { source: r.source }),
    ...(typeof r?.session_id === "string" && { sessionId: r.session_id }),
  };
}

/** The session any hook runs in: `session_id`. */
export function parseSessionId(raw: string): string | undefined {
  const id = record(raw)?.session_id;
  return typeof id === "string" ? id : undefined;
}

export function sessionStartAnswer(summary: string | undefined, messages: string[]): HookAnswer | undefined {
  if (summary === undefined && messages.length === 0) return undefined;
  // A session start can say a few things at once: a blank line between them (§1.2).
  const said = messages.join("\n\n");
  const data = {
    ...(summary !== undefined && { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: summary } }),
    // On a line of its own, under the words the host puts before it (§1.2).
    ...(messages.length > 0 && { systemMessage: `\n${said}` }),
  };
  return { data, text: [said, summary].filter(Boolean).join("\n\n") };
}

/**
 * The command and its output; the output is `tool_response.stdout`, or `tool_response` itself when it is a string.
 * A long output is cut short there, and the whole kept in a file named by `persistedOutputPath`.
 */
export function parseToolResult(raw: string): ToolResult | undefined {
  const r = record(raw);
  if (r === undefined) return undefined;
  const response = r.tool_response as { stdout?: unknown; persistedOutputPath?: unknown } | string | undefined;
  const command = (r.tool_input as { command?: unknown } | undefined)?.command;
  return {
    ...(typeof command === "string" && { command }),
    output: typeof response === "string" ? response : typeof response?.stdout === "string" ? response.stdout : "",
    ...(typeof r.session_id === "string" && { sessionId: r.session_id }),
    ...(typeof r.tool_use_id === "string" && { callId: r.tool_use_id }),
    ...(typeof r.cwd === "string" && { cwd: r.cwd }),
    ...(typeof response === "object" &&
      typeof response?.persistedOutputPath === "string" && { persistedPath: response.persistedOutputPath }),
  };
}

/** The skill a skill-load hook is told about: `tool_input.skill`, when the tool is the skill tool. */
export function parseSkillUse(raw: string): string | undefined {
  const r = record(raw);
  if (r === undefined || r.tool_name !== "Skill") return undefined;
  const skill = (r.tool_input as { skill?: unknown } | undefined)?.skill;
  return typeof skill === "string" ? skill : undefined;
}

/** The answer that lets Claude Code load the skill without asking. */
export const allowSkillAnswer = (): HookAnswer => {
  const data = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Kioku loads its own skill",
    },
  };
  return { data, text: JSON.stringify(data) };
};

/** The `kioku namespace add <path> --summary <text> [--brain <b>]` in the shell command a pre-tool hook is told about. */
export function parseNamespaceAdd(raw: string): NamespaceAdd | undefined {
  const r = record(raw);
  const command = (r?.tool_input as { command?: unknown } | undefined)?.command;
  if (typeof command !== "string") return undefined;
  const rest = kiokuCall(command, "namespace", ["add"]);
  if (rest === undefined) return undefined;
  const out: Partial<NamespaceAdd> = {};
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    const flag = /^--(summary|brain)(?:=(.*))?$/.exec(w);
    if (flag) {
      const value = flag[2] ?? rest[++i];
      if (value !== undefined) out[flag[1] as "summary" | "brain"] = value;
    } else if (!w.startsWith("-") && out.path === undefined) out.path = w;
  }
  return out.path === undefined ? undefined : (out as NamespaceAdd);
}

/** The answer that has Claude Code ask the person before the tool runs, with `reason` shown to them. */
export const askAnswer = (reason: string): HookAnswer => {
  const data = {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason },
  };
  return { data, text: JSON.stringify(data) };
};

/** A prompt's answer: what is added to its context for the agent (§4.7), and what the person is told of it (§1.2). */
export function promptContextAnswer(context: string, said?: string): HookAnswer {
  return {
    data: {
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
      // On a line of its own, under the words the host puts before it (§1.2).
      ...(said !== undefined && { systemMessage: `\n${said}` }),
    },
    text: [said, context].filter(Boolean).join("\n\n"),
  };
}

/** The prompt the person submitted, with the folder and session it was sent from. */
export function parseUserPrompt(raw: string): UserPromptInput | undefined {
  const r = record(raw);
  if (typeof r?.prompt !== "string" || r.prompt.trim() === "") return undefined;
  return {
    prompt: r.prompt,
    ...(typeof r.cwd === "string" && { cwd: r.cwd }),
    ...(typeof r.session_id === "string" && { sessionId: r.session_id }),
  };
}
