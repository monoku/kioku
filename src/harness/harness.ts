/**
 * What differs between the agents Kioku works with (§6.2, §6.3): the shape of the JSON a hook receives and
 * answers with, how `kioku` gets onto the agent's PATH, and where its plugin is kept. The core works with the
 * neutral data below; an adapter turns it into one agent's format.
 */

/** What a session-start hook is told. */
export interface SessionStartInput {
  cwd?: string;
  /** How the session began: `startup`, `resume`, `clear` or `compact`. */
  source?: string;
  /** The session, for its journal (§4.6). */
  sessionId?: string;
}

/** A namespace the agent is about to make (§3.2): its path, its description and the brain named, as the command gives them. */
export interface NamespaceAdd {
  path: string;
  summary?: string;
  brain?: string;
}

/** What a hook before a compaction is told. */
export interface PreCompactInput {
  cwd?: string;
  sessionId?: string;
}

/** What a prompt-submit hook is told. */
export interface UserPromptInput {
  prompt: string;
  cwd?: string;
  sessionId?: string;
}

/** What a post-tool hook is told about a shell command. Either part is absent when the agent did not send it. */
export interface ToolResult {
  command?: string;
  output: string;
  /** The folder the session runs in, whose chain names the brains (§1.2). */
  cwd?: string;
  /** The session the command ran in, for its count (§1.2). */
  sessionId?: string;
  /** The id the host gave the call, which the journal's entries hold (§4.6). */
  callId?: string;
  /** Where the host kept the whole output when it cut `output` short; read only by the adapter that knows the place. */
  persistedPath?: string;
}

/** A hook's answer: the data for `--json`, and the words printed when stdout is the agent's. */
export interface HookAnswer {
  data: unknown;
  text: string;
}

/** The host's plugin (§6.2): what its own files say is added. */
export interface Integration {
  /** Whether the host is on this machine: its command on the PATH, or its configuration folder. */
  found: () => boolean;
  /** The host's Kioku plugin (§6.2): whether it is installed, the version the host loads, and where it has it from. */
  plugin: {
    installed: () => boolean;
    version: () => string | undefined;
    /** Where the host has the plugin's marketplace from; undefined when it has none. */
    marketplace: () => MarketplaceSource | undefined;
  };
}

/** Where a host has the plugin's marketplace from: a folder, read in place (§6.2), a GitHub repository, or else. */
export type MarketplaceSource =
  | { kind: "directory"; path: string }
  | { kind: "github"; repo: string }
  | { kind: "other"; what: string };

export interface Harness {
  id: string;
  /** Whether a process runs inside this host, from its environment: how the tool tells the agent's writes from a person's (§1.6). */
  runsIn: (env: NodeJS.ProcessEnv) => boolean;
  /** The host's name for a person. */
  name: string;
  /** The configuration folder this adapter reads and writes (§6.2). */
  configDir: string;
  /** Read the session-start hook's input; anything unreadable counts as nothing. */
  parseSessionStart: (raw: string) => SessionStartInput;
  /** The answer to a session start: the summary as context for the agent, the messages for the person. */
  sessionStartAnswer: (summary: string | undefined, messages: string[]) => HookAnswer | undefined;
  /** Read a shell command's result out of the post-tool hook's input; undefined when it is unreadable. */
  parseToolResult: (raw: string) => ToolResult | undefined;
  /** Read the prompt-submit hook's input; undefined when it is unreadable or holds no prompt. */
  parseUserPrompt: (raw: string) => UserPromptInput | undefined;
  /** The answer to a prompt: `context` added to it for the agent, and what the person is told of it (§4.7, §1.2). */
  promptContextAnswer: (context: string, said?: string) => HookAnswer;
  /** Read the input of the hook that runs before the host compacts a session (§1.1). */
  parsePreCompact: (raw: string) => PreCompactInput;
  /** The answer that asks the host's compaction to keep `instructions` in mind for its summary (§1.1). */
  compactInstructionsAnswer: (instructions: string) => HookAnswer & { raw: true };
  /** Read which skill a skill-load hook is told about; undefined when it is unreadable. */
  parseSkillUse: (raw: string) => string | undefined;
  /** Read the session a hook runs in, for its journal (§4.6); undefined when the input names none. */
  parseSessionId: (raw: string) => string | undefined;
  /** The answer that lets the host load a skill without asking. */
  allowSkillAnswer: () => HookAnswer;
  /** Read the `kioku namespace add` a pre-tool hook is told the shell is about to run; undefined for any other command. */
  parseNamespaceAdd: (raw: string) => NamespaceAdd | undefined;
  /** The answer that has the host ask the person before the tool runs, with `reason` as the question (§3.2). */
  askAnswer: (reason: string) => HookAnswer;
  /** Make `kioku` resolve in the agent's shell where the agent has a way to ask for it, given the person's home; a sentence for the person when it cannot and `kioku` is not found. */
  persistPath: (person: string, env: NodeJS.ProcessEnv) => string | undefined;
  integration: Integration;
  /** What else `doctor` checks for this agent, such as whether its own memory is on. */
  checks: () => HostCheck[];
}

/** One more line of `doctor` for an agent: fine, or a warning with what to do. */
export interface HostCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}
