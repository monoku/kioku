import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../../src/cli/run.ts";
import { ensureLauncher, installDirs } from "../../src/core/setup/install.ts";
import { PLUGIN_NAME, pluginHooks } from "../../src/harness/claude-code-integration.ts";
import { MARKETPLACE_NAME } from "../../src/product.ts";
import { ctx } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";

isolateGit();

const root = join(import.meta.dirname, "..", "..");

// A `claude` that records its arguments and keeps the two files Claude Code keeps of what it has added: a marketplace
// added from a folder is recorded as one, and the plugin's copy keeps the version it had, as Claude Code's does (§6.2).
const FAKE_CLAUDE = `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
d="$CLAUDE_CONFIG_DIR/plugins"; mkdir -p "$d"
case "$1 $2" in
  "plugin marketplace")
    case "$3" in
      add) printf '{"kioku":{"source":{"source":"directory","path":"%s"}}}' "$4" > "$d/known_marketplaces.json" ;;
      remove) rm -f "$d/known_marketplaces.json" ;;
    esac ;;
  "plugin install") echo '{"version":2,"plugins":{"kioku@kioku":[{"version":"0.0.1"}]}}' > "$d/installed_plugins.json" ;;
  "plugin uninstall") echo '{"version":2,"plugins":{}}' > "$d/installed_plugins.json" ;;
esac
`;

/** A version's plugin beside its bundle, as the release's archive lays it out (§6.2). */
function placePluginOf(folder: string, version: string): void {
  mkdirSync(join(folder, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(folder, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "kioku", plugins: [{ name: "kioku", source: "./" }] }),
  );
  writeFileSync(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "kioku", version }));
}

interface Box {
  person: string;
  /** The folder beside the tool that holds its plugin: the installer's `current/plugin`. */
  folder: string;
  /** The bundle the tool runs from, under the installer's folder. */
  bundle: string;
  calls: () => string[];
  kioku: (
    argv: string[],
    o?: { interactive?: boolean; yes?: boolean; claude?: boolean; stdin?: string; bundle?: string },
  ) => Promise<{ code: number; out: any; raw: string }>;
}

async function box<T>(fn: (b: Box) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kioku-plugins-"));
  try {
    const person = join(dir, "person");
    const bin = join(dir, "fakebin");
    const log = join(dir, "claude.log");
    mkdirSync(join(person, ".claude"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
    chmodSync(join(bin, "claude"), 0o755);
    const installEnv = { KIOKU_INSTALL_DIR: join(dir, "install"), KIOKU_BIN_DIR: join(dir, "bin") };
    ensureLauncher(installDirs(person, installEnv));
    // Installed as the installer installs: the bundle and its plugin under versions/1.0.0, current pointing there.
    const version = join(dir, "install", "versions", "1.0.0");
    mkdirSync(version, { recursive: true });
    writeFileSync(join(version, "kioku.mjs"), "");
    placePluginOf(join(version, "plugin"), "1.0.0");
    symlinkSync(join("versions", "1.0.0"), join(dir, "install", "current"));
    const b: Box = {
      person,
      folder: join(dir, "install", "current", "plugin"),
      bundle: join(version, "kioku.mjs"),
      calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []),
      kioku: async (argv, o = {}) => {
        let raw = "";
        const env = {
          ...installEnv,
          CLAUDE_CONFIG_DIR: join(person, ".claude"),
          FAKE_LOG: log,
          PATH: `${o.claude === false ? "" : `${bin}:`}/usr/bin:/bin`,
        };
        const code = await run(
          argv,
          { stdout: (t) => (raw += t), isTty: false },
          ctx({
            home: join(dir, "kiokuhome"),
            hostHome: person,
            cwd: dir,
            env,
            version: "1.0.0",
            interactive: o.interactive ?? true,
            ask: async () => o.yes ?? true,
            ...(o.stdin !== undefined && { stdin: async () => o.stdin! }),
            bundle: o.bundle ?? join(version, "kioku.mjs"),
          }),
        );
        return { code, raw, out: raw.trim() === "" ? raw : JSON.parse(raw) };
      },
    };
    return await fn(b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("plugin claude-code install adds the folder beside the tool as the marketplace, then the plugin, and is idempotent (§6.2)", () =>
  box(async (b) => {
    const r = await b.kioku(["plugin", "claude-code", "install"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.host, r.out.status], ["claude-code", "done"]);
    assert.deepEqual(b.calls(), [`plugin marketplace add ${b.folder}`, "plugin install kioku@kioku"]);

    const again = await b.kioku(["plugin", "claude", "install"]);
    assert.deepEqual([again.code, again.out.status, again.out.commands], [0, "unchanged", []]);
    assert.equal(b.calls().length, 2, "nothing ran again");
  }));

/** Claude Code with the Kioku plugin of `version` installed from a marketplace: GitHub's, as an earlier version registered it, unless `source` says. */
function pluginOf(b: Box, version: string, source: unknown = { source: "github", repo: "monoku/kioku" }): void {
  const d = join(b.person, ".claude/plugins");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "known_marketplaces.json"), JSON.stringify({ kioku: { source } }));
  writeFileSync(
    join(d, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "kioku@kioku": [{ version }] } }),
  );
}

