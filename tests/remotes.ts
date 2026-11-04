import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { put, sh } from "./fixtures.ts";

/** Git with no user or system configuration and a fixed identity, for tests that run it. */
export function isolateGit(): void {
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Sam",
    GIT_AUTHOR_EMAIL: "sam@example.com",
    GIT_COMMITTER_NAME: "Sam",
    GIT_COMMITTER_EMAIL: "sam@example.com",
  });
  offline();
}

/**
 * GitHub as a folder that does not exist: a clone a test did not set up finds nothing, and never the network. And no
 * maintenance after a commit: git runs it detached, and it may pack the loose objects a clone is copying.
 */
function offline(): void {
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: `url.file://${join(tmpdir(), "kioku-tests-no-github")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    GIT_CONFIG_KEY_1: "maintenance.auto",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "gc.auto",
    GIT_CONFIG_VALUE_2: "0",
    // Who the person is, as git says it (§2.3): sam, the name of their personal brain and who confirms a page.
    GIT_CONFIG_KEY_3: "github.user",
    GIT_CONFIG_VALUE_3: "sam",
  });
}

/**
 * Stand-ins for brains on GitHub: bare repositories under `<root>/remote/<owner>/<repo>.git`, reached through git's
 * own URL rewriting so that `github.com/owner/repo` clones from disk and nothing touches the network.
 */
export class Remotes {
  readonly root: string;
  readonly base: string;

  constructor(root: string) {
    this.root = root;
    this.base = join(root, "remote");
    mkdirSync(this.base, { recursive: true });
    // Key 0 alone: the maintenance and gc guards `offline` set as keys 1 and 2 stay.
    Object.assign(process.env, {
      GIT_CONFIG_KEY_0: `url.file://${this.base}/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/",
    });
  }

  /** Publish a brain made of these files as `github.com/<slug>`. */
  publish(slug: string, files: Record<string, string>): void {
    const src = join(this.root, "src", slug);
    for (const [rel, text] of Object.entries(files)) put(src, rel, text);
    sh(src, "init", "-q", "-b", "main");
    sh(src, "add", "-A");
    sh(src, "commit", "-q", "-m", "init");
    const bare = join(this.base, `${slug}.git`);
    mkdirSync(dirname(bare), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", "--no-local", src, bare]);
  }

  /** An empty repository at `github.com/<slug>`, as a person makes one on the host before `brain publish`. */
  empty(slug: string): string {
    const bare = join(this.base, `${slug}.git`);
    mkdirSync(bare, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    return bare;
  }

  close(): void {
    offline();
  }
}

export const repo = (dir: string): string => {
  mkdirSync(dir, { recursive: true });
  sh(dir, "init", "-q", "-b", "main");
  return dir;
};
