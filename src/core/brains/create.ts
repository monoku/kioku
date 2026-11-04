import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brainRepo, brainRepoOfKey, parseRepoShort, repoKey, cloneOf, type BrainRef } from "../config/brain-ref.ts";
import { LANGUAGE_TAG, stringifyFolderConfig, TIERS, type Tier } from "../config/folder-config.ts";
import { emptyConfig, readMachineConfig, updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { commitOrRestore, git, type Change } from "../git.ts";
import { findUser, knownUser, type UserSource } from "../setup/personal.ts";
import { folderFiles } from "./owned.ts";

export interface CreateInput {
  /** Personal when no repository is named. */
  tier?: string;
  /** `owner/repo` or a brain URL; with none, the personal brain `<name>/brain` (§2.3). */
  repo?: string;
  /** Where the repository's clone goes, absolute, instead of the managed folder; recorded as its `path` (§2.5). */
  dir?: string;
  /** The language its pages are written in (§3.2). */
  language?: string;
  /** How the write arrived, for the `Kioku-Via` trailer of the first commit (§1.6). */
  via?: string;
}

export interface CreateResult {
  /** Always `created`: the brain is made on this machine (§2.3); `brain clone` is the verb that brings one. */
  action: "created";
  brain: string;
  tier: Tier;
  path: string;
  commit: string;
  /** Only on this machine: `kioku brain publish` gives it a remote (§2.3). */
  publication: "local";
  /** The language the brain declared when it was made (§3.2). */
  language?: string;
  /** Where the personal brain's name came from when no repository was named: git or the system user (§2.3). Nothing is recorded. */
  /** Where the person's name came from, when the personal brain was named after it (§2.3). */
  userFrom?: UserSource;
}

/** The front pages of a new personal brain (§2.1, §3.1): the person's, in their words. */
const personalIndex = (name: string): string =>
  `# ${name}\n\nThe personal brain of ${name}: how they work, what they learned, the instincts that came from it.\n\n` +
  `Kioku writes here as the agent works; the pages are Markdown and the history is git.\n`;

/**
 * `kioku brain create [<brain>] [--tier <tier>]` (§2.3, §6.1): a brain made on this machine, asking no git host anything:
 * the folder, its `kioku.yaml`, front pages, the files the tool owns (`AGENTS.md`, each agent host's pointers, §2.7),
 * kind folders, a first commit, in a repository of its own. No repository is ever made on the host here:
 * `kioku brain publish` is the person's. With no brain named it is the personal brain, `<name>/brain`, `<name>` the
 * one the person goes by as git on this machine knows it (§2.3).
 */
export async function createBrain(home: string, version: string, input: CreateInput): Promise<CreateResult> {
  const config = readMachineConfig(home);
  if (input.repo === undefined && input.tier !== undefined && input.tier !== "personal")
    throw userError(`a ${input.tier} brain is named by its repository, such as owner/repo`, "usage");
  if (input.repo !== undefined && input.tier === undefined)
    throw userError("--tier is needed: personal, project or team", "usage");
  const tier = (input.tier ?? "personal") as Tier;
  if (!(TIERS as readonly string[]).includes(tier))
    throw userError(`the tier is personal, project or team, not "${tier}"`, "usage");
  if (tier === "personal" && config?.brain !== undefined)
    throw userError(
      input.repo === undefined
        ? `this machine has your personal brain, ${brainRepoOfKey(config.brain)} (${config.brain}); a shared brain is named by its repository, with --tier project or team`
        : `a personal brain is already set (${config.brain})`,
      "personal_exists",
    );
  // With no repository named, the personal brain is the person's: `<name>/brain` (§2.3). Nothing is recorded.
  const found = input.repo === undefined ? findUser() : undefined;
  const repo = input.repo ?? `${found!.name}/brain`;
  const base = parseRepoShort(repo);
  if (base === undefined) throw userError(`"${repo}" is not a repository such as owner/repo`, "usage");
  if (input.language !== undefined && !LANGUAGE_TAG.test(input.language)) {
    throw userError(
      `--language is a language tag: two or three letters, and a region if needed, such as en, es, es-419 or pt-BR, not "${input.language}"`,
      "usage",
    );
  }
  const ref: BrainRef = base;

  const recorded = config?.repositories[repoKey(ref)]?.path;
  if (input.dir !== undefined && recorded !== undefined && cloneOf(config!, ref, home) !== input.dir) {
    throw userError(
      `${repoKey(ref)} is already at ${cloneOf(config!, ref, home)} on this machine; --dir cannot move it`,
      "usage",
    );
  }
  const clone = input.dir ?? cloneOf(config ?? emptyConfig(), ref, home);
  if (existsSync(join(clone, "kioku.yaml"))) throw userError(`${clone} already holds a brain`, "brain_exists");
  if (existsSync(join(clone, ".git")))
    throw userError(`${clone} is already a repository; a brain is a repository of its own`, "brain_exists");
  if (existsSync(clone) && readdirSync(clone).length > 0)
    throw userError(`${clone} exists and is not empty`, "path_not_empty");
  const hadFolder = existsSync(clone);

  // A brain has no name (§2.3): its files name it by its repository; a personal brain's front page, by the person.
  const shown = brainRepo(ref);
  const written: Change[] = [];
  const put = (relToRepo: string, text: string) => {
    const path = join(clone, relToRepo);
    written.push({ rel: relToRepo, before: existsSync(path) ? readFileSync(path, "utf8") : undefined });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  let commit: string;
  try {
    put(
      "kioku.yaml",
      stringifyFolderConfig({
        form: "brain",
        format: 1,
        tier,
        namespaces: [],
        ...(input.language !== undefined && { language: input.language }),
      }),
    );
    put(
      "BRAIN.md",
      tier === "personal"
        ? personalIndex(found?.name ?? knownUser() ?? shown)
        : `# ${shown}\n\nThe ${tier} brain ${shown}: what it is for, the projects it serves, and who looks after it.\n`,
    );
    for (const f of folderFiles(shown, tier, version)) put(f.rel, f.text);
    for (const f of ["memory", "rules", "skills"]) put(`${f}/.gitkeep`, "");
    put(".gitignore", ".DS_Store\n");
    git(clone, ["init", "-q", "-b", "main"]);
    // Committed as every write is (§1.6): on a machine with no git identity, as the name the person goes by, worked out
    // and not recorded (§2.5); when the commit fails, nothing written stays.
    commit = commitOrRestore(clone, `Create the ${tier} brain ${shown}`, written, {
      via: input.via,
      author: found?.name ?? knownUser() ?? base.owner,
    });
  } catch (e) {
    // A brain that could not be made leaves nothing it made, so making it again works.
    if (hadFolder) for (const entry of readdirSync(clone)) rmSync(join(clone, entry), { recursive: true, force: true });
    else rmSync(clone, { recursive: true, force: true });
    throw e;
  }

  await updateMachineConfig((c) => {
    c.repositories[repoKey(ref)] ??= {};
    if (input.dir !== undefined) c.repositories[repoKey(ref)]!.path = input.dir;
    if (tier === "personal") c.brain ??= repoKey(ref);
  }, home);

  return {
    action: "created",
    brain: repoKey(ref),
    tier,
    path: clone,
    commit,
    publication: "local",
    ...(input.language !== undefined && { language: input.language }),
    ...(found !== undefined && { userFrom: found.from }),
  };
}
