import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brainFolder, isAddress, parseName, repoKey, type BrainRef } from "../config/brain-ref.ts";
import { CURRENT_FORMAT, LANGUAGE_TAG, stringifyFolderConfig, TIERS, type Tier } from "../config/folder-config.ts";
import { readMachineConfig, updateMachineConfig } from "../config/machine.ts";
import { userError } from "../errors.ts";
import { commitOrRestore, git, type Change } from "../git.ts";
import { knownUser } from "../setup/personal.ts";
import { folderFiles } from "./owned.ts";

export interface CreateInput {
  /** Personal unless it says project or team (§2.3). */
  tier?: string;
  /** The brain's name, `<owner>/<repo>`, always given (§2.3). */
  repo: string;
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
}

/** The front page of a new personal brain (§2.1, §3.1), named by the brain, never by who the person is (§2.3). */
const personalIndex = (name: string): string =>
  `# ${name}\n\nThe personal brain ${name}: how its person works, what they learned, the instincts that came from it.\n\n` +
  `Kioku writes here as the agent works; the pages are Markdown and the history is git.\n`;

/**
 * `kioku brain create <owner>/<repo> [--tier <tier>]` (§2.3, §6.1): a brain made on this machine with the name given,
 * asking no git host anything and nothing of git or the system for its name: the folder, its `kioku.yaml` with that
 * name, front pages, the files the tool owns (`AGENTS.md`, each agent host's pointers, §2.7), kind folders, a first
 * commit, in a repository of its own, under `~/.kioku/brains/<owner>/<repo>` (§2.5). No repository is ever made on the
 * host here: `kioku brain publish` is the person's.
 */
export async function createBrain(home: string, version: string, input: CreateInput): Promise<CreateResult> {
  const config = readMachineConfig(home);
  const tier = (input.tier ?? "personal") as Tier;
  if (!(TIERS as readonly string[]).includes(tier))
    throw userError(`the tier is personal, project or team, not "${tier}"`, "usage");
  const named = parseName(input.repo);
  if (named === undefined)
    throw userError(
      isAddress(input.repo)
        ? `"${input.repo}" is an address; brain create takes the brain's name, <owner>/<repo>, and brain publish --remote gives it an address`
        : `"${input.repo}" is not a brain's name: <owner>/<repo>, letters, digits, - and _, such as sam/memoria`,
      "usage",
    );
  if (tier === "personal" && config?.brain !== undefined)
    throw userError(
      `this machine has your personal brain, ${config.brain}; a shared brain is made with --tier project or team`,
      "personal_exists",
    );
  if (input.language !== undefined && !LANGUAGE_TAG.test(input.language)) {
    throw userError(
      `--language is a language tag: two or three letters, and a region if needed, such as en, es, es-419 or pt-BR, not "${input.language}"`,
      "usage",
    );
  }
  const ref: BrainRef = named;
  const name = repoKey(ref);
  const clone = brainFolder(home, ref);
  if (existsSync(join(clone, "kioku.yaml")) || config?.repositories[name] !== undefined)
    throw userError(`this machine has a brain named ${name} already; another name is another brain`, "brain_exists");
  if (existsSync(join(clone, ".git")))
    throw userError(`${clone} is already a repository; a brain is a repository of its own`, "brain_exists");
  if (existsSync(clone) && readdirSync(clone).length > 0)
    throw userError(`${clone} exists and is not empty`, "path_not_empty");
  // A brain is a repository of its own: never inside another brain, nor holding one (§2.3).
  if (existsSync(join(dirname(clone), "kioku.yaml")))
    throw userError(`${dirname(clone)} is a brain, and a brain is never inside another`, "brain_exists");
  const hadFolder = existsSync(clone);

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
        format: CURRENT_FORMAT,
        name,
        tier,
        namespaces: [],
        ...(input.language !== undefined && { language: input.language }),
      }),
    );
    put(
      "BRAIN.md",
      tier === "personal"
        ? personalIndex(name)
        : `# ${name}\n\nThe ${tier} brain ${name}: what it is for, the projects it serves, and who looks after it.\n`,
    );
    for (const f of folderFiles(name, tier, version)) put(f.rel, f.text);
    for (const f of ["memory", "rules", "skills"]) put(`${f}/.gitkeep`, "");
    put(".gitignore", ".DS_Store\n");
    git(clone, ["init", "-q", "-b", "main"]);
    // Committed as every write is (§1.6): on a machine with no git identity, as the name the person goes by, worked out
    // and not recorded (§2.5); when the commit fails, nothing written stays.
    commit = commitOrRestore(clone, `Create the ${tier} brain ${name}`, written, {
      via: input.via,
      author: knownUser() ?? ref.owner,
    });
  } catch (e) {
    // A brain that could not be made leaves nothing it made, so making it again works.
    if (hadFolder) for (const entry of readdirSync(clone)) rmSync(join(clone, entry), { recursive: true, force: true });
    else rmSync(clone, { recursive: true, force: true });
    throw e;
  }

  // A brain made here has no address to accept, so it is not in `repositories` (§2.5).
  if (tier === "personal") await updateMachineConfig((c) => void (c.brain ??= name), home);

  return {
    action: "created",
    brain: name,
    tier,
    path: clone,
    commit,
    publication: "local",
    ...(input.language !== undefined && { language: input.language }),
  };
}
