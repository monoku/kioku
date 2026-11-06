import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type Context } from "../../src/cli/run.ts";
import { finishByBundle } from "../../src/cli/update.ts";
import {
  currentBundle,
  currentVersion,
  installDirs,
  installedVersions,
  installOrigin,
  launcherPath,
  newerThan,
  versionsDir,
  type InstallDirs,
} from "../../src/core/setup/install.ts";
import { installBundle, lastCheck, readUpdateState, recordAvailable } from "../../src/core/setup/update.ts";
import { updateStatePath } from "../../src/core/state.ts";
import type { Download } from "../../src/core/semantic/install.ts";
import { ctx, OFFLINE } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { world, type World } from "../world.ts";
// @ts-expect-error: a plain script, without types
import { tarGz } from "../../scripts/plugin-archive.mjs";

isolateGit();

/** A bundle that answers `--version --json` as the tool does, and nothing else. */
const bundleOf = (version: string): string =>
  `console.log(JSON.stringify({ version: "${version}", contract: 1, formats: [1] }));\n`;
const sha = (body: string | Buffer): string => createHash("sha256").update(body).digest("hex");

/** The plugin a release of `version` carries beside its bundle (§6.2, §6.4): a marketplace and the plugin's manifest. */
const pluginArchiveOf = (version: string): Buffer =>
  tarGz([
    {
      name: ".claude-plugin/marketplace.json",
      data: Buffer.from(JSON.stringify({ name: "kioku", plugins: [{ name: "kioku", source: "./" }] })),
    },
    { name: ".claude-plugin/plugin.json", data: Buffer.from(JSON.stringify({ name: "kioku", version })) },
  ]);

/** The version of the plugin a version's folder holds; undefined when it holds none. */
const pluginIn = (dirs: InstallDirs, version: string): string | undefined => {
  const manifest = join(versionsDir(dirs), version, "plugin", ".claude-plugin", "plugin.json");
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : undefined;
};

/** A release server: the assets by URL; anything else answers 404. */
const serve =
  (assets: Record<string, string | Buffer>): Download =>
  async (url) => {
    const body = assets[url];
    if (body === undefined) throw new Error(`${url} answered 404`);
    return (async function* () {
      yield Buffer.from(body);
    })();
  };

interface Box {
  dir: string;
  home: string;
  dirs: InstallDirs;
  env: NodeJS.ProcessEnv;
  assets: Record<string, string | Buffer>;
  /** Publish `body` as the latest release, with its checksum, and as its version's release. */
  release: (version: string, body?: string, checksum?: string) => void;
  /** Publish a version's release that is not the latest: a candidate, or one before. */
  tagged: (version: string, body?: string) => void;
  /** A version already installed and active on this machine. */
  installed: (version: string) => void;
  /** The bundles `update` handed the finishing to, in order. */
  finishes: string[];
  kioku: (
    argv: string[],
    o?: {
      interactive?: boolean;
      tty?: boolean;
      finishUpdate?: Context["finishUpdate"];
      prepareUpdate?: Context["prepareUpdate"];
      bundle?: string;
    },
  ) => Promise<{ code: number; out: any; raw: string }>;
}

/** A bundle the installer installed: one under its folder, which is what `update` updates (§6.4). */
const installerBundle = (dirs: InstallDirs): string => join(dirs.install, "versions", "0.0.0", "kioku.mjs");

const RELEASES = "https://releases.test/releases";
const BASE = `${RELEASES}/latest/download`;

