import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error: a plain script, without types
import { tagProblem } from "../scripts/check-tag.mjs";
// @ts-expect-error: a plain script, without types
import { releaseIn, releaseNotes, releaseOfTag } from "../scripts/publish-release.mjs";
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

/** A repository with a main that a release pull request is merged into with a merge commit, as the how-to says. */
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
  git("commit", "-qm", `Release ${version}`);
  const commit = git("rev-parse", "HEAD");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", `Merge pull request #1 from release/${version}`, `release/${version}`);
  return { dir, git, before, commit, after: git("rev-parse", "HEAD") };
}

const NEVER = () => false;

test("merging a release's pull request publishes its commit, though a merge commit ends the push (§6.4)", () => {
  const r = released("1.2.0");
  try {
    const found = releaseIn(r.before, r.after, { cwd: r.dir, released: NEVER });
    assert.deepEqual(found, {
      tag: "v1.2.0",
      sha: r.commit,
      version: "1.2.0",
      notes: "- Added this.\n\n- And that.\n",
    });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a push with no release commit publishes nothing, and one already out is not published again", () => {
  const r = released("1.2.0");
  try {
    assert.equal(releaseIn(r.commit, r.after, { cwd: r.dir, released: NEVER }), undefined);
    r.git("tag", "v1.2.0", r.commit);
    assert.equal(releaseIn(r.before, r.after, { cwd: r.dir, released: () => true }), undefined);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a tag on a commit outside main publishes nothing, and one on main publishes that commit (§6.4)", () => {
  const r = released("1.2.0");
  try {
    r.git("tag", "v1.2.0", r.commit);
    const found = releaseOfTag("v1.2.0", { cwd: r.dir, released: NEVER, main: "main" });
    assert.equal(found.sha, r.commit);
    assert.equal(found.notes, "- Added this.\n\n- And that.\n");
    assert.equal(releaseOfTag("v1.2.0", { cwd: r.dir, released: () => true, main: "main" }), undefined);
    r.git("tag", "-d", "v1.2.0");

    r.git("switch", "-qc", "stray", r.before);
    r.git("commit", "-q", "--allow-empty", "-m", "Stray");
    r.git("tag", "v1.2.0");
    r.git("switch", "-q", "main");
    assert.throws(() => releaseOfTag("v1.2.0", { cwd: r.dir, released: NEVER, main: "main" }), /not on main/);
    // Then the release's merge finds that tag standing, and says so rather than taking it for its own.
    assert.throws(
      () => releaseIn(r.before, r.after, { cwd: r.dir, released: NEVER }),
      /the tag v1\.2\.0 exists with no release/,
    );
    r.git("tag", "-d", "v1.2.0");
    assert.throws(
      () => releaseIn(r.before, r.commit, { cwd: r.dir, released: NEVER, main: r.before }),
      /is not on main/,
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a commit named for another version than it sets publishes nothing", () => {
  const r = released("1.2.0");
  try {
    r.git("switch", "-qc", "wrong", r.before);
    r.git("commit", "-q", "--allow-empty", "-m", "Release 9.9.9");
    assert.throws(
      () => releaseIn(r.before, r.git("rev-parse", "HEAD"), { cwd: r.dir, released: NEVER }),
      /sets the version 1\.1\.0, not 9\.9\.9/,
    );
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
  assert.match(release, /"lib\/kioku\.mjs#kioku\.mjs"/);
  assert.match(release, /sha256sum lib\/kioku\.mjs/);
  assert.match(
    release,
    /"kioku\.mjs\.sha256#kioku\.mjs\.sha256"/,
    "the checksum the installer and `kioku update` check against (§6.4)",
  );
  assert.match(release, /sha256sum lib\/kioku-plugin\.tar\.gz/);
  assert.match(
    release,
    /"lib\/kioku-plugin\.tar\.gz#kioku-plugin\.tar\.gz" "kioku-plugin\.tar\.gz\.sha256#kioku-plugin\.tar\.gz\.sha256"/,
    "the plugin travels beside the bundle, with its own checksum (§6.2, §6.4)",
  );
  assert.ok(
    release.indexOf("check-tag.mjs") < release.indexOf("gh release create"),
    "the tag is checked before anything is published",
  );
  assert.match(
    release,
    /gh release create [^\n]* --target "\$SHA" [^\n]*--notes-file [^\n]* --latest$/m,
    "every release is the latest when it is published (§6.4)",
  );
  assert.doesNotMatch(release, /prerelease/);
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
    installer.indexOf('mv "$TMP/plugin" "$INSTALL_DIR/versions/$VERSION/plugin"') <
      installer.indexOf('ln -sfn "versions/$VERSION"'),
    "the plugin is in place before current moves, so current/plugin is always one (§6.2)",
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

test("the tag is v<version> and nothing else: a prefix in package.json is not read, and the release runs on v* only (§6.4)", () => {
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(release, /^ {4}tags: \["v\*"\]$/m);

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
