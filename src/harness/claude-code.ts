import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { installDirs, onPath, pathLine } from "../core/setup/install.ts";
import type { Harness, ToolResult } from "./harness.ts";
import {
  claudeConfigDir,
  claudeFound,
  marketplaceSource,
  nativeMemoryOn,
  pluginInstalled,
  pluginVersion,
} from "./claude-code-settings.ts";
import {
  allowSkillAnswer,
  askAnswer,
  parseNamespaceAdd,
  parseSessionId,
  parseSessionStart,
  parseSkillUse,
  parseToolResult,
  parseUserPrompt,
  sessionStartAnswer,
} from "./hook-json.ts";

export { claudeSettingsPath, nativeMemoryOn } from "./claude-code-settings.ts";

/** Make `kioku` resolve in Claude Code's Bash tool: it sources `CLAUDE_ENV_FILE` before each of its commands. */
function persistPath(person: string, env: NodeJS.ProcessEnv): undefined {
  const file = env.CLAUDE_ENV_FILE;
  const dirs = installDirs(person, env);
  if (!file || onPath(dirs, env.PATH)) return;
  if (existsSync(file) && readFileSync(file, "utf8").includes(dirs.bin)) return;
  appendFileSync(file, `${pathLine(dirs)}\n`);
}

/** The most of a kept output read back: a reading verb's answer is far below it. */
const PERSISTED_MAX = 20 * 1024 * 1024;

/**
 * A tool's result with its whole output: Claude Code cuts a long one short in `stdout`, which no longer parses, and
 * keeps the whole in a file under its projects folder. That file is read, and no other: a path elsewhere is ignored.
 */
function wholeToolResult(configDir: string) {
  const projects = join(resolve(configDir), "projects") + sep;
  return (raw: string): ToolResult | undefined => {
    const r = parseToolResult(raw);
    const path = r?.persistedPath === undefined ? undefined : resolve(r.persistedPath);
    if (r === undefined || path === undefined || !path.startsWith(projects)) return r;
    try {
      return statSync(path).size > PERSISTED_MAX ? r : { ...r, output: readFileSync(path, "utf8") };
    } catch {
      return r;
    }
  };
}

/**
 * The adapter for Claude Code (§6.2, §6.3). `env` is the process's: `CLAUDE_CONFIG_DIR` moves its settings and
 * its plugins.
 */
export function claudeCode(home: string, env: NodeJS.ProcessEnv): Harness {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || undefined;
  return {
    id: "claude-code",
    runsIn: (e) => e.CLAUDECODE === "1",
    name: "Claude Code",
    configDir: claudeConfigDir(home, configDir),
    parseSessionStart,
    sessionStartAnswer,
    parseUserPrompt,
    parseToolResult: wholeToolResult(claudeConfigDir(home, configDir)),
    parseSkillUse,
    parseSessionId,
    allowSkillAnswer,
    parseNamespaceAdd,
    askAnswer,
    persistPath,
    integration: {
      found: () => claudeFound(home, configDir, env),
      plugin: {
        installed: () => pluginInstalled(home, configDir),
        version: () => pluginVersion(home, configDir),
        marketplace: () => marketplaceSource(home, configDir),
      },
    },
    // Information, never a warning: the agent saves to Kioku with both on (docs/how-to/claude-code-own-memory.md).
    checks: () => [
      {
        name: "claude memory",
        ok: true,
        detail: nativeMemoryOn(home, configDir, env)
          ? "Claude Code's own memory is on, next to Kioku's; `autoMemoryEnabled: false` in its settings keeps only Kioku"
          : "Claude Code's own memory is off; Kioku is the only memory the agent writes",
      },
    ],
  };
}