async function box<T>(fn: (b: Box) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kioku-update-"));
  try {
    const home = join(dir, "kiokuhome");
    const person = join(dir, "person");
    mkdirSync(person);
    const env = {
      KIOKU_INSTALL_DIR: join(dir, "install"),
      KIOKU_BIN_DIR: join(dir, "bin"),
      KIOKU_RELEASES_URL: RELEASES,
    };
    const dirs = installDirs(person, env);
    const assets: Record<string, string | Buffer> = {};
    const finishes: string[] = [];
    const b: Box = {
      dir,
      home,
      dirs,
      env,
      assets,
      finishes,
      release: (version, body = bundleOf(version), checksum = sha(body)) => {
        assets[`${BASE}/kioku.mjs`] = body;
        assets[`${BASE}/kioku.mjs.sha256`] = `${checksum}  kioku.mjs\n`;
        assets[`${BASE}/kioku-plugin.tar.gz`] = pluginArchiveOf(version);
        assets[`${BASE}/kioku-plugin.tar.gz.sha256`] = `${sha(pluginArchiveOf(version))}  kioku-plugin.tar.gz\n`;
        b.tagged(version, body);
      },
      tagged: (version, body = bundleOf(version)) => {
        assets[`${RELEASES}/download/v${version}/kioku.mjs`] = body;
        assets[`${RELEASES}/download/v${version}/kioku.mjs.sha256`] = `${sha(body)}  kioku.mjs\n`;
        assets[`${RELEASES}/download/v${version}/kioku-plugin.tar.gz`] = pluginArchiveOf(version);
        assets[`${RELEASES}/download/v${version}/kioku-plugin.tar.gz.sha256`] =
          `${sha(pluginArchiveOf(version))}  kioku-plugin.tar.gz\n`;
      },
      installed: (version) => {
        const file = join(dir, `${version}.mjs`);
        writeFileSync(file, bundleOf(version));
        installBundle(dirs, version, file);
      },
      kioku: async (argv, o = {}) => {
        let raw = "";
        const context = ctx({
          home,
          hostHome: person,
          cwd: dir,
          env: { ...env, PATH: `${dirs.bin}:/usr/bin` },
          semantic: { ...OFFLINE, download: serve(assets) },
          interactive: o.interactive ?? false,
          bundle: o.bundle ?? installerBundle(dirs),
        });
        if (o.prepareUpdate !== undefined) context.prepareUpdate = o.prepareUpdate;
        // What the bundle just installed would do, done here by this same code, so the test sees it; which bundle was asked is recorded.
        context.finishUpdate =
          o.finishUpdate ??
          (async (bundle) => {
            finishes.push(bundle);
            let out = "";
            await run(["update", "--finish", "--json"], { stdout: (t) => (out += t), isTty: false }, context);
            return JSON.parse(out);
          });
        const code = await run(argv, { stdout: (t) => (raw += t), isTty: o.tty ?? false }, context);
        return { code, raw, out: (o.tty ?? false) || raw.trim() === "" ? raw : JSON.parse(raw) };
      },
    };
    return await fn(b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The launcher run as a person runs it, without the `KIOKU_BIN` a developer's shell may carry (§6.3): the test is about the version it made current. */
const { KIOKU_BIN: _devBuild, ...LAUNCHER_ENV } = process.env;
const version = (b: Box): string =>
  JSON.parse(execFileSync(launcherPath(b.dirs), ["--version", "--json"], { encoding: "utf8", env: LAUNCHER_ENV }))
    .version;

test("update installs the latest release under versions/, makes it current, and the launcher runs it from the next call (§6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    assert.equal(version(b), "0.5.0");
    b.release("0.6.0");
    const r = await b.kioku(["update"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(
      [r.out.status, r.out.version, r.out.was, r.out.installed, r.out.pruned, r.out.dryRun],
      ["updated", "0.6.0", "0.5.0", true, [], false],
    );
    assert.equal(currentVersion(b.dirs), "0.6.0");
    assert.equal(version(b), "0.6.0");
    assert.equal(
      pluginIn(b.dirs, "0.6.0"),
      "0.6.0",
      "the release's plugin beside its bundle, which current/plugin is (§6.2)",
    );
    assert.deepEqual(installedVersions(b.dirs), ["0.6.0", "0.5.0"], "the version before is kept");
    assert.ok(
      readdirSync(versionsDir(b.dirs)).every((f) => !f.startsWith(".")),
      "no download is left behind",
    );

    const again = await b.kioku(["update"], { tty: true });
    assert.match(again.raw, /^Kioku 0\.6\.0 is the latest version\.\n$/);
    assert.equal(
      lastCheck(b.home)?.toISOString(),
      new Date(2026, 9, 7, 12, 0, 0).toISOString(),
      "the day's check is recorded",
    );
  }));

/** The bundle of a tool the installer installed in a world's home. */
const installedIn = (w: World): string => installerBundle(installDirs(w.home, {}));

/** A session's start, for a tool run from `bundle`: under the installer's folder, elsewhere, or from source. */
const sessionOf = (w: World, bundle: string | undefined) => async (now: Date) => {
  w.calls.length = 0;
  const r = await w.kioku(["hook", "session-start"], {
    stdin: JSON.stringify({ cwd: w.repo, source: "startup" }),
    context: { now: () => now, ...(bundle !== undefined && { bundle }) },
  });
  assert.equal(r.code, 0, r.raw);
  return { calls: w.calls.filter((c) => c[0] === "update"), said: (r.out.systemMessage ?? "") as string };
};

test("where the installer installed the tool, a session looks for a new version once a day in the background and installs nothing; muted, it does not look (§6.4)", () =>
  world(async (w) => {
    const session = async (now: Date) => (await sessionOf(w, installedIn(w))(now)).calls;
    const day1 = new Date(2026, 9, 7, 9, 0, 0);
    assert.deepEqual(await session(day1), [["update", "--check"]], "the first session looks, and only looks");
    assert.equal(lastCheck(w.home)?.getTime(), day1.getTime());
    assert.deepEqual(await session(new Date(2026, 9, 7, 20, 0, 0)), [], "not again the same day");
    assert.deepEqual(await session(new Date(2026, 9, 8, 9, 30, 0)), [["update", "--check"]], "again a day later");

    writeFileSync(updateStatePath(w.home), "{ not json");
    assert.deepEqual(
      await session(new Date(2026, 9, 8, 10, 0, 0)),
      [["update", "--check"]],
      "an unreadable stamp counts as never",
    );

    await w.kioku(["config", "set", "display.mute", "+update-available"], { context: { interactive: true } });
    assert.deepEqual(await session(new Date(2026, 9, 20, 9, 0, 0)), [], "nothing would use the look, so there is none");
    const doctor = (await w.kioku(["doctor"], { context: { bundle: installedIn(w) } })).out.checks.find(
      (c: { name: string }) => c.name === "kioku updates",
    );
    assert.equal(doctor.state, "ok");
    assert.match(
      doctor.detail,
      /the daily look is off \(update-available muted\); last looked for a new version on 2026-10-08; kioku update still works/,
    );
  }));

test("a newer version a look found is said once, in the next session, and muting it silences it (§6.4)", () =>
  world(async (w) => {
    const session = sessionOf(w, installedIn(w));
    const first = await session(new Date(2026, 9, 7, 9, 0, 0));
    assert.doesNotMatch(first.said, /is available/, "nothing is said before something is found");
    recordAvailable(w.home, "9.9.9");
    const next = await session(new Date(2026, 9, 7, 10, 0, 0));
    assert.deepEqual(next.calls, [], "not looked for again the same day");
    assert.match(
      next.said,
      /⬢ kioku\.md · 9\.9\.9 is available\n {2}⎿ this machine runs [\d.]+(?:-dev)?\n {2}⎿ run kioku update in a terminal/,
      "the one place a session says a version: the newer one, and the one this machine runs",
    );
    assert.doesNotMatch((await session(new Date(2026, 9, 7, 11, 0, 0))).said, /is available/, "once for each look");
    assert.equal(readUpdateState(w.home).checked !== undefined, true, "the day's stamp is kept");

    recordAvailable(w.home, "9.9.9");
    await w.kioku(["config", "set", "display.mute", "+update-available"], { context: { interactive: true } });
    const muted = await session(new Date(2026, 9, 9, 9, 0, 0));
    assert.doesNotMatch(muted.said, /is available/, "muted, it says nothing");
    assert.deepEqual(muted.calls, [], "and looks for nothing");
  }));

test("a tool the installer did not install never looks, and update changes nothing and names what updates it (§6.4)", () =>
  world(async (w) => {
    recordAvailable(w.home, "9.9.9");
    for (const bundle of [undefined, "/opt/homebrew/Cellar/kioku/1.0.0/libexec/kioku.mjs"]) {
      const s = await sessionOf(w, bundle)(new Date(2026, 9, 7, 9, 0, 0));
      assert.deepEqual(s.calls, [], bundle ?? "from source");
      assert.doesNotMatch(s.said, /is available/, bundle ?? "from source");
    }
    assert.equal(lastCheck(w.home), undefined, "no look was stamped");
    const doctor = (
      await w.kioku(["doctor"], { context: { bundle: "/opt/homebrew/Cellar/kioku/1.0.0/libexec/kioku.mjs" } })
    ).out.checks.find((c: { name: string }) => c.name === "kioku updates");
    assert.match(doctor.detail, /installed by Homebrew, which updates it: brew upgrade kioku/);
  }).then(() =>
    box(async (b) => {
      b.installed("0.5.0");
      b.release("0.6.0");
      const brew = "/home/linuxbrew/.linuxbrew/Cellar/kioku/0.5.0/libexec/kioku.mjs";
      for (const argv of [["update"], ["update", "--check"], ["update", "0.6.0"], ["update", "--dry-run"]]) {
        const r = await b.kioku(argv, { bundle: brew, interactive: true });
        assert.equal(r.code, 0, r.raw);
        assert.deepEqual(
          r.out,
          { status: "managed", origin: "homebrew", command: "brew upgrade kioku" },
          argv.join(" "),
        );
      }
      const text = await b.kioku(["update"], { bundle: brew, tty: true });
      assert.equal(text.raw, "Kioku was installed by Homebrew, which updates it: brew upgrade kioku\n");
      const other = await b.kioku(["update"], { bundle: join(b.dir, "build", "kioku.mjs") });
      assert.deepEqual(other.out, { status: "managed", origin: "other" });
      assert.equal(currentVersion(b.dirs), "0.5.0", "nothing changed");
      assert.equal(readUpdateState(b.home).checked, undefined, "nothing was looked for");
    }),
  ));

test("how the tool was installed is read from the bundle it runs: under the installer's folder, through current too, in Homebrew's cellar, or anything else (§6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    assert.equal(installOrigin(b.dirs, currentBundle(b.dirs)), "installer", "through the current link");
    assert.equal(installOrigin(b.dirs, join(versionsDir(b.dirs), "0.5.0", "kioku.mjs")), "installer");
    assert.equal(installOrigin(b.dirs, "/opt/homebrew/Cellar/kioku/1.0.0/libexec/kioku.mjs"), "homebrew");
    assert.equal(installOrigin(b.dirs, "/usr/local/opt/kioku/libexec/kioku.mjs"), "homebrew");
    assert.equal(installOrigin(b.dirs, "/home/linuxbrew/.linuxbrew/bin/kioku.mjs"), "homebrew");
    assert.equal(installOrigin(b.dirs, join(b.dir, "checkout", "lib", "kioku.mjs")), "other");
    assert.equal(installOrigin(b.dirs, `${b.dirs.install}-old/kioku.mjs`), "other", "a folder beside it is not it");
    assert.equal(installOrigin(b.dirs, undefined), "other", "run from source");
  }));

test("--check records the newer version a session says, installing clears it, and says what changed and the way back (§6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    b.release("0.6.0");
    assert.equal((await b.kioku(["update", "--check"])).code, 0);
    assert.equal(readUpdateState(b.home).available, "0.6.0");
    const r = await b.kioku(["update"], { tty: true });
    assert.equal(r.code, 0, r.raw);
    assert.match(
      r.raw,
      /^Installed Kioku 0\.6\.0 \(was 0\.5\.0\); every kioku call now runs it\. What changed: https:\/\/\S+\/CHANGELOG\.md\. To go back: kioku update 0\.5\.0, in a terminal\./,
    );
    assert.equal(readUpdateState(b.home).available, undefined);
    assert.equal((await b.kioku(["update", "--check"])).code, 0);
    assert.equal(readUpdateState(b.home).available, undefined, "nothing newer: nothing to say");
  }));

