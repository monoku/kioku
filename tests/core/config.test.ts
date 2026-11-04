import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  managedPath,
  managedRef,
  parseBrainReference,
  parseRepo,
  referenceValue,
  repoKey,
} from "../../src/core/config/brain-ref.ts";
import {
  BRAIN_KEYS,
  CODE_REPO_KEYS,
  parseFolderConfig,
  readFolderConfig,
  stringifyFolderConfig,
} from "../../src/core/config/folder-config.ts";
import {
  MACHINE_KEYS,
  configPath,
  emptyConfig,
  readMachineConfig,
  stringifyMachineConfig,
  updateMachineConfig,
  writeMachineConfig,
  CONFIG_HEADER,
} from "../../src/core/config/machine.ts";
import { expandPath, localPathOf } from "../../src/core/config/brain-ref.ts";
import { resolveChain } from "../../src/core/config/chain.ts";
import { cloneUrl } from "../../src/core/brains/clone.ts";
import { downloadMB, PINS } from "../../src/core/semantic/pins.ts";
import { configuredMode, semanticStatus } from "../../src/core/semantic/status.ts";
import { answerOf, contextIn, runTool } from "../../scripts/tool.ts";
import { scratch as scratchIn } from "../fixtures.ts";

const scratch = scratchIn("config");

// The worked example of §2.5, file by file.
const CODE = "brain: github.com/northwind/brain-acme\nteam: github.com/northwind/brain\n";
/** A project folder that names its project brain and no team. */
const PROJECT_ONLY = "brain: github.com/northwind/brain-acme\n";
const PROJECT = "format: 1\ntier: project\nnamespaces:\n  - acme\n";
const TEAM = "format: 1\ntier: team\nnamespaces:\n  - engineering\n  - design\n  - delivery\n";
const PERSONAL = "format: 1\ntier: personal\nnamespaces:\n  - sam\n";
const MACHINE = `brain: github.com/sam/brain
trust:
  owners:
    - github.com/northwind
    - github.com/acme
repositories:
  github.com/sam/brain:
    path: ~/code/sam/brain
  github.com/northwind/brain-acme: {}
  github.com/northwind/brain: {}
`;

test("brain URLs in every spelling reduce to one key", () => {
  for (const s of [
    "github.com/northwind/brain-acme",
    "https://github.com/northwind/brain-acme",
    "https://github.com/northwind/brain-acme.git",
    "git@github.com:northwind/brain-acme.git",
    "ssh://git@github.com/northwind/brain-acme/",
  ])
    assert.equal(repoKey(parseRepo(s)!), "github.com/northwind/brain-acme", s);
  assert.equal(parseRepo("brain-acme"), undefined);
  assert.equal(parseRepo(""), undefined);
  assert.equal(
    managedPath("/h", parseRepo("github.com/northwind/brain-acme")!),
    "/h/.kioku/brains/northwind/brain-acme",
  );
});

test("a brain reference is a repository, the whole of it: a `path` is refused naming the key (§2.2)", () => {
  const short = parseBrainReference("github.com/northwind/brain-acme", "brain");
  assert.ok(short.ok && repoKey(short.ref) === "github.com/northwind/brain-acme");
  const long = parseBrainReference({ repo: "https://github.com/northwind/brains.git" }, "brain");
  assert.ok(long.ok);
  assert.equal(repoKey(long.ref), "github.com/northwind/brains");
  assert.equal(referenceValue(long.ref), "github.com/northwind/brains");
  const path = parseBrainReference({ repo: "github.com/northwind/brains", path: "acme" }, "brain");
  assert.match(path.ok ? "" : path.reason, /unknown key `brain\.path`.*a brain is a whole repository/);
  const extra = parseBrainReference({ repo: "github.com/a/b", branch: "x" }, "brain");
  assert.match(extra.ok ? "" : extra.reason, /unknown key `brain.branch`/);
});

test("a brain reference may say where its repository is: an ssh address alone, or { repo, url }, a folder on disk included (§2.2)", () => {
  const ssh = parseBrainReference("git@git.example.com:northwind/brain-acme.git", "brain");
  assert.ok(ssh.ok);
  assert.deepEqual(
    [repoKey(ssh.ref), ssh.ref.url, cloneUrl(ssh.ref)],
    [
      "git.example.com/northwind/brain-acme",
      "git@git.example.com:northwind/brain-acme.git",
      "git@git.example.com:northwind/brain-acme.git",
    ],
  );
  assert.equal(referenceValue(ssh.ref), "git@git.example.com:northwind/brain-acme.git", "written back as it was given");
  const disk = parseBrainReference(
    { repo: "github.com/northwind/brain-acme", url: "/Volumes/shared/acme.git" },
    "brain",
  );
  assert.ok(disk.ok);
  assert.deepEqual(
    [repoKey(disk.ref), cloneUrl(disk.ref)],
    ["github.com/northwind/brain-acme", "/Volumes/shared/acme.git"],
  );
  assert.deepEqual(referenceValue(disk.ref), {
    repo: "github.com/northwind/brain-acme",
    url: "/Volumes/shared/acme.git",
  });
  const plain = parseBrainReference("https://github.com/northwind/brain-acme.git", "brain");
  assert.ok(plain.ok && plain.ref.url === undefined, "an https address is the one the name says");
  assert.equal(cloneUrl(parseRepo("github.com/northwind/brain-acme")!), "https://github.com/northwind/brain-acme.git");
  const config = { ...emptyConfig(), repositories: { "github.com/northwind/brain-acme": { url: "/srv/acme.git" } } };
  assert.equal(
    cloneUrl(parseRepo("github.com/northwind/brain-acme")!, config),
    "/srv/acme.git",
    "the machine's address when the reference has none",
  );
  const bad = parseBrainReference({ repo: "github.com/a/b", url: "" }, "brain");
  assert.match(bad.ok ? "" : bad.reason, /brain\.url/);
  const text = "brain: { repo: github.com/northwind/brain-acme, url: /Volumes/shared/acme.git }\n";
  const read = parseFolderConfig(text);
  assert.ok(read.ok);
  if (read.ok) assert.equal(stringifyFolderConfig(read.value), text);
});

