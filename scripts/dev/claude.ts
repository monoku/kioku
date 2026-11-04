/**
 * `pnpm dev:claude [-- --launch]`: rebuild the bundle and point the demo's code repository at it again, as `pnpm demo`
 * leaves it (see `prepare.ts`), after a change in `src/`. `--launch` then starts `claude` in `.demo/app` with this checkout's
 * plugin loaded for the session, in place of an installed one.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareSession } from "./prepare.ts";

const { values } = parseArgs({
  options: { launch: { type: "boolean" } },
  strict: true,
  args: process.argv.slice(2).filter((a) => a !== "--"),
});
const root = resolve(new URL("../..", import.meta.url).pathname);
const out = join(root, ".demo");
const app = join(out, "app");

if (!existsSync(join(app, "kioku.yaml"))) {
  console.error(`${out} has no demo brains yet. Run: pnpm demo`);
  process.exit(1);
}
prepareSession(root, out);
console.log(`A session opened in ${app} runs this checkout's bundle against ${join(out, ".home")}.`);
if (values.launch) {
  const plugin = join(root, "plugins", "claude-code");
  process.exitCode = spawnSync("claude", ["--plugin-dir", plugin], { cwd: app, stdio: "inherit" }).status ?? 1;
}