test("older versions are removed, keeping the one before the new one and never the active one", () =>
  box(async (b) => {
    b.installed("0.4.0");
    b.installed("0.5.0");
    b.release("0.6.0");
    const r = await b.kioku(["update"]);
    assert.deepEqual(r.out.pruned, ["0.4.0"]);
    assert.deepEqual(installedVersions(b.dirs), ["0.6.0", "0.5.0"]);
    assert.equal(newerThan("0.10.0", "0.9.0"), true, "by number, not by text");
    assert.equal(newerThan("0.5.2", "0.5.2"), false);
  }));

test("versions are ordered as semantic versioning orders them, a pre-release part included, as a build of its own may carry (§6.4)", () => {
  const order = [
    "1.1.0",
    "1.2.0-dev",
    "1.2.0-rc.1",
    "1.2.0-rc.2",
    "1.2.0-rc.10",
    "1.2.0",
    "1.2.1-rc.1",
    "1.2.1",
    "1.10.0",
  ];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      assert.equal(newerThan(order[i]!, order[j]!), i > j, `${order[i]} against ${order[j]}`);
    }
  }
  assert.equal(newerThan("1.2.0+build.5", "1.2.0"), false, "build metadata does not order");
  assert.equal(newerThan("1.2.0-rc.1.1", "1.2.0-rc.1"), true, "more identifiers come after");
});

