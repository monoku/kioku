// What a push to main publishes (§6.4), for the `release` workflow. A release is the commit `Release <version>` that
// `scripts/release.mjs prepare` made: when a push brings one to main and its tag is not there yet, the workflow tests
// that commit and publishes it, creating the tag. A tag pushed by hand publishes its commit if that is on main. Every
// other push publishes nothing.
//
//   node scripts/publish-release.mjs <sha before the push> <sha after it> <file for the notes>
//
// It appends what it found to $GITHUB_OUTPUT, `tag` and `sha`, which stay absent when there is nothing to publish.
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const NOTHING_BEFORE = /^0+$/;

/** `git` in a repository, answering what it printed. */
const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** What the release page says: the CHANGELOG's section for the version. */
export function releaseNotes(changelog, version) {
  const start = changelog.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}[ \\t]*$`, "m"));
  if (start === -1) throw new Error(`CHANGELOG.md has no section "## ${version}"`);
  const body = changelog.slice(changelog.indexOf("\n", start) + 1);
  const end = body.search(/^## /m);
  const section = (end === -1 ? body : body.slice(0, end)).trim();
  if (section === "") throw new Error(`the section "## ${version}" of CHANGELOG.md is empty`);
  return `${section}\n`;
}

/**
 * The release a push brings to main, or undefined when it brings none, or brought one that is out already. A merge
 * commit is what ends the push, so the release commit is looked for among all it brought. A tag with no release is
 * refused: it was not made here, and what it names was not tested as a release.
 */
export function releaseIn(before, after, { cwd = root, released, main = after }) {
  const git = gitIn(cwd);
  const range = NOTHING_BEFORE.test(before) ? ["-1", after] : [`${before}..${after}`];
  const found = git("log", ...range, "--format=%H%x09%s")
    .split("\n")
    .map((line) => line.split("\t"))
    .map(([sha, subject]) => ({ sha, version: /^Release (\d+\.\d+\.\d+)$/.exec(subject ?? "")?.[1] }))
    .find((c) => c.version !== undefined);
  if (found === undefined) return undefined;
  const { sha, version } = found;
  const pkg = JSON.parse(git("show", `${sha}:package.json`));
  if (pkg.version !== version)
    throw new Error(`the commit ${sha.slice(0, 7)} sets the version ${pkg.version}, not ${version}`);
  // The push was to main, so this holds; it is checked because what follows is public and cannot be taken back.
  try {
    git("merge-base", "--is-ancestor", sha, main);
  } catch {
    throw new Error(`the commit ${sha.slice(0, 7)} is not on main`);
  }
  const tag = `v${version}`;
  if (git("tag", "--list", tag) !== "") {
    if (released(tag)) return undefined;
    throw new Error(
      `the tag ${tag} exists with no release: a release creates its own tag, so remove it, or release the next version`,
    );
  }
  return { tag, sha, version, notes: releaseNotes(git("show", `${sha}:CHANGELOG.md`), version) };
}

/**
 * The release a tag pushed by hand asks for, or undefined when it is out already. Its commit must be on main: a tag
 * on a stray commit never becomes a release. That it names the commit's version, `check-tag` holds next.
 */
export function releaseOfTag(tag, { cwd = root, released, main = "origin/main" }) {
  const git = gitIn(cwd);
  if (released(tag)) return undefined;
  const sha = git("rev-parse", `${tag}^{commit}`);
  try {
    git("merge-base", "--is-ancestor", sha, main);
  } catch {
    throw new Error(`the tag ${tag} is on ${sha.slice(0, 7)}, which is not on main: it publishes nothing`);
  }
  const { version } = JSON.parse(git("show", `${sha}:package.json`));
  return { tag, sha, version, notes: releaseNotes(git("show", `${sha}:CHANGELOG.md`), version) };
}

const hasRelease = (tag) => {
  try {
    execFileSync("gh", ["release", "view", tag], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [before, after, notesFile] = process.argv.slice(2);
  try {
    const release =
      process.env.GITHUB_REF_TYPE === "tag"
        ? releaseOfTag(process.env.GITHUB_REF_NAME, { released: hasRelease })
        : releaseIn(before, after, { released: hasRelease });
    if (release === undefined) {
      console.log("This push brings no release to publish.");
    } else {
      writeFileSync(notesFile, release.notes);
      appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\nsha=${release.sha}\n`);
      console.log(`To publish: ${release.tag} at ${release.sha}.`);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
