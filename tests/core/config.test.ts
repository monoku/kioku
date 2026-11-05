import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addressParts,
  addressUrl,
  brainFolder,
  isAddress,
  managedRef,
  nameOfAddress,
  ownerOfAddress,
  parseBrainReference,
  parseName,
  parseOwner,
  referenceValue,
  repoKey,
  sameRepository,
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
import { expandPath } from "../../src/core/config/brain-ref.ts";
import { resolveChain } from "../../src/core/config/chain.ts";
import { cloneUrl } from "../../src/core/brains/clone.ts";
import { downloadMB, PINS } from "../../src/core/semantic/pins.ts";
import { configuredMode, semanticStatus } from "../../src/core/semantic/status.ts";
import { answerOf, contextIn, runTool } from "../../scripts/tool.ts";
import { scratch as scratchIn } from "../fixtures.ts";

const scratch = scratchIn("config");

const ACME = "https://github.com/northwind/brain-acme.git";
const TEAM_URL = "https://github.com/northwind/brain.git";
// The worked example of §2.5, file by file.
const CODE = `brain: { name: northwind/brain-acme, url: ${ACME} }\nteam: { name: northwind/brain, url: ${TEAM_URL} }\n`;
/** A project folder that names its project brain and no team. */
const PROJECT_ONLY = `brain: { name: northwind/brain-acme, url: ${ACME} }\n`;
const PROJECT = "format: 2\nname: northwind/brain-acme\ntier: project\nnamespaces:\n  - acme\n";
const TEAM = "format: 2\nname: northwind/brain\ntier: team\nnamespaces:\n  - engineering\n  - design\n  - delivery\n";
const PERSONAL = "format: 2\nname: sam/brain\ntier: personal\nnamespaces:\n  - sam\n";
const MACHINE = `brain: sam/brain
trust:
  owners:
    - github.com/northwind
    - github.com/acme
repositories:
  sam/brain: git@github.com:sam/memoria.git
  northwind/brain-acme: ${ACME}
  northwind/brain: ${TEAM_URL}
`;

test("a name is <owner>/<repo>, letters, digits, - and _, never a dot, a path or an address (§2.2)", () => {
  assert.deepEqual(parseName("sam/memoria"), { owner: "sam", repo: "memoria" });
  assert.deepEqual(parseName("north_wind/app-brain"), { owner: "north_wind", repo: "app-brain" });
  for (const bad of ["memoria", "a/b/c", "github.com/sam", "sam/my.brain", "./a", "~/a", "/a/b", "a//b", "", "a/"])
    assert.equal(parseName(bad), undefined, bad);
  assert.equal(brainFolder("/h", parseName("northwind/brain-acme")!), "/h/.kioku/brains/northwind/brain-acme");
  assert.deepEqual(managedRef("northwind/brain-acme"), { owner: "northwind", repo: "brain-acme" });
  assert.equal(
    managedRef("github.com/northwind/brain-acme"),
    undefined,
    "a folder of 0.1.0's under its host is no brain's",
  );
  assert.equal(managedRef("northwind/brains/acme"), undefined, "a folder inside a brain is no brain of its own");
});

test("an address is any address git clones from, and a name never reads as one (§2.2)", () => {
  for (const a of [
    "github.com/northwind/brain-acme",
    "https://github.com/northwind/brain-acme.git",
    "git@github.com:northwind/brain-acme.git",
    "ssh://git@git.example.com:2222/northwind/platform/team.git",
    "file:///srv/acme.git",
    "/Volumes/shared/acme.git",
    "./acme.git",
    "~/brains/acme.git",
  ])
    assert.ok(isAddress(a), a);
  for (const n of ["northwind/brain-acme", "memoria", "-upload-pack=x", "github.com/northwind"])
    assert.ok(!isAddress(n), n);
  assert.equal(addressUrl("github.com/northwind/brain-acme"), ACME, "host/path is read as https");
  assert.equal(addressUrl("git@github.com:northwind/brain-acme.git"), "git@github.com:northwind/brain-acme.git");
  assert.deepEqual(addressParts("ssh://git@git.example.com:2222/northwind/platform/team.git"), {
    host: "git.example.com",
    path: "northwind/platform/team",
  });
  assert.equal(addressParts("/srv/acme.git"), undefined, "a folder has no host");
  assert.deepEqual(nameOfAddress(ACME), { owner: "northwind", repo: "brain-acme" });
  assert.deepEqual(nameOfAddress("/Volumes/shared/northwind/acme.git"), { owner: "northwind", repo: "acme" });
  assert.equal(ownerOfAddress("git@GitHub.com:northwind/brain-acme.git"), "github.com/northwind");
  assert.equal(ownerOfAddress("/srv/acme.git"), undefined);
  assert.ok(
    sameRepository(ACME, "git@github.com:northwind/brain-acme.git"),
    "the https and ssh forms of one repository",
  );
  assert.ok(!sameRepository(ACME, "https://gitlab.com/northwind/brain-acme.git"), "another host is another repository");
  assert.deepEqual(parseOwner("GitHub.com/northwind"), { host: "github.com", owner: "northwind" });
  assert.equal(parseOwner("northwind"), undefined, "an owner names its host");
});

