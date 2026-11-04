import { AGENTS_MD } from "../core/brains/agents-md.ts";
import type { OwnedFile } from "../core/brains/owned.ts";
import { INSTALL_COMMAND } from "../product.ts";
import { ingestBody, ingestDescription } from "./ingest.ts";

/**
 * The files Claude Code needs in a brain's folder (§2.7): its own pointer, which imports the
 * neutral `AGENTS.md`, and the `/ingest` command, which Claude Code offers only in sessions opened in that folder.
 * Another agent host brings its own; `AGENTS.md` is shared.
 */

export const CLAUDE_MD = "CLAUDE.md";
export const INGEST_COMMAND = ".claude/commands/ingest.md";

/** Claude Code reads `CLAUDE.md` on its own and expands `@file` imports; the text lives once, in `AGENTS.md`. What only Claude Code needs to hear is said here. */
export const claudeMd = (): string =>
  `@${AGENTS_MD}\n\nWithout Kioku, install it: \`${INSTALL_COMMAND}\`, then \`kioku plugin claude-code install\`.\n`;

/** The `/ingest` command's text for Claude Code: a command in the brain's `.claude/commands/`, allowed to run the tool. */
export function ingestCommand(name: string): string {
  return `---
description: ${ingestDescription(name)}
allowed-tools: Bash(kioku *)
---
${ingestBody(name, "/ingest")}`;
}

/** The files Claude Code needs in a brain, relative to the brain's folder. */
export const claudeCodeBrainFiles = (name: string): OwnedFile[] => [
  { rel: CLAUDE_MD, text: claudeMd() },
  { rel: INGEST_COMMAND, text: ingestCommand(name) },
];
