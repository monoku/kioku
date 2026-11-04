// Writes what the plugin ships from the code (§6.2), held to it by a test: plugins/claude-code/hooks/hooks.json from
// pluginHooks().
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pluginHooks } from "../src/harness/claude-code-integration.ts";

const target = new URL("../plugins/claude-code/hooks/hooks.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(pluginHooks(), null, 2)}\n`);
// Laid out as the repository's formatter wants it, so that `pnpm lint` takes the file as written.
execFileSync("pnpm", ["exec", "biome", "format", "--write", target.pathname], { stdio: "inherit" });
console.log(`wrote ${target.pathname}`);