test("an earlier version's marketplace on GitHub is pointed at the folder beside the tool, and the plugin follows with no reinstall (§6.2)", () =>
  box(async (b) => {
    pluginOf(b, "5.1.0");
    const r = await b.kioku(["plugin", "claude-code", "install"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.status, r.out.commands], ["done", [`claude plugin marketplace add ${b.folder}`]]);
    const again = await b.kioku(["plugin", "claude-code", "install"]);
    assert.deepEqual([again.out.status, again.out.commands], ["unchanged", []]);
  }));

test("plugin install refuses for a tool that carries no plugin, and for one whose plugin is not there, before claude runs (§6.2)", () =>
  box(async (b) => {
    const elsewhere = await b.kioku(["plugin", "claude-code", "install"], {
      bundle: join(b.person, "build", "kioku.mjs"),
    });
    assert.equal(elsewhere.out.error.code, "plugin_missing");
    assert.match(elsewhere.out.error.message, /not installed by its installer or Homebrew/);
    rmSync(b.folder, { recursive: true });
    const gone = await b.kioku(["plugin", "claude-code", "install", "--dry-run"]);
    assert.equal(gone.out.error.code, "plugin_missing");
    assert.match(gone.out.error.message, /run the installer again/);
    assert.deepEqual(b.calls(), []);
  }));

test("doctor says where Claude Code reads the plugin from and warns when it is not beside the tool, or another version, with the command (§6.2)", () =>
  box(async (b) => {
    assert.equal((await b.kioku(["setup", "--no-model"])).code, 0);
    const plugin = async (bundle?: string) =>
      (await b.kioku(["doctor"], bundle === undefined ? {} : { bundle })).out.checks.find(
        (c: { name: string }) => c.name === "Claude Code plugin",
      );
    pluginOf(b, "0.1.0");
    const github = await plugin();
    assert.equal(github.state, "warn", JSON.stringify(github));
    assert.match(github.detail, /reads the Kioku plugin from the GitHub repository monoku\/kioku, not beside the tool/);
    assert.equal(github.fix, `kioku plugin claude-code install points it at ${b.folder}`);

    pluginOf(b, "0.0.1", { source: "directory", path: b.folder });
    const beside = await plugin();
    assert.equal(beside.state, "ok", JSON.stringify(beside));
    assert.match(beside.detail, new RegExp(`the Kioku plugin 1\\.0\\.0 is installed in .*, read from ${b.folder}`));
    const said = await b.kioku(["hook", "session-start"], {
      stdin: JSON.stringify({ cwd: b.person, source: "startup", session_id: "s" }),
    });
    assert.doesNotMatch(said.raw, /plugin is behind|different versions/);
    // The two names are not notices any more: `display.mute` refuses them as it refuses any unknown name.
    for (const gone of ["plugin-behind", "tool-behind"]) {
      const set = await b.kioku(["config", "set", "display.mute", `+${gone}`]);
      assert.notEqual(set.code, 0, gone);
      assert.equal(set.out.error.code, (await b.kioku(["config", "set", "display.mute", "+nothing"])).out.error.code);
    }

    // Beside the tool, a plugin of another version, say.
    placePluginOf(join(b.bundle, "..", "plugin"), "0.1.0");
    const older = await plugin();
    assert.match(older.detail, /is 0\.1\.0, older than Kioku 1\.0\.0/);
    assert.match(older.fix, /kioku plugin claude-code install/);
    placePluginOf(join(b.bundle, "..", "plugin"), "99.0.0");
    // The fix is the one that updates the tool as it was installed (§6.2, §6.4).
    assert.match((await plugin()).fix, /^kioku update brings the tool to it$/);
    pluginOf(b, "99.0.0", { source: "directory", path: "/opt/homebrew/opt/kioku/libexec/plugin" });
    assert.match(
      (await plugin("/opt/homebrew/Cellar/kioku/1.0.0/libexec/kioku.mjs")).fix,
      /^brew upgrade kioku brings/,
    );
    pluginOf(b, "99.0.0", { source: "directory", path: join(b.person, "anywhere") });
    assert.match(
      (await plugin(join(b.person, "build", "kioku.mjs"))).fix,
      /^updating Kioku the way it was installed brings the tool to it$/,
      "a tool that carries no plugin is not held to a folder",
    );
  }));

