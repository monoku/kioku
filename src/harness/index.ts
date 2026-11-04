import type { OwnedFile } from "../core/brains/owned.ts";
import { userError } from "../core/errors.ts";
import { claudeCode } from "./claude-code.ts";
import { CLAUDE_MD, claudeCodeBrainFiles } from "./claude-code-files.ts";
import type { Harness } from "./harness.ts";
import { newerThan } from "../core/setup/install.ts";

export type {
  Harness,
  HookAnswer,
  HostCheck,
  Integration,
  MarketplaceSource,
  SessionStartInput,
  ToolResult,
} from "./harness.ts";

/** The agent hosts the tool knows, by the id `kioku hook --host` takes: this adapter is the one place that names them (design.md). */
export const HARNESS_IDS = ["claude-code"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const DEFAULT_HARNESS = "claude-code";

/** The adapters, one per id. */
const adapters: Record<HarnessId, (home: string, env: NodeJS.ProcessEnv) => Harness> = {
  "claude-code": claudeCode,
};

/** What each agent host needs in a brain's folder (§2.7), by the same ids; `AGENTS.md` itself is the core's. */
const brainFiles: Record<HarnessId, (name: string) => OwnedFile[]> = {
  "claude-code": claudeCodeBrainFiles,
};

/** The files an agent host keeps at a brain's root (§2.7): Markdown there that is not a page. */
export const hostRootFiles = (): string[] => [CLAUDE_MD];

/** `word` as a host id, or the one refusal for a word that is none. */
function knownId(word: string): HarnessId {
  if (!(HARNESS_IDS as readonly string[]).includes(word)) {
    throw userError(
      `unknown host "${word}" (the tool knows ${HARNESS_IDS.join(", ")}; \`claude\` means claude-code)`,
      "unknown_host",
    );
  }
  return word as HarnessId;
}

/** A host id as a person types it: an id, or `claude` for Claude Code; anything else is refused. */
export const harnessIdOf = (word: string): HarnessId => knownId(word === "claude" ? "claude-code" : word);

export const harnessFor = (id: string, home: string, env: NodeJS.ProcessEnv): Harness =>
  adapters[knownId(id)](home, env);

export const allHarnesses = (home: string, env: NodeJS.ProcessEnv): Harness[] =>
  Object.values(adapters).map((make) => make(home, env));

/** The files every known agent host needs in a brain's folder, relative to it. */
export const harnessBrainFiles = (name: string): OwnedFile[] =>
  Object.values(brainFiles).flatMap((files) => files(name));

/**
 * The version of the host's Kioku plugin when it is installed and older than `version`, the tool's (§6.2); undefined
 * when there is none, or it is current or newer.
 */
export function pluginBehind(h: Harness, version: string): string | undefined {
  if (!h.integration.plugin.installed()) return undefined;
  const v = h.integration.plugin.version();
  return v !== undefined && newerThan(version, v) ? v : undefined;
}