test("update never takes a machine back: one on a version newer than the latest stays there until a newer one is the latest (§6.4)", () =>
  box(async (b) => {
    b.installed("1.2.0");
    b.release("1.2.0");
    b.tagged("1.3.0");
    b.installed("1.3.0");
    const stay = await b.kioku(["update"]);
    assert.equal(stay.code, 0, stay.raw);
    assert.deepEqual(
      [stay.out.status, stay.out.version, stay.out.latest, stay.out.was, stay.out.installed],
      ["current", "1.3.0", "1.2.0", "1.3.0", false],
    );
    assert.equal(currentVersion(b.dirs), "1.3.0");
    assert.match(
      (await b.kioku(["update"], { tty: true })).raw,
      /^Kioku 1\.3\.0 is newer than the latest release, 1\.2\.0; it stays until a newer release is the latest\.\n$/,
    );
    assert.equal((await b.kioku(["update", "--check"])).out.status, "current", "--check sees nothing newer either");

    b.release("1.4.0");
    const on = await b.kioku(["update"]);
    assert.deepEqual([on.out.status, on.out.version, on.out.was], ["updated", "1.4.0", "1.3.0"]);
    assert.deepEqual(installedVersions(b.dirs), ["1.4.0", "1.3.0"], "1.3.0 is the version before, and 1.2.0 is pruned");
  }));

