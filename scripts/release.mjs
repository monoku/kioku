// Prepares a release through a pull request, as git flow has it (§6.4). It never pushes: it prints the commands for a
// person to run.
//
//   node scripts/release.mjs prepare <version>   from develop, makes the branch release/v<version>; on a branch
//                                                release/v<version> or hotfix/v<version> already made (off develop, or
//                                                off main for a fix that cannot wait), works there. Names the
//                                                CHANGELOG's `## Unreleased` section after the version, sets it in
//                                                package.json and the plugin's manifest, runs the checks and commits
//                                                `Bump version to <version>`; the person pushes the branch and opens
//                                                its pull request into main, at the address it prints
//
// More commits may follow on the branch. Merging its pull request into main is the release: the `release` workflow sees
// the version move, tests what main then is and publishes it as the latest, so main holds what was released and
// nothing more. Then main comes back into develop, so develop says the version and the next release does not fight
// over CHANGELOG.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { withVersion } from "./json-version.mjs";

const root = new URL("..", import.meta.url).pathname;
const [step, version = ""] = process.argv.slice(2);
const tag = `v${version}`;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const count = (range) => Number(out("git", ["rev-list", "--count", range]));
const parts = (v) => v.split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  const i = x.findIndex((n, k) => n !== y[k]);
  return i !== -1 && x[i] > y[i];
};

if (step !== "prepare" || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail("usage: node scripts/release.mjs prepare <major.minor.patch>");
}
if (out("git", ["status", "--porcelain"]) !== "") fail("the working tree is not clean; commit or stash first");
if (out("git", ["tag", "--list", tag]) !== "") fail(`${tag} already exists`);
const pkgPath = `${root}package.json`;
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
// The product repository, named once in package.json; its page opens the pull request, no other tool.
const repoPage = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
if (!newer(version, current)) fail(`${version} is not after ${current}, the version now`);

run("git", ["fetch", "-q", "origin", "develop", "main"]);
const here = out("git", ["branch", "--show-current"]);
const release = `release/${tag}`;
const hotfix = `hotfix/${tag}`;
if (here === "develop") {
  // From what origin's develop is, so the release holds what was pushed and checked.
  if (count("HEAD..origin/develop") !== 0 || count("origin/develop..HEAD") !== 0) {
    fail("develop is not origin/develop: push or pull what is pending first, then run this again");
  }
  if (out("git", ["branch", "--list", release]) !== "") fail(`the branch ${release} already exists: switch to it`);
} else if (here !== release && here !== hotfix) {
  fail(
    `run this from develop, which makes ${release}, or on ${release} or ${hotfix} (off main, for a fix that cannot wait)`,
  );
}
// The release is merged into main, so it holds all of main: the last release, and any fix released since.
if (count("HEAD..origin/main") !== 0) {
  fail(
    here === hotfix
      ? `${hotfix} does not hold all of origin/main: make it off main as origin has it`
      : "develop does not hold all of main: bring main back into develop first (docs/how-to/release.md)",
  );
}

// What accumulated since the last release is under `## Unreleased`; the release gives it its version.
const logPath = `${root}CHANGELOG.md`;
const log = readFileSync(logPath, "utf8");
const unreleased = /^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(log);
if (unreleased === null || unreleased[1].trim() === "") {
  fail("CHANGELOG.md has no `## Unreleased` section with what this version changes; write it first");
}
if (here === "develop") run("git", ["switch", "-q", "-c", release]);
const branch = here === "develop" ? release : here;
writeFileSync(logPath, log.replace(/^## Unreleased$/m, `## ${version}`));
writeFileSync(pkgPath, withVersion(readFileSync(pkgPath, "utf8"), version));
// The plugin is released with the tool: Claude Code updates it only when this version moves (§6.2).
const pluginPath = `${root}plugins/claude-code/.claude-plugin/plugin.json`;
writeFileSync(pluginPath, withVersion(readFileSync(pluginPath, "utf8"), version));

run("pnpm", ["typecheck"]);
run("pnpm", ["lint"]);
run("pnpm", ["test"]);
run("node", ["scripts/check-tag.mjs", tag]);
run("git", ["add", "CHANGELOG.md", "package.json", "plugins/claude-code/.claude-plugin/plugin.json"]);
run("git", ["commit", "-q", "-m", `Bump version to ${version}`]);

console.log(`\nCommitted the version ${version} on ${branch}. Nothing is pushed. Push it:
git push -u origin ${branch}
then open its pull request into main, titled "Release ${version}":
${repoPage}/compare/main...${branch}?expand=1
More commits on ${branch} go out with it. Merge it with a merge commit once its checks pass: that publishes it.

Once it is merged, bring main back into develop, and drop the branch:
git switch develop && git pull --ff-only origin develop && git fetch origin main && git merge --no-ff origin/main && git push origin develop
git branch -d ${branch} && git push origin --delete ${branch}`);
