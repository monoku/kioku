import { JOURNAL_READS, JOURNAL_WRITES } from "../core/session/journal-verbs.ts";
import { MARKETPLACE_NAME } from "../product.ts";

/**
 * What Kioku is to Claude Code (§6.2): a plugin, `kioku` in a marketplace that ships beside the tool, under the
 * installed version's folder, that `kioku plugin claude-code install` registers with Claude Code's own commands. The
 * plugin is `plugins/claude-code/` in this repository: its hooks, below, its skill and its command are files there, and
 * Claude Code loads them from the tool's folder at each session start.
 */

export const PLUGIN_NAME = "kioku";
export const PLUGIN_MARKETPLACE: string = MARKETPLACE_NAME;
/** The `plugin@marketplace` selector `claude plugin install` and `uninstall` take, and the id Claude Code lists it under. */
export const PLUGIN_SELECTOR = `${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`;
/** What the skill is called once loaded: the plugin's name, then the skill's. */
export const PLUGIN_SKILL = `${PLUGIN_NAME}:kioku`;

export type HookVerb = "session-start" | "user-prompt-submit" | "post-tool-use" | "pre-tool-use";

/** The writing verbs, one filter each: their result is an entry of the journal (§4.6). */
export const WRITE_FILTERS: readonly string[] = JOURNAL_WRITES.map((v) => `Bash(kioku page ${v} *)`);
/** The reading verbs, one filter each: their result is an entry of the journal (§4.6). */
export const READ_FILTERS: readonly string[] = JOURNAL_READS.map((c) => `Bash(kioku ${c} *)`);

export interface HookHandler {
  type: "command";
  command: string;
  if?: string;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}

/**
 * The plugin's `hooks/hooks.json` (§6.2): the mod's module, the footer indicator, and the three hooks, the last filtered to the writing and the reading verbs, each a literal command that runs the plugin's own
 * `hooks/kioku.sh`, which finds the launcher; and one that lets the host load the plugin's own skill without
 * asking. The file is committed; a test holds it to this.
 */
export function pluginHooks(): { hooks: Record<string, HookGroup[]>; modules: string[] } {
  const run = (verb: HookVerb): string => `bash "\${CLAUDE_PLUGIN_ROOT}/hooks/kioku.sh" hook ${verb}`;
  return {
    modules: ["./register.tsx"],
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: run("session-start") }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: run("user-prompt-submit") }] }],
      PreToolUse: [
        { matcher: "Skill", hooks: [{ type: "command", command: run("pre-tool-use") }] },
        // A namespace is structure: the person confirms each one before it is made (§3.2).
        {
          matcher: "Bash",
          hooks: [{ type: "command", if: "Bash(kioku namespace add *)", command: run("pre-tool-use") }],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [...WRITE_FILTERS, ...READ_FILTERS].map((f) => ({
            type: "command",
            if: f,
            command: run("post-tool-use"),
          })),
        },
      ],
    },
  };
}