test("a build of its own newer than the latest release stays; an older one moves to the release (§6.4)", () =>
  box(async (b) => {
    b.installed("1.1.0");
    b.release("1.1.0");
    b.installed("1.2.0-dev");
    assert.equal((await b.kioku(["update"])).out.status, "current");
    assert.equal(currentVersion(b.dirs), "1.2.0-dev");
    b.installed("1.1.0-dev");
    const moved = await b.kioku(["update"]);
    assert.deepEqual([moved.out.status, moved.out.version], ["updated", "1.1.0"]);
  }));

test("update <version> installs that release, an older one too, only in a terminal; the latest takes it forward again (§6.4)", () =>
  box(async (b) => {
    b.installed("1.1.0");
    b.release("1.1.0");
    b.tagged("1.0.0");
    const refused = await b.kioku(["update", "1.0.0"]);
    assert.equal(refused.out.error.code, "needs_terminal");
    assert.equal(currentVersion(b.dirs), "1.1.0");

    const check = await b.kioku(["update", "1.0.0", "--check"], { tty: true });
    assert.match(
      check.raw,
      /^Kioku 1\.0\.0 is available; this machine runs 1\.1\.0\. Run kioku update 1\.0\.0 to install it\.\n$/,
    );
    assert.equal(currentVersion(b.dirs), "1.1.0", "--check outside a terminal installs nothing and needs none");

    const back = await b.kioku(["update", "v1.0.0"], { interactive: true });
    assert.equal(back.code, 0, back.raw);
    assert.deepEqual(
      [back.out.status, back.out.version, back.out.was],
      ["updated", "1.0.0", "1.1.0"],
      "named, it goes back",
    );
    assert.equal(version(b), "1.0.0");
    assert.equal((await b.kioku(["update", "1.0.0"], { interactive: true })).out.status, "current");

    const forward = await b.kioku(["update"], { interactive: true });
    assert.deepEqual([forward.out.status, forward.out.version, forward.out.was], ["updated", "1.1.0", "1.0.0"]);
    assert.equal(
      (await b.kioku(["update", "1.2.0-rc.1"], { interactive: true })).out.error.code,
      "usage",
      "a release is <major>.<minor>.<patch>",
    );
  }));

test("update <version> refuses what is not a version, a release that does not exist, and one that holds another version; there is no --from", () =>
  box(async (b) => {
    b.installed("1.1.0");
    assert.equal((await b.kioku(["update", "latest"], { interactive: true })).out.error.code, "usage");
    assert.equal((await b.kioku(["update", "1.2.0", "1.3.0"], { interactive: true })).out.error.code, "usage");
    const from = (await b.kioku(["update", "--from", "x.mjs"], { interactive: true })).out.error;
    assert.deepEqual([from.code, from.message.startsWith("unknown flag --from;")], ["usage", true], from.message);
    const missing = await b.kioku(["update", "9.9.9"], { interactive: true });
    assert.equal(missing.out.error.code, "update_failed");
    assert.match(missing.out.error.message, /could not fetch the release of 9\.9\.9/);
    b.tagged("1.3.0", bundleOf("1.4.0"));
    const other = await b.kioku(["update", "1.3.0"], { interactive: true });
    assert.equal(other.out.error.code, "update_failed");
    assert.match(other.out.error.message, /holds 1\.4\.0, not 1\.3\.0/);
    assert.equal(currentVersion(b.dirs), "1.1.0");
    assert.deepEqual(readdirSync(versionsDir(b.dirs)), ["1.1.0"], "no scratch file is left");
  }));