test("a clone from a host other than github.com goes under a folder of the host's name, and is found back from it (§2.5)", () => {
  assert.equal(
    managedPath("/h", parseRepo("git.example.com/northwind/brain-acme")!),
    "/h/.kioku/brains/git.example.com/northwind/brain-acme",
  );
  assert.deepEqual(managedRef("git.example.com/northwind/brain-acme"), {
    host: "git.example.com",
    owner: "northwind",
    repo: "brain-acme",
  });
  assert.deepEqual(managedRef("northwind/brain-acme"), { host: "github.com", owner: "northwind", repo: "brain-acme" });
  assert.equal(managedRef("northwind/brains/acme"), undefined, "a folder inside a clone is no brain of its own");
});

test("a machine configuration keeps the address of a repository that is not where its name says, and refuses an empty one", () =>
  scratch(async (home) => {
    mkdirSync(join(home, ".kioku"), { recursive: true });
    writeFileSync(
      configPath(home),
      "repositories:\n  github.com/sam/brain:\n    url: /Volumes/shared/sam.git\ndisplay:\n  mute:\n    - unpublished\n",
    );
    const c = readMachineConfig(home)!;
    assert.deepEqual(
      [c.repositories["github.com/sam/brain"], c.display],
      [{ url: "/Volumes/shared/sam.git" }, { mute: ["unpublished"] }],
    );
    assert.match(stringifyMachineConfig(c), /github\.com\/sam\/brain:\n {4}url: \/Volumes\/shared\/sam\.git\n/);
    writeFileSync(configPath(home), 'repositories:\n  github.com/sam/brain:\n    url: ""\n');
    assert.throws(() => readMachineConfig(home), /repositories\.github\.com\/sam\/brain\.url/);
  }));

test("code repository form of kioku.yaml (§2.5)", () => {
  const r = parseFolderConfig(CODE);
  assert.ok(r.ok && r.value.form === "code");
  assert.equal(r.ok && r.value.form === "code" && repoKey(r.value.brain!), "github.com/northwind/brain-acme");
  const url = parseFolderConfig("brain: https://github.com/northwind/brain-acme.git\n");
  assert.ok(url.ok && url.value.form === "code" && repoKey(url.value.brain!) === "github.com/northwind/brain-acme");
});

test("brain form: project, team, personal (§2.5)", () => {
  const project = parseFolderConfig(PROJECT);
  assert.deepEqual(project, {
    ok: true,
    value: { form: "brain", format: 1, tier: "project", namespaces: ["acme"] },
  });
  const team = parseFolderConfig(TEAM);
  assert.deepEqual(team, {
    ok: true,
    value: {
      form: "brain",
      format: 1,
      tier: "team",
      namespaces: ["engineering", "design", "delivery"],
    },
  });
  const personal = parseFolderConfig(PERSONAL);
  assert.deepEqual(personal, {
    ok: true,
    value: { form: "brain", format: 1, tier: "personal", namespaces: ["sam"] },
  });
});

test("the files of §2.5 write back as they were read", () => {
  for (const text of [CODE, PROJECT, TEAM, PERSONAL]) {
    const r = parseFolderConfig(text);
    assert.ok(r.ok, text);
    if (r.ok) assert.equal(stringifyFolderConfig(r.value), text);
  }
});

test("a newer format still reads, so the validator can refuse it", () => {
  const r = parseFolderConfig(PERSONAL.replace("format: 1", "format: 9") + "future: yes\n");
  assert.ok(r.ok && r.value.form === "brain" && r.value.format === 9);
});

