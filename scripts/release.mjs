// Prepares a release through a pull request (§6.4). It never pushes: it prints the commands for a person to run.
//
//   node scripts/release.mjs prepare <version>   on a branch release/v<version>: names the CHANGELOG's
//                                                `## Unreleased` section after the version, sets it in package.json,
//                                                runs the checks and commits `Release <version>`; the person pushes
//                                                the branch and opens the pull request
//
// Merging that pull request is the release: the `release` workflow finds the commit, tests it and publishes it as the
// latest. Then main comes back into develop, so the next pull request from develop does not fight over CHANGELOG.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { withVersion } from "./json-version.mjs";

const root = new URL("..", import.meta.url).pathname;
const [step, version = ""] = process.argv.slice(2);
const tag = `v${version}`;
const branch = `release/${tag}`;
const subject = `Release ${version}`;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (step !== "prepare" || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail("usage: node scripts/release.mjs prepare <major.minor.patch>");
}
if (out("git", ["status", "--porcelain"]) !== "") fail("the working tree is not clean; commit or stash first");
if (out("git", ["tag", "--list", tag]) !== "") fail(`${tag} already exists`);
run("git", ["fetch", "-q", "origin", "main"]);

// The release starts from what origin's main is, so the pull request holds the release commit and nothing else.
if (
  out("git", ["rev-list", "--count", "HEAD..origin/main"]) !== "0" ||
  out("git", ["rev-list", "--count", "origin/main..HEAD"]) !== "0"
) {
  fail("HEAD is not origin/main: merge what is pending first, then run this from main as origin has it");
}
if (out("git", ["branch", "--list", branch]) !== "") fail(`the branch ${branch} already exists`);

// What accumulated since the last release is under `## Unreleased`; the release gives it its version.
const logPath = `${root}CHANGELOG.md`;
const log = readFileSync(logPath, "utf8");
const unreleased = /^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(log);
if (unreleased === null || unreleased[1].trim() === "") {
  fail("CHANGELOG.md has no `## Unreleased` section with what this version changes; write it first");
}
run("git", ["switch", "-q", "-c", branch]);
writeFileSync(logPath, log.replace(/^## Unreleased$/m, `## ${version}`));
const pkgPath = `${root}package.json`;
writeFileSync(pkgPath, withVersion(readFileSync(pkgPath, "utf8"), version));
// The plugin is released with the tool: Claude Code updates it only when this version moves (§6.2).
const pluginPath = `${root}plugins/claude-code/.claude-plugin/plugin.json`;
writeFileSync(pluginPath, withVersion(readFileSync(pluginPath, "utf8"), version));

run("pnpm", ["typecheck"]);
run("pnpm", ["lint"]);
run("pnpm", ["test"]);
run("node", ["scripts/check-tag.mjs", tag]);
run("git", ["add", "CHANGELOG.md", "package.json", "plugins/claude-code/.claude-plugin/plugin.json"]);
run("git", ["commit", "-q", "-m", subject]);

console.log(`\nCommitted ${subject} on ${branch}. Nothing is pushed. Push it and open the pull request:
git push -u origin ${branch}
gh pr create --base main --head ${branch} --title "${subject}" --body "What it holds is CHANGELOG.md's section for it."
Merge it with a merge commit once its checks pass: that publishes it.

Once it is merged, bring main back into develop:
git switch develop && git pull --ff-only origin develop && git fetch origin main && git merge --no-ff origin/main && git push origin develop`);