test("--check says whether there is a newer version, --dry-run what it would do, and neither writes anything", () =>
  box(async (b) => {
    b.installed("0.5.0");
    b.release("0.6.0");
    const check = await b.kioku(["update", "--check"]);
    assert.deepEqual(
      [check.out.status, check.out.version, check.out.was, check.out.dryRun],
      ["available", "0.6.0", "0.5.0", true],
    );
    const dry = await b.kioku(["update", "--dry-run"], { tty: true });
    assert.match(dry.raw, /Kioku 0\.6\.0 is available; this machine runs 0\.5\.0/);
    assert.equal(currentVersion(b.dirs), "0.5.0");
    assert.deepEqual(installedVersions(b.dirs), ["0.5.0"]);

    b.release("0.5.0");
    assert.equal(
      (await b.kioku(["update", "--check"])).out.status,
      "current",
      "the same bytes as the installed bundle",
    );
  }));

test("a download that does not match its checksum, is not a bundle, or cannot be fetched changes nothing", () =>
  box(async (b) => {
    b.installed("0.5.0");
    b.release("0.6.0", bundleOf("0.6.0"), sha("something else"));
    const wrong = await b.kioku(["update"]);
    assert.equal(wrong.out.error.code, "update_failed");
    assert.match(wrong.out.error.message, /does not match its checksum/);

    b.release("0.6.0", "console.log('not kioku')\n");
    const other = await b.kioku(["update"]);
    assert.equal(other.out.error.code, "update_failed");
    assert.match(other.out.error.message, /not a Kioku bundle/);

    delete b.assets[`${BASE}/kioku.mjs.sha256`];
    const gone = await b.kioku(["update"]);
    assert.equal(gone.out.error.code, "update_failed");
    assert.match(gone.out.error.message, /could not fetch/);

    assert.equal(currentVersion(b.dirs), "0.5.0");
    assert.equal(version(b), "0.5.0");
    assert.deepEqual(readdirSync(versionsDir(b.dirs)), ["0.5.0"], "no scratch file is left");
  }));

test("doctor says which version is installed and that the launcher runs, and nothing about a version on a machine with no install", () =>
  box(async (b) => {
    const checks = async () =>
      Object.fromEntries((await b.kioku(["doctor"])).out.checks.map((c: { name: string }) => [c.name, c]));
    const none = await checks();
    assert.equal(none["kioku version"], undefined);
    assert.equal(none["kioku launcher"].state, "warn");
    assert.match(none["kioku launcher"].fix, /install\.sh \| sh/);

    b.installed("0.5.0");
    const some = await checks();
    assert.deepEqual([some["kioku version"].state, some["kioku launcher"].state], ["ok", "ok"]);
    assert.match(some["kioku version"].detail, /^0\.5\.0, under /);
    assert.ok(existsSync(launcherPath(b.dirs)));
  }));

test("update puts the release's plugin beside its bundle before current moves, and runs nothing of the host's; a plugin missing or that does not match changes nothing (§6.2, §6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    await b.kioku(["setup"], { interactive: true });
    const log = join(b.dir, "claude.log");
    writeFileSync(join(b.dirs.bin, "claude"), `#!/bin/sh\necho "$@" >> "${log}"\n`);
    chmodSync(join(b.dirs.bin, "claude"), 0o755);
    b.release("0.6.0");
    const r = await b.kioku(["update"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.agents, undefined, "no host is asked to update anything");
    assert.equal(existsSync(log), false, "claude never ran: the next session reads the plugin beside the tool");
    assert.equal(pluginIn(b.dirs, "0.6.0"), "0.6.0");
    assert.equal(
      readFileSync(join(b.dirs.install, "current", "plugin", ".claude-plugin", "plugin.json"), "utf8"),
      readFileSync(join(versionsDir(b.dirs), "0.6.0", "plugin", ".claude-plugin", "plugin.json"), "utf8"),
      "current/plugin is the active version's",
    );
    assert.deepEqual(b.finishes, [currentBundle(b.dirs)], "the finishing was handed to the bundle just installed");
    assert.equal(existsSync(join(b.dir, "person/.claude/settings.json")), false, "no settings were written");

    // The version downloaded fetches the plugin of its own release, not the latest's (§6.4).
    b.release("0.7.0");
    const own = `${RELEASES}/download/v0.7.0`;
    b.assets[`${own}/kioku-plugin.tar.gz.sha256`] = `${"0".repeat(64)}  kioku-plugin.tar.gz\n`;
    const wrong = await b.kioku(["update"]);
    assert.equal(wrong.out.error.code, "update_failed");
    assert.match(wrong.out.error.message, /does not match its checksum; nothing was changed/);
    delete b.assets[`${own}/kioku-plugin.tar.gz`];
    delete b.assets[`${own}/kioku-plugin.tar.gz.sha256`];
    const missing = await b.kioku(["update"]);
    assert.equal(missing.out.error.code, "update_failed");
    b.assets[`${own}/kioku-plugin.tar.gz`] = Buffer.from("not an archive");
    b.assets[`${own}/kioku-plugin.tar.gz.sha256`] = `${sha(Buffer.from("not an archive"))}  kioku-plugin.tar.gz\n`;
    const broken = await b.kioku(["update"]);
    assert.equal(broken.out.error.code, "update_failed");
    assert.match(broken.out.error.message, /the plugin's archive is not one/);
    assert.equal(currentVersion(b.dirs), "0.6.0", "current did not move");
    assert.equal(pluginIn(b.dirs, "0.7.0"), undefined, "and no plugin of 0.7.0 was left");
    assert.equal(existsSync(join(versionsDir(b.dirs), "0.7.0")), false, "nor its bundle");
  }));