test("a project folder's kioku.yaml names a team brain, alone or with its project brain (§2.4)", () => {
  const alone = parseFolderConfig("team: github.com/northwind/brain\n");
  assert.ok(
    alone.ok &&
      alone.value.form === "code" &&
      alone.value.brain === undefined &&
      repoKey(alone.value.team!) === "github.com/northwind/brain",
  );
  const both = parseFolderConfig("brain: github.com/northwind/brain-acme\nteam: github.com/acme/brain\n");
  assert.ok(
    both.ok &&
      both.value.form === "code" &&
      repoKey(both.value.brain!) === "github.com/northwind/brain-acme" &&
      repoKey(both.value.team!) === "github.com/acme/brain",
  );
  assert.equal(
    both.ok && stringifyFolderConfig(both.value),
    "brain: github.com/northwind/brain-acme\nteam: github.com/acme/brain\n",
    "written back as read",
  );
  const folder = parseFolderConfig("team: { repo: github.com/northwind/brains, path: engineering }\n");
  assert.match(folder.ok ? "" : folder.reason, /unknown key `team\.path`/, "a brain is a whole repository");
  const project = parseFolderConfig(PROJECT);
  assert.equal(project.ok && project.value.form, "brain", "a project brain's own team keeps it a brain's file");
  const extra = parseFolderConfig("team: github.com/northwind/brain\nextra: 1\n");
  assert.match(
    extra.ok ? "" : extra.reason,
    /unknown key `extra`; a project folder's file holds `brain`, `team` or both/,
  );
});

test("the two forms are told apart by content, and ambiguity is refused", () => {
  assert.equal(parseFolderConfig(CODE + PERSONAL).ok, false);
  assert.equal(parseFolderConfig("name: x\n").ok, false);
});

test("bad folder configs say what is wrong and name the key", () => {
  const reasons = (text: string) => {
    const r = parseFolderConfig(text);
    assert.equal(r.ok, false, text);
    return r.ok ? "" : r.reason;
  };
  assert.match(reasons("brain: [unclosed\n"), /not valid YAML/);
  assert.match(reasons("- a\n"), /not a mapping/);
  assert.match(reasons("brain: nonsense\n"), /`brain` is not a brain URL/);
  assert.match(reasons("brain: 3\n"), /`brain` must be a brain URL/);
  assert.match(reasons(CODE + "extra: 1\n"), /unknown key `extra`/);
  assert.match(reasons(PERSONAL + "extra: 1\n"), /unknown key `extra`/);
  assert.match(reasons(PERSONAL.replace("tier: personal", "tier: other")), /`tier`/);
  assert.match(reasons(PERSONAL.replace("format: 1", "format: one")), /`format`/);
  assert.match(
    reasons(PERSONAL.replace("format: 1\n", "format: 1\nname: sam\n")),
    /unknown key `name`/,
    "a brain's name is its repository's (§2.3, §5)",
  );
  assert.match(reasons(PERSONAL.replace("  - sam\n", "").replace("namespaces:", "namespaces: [3]")), /`namespaces`/);
  assert.match(reasons(PERSONAL.replace("  - sam\n", "").replace("namespaces:", "namespaces: sam")), /`namespaces`/);
  const empty = parseFolderConfig(PERSONAL.replace("  - sam\n", "").replace("namespaces:", "namespaces: []"));
  assert.ok(
    empty.ok && empty.value.form === "brain" && empty.value.namespaces.length === 0,
    "a brain starts with no namespace (§3.2)",
  );
  for (const brain of [PROJECT, TEAM, PERSONAL])
    assert.match(
      reasons(`${brain}team: github.com/northwind/brain\n`),
      /unknown key `team`/,
      "a brain names no other brain: the folder names its team (§2.4, §5)",
    );
});

test("a folder config read from a file names the file in its failures", () =>
  scratch((dir) => {
    const path = join(dir, "kioku.yaml");
    writeFileSync(path, CODE + "extra: 1\n");
    const r = readFolderConfig(path);
    assert.ok(!r.ok && r.reason.startsWith(path) && r.reason.includes("`extra`"));
    const missing = readFolderConfig(join(dir, "none.yaml"));
    assert.ok(!missing.ok && missing.reason.includes("none.yaml"));
  }));

test("the keys a kioku.yaml may hold are fixed", () => {
  assert.deepEqual([...CODE_REPO_KEYS], ["brain", "team"]);
  assert.deepEqual([...BRAIN_KEYS], ["format", "tier", "namespaces", "language"]);
});

test("`language` in a brain's file: a tag, kept on a round trip, and anything else is named (§3.2)", () => {
  const text = `${PROJECT}language: pt-BR\n`;
  const r = parseFolderConfig(text);
  assert.ok(r.ok && r.value.form === "brain");
  assert.equal(r.value.language, "pt-BR");
  assert.equal(stringifyFolderConfig(r.value), text);
  for (const ok of ["es", "es-419", "es-ES", "en"]) assert.ok(parseFolderConfig(`${PROJECT}language: ${ok}\n`).ok, ok);
  const none = parseFolderConfig(PROJECT);
  assert.ok(none.ok && none.value.form === "brain" && none.value.language === undefined);
  for (const bad of ["English", "e", "en_US", "1"]) {
    const x = parseFolderConfig(`${PROJECT}language: ${bad}\n`);
    assert.ok(!x.ok && /`language` must be a language tag/.test(x.reason), bad);
  }
});

