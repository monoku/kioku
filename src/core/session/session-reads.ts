import { readFileSync } from "node:fs";
import { listMarkdown } from "../brain/brain.ts";
import { readInsideIfAny } from "../brain/inside.ts";
import { parseBrainFile } from "../brain/file.ts";
import { readFolderConfig, type ConfigResult, type FolderConfig } from "../config/folder-config.ts";

/** Each path read once: a failure is not kept, so the next asker meets it as the first did. */
export function onceByPath<T>(read: (path: string) => T): (path: string) => T {
  const seen = new Map<string, T>();
  return (path) => {
    if (seen.has(path)) return seen.get(path)!;
    const value = read(path);
    seen.set(path, value);
    return value;
  };
}

/**
 * What the parts of one session start share of what is on disk (§4.1): made for that start and dropped with it, so
 * nothing is kept past the run or seen by a verb that writes. Everything handed out is read-only to whoever takes it.
 */
export interface SessionReads {
  folderConfig: (path: string) => ConfigResult<FolderConfig>;
  /** The Markdown files of a brain's folder. */
  markdown: (root: string) => string[];
  text: (path: string) => string;
  /** A file of a brain by its brain-relative path, read only inside the brain (§3.1); undefined when there is none. */
  inside: (root: string, rel: string) => string | undefined;
  brainFile: (path: string) => ReturnType<typeof parseBrainFile>;
}

export function sessionReads(): SessionReads {
  const text = onceByPath((path) => readFileSync(path, "utf8"));
  const inside = onceByPath((key) => {
    const [root, rel] = JSON.parse(key) as [string, string];
    return readInsideIfAny(root, rel);
  });
  return {
    inside: (root, rel) => inside(JSON.stringify([root, rel])),
    folderConfig: onceByPath(readFolderConfig),
    markdown: onceByPath(listMarkdown),
    text,
    brainFile: onceByPath((path) => parseBrainFile(text(path))),
  };
}