test("plugin claude-code uninstall removes the plugin and then its marketplace, and says when there is nothing to remove", () =>
  box(async (b) => {
    await b.kioku(["plugin", "claude-code", "install"]);
    const r = await b.kioku(["plugin", "claude", "uninstall"]);
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.status, "done");
    assert.deepEqual(b.calls().slice(2), ["plugin uninstall kioku@kioku", "plugin marketplace remove kioku"]);
    const none = await b.kioku(["plugin", "claude-code", "uninstall"]);
    assert.deepEqual([none.out.status, none.out.commands], ["unchanged", []]);
  }));

test("--dry-run says what would run and runs nothing; a no runs nothing; outside a terminal both refuse", () =>
  box(async (b) => {
    const dry = await b.kioku(["plugin", "claude-code", "install", "--dry-run"], { interactive: false });
    assert.deepEqual(
      [dry.code, dry.out.status, dry.out.commands],
      [0, "planned", [`claude plugin marketplace add ${b.folder}`, "claude plugin install kioku@kioku"]],
    );
    const no = await b.kioku(["plugin", "claude-code", "install"], { yes: false });
    assert.deepEqual([no.code, no.out.status], [1, "cancelled"]);
    const refused = await b.kioku(["plugin", "claude-code", "install"], { interactive: false });
    assert.equal(refused.code, 1);
    assert.equal(refused.out.error.code, "needs_terminal");
    assert.deepEqual(b.calls(), [], "claude never ran");
  }));

test("install and uninstall leave what is in settings.json as it was, whatever it holds, and keep no copy of it (§6.2)", () =>
  box(async (b) => {
    const settings = join(b.person, ".claude/settings.json");
    mkdirSync(dirname(settings), { recursive: true });
    const text = `${JSON.stringify({ permissions: { allow: ["Skill(kioku)"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "/old/bin/kioku hook session-start" }] }] } })}\n`;
    writeFileSync(settings, text);
    for (const verb of ["install", "uninstall"]) {
      const r = await b.kioku(["plugin", "claude-code", verb]);
      assert.equal(r.code, 0, r.raw);
      assert.equal(r.out.legacy, undefined);
      assert.equal(readFileSync(settings, "utf8"), text, verb);
      assert.equal(existsSync(`${settings}.before-kioku`), false, verb);
    }
  }));

test("install refuses without claude on the PATH, before it touches anything", () =>
  box(async (b) => {
    const missing = await b.kioku(["plugin", "claude-code", "install"], { claude: false });
    assert.equal(missing.out.error.code, "agent_missing");
    assert.deepEqual(b.calls(), []);
  }));

