/**
 * Point a demo's code repository at this checkout, so a Claude Code session opened there, in the terminal or in the
 * desktop app, runs the plugin's hooks against the bundle of this working tree and the demo's own brains, and never
 * touches `~/.kioku`: builds `lib/kioku.mjs`, writes a `kioku` launcher for it under `<out>/bin`, sets `KIOKU_HOME`,
 * `KIOKU_BIN` and `CLAUDE_CODE_PLUGIN_DIRS` (this checkout's plugin, loaded in place of an installed one) in the
 * `.claude/settings.local.json` of `<out>/app`, leaving any other key there as it was, and
 * writes a `.mise.toml` there so that a terminal in that folder has the same `KIOKU_HOME` and this launcher first on its
 * `PATH`: `kioku` there is this checkout's. Both say to git that the person is sam, `github.user` (§2.3), added to the
 * person's own git configuration through git's variables, so the demo's story stays sam's whatever that says.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Who the demo is about: the name git gives the person (§2.3), through the variables that add to git's configuration. */
export const DEMO_USER = "sam";
const GIT_USER = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "github.user", GIT_CONFIG_VALUE_0: DEMO_USER };

export function prepareSession(root: string, out: string): void {
  const app = join(out, "app");
  // The plugin compares its version with the tool's, so the launcher runs the bundle (which carries package.json's), not the source.
  if (spawnSync("node", [join(root, "scripts/build.mjs")], { stdio: "inherit" }).status !== 0)
    throw new Error("the bundle did not build");
  const launcher = join(out, "bin", "kioku");
  mkdirSync(join(out, "bin"), { recursive: true });
  writeFileSync(launcher, `#!/bin/sh\nexec node "${join(root, "lib/kioku.mjs")}" "$@"\n`);
  chmodSync(launcher, 0o755);

  const settingsPath = join(app, ".claude", "settings.local.json");
  let settings: { env?: Record<string, string> } = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      throw new Error(`${settingsPath} is not JSON; fix or remove it, and run this again`);
    }
  }
  // The plugin too is this checkout's: Claude Code loads the folder for the session, in place of an installed
  // plugin of the same name.
  settings.env = {
    ...settings.env,
    KIOKU_HOME: join(out, ".home"),
    KIOKU_BIN: launcher,
    CLAUDE_CODE_PLUGIN_DIRS: join(root, "plugins", "claude-code"),
    ...GIT_USER,
  };
  mkdirSync(join(app, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  writeFileSync(
    join(app, ".mise.toml"),
    [
      "# Written by pnpm demo: a terminal here runs this checkout's kioku against the demo's brains (mise trust once).",
      "[env]",
      `KIOKU_HOME = "${join(out, ".home")}"`,
      `_.path = ["${join(out, "bin")}"]`,
      ...Object.entries(GIT_USER).map(([k, v]) => `${k} = "${v}"`),
      "",
    ].join("\n"),
  );
}
