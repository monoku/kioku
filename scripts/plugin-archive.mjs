// The plugin a release carries beside the bundle (§6.2, §6.4): kioku-plugin.tar.gz, the folder plugins/claude-code
// as it is, at once a marketplace and the plugin it lists as itself (`"source": "./"`), without its tests and without
// what the engine lays there for a session. Written by the build next to lib/kioku.mjs, the same bytes on any
// machine: entries in order, no owner, no time.
//
//   node scripts/plugin-archive.mjs [<out>]     (lib/kioku-plugin.tar.gz when none is named)
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;

/** What is the plugin's tests and not the plugin: they run in the repository, never on a machine. */
const TESTS_ONLY = /(\.test\.tsx?|[/\\]tool-double\.ts)$/;
/** What a session of the engine lays in the folder for its own typecheck (ignored by git, not part of the plugin). */
const ENGINE_LAID = /^(\.claude-plugin\/types\/|tsconfig\.json$)/;

/** Every file under `dir`, as paths relative to it, in order. */
function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name === ".DS_Store") continue;
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** The archive's entries: the folder's files, the marketplace first; a plugin it names by another folder goes under it. */
export function pluginEntries(repo = root) {
  const folder = join(repo, "plugins", "claude-code");
  const marketText = readFileSync(join(folder, ".claude-plugin", "marketplace.json"), "utf8");
  const market = JSON.parse(marketText);
  const entries = [];
  for (const plugin of market.plugins) {
    const own = plugin.source === "./" || plugin.source === ".";
    const dir = own ? folder : join(folder, plugin.source);
    for (const file of filesUnder(dir)) {
      if (TESTS_ONLY.test(`/${file}`) || ENGINE_LAID.test(file)) continue;
      if (own && file === ".claude-plugin/marketplace.json") continue;
      const data = readFileSync(join(dir, file));
      entries.push({
        name: own ? file : `${plugin.name}/${file}`,
        data,
        mode: statSync(join(dir, file)).mode & 0o111 ? 0o755 : 0o644,
      });
    }
  }
  entries.unshift({ name: ".claude-plugin/marketplace.json", data: Buffer.from(marketText), mode: 0o644 });
  return entries;
}

/** One ustar header: a name that does not fit in 100 bytes is split at a slash into its prefix. */
function header(name, size, mode) {
  const h = Buffer.alloc(512);
  let base = name;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100)
      throw new Error(`${name} is too long for the archive`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  const octal = (n, width) => `${n.toString(8).padStart(width - 1, "0")}\0`;
  h.write(base, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(0, 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write("0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return h;
}

/** A gzipped tar of `entries` (`{ name, data, mode }`), regular files only. */
export function tarGz(entries) {
  const parts = [];
  for (const { name, data, mode = 0o644 } of entries) {
    parts.push(header(name, data.length, mode), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

/** Write the plugin's archive to `out`. */
export function writePluginArchive(out, repo = root) {
  writeFileSync(out, tarGz(pluginEntries(repo)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? `${root}lib/kioku-plugin.tar.gz`;
  writePluginArchive(out);
  console.log(`wrote ${out}`);
}