test("an unknown host is refused, a host alone lists its verbs, and a verb it does not have is unknown (§6.1)", () =>
  box(async (b) => {
    assert.equal((await b.kioku(["plugin", "codex", "install"])).out.error.code, "unknown_host");
    const alone = await b.kioku(["plugin", "claude-code"]);
    assert.equal(alone.code, 0, alone.raw);
    assert.deepEqual(
      alone.out.verbs.map((v: { verb: string }) => v.verb),
      ["plugin claude-code install", "plugin claude-code uninstall"],
    );
    assert.equal((await b.kioku(["plugin", "claude-code", "add"])).out.error.code, "unknown_verb");
  }));

test("the committed plugin is what the tool says it is: hooks and skill (§6.2)", () => {
  const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
  assert.deepEqual(JSON.parse(read("plugins/claude-code/hooks/hooks.json")), pluginHooks());
  assert.match(read("plugins/claude-code/skills/kioku/SKILL.md"), /^---\nname: kioku\n/);
  assert.ok(
    !existsSync(join(root, "plugins/claude-code/commands")),
    "a file command would show under the plugin's prefix",
  );
  assert.ok(
    (statSync(join(root, "plugins/claude-code/hooks/kioku.sh")).mode & 0o111) !== 0,
    "the hook wrapper is executable",
  );
  const market = JSON.parse(read("plugins/claude-code/.claude-plugin/marketplace.json"));
  assert.equal(market.name, MARKETPLACE_NAME, "the name the tool installs from");
  assert.deepEqual(
    market.plugins.map((p: { name: string; source: string }) => [p.name, p.source]),
    [[PLUGIN_NAME, "./"]],
    "the plugin is the marketplace's own folder, as the archive carries it (§6.2)",
  );
  assert.ok(!existsSync(join(root, ".claude-plugin")), "the repository's root is not a marketplace (§6.2)");
  assert.equal(JSON.parse(read("plugins/claude-code/.claude-plugin/plugin.json")).name, PLUGIN_NAME);
  assert.equal(JSON.parse(read("plugins/claude-code/.claude-plugin/plugin.json")).name, "kioku");
});

test("the hook wrapper finds the launcher by KIOKU_BIN, runs it with its arguments, and tells the person at session start when there is none", () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-wrapper-"));
  try {
    const wrapper = join(root, "plugins/claude-code/hooks/kioku.sh");
    const fake = join(dir, "kioku");
    writeFileSync(fake, '#!/bin/sh\necho "ran $*"\n');
    chmodSync(fake, 0o755);
    const run = (args: string[], env: Record<string, string>): string =>
      execFileSync("bash", [wrapper, ...args], { env: { PATH: "/usr/bin:/bin", HOME: dir, ...env }, encoding: "utf8" });
    assert.equal(run(["hook", "session-start"], { KIOKU_BIN: fake }), "ran hook session-start\n");
    const none = run(["hook", "session-start"], {});
    assert.match(JSON.parse(none).systemMessage, /⬢ kioku\.md · ⚠ not installed/);
    for (const verb of ["user-prompt-submit", "pre-tool-use", "post-tool-use"])
      assert.equal(run(["hook", verb], {}), "", `${verb} says nothing and does not fail`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("the hook wrapper hands the tool the plugin's version and runs it whatever version the tool is (§6.2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kioku-wrapper-"));
  try {
    const wrapper = join(root, "plugins/claude-code/hooks/kioku.sh");
    const plugin = JSON.parse(readFileSync(join(root, "plugins/claude-code/.claude-plugin/plugin.json"), "utf8"))
      .version as string;
    const fake = join(dir, "kioku");
    writeFileSync(fake, '#!/bin/sh\necho "ran $* with $KIOKU_PLUGIN_VERSION"\n');
    chmodSync(fake, 0o755);
    for (const verb of ["session-start", "user-prompt-submit", "pre-tool-use", "post-tool-use"])
      assert.equal(
        execFileSync("bash", [wrapper, "hook", verb], {
          env: { PATH: "/usr/bin:/bin", HOME: dir, KIOKU_BIN: fake },
          encoding: "utf8",
        }),
        `ran hook ${verb} with ${plugin}\n`,
        verb,
      );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
