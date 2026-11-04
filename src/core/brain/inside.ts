import { type Dirent, lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Whether `rel` names a regular file inside the brain at `root`, through no symbolic link and never above the root
 * (§3.1). A brain is files inside its folder: anything else is read as missing, so a committed link cannot bring a file
 * of the machine's into the agent's context.
 */
export function isInside(root: string, rel: string): boolean {
  if (rel === "" || isAbsolute(rel) || rel.includes("\\")) return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  let at = root;
  for (const [i, part] of parts.entries()) {
    at = join(at, part);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(at);
    } catch {
      return false;
    }
    if (stat.isSymbolicLink()) return false;
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return false;
  }
  return true;
}

/** The text of a file inside the brain, or undefined when there is none there (§3.1). */
export function readInsideIfAny(root: string, rel: string): string | undefined {
  return isInside(root, rel) ? readFileSync(join(root, rel), "utf8") : undefined;
}

/** The symbolic links in a brain's folder, `.git` aside, relative to its root: what the validator names (§5.1 rule 12). */
export function linksIn(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const at = rel === "" ? e.name : `${rel}/${e.name}`;
      if (rel === "" && e.name === ".git") continue;
      if (e.isSymbolicLink()) found.push(at);
      else if (e.isDirectory()) walk(join(dir, e.name), at);
    }
  };
  walk(root, "");
  return found;
}