test("`freshness` in a brain's file is refused naming the key: every brain lasts the same (§4.4, §5)", () => {
  const r = parseFolderConfig(`${PROJECT}freshness:\n  context: 90\n`);
  assert.ok(!r.ok && /freshness/.test(r.reason), r.ok ? "read" : r.reason);
});

test("machine configuration: the example of §2.5 reads and writes back identical", () =>
  scratch((home) => {
    mkdirSync(join(home, ".kioku"));
    writeFileSync(configPath(home), MACHINE);
    const c = readMachineConfig(home)!;
    assert.equal(c.brain, "github.com/sam/brain");
    assert.deepEqual(c.repositories, {
      "github.com/sam/brain": { path: "~/code/sam/brain" },
      "github.com/northwind/brain-acme": {},
      "github.com/northwind/brain": {},
    });
    assert.equal(stringifyMachineConfig(c), `${CONFIG_HEADER}\n${MACHINE}`, "written as read, under the header");
    assert.equal(localPathOf(c, parseRepo("github.com/sam/brain")!, home), join(home, "code/sam/brain"));
    assert.equal(
      localPathOf(c, parseRepo("github.com/northwind/brain-acme")!, home),
      join(home, ".kioku/brains/northwind/brain-acme"),
    );
    assert.equal(localPathOf(c, parseRepo("github.com/unknown/x")!, home), join(home, ".kioku/brains/unknown/x"));
  }));

test("`instincts` and `enabled` are refused naming them: Kioku has no switch of its own (§2.3, §2.5)", () =>
  scratch((home) => {
    mkdirSync(join(home, ".kioku"));
    for (const value of ["true", "false"]) {
      writeFileSync(configPath(home), `enabled: ${value}\n`);
      assert.throws(
        () => readMachineConfig(home),
        (e: Error & { code?: string }) => e.code === "config_invalid" && /unknown key `enabled`/.test(e.message),
      );
    }
    writeFileSync(configPath(home), "instincts:\n  autoevolve: true\n  evolve_after: 5\n");
    assert.throws(() => readMachineConfig(home), /unknown key `instincts`/);
  }));

test("a key from 3.x in the file is refused, in one message naming it (§2.5)", () =>
  scratch((home) => {
    mkdirSync(join(home, ".kioku"));
    for (const [text, key] of [
      ["updates: auto\n", "updates"],
      ["pointers: false\n", "pointers"],
      ["reads: false\n", "reads"],
      ["unopened_days: 30\n", "unopened_days"],
      ["summary:\n  max_chars: 4000\n", "summary"],
      ["evolve: auto\n", "evolve"],
      ["trusted:\n  - github.com/northwind\n", "trusted"],
      ["agents:\n  - claude-code\n", "agents"],
      ["session:\n  marks: none\n", "session"],
      ["display:\n  messages: short\n", "messages"],
      ["display:\n  unpublished: none\n", "unpublished"],
      ["context:\n  pointers: false\n", "context"],
    ] as const) {
      writeFileSync(configPath(home), text);
      assert.throws(
        () => readMachineConfig(home),
        (e: Error & { code?: string }) =>
          e.code === "config_invalid" && e.message.includes(key) && !e.message.includes("\n"),
        text,
      );
    }
  }));

test("a missing machine configuration is a state, not an error; a broken one is an error and is not replaced", () =>
  scratch(async (home) => {
    assert.equal(readMachineConfig(home), undefined);
    mkdirSync(join(home, ".kioku"));
    writeFileSync(configPath(home), "brain: [oops\n");
    assert.throws(() => readMachineConfig(home), /not valid YAML/);
    await assert.rejects(
      updateMachineConfig((c) => {
        c.brain = "github.com/x/brain";
      }, home),
      /not valid YAML/,
    );
    assert.equal(readFileSync(configPath(home), "utf8"), "brain: [oops\n");
    writeFileSync(configPath(home), "brain: nonsense\n");
    assert.throws(() => readMachineConfig(home), /`brain` is not a brain URL/);
    writeFileSync(configPath(home), "repositories:\n  github.com/a/b:\n    path: 3\n");
    assert.throws(() => readMachineConfig(home), /repositories\.github\.com\/a\/b\.path/);
    writeFileSync(configPath(home), "evolve: sometimes\n");
    assert.throws(() => readMachineConfig(home), /`evolve`/);
  }));

test("unknown keys are an error naming the file and the key", () =>
  scratch((home) => {
    mkdirSync(join(home, ".kioku"));
    for (const key of ["personal", "project", "user"]) {
      writeFileSync(configPath(home), `${key}: github.com/northwind/brain\n`);
      assert.throws(
        () => readMachineConfig(home),
        (e: Error) => e.message.includes(configPath(home)) && e.message.includes(`unknown key \`${key}\``),
      );
    }
    writeFileSync(configPath(home), "repositories:\n  github.com/a/b:\n    team: x\n");
    assert.throws(() => readMachineConfig(home), /unknown key `repositories\.github\.com\/a\/b\.team`/);
  }));

