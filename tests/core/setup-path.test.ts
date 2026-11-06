import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLauncher, installDirs, launcherPath, type InstallDirs } from "../../src/core/setup/install.ts";
import { run, type Context } from "../../src/cli/run.ts";
import { ctx } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";

isolateGit();

interface Machine {
  home: string;
  person: string;
  dir: string;
  /** Where the tool is installed: its own folders, apart from `~/.local/bin`, which a link may go to. */
  dirs: InstallDirs;
  bin: string;
  kioku: (
    argv: string[],
    o?: { tty?: boolean; env?: NodeJS.ProcessEnv; interactive?: boolean; bundle?: string },
  ) => Promise<{ code: number; out: any; raw: string }>;
}

/** A machine whose Kioku home and person's home are folders of its own, with the launcher installed, and a PATH made of its folders. */
async function machine<T>(
  fn: (m: Machine) => Promise<T>,
  o: { pathDirs?: (m: { person: string; dir: string }) => string[]; shell?: string } = {},
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kioku-path-"));
  try {
    const person = join(dir, "person");
    const home = join(dir, "kiokuhome");
    mkdirSync(person, { recursive: true });
    const install = { KIOKU_INSTALL_DIR: join(dir, "install"), KIOKU_BIN_DIR: join(dir, "kioku-bin") };
    const installed = installDirs(person, install);
    ensureLauncher(installed);
    const pathDirs = (o.pathDirs ?? (({ person }) => [join(person, ".local/bin")]))({ person, dir });
    for (const d of pathDirs) mkdirSync(d, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      PATH: [...pathDirs, "/usr/bin"].join(":"),
      SHELL: o.shell ?? "/usr/local/bin/fish",
    };
    const kioku: Machine["kioku"] = async (argv, k = {}) => {
      let raw = "";
      const c: Context = ctx({
        home,
        hostHome: person,
        env: { ...install, ...(k.env ?? env) },
        interactive: k.interactive ?? k.tty ?? true,
        ...(k.bundle !== undefined && { bundle: k.bundle }),
      });
      const code = await run(argv, { stdout: (t) => (raw += t), isTty: k.tty ?? false }, c);
      return { code, raw, out: (k.tty ?? false) || raw.trim() === "" ? raw : JSON.parse(raw) };
    };
    const m: Machine = { home, person, dir, dirs: installed, bin: join(person, ".local/bin"), kioku };
    return await fn(m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("setup links kioku into ~/.local/bin when it is on the PATH, and it works at once", () =>
  machine(async (m) => {
    const r = await m.kioku(["setup"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual([r.out.shellPath.action, r.out.shellPath.target], ["linked", join(m.bin, "kioku")]);
    assert.equal(lstatSync(join(m.bin, "kioku")).isSymbolicLink(), true);
    assert.equal(readlinkSync(join(m.bin, "kioku")), launcherPath(m.dirs));
    assert.ok(existsSync(join(m.bin, "kioku")), "the link resolves to the launcher");

    const again = await m.kioku(["setup"], { env: { PATH: `${m.bin}:/usr/bin`, SHELL: "/bin/zsh" } });
    assert.equal(again.out.shellPath, undefined, "already on the PATH: nothing to do");
    assert.equal(again.out.launcher.onPath, true);
  }));

test("it is refused outside a terminal, before anything is written", () =>
  machine(async (m) => {
    const r = await m.kioku(["setup"], { interactive: false });
    assert.equal(r.code, 1);
    assert.equal(r.out.error.code, "needs_terminal");
    assert.ok(!existsSync(join(m.bin, "kioku")));
    assert.ok(!existsSync(join(m.home, ".kioku/config.yaml")), "no brain was made either");
  }));

test("a different kioku already in the folder is left alone and said; the next folder takes the link", () =>
  machine(async (m) => {
    writeFileSync(join(m.bin, "kioku"), "#!/bin/sh\necho mine\n");
    const second = join(m.dir, "second-bin");
    mkdirSync(second);
    const env = { PATH: `${m.bin}:${second}:/usr/bin`, SHELL: "/bin/fish" };
    const r = await m.kioku(["setup"], { env });
    assert.equal(r.code, 0, r.raw);
    assert.equal(readFileSync(join(m.bin, "kioku"), "utf8"), "#!/bin/sh\necho mine\n");
    assert.deepEqual([r.out.shellPath.action, r.out.shellPath.target], ["linked", join(second, "kioku")]);
    assert.match(JSON.stringify(r.out.shellPath.skipped), /another `kioku` is there/);
  }));

test("a folder a version manager rewrites is not used; with no other, fish gets its own conf.d file", () =>
  machine(
    async (m) => {
      const mise = join(m.person, ".local/share/mise/shims");
      const r = await m.kioku(["setup"], { env: { PATH: `${mise}:/usr/bin`, SHELL: "/opt/homebrew/bin/fish" } });
      assert.equal(r.code, 0, r.raw);
      assert.equal(r.out.shellPath.action, "profile");
      const file = join(m.person, ".config/fish/conf.d/kioku.fish");
      assert.deepEqual(r.out.shellPath.files, [file]);
      assert.match(readFileSync(file, "utf8"), /^# kioku\nfish_add_path --global ".*\/kioku-bin"\n$/);
      assert.ok(!existsSync(join(mise, "kioku")));
    },
    { pathDirs: ({ person }) => [join(person, ".local/share/mise/shims")] },
  ));

test("zsh gets one line in ~/.zshrc, kept after what is there, and not twice", () =>
  machine(
    async (m) => {
      const env = { PATH: "/usr/bin", SHELL: "/bin/zsh" };
      writeFileSync(join(m.person, ".zshrc"), "alias ll='ls -l'");
      const r = await m.kioku(["setup"], { env });
      assert.deepEqual([r.out.shellPath.action, r.out.shellPath.files], ["profile", [join(m.person, ".zshrc")]]);
      const text = readFileSync(join(m.person, ".zshrc"), "utf8");
      assert.match(
        text,
        /^alias ll='ls -l'\n# kioku\nexport PATH=".*\/kioku-bin:\$PATH"\n# kioku completion\n[^\n]+\n$/,
        "the PATH line, then the completion line",
      );
      const again = await m.kioku(["setup"], { env });
      assert.deepEqual(again.out.shellPath.files, [], "nothing written the second time");
      assert.equal(readFileSync(join(m.person, ".zshrc"), "utf8"), text);
    },
    { pathDirs: () => [] },
  ));

test("--shell names another shell, or all, and creates no profile for a shell nobody named", () =>
  machine(
    async (m) => {
      const env = { PATH: "/usr/bin", SHELL: "/bin/zsh" };
      const bash = await m.kioku(["setup", "--shell", "bash"], { env });
      assert.equal(bash.out.shellPath.action, "profile");
      assert.ok(existsSync(join(m.person, ".bashrc")));
      assert.ok(!existsSync(join(m.person, ".zshrc")));
      assert.ok(!existsSync(join(m.person, ".config/fish/conf.d/kioku.fish")));

      const all = await m.kioku(["setup", "--shell", "all"], { env });
      assert.equal(all.out.shellPath.action, "profile");
      assert.ok(existsSync(join(m.person, ".zshrc")));
      assert.ok(existsSync(join(m.person, ".config/fish/conf.d/kioku.fish")));

      const bad = await m.kioku(["setup", "--shell", "powershell"], { env });
      assert.equal(bad.out.error.code, "usage");
    },
    { pathDirs: () => [] },
  ));

test("a shell the tool does not know gets the line to add, and nothing is written", () =>
  machine(
    async (m) => {
      const r = await m.kioku(["setup"], { env: { PATH: "/usr/bin", SHELL: "/usr/bin/nu" } });
      assert.equal(r.out.shellPath.action, "unavailable");
      assert.match(r.out.shellPath.line, /export PATH=/, "the line to add by hand");
      assert.deepEqual(readdirSync(m.person), []);
    },
    { pathDirs: () => [] },
  ));

test("setup names the agent hosts found with no plugin, and the command to install each (§6.3)", () =>
  machine(async (m) => {
    mkdirSync(join(m.person, ".claude"));
    const r = await m.kioku(["setup"], { tty: true });
    assert.match(
      r.raw,
      /Claude Code is on this machine and does not use Kioku yet\. To let it: kioku plugin claude-code install/,
    );
    const json = await m.kioku(["setup"]);
    assert.deepEqual(json.out.agents, [{ host: "claude-code", name: "Claude Code", found: true, added: false }]);
  }));

test("doctor says the command and the line of the person's shell", () =>
  machine(
    async (m) => {
      await m.kioku(["setup"], { env: { PATH: "/usr/bin", SHELL: "/bin/fish" } });
      let raw = "";
      await run(
        ["doctor"],
        { stdout: (t) => (raw += t), isTty: false },
        ctx({
          home: m.home,
          hostHome: m.person,
          env: { KIOKU_INSTALL_DIR: m.dirs.install, KIOKU_BIN_DIR: m.dirs.bin, PATH: "/usr/bin", SHELL: "/bin/fish" },
        }),
      );
      const check = JSON.parse(raw).checks.find((c: { name: string }) => c.name === "kioku launcher");
      assert.equal(check.state, "warn");
      assert.match(check.fix, /kioku setup, which links it.*fish_add_path/);
    },
    { pathDirs: () => [] },
  ));

test("a broken link named kioku is not overwritten", () =>
  machine(async (m) => {
    symlinkSync(join(m.dir, "nowhere"), join(m.bin, "kioku"));
    const r = await m.kioku(["setup"]);
    assert.notEqual(r.out.shellPath?.action, "linked");
    assert.equal(readlinkSync(join(m.bin, "kioku")), join(m.dir, "nowhere"));
    rmSync(join(m.bin, "kioku"));
  }));

test("setup gives the shell its completion: a fish file, or a profile line for zsh and bash, each written once; a shell it does not know is said (§6.3)", () =>
  machine(async (m) => {
    const fishFile = join(m.person, ".config/fish/completions/kioku.fish");
    const r = await m.kioku(["setup"]);
    assert.equal(r.code, 0, r.raw);
    assert.deepEqual(r.out.completion, { shell: "fish", action: "written", files: [fishFile] });
    assert.equal(
      readFileSync(fishFile, "utf8"),
      `# kioku completion\n"${launcherPath(m.dirs)}" completion fish | source\n`,
    );
    const again = await m.kioku(["setup"]);
    assert.deepEqual(again.out.completion, { shell: "fish", action: "present", files: [fishFile] });
    assert.match((await m.kioku(["setup"], { tty: true })).raw, /Nothing to do/);

    const zsh = await m.kioku(["setup", "--shell", "zsh"]);
    assert.deepEqual(zsh.out.completion, { shell: "zsh", action: "written", files: [join(m.person, ".zshrc")] });
    const rc = readFileSync(join(m.person, ".zshrc"), "utf8");
    // `eval`, not `source <(…)`: macOS's bash 3.2 reads nothing from a process substitution.
    assert.match(rc, /# kioku completion\n\[ -x "[^"]+\/kioku" \] && eval "\$\("[^"]+\/kioku" completion zsh\)"\n$/);
    await m.kioku(["setup", "--shell", "zsh"]);
    assert.equal(readFileSync(join(m.person, ".zshrc"), "utf8"), rc, "written once");

    const unknown = await m.kioku(["setup"], { env: { PATH: `${m.bin}:/usr/bin`, SHELL: "/bin/ksh" } });
    assert.equal(unknown.out.completion.action, "unavailable");
    assert.match(
      (await m.kioku(["setup"], { tty: true, env: { PATH: `${m.bin}:/usr/bin`, SHELL: "/bin/ksh" } })).raw,
      /Could not give your shell the completion of `kioku`: the shell is not one the tool knows/,
    );
  }));

test("under Homebrew setup leaves the PATH and the completion to the formula, and asks for no installer (§6.3)", () =>
  machine(async (m) => {
    rmSync(launcherPath(m.dirs));
    const bundle = "/opt/homebrew/Cellar/kioku/0.5.0/libexec/kioku.mjs";
    const r = await m.kioku(["setup", "--no-model"], { bundle });
    assert.equal(r.code, 0, r.raw);
    assert.equal(r.out.origin, "homebrew");
    assert.equal(r.out.shellPath, undefined, "the PATH is Homebrew's");
    assert.equal(r.out.completion, undefined, "the completion is the formula's");
    assert.ok(!existsSync(join(m.bin, "kioku")));
    const text = await m.kioku(["setup", "--no-model"], { bundle, tty: true });
    assert.doesNotMatch(text.raw, /run the installer|launcher/);
  }));