test("the version downloaded puts its own plugin in place, update --prepare run from its bundle before it is active; when it cannot, nothing changes (§6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    // A bundle that answers --version, and update --prepare as `prepare` says, recording that it ran and while which was current.
    const ran = join(b.dir, "prepared.log");
    const answers = (version: string, prepare: string): string =>
      `const a = process.argv.slice(2);\nif (a.includes("--version")) console.log(JSON.stringify({ version: "${version}", contract: 1, formats: [1] }));\nelse if (a[0] === "update" && a.includes("--prepare")) { process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(ran)}, process.getBuiltinModule("node:fs").readlinkSync(${JSON.stringify(join(b.dirs.install, "current"))}) + "\\n"); ${prepare} }\nelse if (a[0] === "update" && a.includes("--finish")) console.log(JSON.stringify({ refreshed: null }));\n`;
    const { prepareByBundle } = await import("../../src/cli/update.ts");
    const handOver = { prepareUpdate: prepareByBundle, finishUpdate: finishByBundle };
    b.release("0.6.0", answers("0.6.0", `console.log(JSON.stringify({ prepared: "0.6.0" }));`));
    const r = await b.kioku(["update"], handOver);
    assert.equal(r.code, 0, r.raw);
    assert.equal(currentVersion(b.dirs), "0.6.0");
    assert.deepEqual(
      readFileSync(ran, "utf8").trim().split("\n"),
      [join("versions", "0.5.0")],
      "it ran before current moved",
    );

    b.release(
      "0.7.0",
      answers(
        "0.7.0",
        `console.log(JSON.stringify({ error: { code: "update_failed", message: "the plugin's archive is not one (bad); nothing was changed" } })); process.exit(3);`,
      ),
    );
    const failed = await b.kioku(["update"], handOver);
    assert.equal(failed.out.error.code, "update_failed");
    assert.match(failed.out.error.message, /the plugin's archive is not one \(bad\); nothing was changed/);
    assert.equal(currentVersion(b.dirs), "0.6.0", "current did not move");
    assert.equal(existsSync(join(versionsDir(b.dirs), "0.7.0")), false, "and the version downloaded was removed");
  }));

test("a release from before the hand-over gets its plugin from the version running, in its one layout, so update can go back to it (§6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    // A bundle that answers --version, and anything else as 0.2.1 answers a flag it does not know.
    b.tagged(
      "0.2.1",
      `const a = process.argv.slice(2);\nif (a.includes("--version")) console.log(JSON.stringify({ version: "0.2.1", contract: 1, formats: [1] }));\nelse { console.log(JSON.stringify({ error: { code: "usage", message: "unknown flag --prepare; kioku update [<version>] [--check] [--dry-run]" } })); process.exit(1); }\n`,
    );
    const { prepareByBundle } = await import("../../src/cli/update.ts");
    const r = await b.kioku(["update", "0.2.1"], {
      tty: false,
      interactive: true,
      prepareUpdate: prepareByBundle,
      finishUpdate: async () => ({ refreshed: null }),
    });
    assert.equal(r.code, 0, r.raw);
    assert.equal(currentVersion(b.dirs), "0.2.1");
    assert.equal(pluginIn(b.dirs, "0.2.1"), "0.2.1");
  }));

