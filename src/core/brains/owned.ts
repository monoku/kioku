import { harnessBrainFiles } from "../../harness/index.ts";
import type { Tier } from "../config/folder-config.ts";
import { AGENTS_MD, agentsMd } from "./agents-md.ts";

/**
 * The files the tool owns in a brain besides its pages (§2.7): the neutral `AGENTS.md` and what each agent host
 * needs in the folder. Written by
 * `brain create`, brought up to date by `brain refresh`; a person may edit them, and `refresh` writes them back.
 */

export interface OwnedFile {
  /** Relative to the brain's repository. */
  rel: string;
  text: string;
}

/** The files in the brain's own folder, relative to it: `AGENTS.md`, which names the version that wrote it (§2.7), and each agent host's. The validator checks these. */
export const folderFiles = (repo: string, tier: Tier, version: string): OwnedFile[] => [
  { rel: AGENTS_MD, text: agentsMd(repo, tier, version) },
  ...harnessBrainFiles(repo),
];