test("autoupdate and the notice updated are gone: a file that names them is refused, as any unknown key or name (§2.5, §6.4)", () =>
  scratch((home) => {
    mkdirSync(join(home, ".kioku"));
    writeFileSync(configPath(home), "autoupdate: false\n");
    assert.throws(() => readMachineConfig(home), /unknown key `autoupdate`/);
    writeFileSync(configPath(home), "display:\n  mute:\n    - updated\n");
    assert.throws(() => readMachineConfig(home), /`display\.mute` is a list of .*, not "updated"/);
  }));

test("the labs are gone: a file that holds `labs` is refused naming it, and `kioku config` lists no lab key (§2.5)", () =>
  scratch(async (home) => {
    mkdirSync(join(home, ".kioku"));
    writeFileSync(configPath(home), "labs:\n  history:\n    enabled: true\n");
    assert.throws(() => readMachineConfig(home), /unknown key `labs`/);
    writeFileSync(configPath(home), "");
    const { raw } = await runTool(["config", "--json"], contextIn(home, home));
    const keys = ((answerOf(raw)?.keys ?? []) as { key: string }[]).map((k) => k.key);
    assert.ok(keys.length > 0);
    assert.equal(keys.filter((k) => k.startsWith("labs.")).length, 0, keys.join(", "));
  }));

test("the machine configuration names the person's brain and team, and holds no project (§2.5)", () => {
  assert.deepEqual([...MACHINE_KEYS], ["brain", "team", "display", "search", "trust", "repositories"]);
  const keys = Object.keys(emptyConfig());
  assert.deepEqual(keys.sort(), ["repositories", "trust"]);
});

test("`brain` and `team` read as keys and write back first, in the order of §2.5", () =>
  scratch((home) => {
    mkdirSync(join(home, ".kioku"));
    const text =
      "brain: github.com/sam/brain\nteam: github.com/northwind/brain\nrepositories:\n  github.com/northwind/brain: {}\n";
    writeFileSync(configPath(home), text);
    const c = readMachineConfig(home)!;
    assert.deepEqual([c.brain, c.team], ["github.com/sam/brain", "github.com/northwind/brain"]);
    assert.equal(stringifyMachineConfig(c), `${CONFIG_HEADER}\n${text}`);
    writeFileSync(configPath(home), "team: nonsense\n");
    assert.throws(() => readMachineConfig(home), /`team` is not a brain URL/);
  }));

test("machine configuration writes round-trip, atomically, leaving no lock or temporary file", () =>
  scratch(async (home) => {
    const c = emptyConfig();
    c.brain = "github.com/sam/brain";
    c.repositories["github.com/sam/brain"] = { path: "~/code/sam/brain" };
    c.repositories["github.com/northwind/brain"] = {};
    await writeMachineConfig(c, home);
    assert.deepEqual(readMachineConfig(home), c);
    assert.deepEqual(readdirSync(join(home, ".kioku")), ["config.yaml"]);

    await updateMachineConfig((x) => {
      x.repositories["github.com/northwind/brain-acme"] = {};
    }, home);
    assert.deepEqual(Object.keys(readMachineConfig(home)!.repositories), [
      "github.com/sam/brain",
      "github.com/northwind/brain",
      "github.com/northwind/brain-acme",
    ]);
  }));

test("updating a machine that is not set up starts from the defaults", () =>
  scratch(async (home) => {
    await updateMachineConfig((c) => {
      c.brain = "github.com/sam/brain";
    }, home);
    assert.deepEqual(readMachineConfig(home), {
      brain: "github.com/sam/brain",
      repositories: {},
      trust: { owners: [] },
    });
  }));

test("concurrent updates are not lost", () =>
  scratch(async (home) => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateMachineConfig((c) => {
          c.repositories[`github.com/o/b${i}`] = {};
        }, home),
      ),
    );
    assert.equal(Object.keys(readMachineConfig(home)!.repositories).length, 8);
  }));

test("expandPath: ~ and absolute paths; relative is refused", () => {
  assert.equal(expandPath("~", "/h"), "/h");
  assert.equal(expandPath("~/x/y", "/h"), "/h/x/y");
  assert.equal(expandPath("/abs", "/h"), "/abs");
  assert.throws(() => expandPath("rel/x", "/h"), /absolute/);
});

/** Lay out the machine of §2.5 under a fake home; `clone` says which brains exist on disk. */
function machine(
  home: string,
  clone: { project?: boolean; team?: boolean; personal?: boolean; projectText?: string; code?: string },
) {
  mkdirSync(join(home, ".kioku"), { recursive: true });
  writeFileSync(configPath(home), MACHINE);
  const put = (dir: string, text: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "kioku.yaml"), text);
  };
  if (clone.personal) put(join(home, "code/sam/brain"), PERSONAL);
  if (clone.project) put(join(home, ".kioku/brains/northwind/brain-acme"), clone.projectText ?? PROJECT);
  if (clone.team) put(join(home, ".kioku/brains/northwind/brain"), TEAM);
  const repo = join(home, "work/acme-api");
  put(repo, clone.code ?? CODE);
  mkdirSync(join(repo, "src/deep"), { recursive: true });
  return repo;
}