test("update hands the finishing to the version it installed, update --finish run from its bundle, and says when that could not be (§6.4)", () =>
  box(async (b) => {
    b.installed("0.5.0");
    // A bundle that answers as the tool does to --version, and to update --finish with what it did.
    const answers = (version: string, finish: string): string =>
      `const a = process.argv.slice(2);\nif (a.includes("--version")) console.log(JSON.stringify({ version: "${version}", contract: 1, formats: [1] }));\nelse if (a[0] === "update" && a.includes("--finish")) { ${finish} }\n`;
    b.release("0.6.0", answers("0.6.0", `console.log(JSON.stringify({ refreshed: { brains: [{}, {}] } }));`));
    const r = await b.kioku(["update"], { finishUpdate: finishByBundle });
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.status, r.out.refreshed, r.out.finishError], ["updated", { brains: [{}, {}] }, undefined]);
    assert.equal(currentVersion(b.dirs), "0.6.0");

    b.release(
      "0.7.0",
      answers(
        "0.7.0",
        `console.log(JSON.stringify({ error: { code: "internal", message: "boom" } })); process.exit(3);`,
      ),
    );
    const failed = await b.kioku(["update"], { finishUpdate: finishByBundle, tty: true });
    assert.equal(failed.code, 0, failed.raw);
    assert.match(
      failed.raw,
      /^Installed Kioku 0\.7\.0 \(was 0\.6\.0\); every kioku call now runs it\. What changed: \S+\. To go back: kioku update 0\.6\.0, in a terminal\. Removed 0\.5\.0\. Could not hand over to it \(boom\): run kioku brain refresh --all\.\n$/,
    );
    assert.equal(currentVersion(b.dirs), "0.7.0", "the version is installed all the same");
  }));

test("update --finish refreshes the brains with the version running, and goes alone", () =>
  box(async (b) => {
    b.installed("0.5.0");
    await b.kioku(["setup"], { interactive: true });
    await b.kioku(["brain", "create", "sam/brain", "--tier", "personal"], { interactive: true });
    const r = await b.kioku(["update", "--finish"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.agents, undefined, "no host is asked to update its plugin (§6.2)");
    assert.ok(Array.isArray(r.out.refreshed?.brains) && r.out.refreshed.brains.length >= 1, "brain refresh --all ran");
    assert.equal((await b.kioku(["update", "--finish", "--check"])).out.error.code, "usage");
  }));

test("after installing a version, update brings the files Kioku owns in each brain to it (§2.7)", () =>
  world(async (w) => {
    const dir = mkdtempSync(join(tmpdir(), "kioku-update-world-"));
    try {
      const env = {
        KIOKU_INSTALL_DIR: join(dir, "install"),
        KIOKU_BIN_DIR: join(dir, "bin"),
        KIOKU_RELEASES_URL: RELEASES,
      };
      const assets: Record<string, string | Buffer> = {
        [`${BASE}/kioku.mjs`]: bundleOf("9.0.0"),
        [`${BASE}/kioku.mjs.sha256`]: `${sha(bundleOf("9.0.0"))}  kioku.mjs\n`,
        [`${BASE}/kioku-plugin.tar.gz`]: pluginArchiveOf("9.0.0"),
        [`${BASE}/kioku-plugin.tar.gz.sha256`]: `${sha(pluginArchiveOf("9.0.0"))}  kioku-plugin.tar.gz\n`,
        // The version downloaded fetches its plugin from its own release (§6.4).
        [`${RELEASES}/download/v9.0.0/kioku-plugin.tar.gz`]: pluginArchiveOf("9.0.0"),
        [`${RELEASES}/download/v9.0.0/kioku-plugin.tar.gz.sha256`]: `${sha(pluginArchiveOf("9.0.0"))}  kioku-plugin.tar.gz\n`,
      };
      const r = await w.kioku(["update"], {
        context: {
          hostHome: dir,
          env,
          semantic: { ...OFFLINE, download: serve(assets) },
          bundle: installerBundle(installDirs(dir, env)),
        },
      });
      assert.equal(r.code, 0, r.raw);
      assert.equal(r.out.status, "updated");
      assert.ok(
        Array.isArray(r.out.refreshed?.brains) && r.out.refreshed.brains.length >= 1,
        "brain refresh --all ran",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }));