test("a project folder's reference is a name, or { name, url }; an address alone, as 0.1.0 wrote it, says its name (§2.2)", () => {
  const name = parseBrainReference("northwind/brain-acme", "brain");
  assert.ok(name.ok);
  assert.deepEqual(name.ref, { owner: "northwind", repo: "brain-acme" });
  assert.equal(referenceValue(name.ref), "northwind/brain-acme");
  const both = parseBrainReference({ name: "northwind/brain-acme", url: "/Volumes/shared/acme.git" }, "brain");
  assert.ok(both.ok);
  assert.deepEqual([repoKey(both.ref), cloneUrl(both.ref)], ["northwind/brain-acme", "/Volumes/shared/acme.git"]);
  assert.deepEqual(referenceValue(both.ref), { name: "northwind/brain-acme", url: "/Volumes/shared/acme.git" });
  const old = parseBrainReference("github.com/northwind/brain-acme", "brain");
  assert.ok(old.ok);
  assert.deepEqual(old.ref, { owner: "northwind", repo: "brain-acme", url: ACME });
  const config = { ...emptyConfig(), repositories: { "northwind/brain-acme": "/srv/acme.git" } };
  assert.equal(cloneUrl(name.ref, config), "/srv/acme.git", "the machine's address when the reference has none");
  assert.equal(cloneUrl(name.ref), undefined, "a name alone has no address to clone from (§2.4)");
  for (const [value, reason] of [
    [{ name: "a/b", url: "" }, /brain\.url/],
    [{ name: "a/b", branch: "x" }, /unknown key `brain.branch`/],
    [{ repo: "a/b" }, /unknown key `brain.repo`/],
    [{ name: "a/b", url: "--upload-pack=x" }, /begins with -/],
    ["acme", /not a brain's name/],
  ] as const) {
    const r = parseBrainReference(value, "brain");
    assert.match(r.ok ? "" : r.reason, reason, JSON.stringify(value));
  }
  const text = "brain: { name: northwind/brain-acme, url: /Volumes/shared/acme.git }\n";
  const read = parseFolderConfig(text);
  assert.ok(read.ok);
  if (read.ok) assert.equal(stringifyFolderConfig(read.value), text);
});

test("a machine configuration holds the addresses the person accepted, by name, and refuses an empty one (§2.5)", () =>
  scratch(async (home) => {
    mkdirSync(join(home, ".kioku"), { recursive: true });
    writeFileSync(
      configPath(home),
      "repositories:\n  sam/brain: /Volumes/shared/sam.git\ndisplay:\n  mute:\n    - unpublished\n",
    );
    const c = readMachineConfig(home)!;
    assert.deepEqual([c.repositories["sam/brain"], c.display], ["/Volumes/shared/sam.git", { mute: ["unpublished"] }]);
    assert.match(stringifyMachineConfig(c), /^repositories:\n {2}sam\/brain: \/Volumes\/shared\/sam\.git$/m);
    writeFileSync(configPath(home), 'repositories:\n  sam/brain: ""\n');
    assert.throws(() => readMachineConfig(home), /repositories\.sam\/brain/);
    writeFileSync(configPath(home), "repositories:\n  sam.x/brain: /a\n");
    assert.throws(() => readMachineConfig(home), /not a brain's name/);
  }));

test("a configuration 0.1.0 wrote is read by name, its addresses and paths kept until it is brought forward (§2.5)", () =>
  scratch(async (home) => {
    mkdirSync(join(home, ".kioku"), { recursive: true });
    writeFileSync(
      configPath(home),
      "brain: github.com/sam/brain\nteam: git.example.com/northwind/brain\nrepositories:\n  github.com/sam/brain:\n    path: ~/code/sam/brain\n  git.example.com/northwind/brain: {}\n  github.com/northwind/brain-acme:\n    url: /srv/acme.git\n",
    );
    const c = readMachineConfig(home)!;
    assert.deepEqual([c.brain, c.team], ["sam/brain", "northwind/brain"]);
    assert.deepEqual(c.repositories, {
      "sam/brain": "https://github.com/sam/brain.git",
      "northwind/brain": "https://git.example.com/northwind/brain.git",
      "northwind/brain-acme": "/srv/acme.git",
    });
    assert.deepEqual(
      c.legacy?.map((l) => [l.key, l.name, l.path, l.url]),
      [
        ["github.com/sam/brain", "sam/brain", "~/code/sam/brain", undefined],
        ["git.example.com/northwind/brain", "northwind/brain", undefined, undefined],
        ["github.com/northwind/brain-acme", "northwind/brain-acme", undefined, "/srv/acme.git"],
      ],
    );
    // Written before it is brought forward: each entry as 0.1.0 wrote it, and no address its key only suggests.
    assert.match(
      stringifyMachineConfig(c),
      /^repositories:\n {2}github\.com\/sam\/brain:\n {4}path: ~\/code\/sam\/brain\n {2}git\.example\.com\/northwind\/brain: \{\}\n {2}github\.com\/northwind\/brain-acme:\n {4}url: \/srv\/acme\.git\n/m,
    );
    assert.doesNotMatch(stringifyMachineConfig(c), /https:/);
    // An address a verb sets is kept as the entry's `url`; a brain a verb removes is left out.
    c.repositories["sam/brain"] = "git@github.com:sam/brain.git";
    Reflect.deleteProperty(c.repositories, "northwind/brain");
    assert.match(stringifyMachineConfig(c), /github\.com\/sam\/brain:\n {4}path: ~\/code\/sam\/brain\n {4}url: git@/);
    assert.doesNotMatch(stringifyMachineConfig(c), /git\.example\.com/);
    // Brought forward, it is written by name, never in the old form.
    delete c.legacy;
    assert.doesNotMatch(stringifyMachineConfig(c), /^ *github\.com\/|path:/m);
  }));

test("code repository form of kioku.yaml (§2.5)", () => {
  const r = parseFolderConfig(CODE);
  assert.ok(r.ok && r.value.form === "code");
  assert.equal(r.ok && r.value.form === "code" && repoKey(r.value.brain!), "northwind/brain-acme");
  const name = parseFolderConfig("brain: northwind/brain-acme\n");
  assert.ok(name.ok && name.value.form === "code" && name.value.brain!.url === undefined);
});

test("brain form: project, team, personal, each with its name (§2.5)", () => {
  assert.deepEqual(parseFolderConfig(PROJECT), {
    ok: true,
    value: { form: "brain", format: 2, name: "northwind/brain-acme", tier: "project", namespaces: ["acme"] },
  });
  assert.deepEqual(parseFolderConfig(TEAM), {
    ok: true,
    value: {
      form: "brain",
      format: 2,
      name: "northwind/brain",
      tier: "team",
      namespaces: ["engineering", "design", "delivery"],
    },
  });
  assert.deepEqual(parseFolderConfig(PERSONAL), {
    ok: true,
    value: { form: "brain", format: 2, name: "sam/brain", tier: "personal", namespaces: ["sam"] },
  });
});

test("format 1, which 0.1.0 wrote, reads with no name; format 2 needs one; a name is refused in format 1 (§3.2)", () => {
  const one = parseFolderConfig("format: 1\ntier: project\nnamespaces:\n  - acme\n");
  assert.deepEqual(one, { ok: true, value: { form: "brain", format: 1, tier: "project", namespaces: ["acme"] } });
  const unnamed = parseFolderConfig("format: 2\ntier: project\nnamespaces: []\n");
  assert.match(unnamed.ok ? "" : unnamed.reason, /^`name` must be/);
  const bad = parseFolderConfig("format: 2\nname: acme\ntier: project\nnamespaces: []\n");
  assert.match(bad.ok ? "" : bad.reason, /^`name` must be/);
  const early = parseFolderConfig("format: 1\nname: northwind/acme\ntier: project\nnamespaces: []\n");
  assert.match(early.ok ? "" : early.reason, /unknown key `name`/);
});

test("the files of §2.5 write back as they were read", () => {
  for (const text of [CODE, PROJECT, TEAM, PERSONAL]) {
    const r = parseFolderConfig(text);
    assert.ok(r.ok, text);
    if (r.ok) assert.equal(stringifyFolderConfig(r.value), text);
  }
});

test("a newer format still reads, so the validator can refuse it", () => {
  const r = parseFolderConfig(PERSONAL.replace("format: 2", "format: 9") + "future: yes\n");
  assert.ok(r.ok && r.value.form === "brain" && r.value.format === 9);
});

test("a project folder's kioku.yaml names a team brain, alone or with its project brain (§2.4)", () => {
  const alone = parseFolderConfig("team: northwind/brain\n");
  assert.ok(
    alone.ok &&
      alone.value.form === "code" &&
      alone.value.brain === undefined &&
      repoKey(alone.value.team!) === "northwind/brain",
  );
  const both = parseFolderConfig(`brain: northwind/brain-acme\nteam: { name: acme/brain, url: ${TEAM_URL} }\n`);
  assert.ok(
    both.ok &&
      both.value.form === "code" &&
      repoKey(both.value.brain!) === "northwind/brain-acme" &&
      repoKey(both.value.team!) === "acme/brain",
  );
  assert.equal(
    both.ok && stringifyFolderConfig(both.value),
    `brain: northwind/brain-acme\nteam: { name: acme/brain, url: ${TEAM_URL} }\n`,
    "written back as read",
  );
  const folder = parseFolderConfig("team: { name: northwind/brains, path: engineering }\n");
  assert.match(folder.ok ? "" : folder.reason, /unknown key `team\.path`/, "a brain is a whole repository");
  const project = parseFolderConfig(PROJECT);
  assert.equal(project.ok && project.value.form, "brain", "a project brain's own team keeps it a brain's file");
  const extra = parseFolderConfig("team: northwind/brain\nextra: 1\n");
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
  assert.match(reasons("brain: nonsense\n"), /`brain` is not a brain's name/);
  assert.match(reasons("brain: 3\n"), /`brain` must be a brain's name/);
  assert.match(reasons(CODE + "extra: 1\n"), /unknown key `extra`/);
  assert.match(reasons(PERSONAL + "extra: 1\n"), /unknown key `extra`/);
  assert.match(reasons(PERSONAL.replace("tier: personal", "tier: other")), /`tier`/);
  assert.match(reasons(PERSONAL.replace("format: 2", "format: one")), /`format`/);
  assert.match(
    reasons(PERSONAL.replace("name: sam/brain\n", "name: sam\n")),
    /`name` must be/,
    "a brain's name is <owner>/<repo> (§2.2, §5.1 rule 13)",
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
      reasons(`${brain}team: northwind/brain\n`),
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
  assert.deepEqual([...BRAIN_KEYS], ["format", "name", "tier", "namespaces", "language"]);
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
    assert.equal(c.brain, "sam/brain");
    assert.deepEqual(c.repositories, {
      "sam/brain": "git@github.com:sam/memoria.git",
      "northwind/brain-acme": ACME,
      "northwind/brain": TEAM_URL,
    });
    assert.equal(stringifyMachineConfig(c), `${CONFIG_HEADER}\n${MACHINE}`, "written as read, under the header");
    assert.equal(c.legacy, undefined);
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
        c.brain = "x/brain";
      }, home),
      /not valid YAML/,
    );
    assert.equal(readFileSync(configPath(home), "utf8"), "brain: [oops\n");
    writeFileSync(configPath(home), "brain: nonsense\n");
    assert.throws(() => readMachineConfig(home), /`brain` is not a brain's name/);
    writeFileSync(configPath(home), "repositories:\n  a/b: 3\n");
    assert.throws(() => readMachineConfig(home), /repositories\.a\/b/);
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
    assert.throws(
      () => readMachineConfig(home),
      /unknown key `repositories\.github\.com\/a\/b\.team`/,
      "0.1.0's form, read to bring it forward, holds `path` and `url`",
    );
    writeFileSync(configPath(home), "repositories:\n  a/b:\n    url: x\n");
    assert.throws(
      () => readMachineConfig(home),
      /`repositories\.a\/b` must be the address/,
      "this form holds the address alone",
    );
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
    const text = `brain: sam/brain\nteam: northwind/brain\nrepositories:\n  northwind/brain: ${TEAM_URL}\n`;
    writeFileSync(configPath(home), text);
    const c = readMachineConfig(home)!;
    assert.deepEqual([c.brain, c.team], ["sam/brain", "northwind/brain"]);
    assert.equal(stringifyMachineConfig(c), `${CONFIG_HEADER}\n${text}`);
    writeFileSync(configPath(home), "team: nonsense\n");
    assert.throws(() => readMachineConfig(home), /`team` is not a brain's name/);
  }));

test("machine configuration writes round-trip, atomically, leaving no lock or temporary file", () =>
  scratch(async (home) => {
    const c = emptyConfig();
    c.brain = "sam/brain";
    c.repositories["sam/brain"] = "/Volumes/shared/sam.git";
    c.repositories["northwind/brain"] = TEAM_URL;
    await writeMachineConfig(c, home);
    assert.deepEqual(readMachineConfig(home), c);
    assert.deepEqual(readdirSync(join(home, ".kioku")), ["config.yaml"]);

    await updateMachineConfig((x) => {
      x.repositories["northwind/brain-acme"] = ACME;
    }, home);
    assert.deepEqual(Object.keys(readMachineConfig(home)!.repositories), [
      "sam/brain",
      "northwind/brain",
      "northwind/brain-acme",
    ]);
  }));

test("updating a machine that is not set up starts from the defaults", () =>
  scratch(async (home) => {
    await updateMachineConfig((c) => {
      c.brain = "sam/brain";
    }, home);
    assert.deepEqual(readMachineConfig(home), {
      brain: "sam/brain",
      repositories: {},
      trust: { owners: [] },
    });
  }));

test("concurrent updates are not lost", () =>
  scratch(async (home) => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateMachineConfig((c) => {
          c.repositories[`o/b${i}`] = `/srv/b${i}.git`;
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
  if (clone.personal) put(join(home, ".kioku/brains/sam/brain"), PERSONAL);
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
        ["personal", "sam/brain", true],
        ["project", "northwind/brain-acme", true],
        ["team", "northwind/brain", true],
      ],
    );
    assert.equal(chain.links[0]!.path, join(home, ".kioku/brains/sam/brain"));
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
      [["personal", "sam/brain"]],
    );
  }));

test("every brain lives in the managed folder under its name: a brain the machine names but has not is not cloned (§2.5)", () =>
  scratch((home) => {
    machine(home, {});
    const chain = resolveChain(join(home, "work/acme-api"), config(home), home);
    assert.equal(chain.links[0]!.path, join(home, ".kioku/brains/sam/brain"));
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
  c.repositories = { "sam/brain": c.repositories["sam/brain"]! };
  c.trust.owners = [];
  return { repo, c };
}

test("a brain a repository names is not loaded until this machine trusts it (§2.4)", () =>
  scratch((home) => {
    const { repo, c } = unfamiliar(home, { personal: true, project: true, team: true });
    const chain = resolveChain(repo, c, home);
    assert.deepEqual(
      chain.links.map((l) => l.key),
      ["sam/brain"],
    );
    assert.deepEqual(
      chain.untrusted.map((l) => [l.tier, l.key, l.cloned]),
      [
        ["project", "northwind/brain-acme", false],
        ["team", "northwind/brain", false],
      ],
    );
    assert.deepEqual(chain.missing, []);
    assert.equal(chain.project, "northwind/brain-acme");
  }));

test("a registered repository, or an owner in `trust.owners`, is trusted", () =>
  scratch((home) => {
    const { repo, c } = unfamiliar(home, { personal: true, project: true, team: true });
    c.repositories["northwind/brain-acme"] = ACME;
    c.repositories["northwind/brain"] = TEAM_URL;
    const byBrain = resolveChain(repo, c, home);
    assert.deepEqual(
      byBrain.links.map((l) => l.key),
      ["sam/brain", "northwind/brain-acme", "northwind/brain"],
    );
    assert.deepEqual(byBrain.untrusted, []);

    const owner = unfamiliar(home, { personal: true, project: true, team: true });
    owner.c.trust.owners = ["github.com/northwind"];
    assert.deepEqual(
      resolveChain(owner.repo, owner.c, home).links.map((l) => l.key),
      ["sam/brain", "northwind/brain-acme", "northwind/brain"],
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
    c.repositories["northwind/brain-acme"] = ACME;
    const chain = resolveChain(repo, c, home);
    assert.deepEqual(
      chain.links.map((l) => l.key),
      ["sam/brain", "northwind/brain-acme"],
    );
    assert.deepEqual(
      chain.untrusted.map((l) => [l.tier, l.key]),
      [["team", "acme/brain"]],
    );
  }));

test("a brain the session is inside is the person's own act and needs no trust", () =>
  scratch((home) => {
    machine(home, { personal: true, project: true, team: true });
    const c = config(home);
    c.trust.owners = [];
    const inside = resolveChain(join(home, ".kioku/brains/northwind/brain-acme"), c, home);
    assert.equal(inside.inside, "northwind/brain-acme");
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
        ["personal", "sam/brain"],
        ["team", "northwind/brain"],
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
        ["project", "northwind/brain-acme"],
        ["team", "acme/brain"],
      ],
    );
  }));

test("the machine's team loads where no project folder names one, and needs no trust; a folder's team wins (§2.4)", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, project: true, team: true, code: PROJECT_ONLY });
    const c = config(home);
    c.team = "northwind/brain";
    // Nobody ran `kioku init` here: the machine's team is the person's own act, so it is trusted all the same.
    const strict = {
      ...c,
      repositories: { "sam/brain": c.repositories["sam/brain"]! },
      trust: { owners: [] },
    };
    mkdirSync(join(home, "scratch"), { recursive: true });
    const nowhere = resolveChain(join(home, "scratch"), strict, home);
    assert.deepEqual(
      nowhere.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "sam/brain"],
        ["team", "northwind/brain"],
      ],
    );
    assert.equal(nowhere.teamFrom, "machine");
    assert.deepEqual(nowhere.untrusted, []);

    const projectOnly = resolveChain(repo, c, home);
    assert.deepEqual(
      projectOnly.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "sam/brain"],
        ["project", "northwind/brain-acme"],
        ["team", "northwind/brain"],
      ],
    );
    assert.equal(projectOnly.teamFrom, "machine");

    writeFileSync(join(repo, "kioku.yaml"), `${PROJECT_ONLY}team: github.com/acme/brain\n`);
    const named = resolveChain(repo, c, home);
    assert.deepEqual(
      named.links.map((l) => [l.tier, l.key]),
      [
        ["personal", "sam/brain"],
        ["project", "northwind/brain-acme"],
        ["team", "acme/brain"],
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

test("a folder that names the personal brain as its project loads it once, as personal, and says so (§2.1)", () =>
  scratch((home) => {
    const repo = machine(home, { personal: true, code: "brain: sam/brain\n" });
    const chain = resolveChain(repo, config(home), home);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["personal", "sam/brain"]],
    );
    assert.equal(chain.project, undefined);
    assert.match(
      chain.problems.join("\n"),
      /sam\/brain is a personal brain, and a project link takes only a project brain/,
    );
  }));

