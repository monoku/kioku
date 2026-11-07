import { brainRepoOfKey } from "../config/brain-ref.ts";
import { LANGUAGE_TAG, stringifyFolderConfig } from "../config/folder-config.ts";
import { userError } from "../errors.ts";
import { applyChanges, bringIn, type Applied, type TargetBrain } from "./apply.ts";
import type { WriteContext } from "./apply.ts";

export interface LanguageSet extends Partial<Applied> {
  status: "done";
  brain: string;
  language: string;
}

/**
 * `kioku brain language <tag> --brain <b>` (§3.2): the brain declares the language its pages are written in, in `kioku.yaml`,
 * in one commit. A convention: nothing checks the pages against it.
 */
export async function setLanguage(
  brain: TargetBrain,
  input: { language: string },
  env: WriteContext,
): Promise<LanguageSet> {
  const language = input.language.trim();
  if (!LANGUAGE_TAG.test(language))
    throw userError(
      `${JSON.stringify(input.language)} is not a language tag: two or three letters, and a region if needed, such as en, es, es-419 or pt-BR`,
      "usage",
    );
  const seen = await bringIn(brain);
  const config = seen.repo.config();
  if (config.language === language)
    throw userError(
      `${brainRepoOfKey(brain.key)} already says its pages are written in ${language}; nothing was written`,
      "unchanged",
    );
  const text = stringifyFolderConfig({ ...config, language });
  const applied = await applyChanges(brain, [{ rel: "kioku.yaml", text }], `language: ${language}`, env, seen);
  return { status: "done", brain: brain.key, language, ...applied };
}
