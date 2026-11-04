// Bundles src/cli/main.ts into lib/kioku.mjs, the tool a release publishes (§6.2, §6.4), with the version from
// package.json; and writes lib/kioku-plugin.tar.gz, the plugin that travels beside it.
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { writePluginArchive } from "./plugin-archive.mjs";

const root = new URL("..", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

export async function bundle(outfile) {
  await build({
    entryPoints: [`${root}src/cli/main.ts`],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    minify: true,
    legalComments: "none",
    // Some bundled CommonJS code calls require() on Node's own modules; give the ES module a real one.
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
    },
    define: { __KIOKU_VERSION__: JSON.stringify(version) },
    logLevel: "warning",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bundle(`${root}lib/kioku.mjs`);
  // The plugin travels beside the bundle (§6.2): a release publishes both from this build.
  writePluginArchive(`${root}lib/kioku-plugin.tar.gz`);
}