const config = (home: string) => readMachineConfig(home)!;

test("chain: personal, project and team, all cloned, from a subfolder", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, project: true, team: true });
    const chain = resolveChain(join(repo, "src/deep"), config(home), home);
    assert.equal(chain.root, repo);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key, l.cloned]),
      [
        ["personal", "github.com/sam/brain", true],
        ["project", "github.com/northwind/brain-acme", true],
        ["team", "github.com/northwind/brain", true],
      ],
    );
    assert.equal(chain.links[0]!.path, join(home, "code/sam/brain"));
    assert.equal(chain.links[1]!.path, join(home, ".kioku/brains/northwind/brain-acme"));
    assert.equal(chain.links[2]!.path, join(home, ".kioku/brains/northwind/brain"));
    assert.deepEqual(chain.missing, []);
    assert.deepEqual(chain.problems, []);
  }));

test("a folder that names its project brain alone gives a chain of two, with nothing to say", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, project: true, team: true, code: PROJECT_ONLY });
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(
      chain.links.map((l) => l.tier),
      ["personal", "project"],
    );
    assert.deepEqual(chain.missing, []);
    assert.deepEqual(chain.problems, []);
  }));

test("a folder with no kioku.yaml resolves to the personal brain alone", () =>
  scratch((home) => {
    machine(home, { personal: true });
    mkdirSync(join(home, "scratch/a"), { recursive: true });
    const chain = resolveChain(join(home, "scratch/a"), config(home), home);
    assert.equal(chain.root, undefined);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["personal", "github.com/sam/brain"]],
    );
  }));

test("a personal brain overridden by a local path resolves to that path", () =>
  scratch((home) => {
    machine(home, { personal: true });
    const c = config(home);
    c.repositories["github.com/sam/brain"] = { path: "/data/my-brain" };
    const chain = resolveChain(join(home, "work/acme-api"), c, home);
    assert.equal(chain.links[0]!.path, "/data/my-brain");
    assert.equal(chain.links[0]!.cloned, false);
  }));

test("a machine that is not set up has no personal link, and the project still resolves", () =>
  scratch((home) => {
    const repo = machine(home, { project: true, team: true });
    const c = config(home);
    delete c.brain;
    assert.deepEqual(
      resolveChain(repo, c, home).links.map((l) => l.tier),
      ["project", "team"],
    );
    // A machine with no configuration trusts nothing a repository names (§2.4).
    const bare = resolveChain(repo, undefined, home);
    assert.deepEqual(bare.links, []);
    assert.deepEqual(
      bare.untrusted.map((l) => l.tier),
      ["project", "team"],
    );
  }));

/** The machine of the worked example, without what it knows of the shared brains: nobody ran `kioku init` here. */
function unfamiliar(home: string, o: Parameters<typeof machine>[1]) {
  const repo = machine(home, o);
  const c = config(home);
  c.repositories = { "github.com/sam/brain": c.repositories["github.com/sam/brain"]! };
  c.trust.owners = [];
  return { repo, c };
}

test("a brain a repository names is not loaded until this machine trusts it (§2.4)", () =>
  scratch((home) => {
    const { repo, c } = unfamiliar(home, { personal: true, project: true, team: true });
    const chain = resolveChain(repo, c, home);
    assert.deepEqual(
      chain.links.map((l) => l.key),
      ["github.com/sam/brain"],
    );
    assert.deepEqual(
      chain.untrusted.map((l) => [l.tier, l.key, l.cloned]),
      [
        ["project", "github.com/northwind/brain-acme", false],
        ["team", "github.com/northwind/brain", false],
      ],
    );
    assert.deepEqual(chain.missing, []);
    assert.equal(chain.project, "github.com/northwind/brain-acme");
  }));

test("a registered repository, or an owner in `trust.owners`, is trusted", () =>
  scratch((home) => {
    const { repo, c } = unfamiliar(home, { personal: true, project: true, team: true });
    c.repositories["github.com/northwind/brain-acme"] = {};
    c.repositories["github.com/northwind/brain"] = {};
    const byBrain = resolveChain(repo, c, home);
    assert.deepEqual(
      byBrain.links.map((l) => l.key),
      ["github.com/sam/brain", "github.com/northwind/brain-acme", "github.com/northwind/brain"],
    );
    assert.deepEqual(byBrain.untrusted, []);

    const owner = unfamiliar(home, { personal: true, project: true, team: true });
    owner.c.trust.owners = ["github.com/northwind"];
    assert.deepEqual(
      resolveChain(owner.repo, owner.c, home).links.map((l) => l.key),
      ["github.com/sam/brain", "github.com/northwind/brain-acme", "github.com/northwind/brain"],
    );
  }));

