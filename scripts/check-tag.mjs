// Fails unless the tag is v<major>.<minor>.<patch>, with the version of package.json (§6.4), which the Claude Code
// plugin's version must also be: they are released together (§6.2).
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;

export function tagProblem(tag, root_ = root) {
  const read = (p) => JSON.parse(readFileSync(`${root_}${p}`, "utf8")).version;
  const pkg = read("package.json");
  if (tag !== `v${pkg}`) return `the tag ${tag} is not v${pkg}, the version in package.json`;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) return `the tag ${tag} is not v<major>.<minor>.<patch>, which every release is`;
  const plugin = read("plugins/claude-code/.claude-plugin/plugin.json");
  if (plugin !== pkg) return `the plugin's version ${plugin} is not ${pkg}, the version in package.json`;
  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problem = tagProblem(process.argv[2] ?? "");
  if (problem) {
    console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`${process.argv[2]} is the version of package.json.`);
  }
}