test("inside a brain's own folder that brain alone is the chain, and the personal brain is not loaded (§2.7)", () =>
  scratch((home) => {
    machine(home, { personal: true, project: true });
    const chain = resolveChain(join(home, ".kioku/brains/northwind/brain-acme/knowledge/acme"), config(home), home);
    assert.equal(chain.root, undefined);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["project", "northwind/brain-acme"]],
    );
    assert.deepEqual(
      chain.notLoaded.map((n) => [n.tier, n.key]),
      [["personal", "sam/brain"]],
    );
    const c = config(home);
    c.team = "northwind/brain";
    assert.deepEqual(
      resolveChain(join(home, ".kioku/brains/northwind/brain-acme"), c, home).notLoaded.map((n) => [n.tier, n.key]),
      [
        ["personal", "sam/brain"],
        ["team", "northwind/brain"],
      ],
      "the machine's team is the session's chain too, not loaded",
    );
    assert.equal(chain.inside, "northwind/brain-acme");
    assert.equal(chain.project, "northwind/brain-acme");
    assert.equal(chain.links[0]!.path, join(home, ".kioku/brains/northwind/brain-acme"));
  }));

test("inside the personal brain it loads once and is the brain the session is in", () =>
  scratch((home) => {
    machine(home, { personal: true });
    const chain = resolveChain(join(home, ".kioku/brains/sam/brain"), config(home), home);
    assert.deepEqual(
      chain.links.map((l) => [l.tier, l.key]),
      [["personal", "sam/brain"]],
    );
    assert.equal(chain.inside, "sam/brain");
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
