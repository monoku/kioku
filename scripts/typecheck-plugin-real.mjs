// Checks the mod against the types Claude Code itself laid on this machine, where `pnpm typecheck:plugin`, which ci
// runs, checks it against the declaration the repository keeps. Claude Code writes them, git ignores them, and they are
// there once a session has loaded the mod from this folder (`claude --plugin-dir plugins/claude-code`): without them there is nothing to compare.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "plugins/claude-code/.claude-plugin/types/claude-code/index.d.ts");

if (!existsSync(api)) {
  console.log(
    "Skipped: no types from Claude Code here. A session that loads the mod lays them: claude --plugin-dir plugins/claude-code",
  );
  process.exit(0);
}
console.log(readFileSync(api, "utf8").split("\n", 1)[0]);
const tsc = process.platform === "win32" ? "tsc.cmd" : "tsc";
const ran = spawnSync(join(root, "node_modules/.bin", tsc), ["-p", "tsconfig.plugin.real.json"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(ran.status ?? 1);
