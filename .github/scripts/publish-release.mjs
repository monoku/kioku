// What a push to main publishes (§6.4), for the `release` workflow. A release is the merge of a branch release/v<version>
// or hotfix/v<version> into main, as git flow has it: when a push moves the version in package.json and its tag is not
// there yet, the workflow tests the commit main is then at, the merge, and publishes it, creating the tag on it. So
// whatever the branch held when it was merged is released, commits after its version moved included. Every other push
// publishes nothing, and nothing else publishes: a tag pushed by hand is not a release, so that the token that writes
// only ever runs code that reached main through its pull request.
//
//   node .github/scripts/publish-release.mjs find <sha before the push> <sha after it> <file for the notes>
//       appends what it found to $GITHUB_OUTPUT, `tag` and `sha`, which stay absent when there is nothing to publish
//   node .github/scripts/publish-release.mjs publish <tag> <sha> <file for the notes> <asset>...
//       creates the GitHub release, its tag on <sha>, with the assets under their own names, as the latest
//
// It speaks to GitHub's REST API with fetch and the workflow's GITHUB_TOKEN, for GITHUB_REPOSITORY: no other tool.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const NOTHING_BEFORE = /^0+$/;

/** `git` in a repository, answering what it printed. */
const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** What the release page says: the CHANGELOG's section for the version. */
export function releaseNotes(changelog, version) {
  const start = changelog.search(new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "m"));
  if (start === -1) throw new Error(`CHANGELOG.md has no section "## ${version}"`);
  const body = changelog.slice(changelog.indexOf("\n", start) + 1);
  const end = body.search(/^## /m);
  const section = (end === -1 ? body : body.slice(0, end)).trim();
  if (section === "") throw new Error(`the section "## ${version}" of CHANGELOG.md is empty`);
  return `${section}\n`;
}

/**
 * The release a push brings to main, or undefined when it brings none, or brought one that is out already. A push
 * brings one when it moves the version in package.json: what main is at after it is the release, merge commit and all.
 * A tag with no release is refused: it was not made here, and what it names was not tested as a release.
 */
export async function releaseIn(before, after, { cwd = root, released, main = after }) {
  const git = gitIn(cwd);
  const versionAt = (sha) => JSON.parse(git("show", `${sha}:package.json`)).version;
  const version = versionAt(after);
  if (!NOTHING_BEFORE.test(before) && versionAt(before) === version) return undefined;
  // The push was to main, so this holds; it is checked because what follows is public and cannot be taken back.
  try {
    git("merge-base", "--is-ancestor", after, main);
  } catch {
    throw new Error(`the commit ${after.slice(0, 7)} is not on main`);
  }
  const tag = `v${version}`;
  if (git("tag", "--list", tag) !== "") {
    if (await released(tag)) return undefined;
    throw new Error(
      `the tag ${tag} exists with no release: a release creates its own tag, so remove it, or release the next version`,
    );
  }
  return {
    tag,
    sha: git("rev-parse", after),
    version,
    notes: releaseNotes(git("show", `${after}:CHANGELOG.md`), version),
  };
}

/** GitHub's REST API for one repository, through `fetch`: what a path answers, or an error that says what it said. */
export function githubApi({ repo, token, fetch: get = fetch, api = "https://api.github.com" }) {
  return async (method, path, body, { base = api, type } = {}) => {
    const response = await get(`${base}/repos/${repo}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": type ?? "application/json" }),
      },
      body: body === undefined || type !== undefined ? body : JSON.stringify(body),
    });
    if (response.status === 404 && method === "GET") return undefined;
    if (!response.ok)
      throw new Error(`GitHub answered ${response.status} to ${method} ${path}: ${await response.text()}`);
    return response.status === 204 ? {} : response.json();
  };
}

/** Whether a tag has its release on GitHub. */
export const hasRelease = (call) => async (tag) =>
  (await call("GET", `/releases/tags/${encodeURIComponent(tag)}`)) !== undefined;

/**
 * Publishes the release: a draft first, which makes no tag, then each asset under its own name, then the release, which
 * creates the tag on `sha` and is the latest (§6.4). Whatever fails before that takes the draft away: nothing is left
 * half made, and running it again starts clean.
 */
export async function publishRelease(call, { tag, sha, notes, assets }) {
  const draft = await call("POST", "/releases", {
    tag_name: tag,
    target_commitish: sha,
    name: tag,
    body: notes,
    draft: true,
  });
  try {
    for (const { name, bytes } of assets) {
      await call("POST", `/releases/${draft.id}/assets?name=${encodeURIComponent(name)}`, bytes, {
        base: "https://uploads.github.com",
        type: "application/octet-stream",
      });
    }
    return await call("PATCH", `/releases/${draft.id}`, { draft: false, make_latest: "true" });
  } catch (e) {
    await call("DELETE", `/releases/${draft.id}`).catch(() => {});
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step, ...args] = process.argv.slice(2);
  const call = githubApi({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN });
  try {
    if (step === "find") {
      const [before, after, notesFile] = args;
      const released = hasRelease(call);
      const release = await releaseIn(before, after, { released });
      if (release === undefined) {
        console.log("This push brings no release to publish.");
      } else {
        writeFileSync(notesFile, release.notes);
        appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\nsha=${release.sha}\n`);
        console.log(`To publish: ${release.tag} at ${release.sha}.`);
      }
    } else if (step === "publish") {
      const [tag, sha, notesFile, ...files] = args;
      const assets = files.map((f) => ({ name: basename(f), bytes: readFileSync(f) }));
      const done = await publishRelease(call, { tag, sha, notes: readFileSync(notesFile, "utf8"), assets });
      console.log(`Published ${tag}: ${done.html_url}`);
    } else {
      throw new Error(
        "usage: publish-release.mjs find <before> <after> <notes> | publish <tag> <sha> <notes> <asset>...",
      );
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
