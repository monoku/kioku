import { tmpdir, userInfo } from "node:os";
import { userError } from "../errors.ts";
import { gitQuiet } from "../git.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const slug = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");

/** Where the name the person goes by came from (§2.3): git on this machine, or the system user. */
export type UserSource = "git" | "system";

/**
 * The name the person goes by (§2.3), with where it came from: what git on this machine knows (`github.user`, the
 * name, the part of the email before the `@`), else the system user. No git host is asked, and nothing is recorded:
 * `git config --global github.user <handle>` is where a person says it.
 */
export function findUser(cwd: string = tmpdir()): { name: string; from: UserSource } {
  // One key at a time, the first that gives a name ending the search: most machines answer the first or the second.
  const asked: [string, (v: string) => string][] = [
    ["github.user", (v) => v],
    ["user.name", (v) => v],
    ["user.email", (v) => v.split("@")[0]!],
  ];
  let git: string | undefined;
  for (const [key, part] of asked) {
    const value = gitQuiet(cwd, ["config", "--get", key]);
    const name = value === undefined ? "" : slug(part(value));
    if (name !== "") {
      git = name;
      break;
    }
  }
  const [name, from]: [string, UserSource] = git !== undefined ? [git, "git"] : [slug(userInfo().username), "system"];
  if (!NAME.test(name))
    throw userError(
      `"${name}" cannot be a user name; use letters, digits, dots and dashes (git config --global github.user <handle> names one)`,
      "user_invalid",
    );
  return { name, from };
}

/** The name the person goes by as far as this machine knows; undefined when none is a valid name. */
export function knownUser(): string | undefined {
  try {
    return findUser().name;
  } catch {
    return undefined;
  }
}
