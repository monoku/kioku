import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MarketplaceSource } from "./harness.ts";
import { newerThan, whichOnPath } from "../core/setup/install.ts";
import { PLUGIN_MARKETPLACE, PLUGIN_NAME, PLUGIN_SELECTOR } from "./claude-code-integration.ts";

/**
 * Claude Code's own configuration (§6.2, §6.3): `settings.json`, and the files in which it records the plugins and
 * marketplaces it has. Kioku installs its plugin with Claude Code's own commands and writes into none of these: what is
 * here only reads them.
 */

/** The person's Claude Code configuration folder: `$CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export const claudeConfigDir = (home: string, configDir?: string): string => configDir ?? join(home, ".claude");
/** The person's Claude Code settings: `settings.json` in that folder. */
export const claudeSettingsPath = (home: string, configDir?: string): string =>
  join(claudeConfigDir(home, configDir), "settings.json");

/** Whether Claude Code's own memory (auto memory) is on: it is by default; `autoMemoryEnabled: false` in the person's settings or `CLAUDE_CODE_DISABLE_AUTO_MEMORY` turns it off. */
export function nativeMemoryOn(home: string, configDir: string | undefined, env: NodeJS.ProcessEnv): boolean {
  const disabled = env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  if (disabled !== undefined && disabled !== "" && disabled !== "0" && disabled.toLowerCase() !== "false") return false;
  try {
    const settings = JSON.parse(readFileSync(claudeSettingsPath(home, configDir), "utf8")) as Record<string, unknown>;
    return settings?.autoMemoryEnabled !== false;
  } catch {
    return true;
  }
}

/** Whether Claude Code is on this machine: `claude` on the PATH, or its configuration folder. */
export const claudeFound = (home: string, configDir: string | undefined, env: NodeJS.ProcessEnv): boolean =>
  whichOnPath("claude", env) !== undefined || existsSync(claudeConfigDir(home, configDir));

/** One of the files in which Claude Code records what it has added, read as an object; absent or unreadable counts as nothing. */
function recorded(home: string, configDir: string | undefined, file: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(join(claudeConfigDir(home, configDir), "plugins", file), "utf8")) as unknown;
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Whether Claude Code has the Kioku plugin installed: its `installed_plugins.json` lists `kioku@<marketplace>`. */
export function pluginInstalled(home: string, configDir?: string): boolean {
  const plugins = recorded(home, configDir, "installed_plugins.json").plugins;
  if (typeof plugins !== "object" || plugins === null) return false;
  const entries = (plugins as Record<string, unknown>)[PLUGIN_SELECTOR];
  return Array.isArray(entries) && entries.length > 0;
}

/**
 * The version of the Kioku plugin Claude Code loads: from a marketplace that is a folder, the version the plugin's own
 * manifest declares there, since Claude Code reads it in place (§6.2); else the one it installed, the newest when it
 * lists several. Undefined when none.
 */
export function pluginVersion(home: string, configDir?: string): string | undefined {
  const source = marketplaceSource(home, configDir);
  if (source?.kind === "directory") {
    const inFolder = folderPluginVersion(source.path);
    if (inFolder !== undefined) return inFolder;
  }
  const plugins = recorded(home, configDir, "installed_plugins.json").plugins;
  if (typeof plugins !== "object" || plugins === null) return undefined;
  const entries = (plugins as Record<string, unknown>)[PLUGIN_SELECTOR];
  if (!Array.isArray(entries)) return undefined;
  const versions = entries
    .map((e) => (e as { version?: unknown })?.version)
    .filter((v): v is string => typeof v === "string" && /^\d+\.\d+\.\d+/.test(v));
  return versions.reduce<string | undefined>((a, v) => (a === undefined || newerThan(v, a) ? v : a), undefined);
}

/** Where Claude Code has the plugin's marketplace from, as its `known_marketplaces.json` records it; undefined when it has none. */
export function marketplaceSource(home: string, configDir?: string): MarketplaceSource | undefined {
  const entry = recorded(home, configDir, "known_marketplaces.json")[PLUGIN_MARKETPLACE] as
    | { source?: { source?: unknown; path?: unknown; repo?: unknown; url?: unknown } }
    | undefined;
  if (typeof entry !== "object" || entry === null) return undefined;
  const s = entry.source ?? {};
  if (s.source === "directory" && typeof s.path === "string") return { kind: "directory", path: s.path };
  if (s.source === "github" && typeof s.repo === "string") return { kind: "github", repo: s.repo };
  return { kind: "other", what: typeof s.url === "string" ? s.url : String(s.source ?? "unknown") };
}

/** The version of the plugin a marketplace folder lists, read from its manifest; undefined when it cannot be read. */
function folderPluginVersion(folder: string): string | undefined {
  try {
    const market = JSON.parse(readFileSync(join(folder, ".claude-plugin", "marketplace.json"), "utf8")) as {
      plugins?: { name?: unknown; source?: unknown }[];
    };
    const entry = market.plugins?.find((p) => p.name === PLUGIN_NAME);
    if (typeof entry?.source !== "string") return undefined;
    const manifest = JSON.parse(readFileSync(join(folder, entry.source, ".claude-plugin", "plugin.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}