test("every brain the folder names is checked on its own: a team beside a trusted project brain too", () =>
  scratch((home) => {
    const { repo, c } = unfamiliar(home, {
      personal: true,
      project: true,
      team: true,
      code: `${PROJECT_ONLY}team: github.com/acme/brain\n`,
    });
    c.repositories["github.com/northwind/brain-acme"] = {};
    const chain = resolveChain(repo, c, home);
    assert.deepEqual(
      chain.links.map((l) => l.key),
      ["github.com/sam/brain", "github.com/northwind/brain-acme"],
    );
    assert.deepEqual(
      chain.untrusted.map((l) => [l.tier, l.key]),
      [["team", "github.com/acme/brain"]],
    );
  }));

test("a brain the session is inside is the person's own act and needs no trust", () =>
  scratch((home) => {
    machine(home, { personal: true, project: true, team: true });
    const c = config(home);
    c.trust.owners = [];
    const inside = resolveChain(join(home, ".kioku/brains/northwind/brain-acme"), c, home);
    assert.equal(inside.inside, "github.com/northwind/brain-acme");
    assert.deepEqual(inside.untrusted, []);
  }));

test("`trust.owners` is a list of owners; the file round-trips it and refuses anything else", () =>
  scratch(async (home) => {
    const c = emptyConfig();
    c.trust.owners = ["github.com/northwind"];
    await writeMachineConfig(c, home);
    assert.deepEqual(readMachineConfig(home)!.trust.owners, ["github.com/northwind"]);
    assert.match(readFileSync(configPath(home), "utf8"), /^trust:\n  owners:\n    - github\.com\/northwind$/m);
    writeFileSync(configPath(home), "trust:\n  owners:\n    - northwind\n    - gitlab.com/acme\n");
    assert.deepEqual(readMachineConfig(home)!.trust.owners, ["github.com/northwind", "gitlab.com/acme"]);
    writeFileSync(configPath(home), "trust:\n  owners: github.com/northwind\n");
    assert.throws(() => readMachineConfig(home), /`trust\.owners` must be a list of owners/);
    writeFileSync(configPath(home), "trust:\n  owners:\n    - github.com/northwind/brain\n");
    assert.throws(() => readMachineConfig(home), /`trust\.owners` must be a list of owners/);
  }));

test("chain reports what is not cloned yet, the team as soon as the folder names it", () =>
  scratch((home) => {
    const repo = machine(home, {});
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(
      chain.missing.map((l) => l.tier),
      ["personal", "project", "team"],
    );

    machine(home, { project: true });
    const next = resolveChain(repo, config(home), home);
    assert.deepEqual(
      next.missing.map((l) => l.tier),
      ["personal", "team"],
    );
  }));

test("a repository that names only a team gives personal and team, with no project", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, team: true, code: "team: github.com/northwind/brain\n" });
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "github.com/sam/brain"],
        ["team", "github.com/northwind/brain"],
      ],
    );
    assert.equal(chain.project, undefined);
  }));

test("the team is the one the folder names, whatever its project brain's file holds", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, code: `${PROJECT_ONLY}team: github.com/acme/brain\n` });
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(
      chain.missing.map((l) => [l.tier, l.key]),
      [
        ["project", "github.com/northwind/brain-acme"],
        ["team", "github.com/acme/brain"],
      ],
    );
  }));

test("the machine's team loads where no project folder names one, and needs no trust; a folder's team wins (§2.4)", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, project: true, team: true, code: PROJECT_ONLY });
    const c = config(home);
    c.team = "github.com/northwind/brain";
    // Nobody ran `kioku init` here: the machine's team is the person's own act, so it is trusted all the same.
    const strict = {
      ...c,
      repositories: { "github.com/sam/brain": c.repositories["github.com/sam/brain"]! },
      trust: { owners: [] },
    };
    mkdirSync(join(home, "scratch"), { recursive: true });
    const nowhere = resolveChain(join(home, "scratch"), strict, home);
    assert.deepEqual(
      nowhere.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "github.com/sam/brain"],
        ["team", "github.com/northwind/brain"],
      ],
    );
    assert.equal(nowhere.teamFrom, "machine");
    assert.deepEqual(nowhere.untrusted, []);

    const projectOnly = resolveChain(repo, c, home);
    assert.deepEqual(
      projectOnly.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "github.com/sam/brain"],
        ["project", "github.com/northwind/brain-acme"],
        ["team", "github.com/northwind/brain"],
      ],
    );
    assert.equal(projectOnly.teamFrom, "machine");

    writeFileSync(join(repo, "kioku.yaml"), `${PROJECT_ONLY}team: github.com/acme/brain\n`);
    const named = resolveChain(repo, c, home);
    assert.deepEqual(
      named.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "github.com/sam/brain"],
        ["project", "github.com/northwind/brain-acme"],
        ["team", "github.com/acme/brain"],
      ],
      "the folder's team, and the machine's is not loaded",
    );
    assert.equal(named.teamFrom, "folder");

    // A file that cannot be read may name a team: the machine's does not stand in for it.
    writeFileSync(join(repo, "kioku.yaml"), "brain: [x\n");
    assert.deepEqual(
      resolveChain(repo, c, home).links.map((l) => l.tier),
      ["personal"],
    );
  }));

