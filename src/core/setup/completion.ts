import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { launcherPath } from "./install.ts";
import { profilesOf, SHELLS, shellOf, type PathEnv, type Shell } from "./path.ts";

/** What marks what `setup` writes for the completion, so it is written once. */
export const COMPLETION_MARK = "# kioku completion";

export interface CompletionPlan {
  shell?: Shell | "all";
  action: "written" | "present" | "unavailable";
  files: string[];
  reason?: string;
}

/**
 * The shell's completion of `kioku` (§6.3): a file, or a profile line, that loads `kioku completion <shell>` through
 * the launcher, so what the shell completes is always the installed version's. fish reads a file in its completions
 * folder on demand; zsh and bash take a line in the profile, marked, written once, that evaluates the script.
 */
function completionFiles(shell: Shell, e: PathEnv): string[] {
  if (shell === "fish")
    return [join(e.env.XDG_CONFIG_HOME ?? join(e.person, ".config"), "fish", "completions", "kioku.fish")];
  return profilesOf(shell, e);
}

function textFor(shell: Shell, launcher: string): string {
  if (shell === "fish") return `${COMPLETION_MARK}\n"${launcher}" completion fish | source\n`;
  // `eval`, not `source <(…)`: bash 3.2, the one macOS ships, reads nothing from a process substitution.
  return `${COMPLETION_MARK}\n[ -x "${launcher}" ] && eval "$("${launcher}" completion ${shell})"\n`;
}

/** Write what is missing; say what was found already there. */
export function applyCompletion(e: PathEnv, opts: { shell?: Shell | "all" } = {}): CompletionPlan {
  const shells: Shell[] =
    opts.shell === "all"
      ? [...SHELLS]
      : opts.shell !== undefined
        ? [opts.shell]
        : shellOf(e.env)
          ? [shellOf(e.env)!]
          : [];
  if (shells.length === 0) {
    return {
      action: "unavailable",
      files: [],
      reason: `the shell is not one the tool knows (${SHELLS.join(", ")}): kioku completion <shell> prints the script to source`,
    };
  }
  const launcher = launcherPath(e.dirs);
  const written: string[] = [];
  const present: string[] = [];
  for (const shell of shells) {
    for (const file of completionFiles(shell, e)) {
      const have = existsSync(file) ? readFileSync(file, "utf8") : "";
      if (have.includes(COMPLETION_MARK)) {
        present.push(file);
        continue;
      }
      mkdirSync(dirname(file), { recursive: true });
      if (shell === "fish") writeFileSync(file, textFor(shell, launcher));
      else appendFileSync(file, `${have === "" || have.endsWith("\n") ? "" : "\n"}${textFor(shell, launcher)}`);
      written.push(file);
    }
  }
  const shell = opts.shell ?? shells[0];
  return written.length > 0
    ? { shell, action: "written", files: written }
    : { shell, action: "present", files: present };
}
