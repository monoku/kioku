import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error: a plain script, without types
import { tagProblem } from "../scripts/check-tag.mjs";
// @ts-expect-error: a plain script, without types
import { formula } from "../scripts/homebrew-formula.mjs";
// @ts-expect-error: a plain script, without types
import { githubApi, publishRelease, releaseIn, releaseNotes } from "../.github/scripts/publish-release.mjs";
// @ts-expect-error: a plain script, without types
import { withVersion } from "../scripts/json-version.mjs";
import { launcherScript } from "../src/core/setup/install.ts";
import { INSTALL_COMMAND, INSTALL_URL, PRODUCT_REPO } from "../src/product.ts";
import pkg from "../package.json" with { type: "json" };

/** `host/owner/repo` and `owner/repo` of the product, as package.json names it: what product.ts and install.sh must say. */
const REPO = pkg.repository.url.replace(/^https?:\/\//, "").replace(/\.git$/, "");
const OWNER_REPO = REPO.split("/").slice(1).join("/");
const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function repo(pkgVersion: string, pluginVersion = pkgVersion): string {
  const dir = mkdtempSync(join(tmpdir(), "kioku-tag-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: pkgVersion }));
  mkdirSync(join(dir, "plugins/claude-code/.claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, "plugins/claude-code/.claude-plugin/plugin.json"),
    JSON.stringify({ version: pluginVersion }),
  );
  return `${dir}/`;
}

test("a tag is accepted only when it is v<version> of package.json", () => {
  const ok = repo("0.1.0");
  try {
    assert.equal(tagProblem("v0.1.0", ok), undefined);
    assert.match(tagProblem("v0.2.0", ok), /is not v0\.1\.0/);
    assert.match(tagProblem("0.1.0", ok), /is not v0\.1\.0/);
  } finally {
    rmSync(ok, { recursive: true, force: true });
  }
});

test("release.mjs prepares <major>.<minor>.<patch> only, before it touches anything (§6.4)", () => {
  const script = fileURLToPath(new URL("../scripts/release.mjs", import.meta.url));
  for (const version of ["0.2.0-rc.1", "v0.2.0", ""]) {
    let said = "";
    assert.throws(
      () => execFileSync("node", [script, "prepare", version], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      (e: { status: number; stderr: string }) => {
        said = e.stderr;
        return e.status === 1;
      },
      version,
    );
    assert.equal(said.trim(), "usage: node scripts/release.mjs prepare <major.minor.patch>", version);
  }
});

test("release.mjs sets the version and leaves every other byte as the formatter laid it, so its own lint passes (§6.4)", () => {
  const plugin = readFileSync(new URL("../plugins/claude-code/.claude-plugin/plugin.json", import.meta.url), "utf8");
  const set = withVersion(plugin, "9.9.9");
  assert.equal(JSON.parse(set).version, "9.9.9");
  assert.equal(set, plugin.replace(/"version": "[^"]*"/, '"version": "9.9.9"'), "only the version moves");
  assert.match(set, /^ {2}"keywords": \[[^\n]*\],$/m, "an array on one line stays on one line");
  const nested = '{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": { "a": { "version": "1.0.0" } }\n}\n';
  assert.equal(
    JSON.parse(withVersion(nested, "0.2.0")).dependencies.a.version,
    "1.0.0",
    "a nested version is not touched",
  );
  assert.throws(() => withVersion('{ "name": "x" }', "0.2.0"), /no "version" field/);
  const script = readFileSync(new URL("../scripts/release.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /JSON\.stringify\(/, "the script rewrites no JSON file whole");
});

test("a tag with a part after the patch is refused: every release is <major>.<minor>.<patch> (§6.4)", () => {
  const dir = repo("0.2.0-rc.1");
  try {
    assert.match(tagProblem("v0.2.0-rc.1", dir) ?? "", /is not v<major>\.<minor>\.<patch>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tag is refused when the plugin's version is not the tool's (§6.2)", () => {
  const dir = repo("0.1.0", "0.0.9");
  try {
    assert.match(tagProblem("v0.1.0", dir), /plugin's version 0\.0\.9 is not 0\.1\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("this repository's tag for its version would be accepted", () => {
  assert.equal(tagProblem(`v${pkg.version}`), undefined);
});

const CHANGES =
  "# Changelog\n\n## Unreleased\n\n- Later.\n\n## 1.2.0\n\n- Added this.\n\n- And that.\n\n## 1.1.0\n\n- Older.\n";

/**
 * A repository with a main that a release branch is merged into with a merge commit, as git flow and the how-to have it:
 * the branch moves the version, and a fix follows it there.
 */
function released(version: string, dir = mkdtempSync(join(tmpdir(), "kioku-publish-"))) {
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
      { cwd: dir, encoding: "utf8" },
    ).trim();
  const files = (v: string) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: v }));
    writeFileSync(join(dir, "CHANGELOG.md"), CHANGES);
  };
  git("init", "-q", "-b", "main");
  files("1.1.0");
  git("add", ".");
  git("commit", "-qm", "Start");
  const before = git("rev-parse", "HEAD");
  git("switch", "-qc", `release/${version}`);
  files(version);
  git("add", ".");
  git("commit", "-qm", `Bump version to ${version}`);
  const commit = git("rev-parse", "HEAD");
  writeFileSync(join(dir, "fix.txt"), "found on the release branch\n");
  git("add", ".");
  git("commit", "-qm", "Fix what the release branch found");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", `Merge pull request #1 from release/v${version}`, `release/${version}`);
  return { dir, git, before, commit, after: git("rev-parse", "HEAD") };
}

const NEVER = () => false;

test("merging a release branch publishes what main is then at, the merge, with what followed the version on the branch (§6.4)", async () => {
  const r = released("1.2.0");
  try {
    const found = await releaseIn(r.before, r.after, { cwd: r.dir, released: NEVER });
    assert.deepEqual(found, {
      tag: "v1.2.0",
      sha: r.after,
      version: "1.2.0",
      notes: "- Added this.\n\n- And that.\n",
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a push that does not move the version publishes nothing, and one already out is not published again", async () => {
  const r = released("1.2.0");
  try {
    assert.equal(await releaseIn(r.commit, r.after, { cwd: r.dir, released: NEVER }), undefined);
    r.git("tag", "v1.2.0", r.after);
    assert.equal(await releaseIn(r.before, r.after, { cwd: r.dir, released: () => true }), undefined);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a tag standing where the release would put its own is refused, and a commit off main publishes nothing (§6.4)", async () => {
  const r = released("1.2.0");
  try {
    r.git("switch", "-qc", "stray", r.before);
    r.git("commit", "-q", "--allow-empty", "-m", "Stray");
    r.git("tag", "v1.2.0");
    r.git("switch", "-q", "main");
    // The release's merge finds that tag standing, and says so rather than taking it for its own.
    await assert.rejects(
      () => releaseIn(r.before, r.after, { cwd: r.dir, released: NEVER }),
      /the tag v1\.2\.0 exists with no release/,
    );
    r.git("tag", "-d", "v1.2.0");
    await assert.rejects(
      () => releaseIn(r.before, r.commit, { cwd: r.dir, released: NEVER, main: r.before }),
      /is not on main/,
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a commit's subject means nothing: only the version in package.json makes a release", async () => {
  const r = released("1.2.0");
  try {
    r.git("switch", "-qc", "wrong", r.before);
    r.git("commit", "-q", "--allow-empty", "-m", "Release 9.9.9");
    assert.equal(await releaseIn(r.before, r.git("rev-parse", "HEAD"), { cwd: r.dir, released: NEVER }), undefined);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a release's notes are its CHANGELOG section, and a version without one is not published", () => {
  assert.equal(releaseNotes(CHANGES, "1.1.0"), "- Older.\n");
  assert.throws(() => releaseNotes(CHANGES, "1.3.0"), /no section "## 1\.3\.0"/);
  assert.throws(() => releaseNotes("## 1.3.0\n\n## 1.2.0\n", "1.3.0"), /is empty/);
});

test("the release publishes the asset a brain's workflow fetches at its pinned version", () => {
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(release, /sha256sum lib\/kioku\.mjs/);
  assert.match(release, /sha256sum lib\/kioku-plugin\.tar\.gz/);
  assert.match(
    release,
    /publish-release\.mjs publish "\$TAG" "\$SHA" "[^"]*notes\.md" lib\/kioku\.mjs kioku\.mjs\.sha256 lib\/kioku-plugin\.tar\.gz kioku-plugin\.tar\.gz\.sha256$/m,
    "the bundle and the checksum the installer and `kioku update` check against, and the plugin beside it with its own (§6.2, §6.4)",
  );
  assert.ok(
    release.indexOf("check-tag.mjs") < release.indexOf("publish-release.mjs publish"),
    "the tag is checked before anything is published",
  );
  assert.doesNotMatch(release, /\bgh |GH_TOKEN|prerelease/, "GitHub's API through the script, no other tool");
  assert.deepEqual(
    [PRODUCT_REPO, INSTALL_URL],
    [REPO, `https://raw.githubusercontent.com/${OWNER_REPO}/main/install.sh`],
  );
  assert.equal(INSTALL_COMMAND, `curl -fsSL ${INSTALL_URL} | sh`);
});

test("the installer fetches from the product repository and lays the tool out as the tool expects (§6.3)", () => {
  const installer = readFileSync(new URL("../install.sh", import.meta.url), "utf8");
  assert.match(
    installer,
    new RegExp(`^REPO="\\$\\{KIOKU_REPO:-${escaped(OWNER_REPO)}\\}"$`, "m"),
    "the repository, written here too because the installer runs before the tool",
  );
  assert.ok(PRODUCT_REPO.endsWith(`/${OWNER_REPO}`));
  // The launcher the installer writes is the one `kioku update` writes (install.ts), with the shell's `$INSTALL_DIR` for the folder.
  const heredoc = /cat > "\$TMP\/launcher" <<LAUNCH\n([\s\S]*?)\nLAUNCH\n/.exec(installer);
  assert.ok(heredoc, "the installer writes the launcher from a heredoc");
  assert.equal(
    `${heredoc[1]!.replaceAll("\\$", "$")}\n`,
    launcherScript({ install: "$INSTALL_DIR", bin: "" }),
    "install.sh and launcherScript() write the same launcher",
  );
  assert.match(installer, /releases\/latest\/download/);
  assert.match(installer, /kioku\.mjs\.sha256/);
  assert.match(installer, /fetch kioku-plugin\.tar\.gz\.sha256/);
  assert.match(installer, /versions\/\$VERSION\/kioku\.mjs/);
  assert.ok(
    installer.indexOf('update --prepare --archive "$TMP/kioku-plugin.tar.gz"') <
      installer.indexOf('ln -sfn "versions/$VERSION"'),
    "the bundle downloaded puts its plugin in place before current moves, so current/plugin is always one (§6.2, §6.4)",
  );
  assert.match(installer, /ln -sfn "versions\/\$VERSION" "\$INSTALL_DIR\/current"/);
  assert.match(
    installer,
    /exec node "\$INSTALL_DIR\/current\/kioku\.mjs" "\\\$@"/,
    "the launcher the tool writes, written the same",
  );
  assert.match(
    installer,
    /\[ -n "\\\$\{KIOKU_BIN:-\}" \] && exec "\\\$KIOKU_BIN" "\\\$@"/,
    "the launcher runs KIOKU_BIN when it is set, as the tool's does",
  );
  assert.match(
    installer,
    /"\$LAUNCHER" setup "\$@" <\/dev\/tty/,
    "in a terminal, setup runs on the person's terminal, with the installer's arguments (§6.3)",
  );
  assert.match(
    installer,
    /\[ -z "\$\{KIOKU_NO_SETUP:-\}" \] && \[ -t 1 \]/,
    "only in a terminal, and not when told not to",
  );
  assert.match(installer, /Next, in a terminal: \$NEXT/);
  assert.match(installer, /XDG_DATA_HOME/);
});

/** The assets of a release in `assets`, as the build made them: the bundle and its plugin, each with its checksum. */
function serveRelease(assets: string): void {
  for (const asset of ["kioku.mjs", "kioku-plugin.tar.gz"]) {
    const bytes = readFileSync(new URL(`../lib/${asset}`, import.meta.url));
    writeFileSync(join(assets, asset), bytes);
    writeFileSync(join(assets, `${asset}.sha256`), `${createHash("sha256").update(bytes).digest("hex")}  ${asset}\n`);
  }
}

test("with no terminal the installer installs only, runs no setup and names the next step, by the launcher's whole path when its folder is not on the PATH (§6.3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-install-"));
  try {
    const assets = join(dir, "assets");
    mkdirSync(assets, { recursive: true });
    serveRelease(assets);
    const run = (path: string) =>
      execFileSync("sh", [fileURLToPath(new URL("../install.sh", import.meta.url))], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: path,
          KIOKU_BASE_URL: `file://${assets}`,
          KIOKU_INSTALL_DIR: join(dir, "share"),
          KIOKU_BIN_DIR: join(dir, "bin"),
          KIOKU_HOME: join(dir, "home"),
        },
      });
    const away = run(process.env.PATH ?? "");
    assert.match(
      away,
      new RegExp(
        `^Next, in a terminal: ${join(dir, "bin", "kioku").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} setup$`,
        "m",
      ),
    );
    assert.equal(existsSync(join(dir, "home", ".kioku")), false, "no configuration without a terminal");
    const plugin = JSON.parse(
      readFileSync(join(dir, "share", "current", "plugin", ".claude-plugin", "plugin.json"), "utf8"),
    );
    assert.equal(plugin.version, pkg.version, "the release's plugin beside the bundle, under current (§6.2, §6.3)");
    assert.ok(existsSync(join(dir, "share", "current", "plugin", ".claude-plugin", "marketplace.json")));
    const on = run(`${join(dir, "bin")}:${process.env.PATH ?? ""}`);
    assert.match(on, /^Next, in a terminal: kioku setup$/m, "its folder is on the PATH: the command alone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the installer installs nothing when the bundle it downloaded cannot put its plugin in place, and says why (§6.3, §6.4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-install-"));
  try {
    const assets = join(dir, "assets");
    mkdirSync(assets, { recursive: true });
    serveRelease(assets);
    const broken = Buffer.from("not an archive");
    writeFileSync(join(assets, "kioku-plugin.tar.gz"), broken);
    writeFileSync(
      join(assets, "kioku-plugin.tar.gz.sha256"),
      `${createHash("sha256").update(broken).digest("hex")}  kioku-plugin.tar.gz\n`,
    );
    let stderr = "";
    try {
      execFileSync("sh", [fileURLToPath(new URL("../install.sh", import.meta.url))], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          KIOKU_BASE_URL: `file://${assets}`,
          KIOKU_INSTALL_DIR: join(dir, "share"),
          KIOKU_BIN_DIR: join(dir, "bin"),
          KIOKU_HOME: join(dir, "home"),
        },
      });
      assert.fail("the installer succeeded");
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? "";
    }
    assert.match(
      stderr,
      /the plugin could not be put in place \(the plugin's archive is not one .*\); nothing was installed/,
    );
    assert.deepEqual(readdirSync(join(dir, "share", "versions")), [], "no version was left");
    assert.equal(existsSync(join(dir, "share", "current")), false, "and nothing was made current");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the installer says why a download failed, in curl's words (§6.3)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-install-"));
  try {
    let stderr = "";
    try {
      execFileSync("sh", [fileURLToPath(new URL("../install.sh", import.meta.url))], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          KIOKU_BASE_URL: `file://${join(dir, "nowhere")}`,
          KIOKU_INSTALL_DIR: join(dir, "share"),
          KIOKU_BIN_DIR: join(dir, "bin"),
          KIOKU_HOME: join(dir, "home"),
        },
      });
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? "";
    }
    assert.match(
      stderr,
      /^kioku install: could not download file:\/\/\S+\/nowhere\/kioku\.mjs: .*open.*/im,
      "the address and curl's reason, not the address alone",
    );
    assert.doesNotMatch(stderr, /no reason given/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in a terminal the installer runs setup with its own arguments, and a setup that fails leaves the tool installed and says how to run it again (§6.3)", {
  skip: process.platform === "win32",
}, () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-install-"));
  try {
    const assets = join(dir, "assets");
    mkdirSync(assets, { recursive: true });
    serveRelease(assets);
    const installer = fileURLToPath(new URL("../install.sh", import.meta.url));
    // A pseudo-terminal, as a person's: BSD's `script` takes the command after the file, util-linux's takes it in -c.
    const quoted = ["sh", installer, "--no-model"].map((a) => `'${a}'`).join(" ");
    const inTerminal = (home: string) =>
      execFileSync(
        "script",
        process.platform === "darwin"
          ? ["-q", "/dev/null", "sh", installer, "--no-model"]
          : ["-q", "-e", "-c", quoted, "/dev/null"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          // HOME too, only for this child: setup writes the shell's profile and completion there. node by its own path, not a shim that reads HOME.
          env: {
            ...process.env,
            HOME: home,
            PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
            KIOKU_BASE_URL: `file://${assets}`,
            KIOKU_INSTALL_DIR: join(dir, "share"),
            KIOKU_BIN_DIR: join(dir, "bin"),
            KIOKU_HOME: home,
            SHELL: "/bin/sh",
          },
        },
      ).replace(/\r/g, "");
    const ok = join(dir, "ok");
    mkdirSync(ok);
    const done = inTerminal(ok);
    assert.match(done, /Installed Kioku/);
    assert.match(readFileSync(join(ok, ".kioku/config.yaml"), "utf8"), /mode: full-text/, "--no-model reached setup");

    const broken = join(dir, "broken");
    mkdirSync(join(broken, ".kioku"), { recursive: true });
    writeFileSync(join(broken, ".kioku/config.yaml"), "user: [not, a, name\n");
    const failed = inTerminal(broken);
    assert.match(failed, /kioku setup did not finish; Kioku is installed\. To finish, in a terminal: \S*kioku setup/);
    assert.ok(existsSync(join(dir, "bin", "kioku")), "the launcher stays");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the tag is v<version> and nothing else: a prefix in package.json is not read, and only a push to main releases, never a tag (§6.4)", () => {
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(release, /^on:\n {2}push:\n(?: {4}#[^\n]*\n)* {4}branches: \[main\]\npermissions:/m);
  assert.doesNotMatch(release, /^ {4}tags:/m, "a tag pushed by hand runs no code with the token that writes");

  const dir = mkdtempSync(join(tmpdir(), "kioku-tag-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.2.0", kioku: { tagPrefix: "kioku--v" } }));
    mkdirSync(join(dir, "plugins/claude-code/.claude-plugin"), { recursive: true });
    writeFileSync(join(dir, "plugins/claude-code/.claude-plugin/plugin.json"), JSON.stringify({ version: "0.2.0" }));
    assert.equal(tagProblem("v0.2.0", `${dir}/`), undefined, "a prefix in package.json is not read");
    assert.match(tagProblem("kioku--v0.2.0", `${dir}/`) ?? "", /is not v0\.2\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A GitHub that answers the release API as it does, and keeps what it was asked; `failOn` makes one call fail. */
function fakeGitHub(failOn?: RegExp) {
  const calls: { method: string; url: string; body: unknown; type?: string }[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
    calls.push({ method: init.method, url, body: init.body, type: init.headers["content-type"] });
    const said = `${init.method} ${url}`;
    if (failOn?.test(said)) return new Response("no", { status: 500 });
    if (init.method === "GET") return new Response("", { status: 404 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: 7, html_url: "https://github.com/o/r/releases/tag/v1.2.0" });
  };
  return { calls, call: githubApi({ repo: "o/r", token: "t", fetch }) };
}

const ASSETS = [
  { name: "kioku.mjs", bytes: Buffer.from("bundle") },
  { name: "kioku.mjs.sha256", bytes: Buffer.from("sum") },
];

test("a release is made a draft, given its assets, then published as the latest, its tag on the commit (§6.4)", async () => {
  const github = fakeGitHub();
  await publishRelease(github.call, { tag: "v1.2.0", sha: "abc", notes: "- Added this.\n", assets: ASSETS });
  assert.deepEqual(
    github.calls.map((c) => `${c.method} ${c.url}`),
    [
      "POST https://api.github.com/repos/o/r/releases",
      "POST https://uploads.github.com/repos/o/r/releases/7/assets?name=kioku.mjs",
      "POST https://uploads.github.com/repos/o/r/releases/7/assets?name=kioku.mjs.sha256",
      "PATCH https://api.github.com/repos/o/r/releases/7",
    ],
  );
  assert.deepEqual(JSON.parse(github.calls[0]!.body as string), {
    tag_name: "v1.2.0",
    target_commitish: "abc",
    name: "v1.2.0",
    body: "- Added this.\n",
    draft: true,
  });
  assert.equal(github.calls[1]!.type, "application/octet-stream");
  assert.deepEqual(JSON.parse(github.calls[3]!.body as string), { draft: false, make_latest: "true" });
});

test("a release whose asset fails to upload is taken away, draft and all, and says what GitHub answered", async () => {
  const github = fakeGitHub(/assets\?name=kioku\.mjs\.sha256/);
  await assert.rejects(
    publishRelease(github.call, { tag: "v1.2.0", sha: "abc", notes: "n", assets: ASSETS }),
    /GitHub answered 500 to POST \/releases\/7\/assets\?name=kioku\.mjs\.sha256: no/,
  );
  assert.equal(github.calls.at(-1)!.method, "DELETE");
  assert.ok(!github.calls.some((c) => c.method === "PATCH"), "never published");
});

test("the Homebrew formula is the release's: its assets and checksums, Node, the plugin's hidden marketplace, the completion and the installer's next steps (§6.3)", () => {
  const bundleSha = "a".repeat(64);
  const pluginSha = "b".repeat(64);
  const rb: string = formula({ version: "1.2.0", bundleSha, pluginSha });
  assert.match(rb, /url "https:\/\/github\.com\/monoku\/kioku\/releases\/download\/v1\.2\.0\/kioku\.mjs"/);
  assert.match(rb, /url "https:\/\/github\.com\/monoku\/kioku\/releases\/download\/v1\.2\.0\/kioku-plugin\.tar\.gz"/);
  assert.match(rb, new RegExp(`sha256 "${bundleSha}"[\\s\\S]*sha256 "${pluginSha}"`));
  assert.match(rb, /depends_on "node"/);
  assert.match(rb, /install Dir\["\*"\], "\.claude-plugin"/, 'the hidden folder Dir["*"] leaves out');
  assert.match(rb, /generate_completions_from_executable\(bin\/"kioku", "completion"\)/);
  assert.match(rb, /chmod 0755, bin\/"kioku"/);
  assert.match(rb, /#\{libexec\}\/kioku\.mjs/, "the keg's own bundle: opt is linked only once the install ends");
  const steps = readFileSync(new URL("../docs/specs/06-the-tool.md", import.meta.url), "utf8").match(
    /```\nTo finish, in a terminal:\n([\s\S]*?)```/,
  );
  assert.ok(steps, "§6.3 names the next steps");
  assert.ok(
    rb.includes(`To finish, in a terminal:\n${steps[1]!.replace(/^/gm, "      ").trimEnd()}`),
    "as §6.3 says them",
  );
  assert.throws(() => formula({ version: "1.2.0-rc.1", bundleSha, pluginSha }), /not a release version/);
  assert.throws(() => formula({ version: "1.2.0", bundleSha: "nope", pluginSha }), /64 hexadecimal digits/);
});

test("the release moves the tap's formula only with its deploy key, and fails nothing without it (§6.3, §6.4)", () => {
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(release, /TAP_KEY_SET: \$\{\{ secrets\.HOMEBREW_TAP_DEPLOY_KEY != '' \}\}/);
  assert.match(release, /if: steps\.found\.outputs\.tag != '' && env\.TAP_KEY_SET == 'true'/);
  assert.match(release, /StrictHostKeyChecking=yes/, "GitHub's host keys from its API, none trusted on first sight");
  assert.match(release, /node scripts\/homebrew-formula\.mjs --version "\$\{TAG#v\}"/);
});