test("a personal project whose brain is the personal brain appears once", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, code: "brain: github.com/sam/brain\n" });
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["personal", "github.com/sam/brain"]],
    );
    assert.equal(chain.project, "github.com/sam/brain");
  }));

test("inside a brain's own folder that brain alone is the chain, and the personal brain is not loaded (§2.7)", () =>
  scratch((home) => {
    machine(home, { personal: true, project: true });
    const chain = resolveChain(join(home, ".kioku/brains/northwind/brain-acme/knowledge/acme"), config(home), home);
    assert.equal(chain.root, undefined);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["project", "github.com/northwind/brain-acme"]],
    );
    assert.deepEqual(
      chain.notLoaded.map((n) => [n.tier, n.key]),
      [["personal", "github.com/sam/brain"]],
    );
    const c = config(home);
    c.team = "github.com/northwind/brain";
    assert.deepEqual(
      resolveChain(join(home, ".kioku/brains/northwind/brain-acme"), c, home).notLoaded.map((n) => [n.tier, n.key]),
      [
        ["personal", "github.com/sam/brain"],
        ["team", "github.com/northwind/brain"],
      ],
      "the machine's team is the session's chain too, not loaded",
    );
    assert.equal(chain.inside, "github.com/northwind/brain-acme");
    assert.equal(chain.project, "github.com/northwind/brain-acme");
    assert.equal(chain.links[0]!.path, join(home, ".kioku/brains/northwind/brain-acme"));
  }));

test("inside the personal brain it loads once and is the brain the session is in", () =>
  scratch((home) => {
    machine(home, { personal: true });
    const chain = resolveChain(join(home, "code/sam/brain"), config(home), home);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["personal", "github.com/sam/brain"]],
    );
    assert.equal(chain.inside, "github.com/sam/brain");
    assert.equal(chain.project, undefined);
    assert.deepEqual(chain.notLoaded, []);
  }));

test("inside a brain this machine does not know, the personal brain loads with a problem naming the folder", () =>
  scratch((home) => {
    machine(home, { personal: true });
    const stray = join(home, "stray");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "kioku.yaml"), TEAM);
    const chain = resolveChain(stray, config(home), home);
    assert.deepEqual(
      chain.links.map((l) => l.tier),
      ["personal"],
    );
    assert.equal(chain.inside, undefined);
    assert.equal(chain.problems.length, 1);
    assert.ok(chain.problems[0]!.startsWith(stray));
  }));

test("a broken kioku.yaml is a problem, not a throw, and the personal brain still loads", () =>
  scratch((home) => {
    const repo = machine(home, {
      personal: true,
      project: true,
      projectText: PROJECT.replace("tier: project", "tier: nonsense"),
    });
    // The chain reads only the project folder's file: no brain names another (§2.4), and a brain's own file is the
    // summary's to read, which says that brain cannot be read.
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(chain.problems, []);
    writeFileSync(join(repo, "kioku.yaml"), "brain: [x\n");
    const broken = resolveChain(repo, config(home), home);
    assert.deepEqual(
      broken.links.map((l) => l.tier),
      ["personal"],
    );
    assert.equal(broken.problems.length, 1);
    assert.ok(broken.problems[0]!.startsWith(join(repo, "kioku.yaml")));
  }));

test("search: a mode, optional, and one model pinned; anything else is an error that names it (§2.5, §4.3)", () =>
  scratch(async (home) => {
    assert.equal(PINS.model.id, "Xenova/multilingual-e5-small", "one model, and nothing chooses another");
    assert.equal(downloadMB(PINS), 250);
    const file = (extra: string) => {
      mkdirSync(join(home, ".kioku"), { recursive: true });
      writeFileSync(join(home, ".kioku/config.yaml"), `${extra}repositories: {}\n`);
    };
    file("");
    assert.equal(readMachineConfig(home)!.search, undefined);
    assert.equal(configuredMode(home), "hybrid", "hybrid when none is named");
    file("search:\n");
    assert.equal(readMachineConfig(home)!.search, undefined, "an empty block is no block");

    file("search:\n  mode: full-text\n");
    assert.deepEqual(readMachineConfig(home)!.search, { mode: "full-text" });
    assert.match(stringifyMachineConfig(readMachineConfig(home)!), /^search:\n  mode: full-text$/m);
    assert.deepEqual(
      semanticStatus(home, PINS, "darwin-arm64"),
      { ready: false, missing: [], reason: "search is set to full text in ~/.kioku/config.yaml" },
      "the model is kept, not used",
    );

    const bad: [string, RegExp][] = [
      ["search:\n  model: multilingual-e5-base\n", /unknown key `search.model`; `search` holds `mode`/],
      ["search:\n  mode: semantic\n", /`search.mode` must be hybrid or full-text/],
      ["search:\n  engine: onnx\n", /unknown key `search.engine`/],
      ["search: full-text\n", /`search` must be a mapping/],
      ["search_model: multilingual-e5-small\n", /unknown key `search_model`/],
    ];
    for (const [text, message] of bad) {
      file(text);
      assert.throws(() => readMachineConfig(home), message, text);
      assert.equal(configuredMode(home), "hybrid");
    }
  }));
