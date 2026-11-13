import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../src/cli/run.ts";
import { runTool } from "../scripts/tool.ts";
import { INSTINCT, MEMORY, RULE, ctx, made, put, sh, validPages, writeBrain, type Made } from "./fixtures.ts";
import { Remotes } from "./remotes.ts";

export { sh };

/** Turn a folder of files into a repository with one commit. */
export function commitAll(root: string): void {
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
}

export interface World {
  dir: string;
  home: string;
  repo: string;
  acme: string;
  team: string;
  sam: string;
  remotes: Remotes;
  /** The bare remotes. */
  bare: { acme: string; team: string };
  calls: string[][];
  kioku: (
    argv: string[],
    o?: { stdin?: string; tty?: boolean; cwd?: string; context?: Partial<Context> },
  ) => Promise<{ code: number; out: any; raw: string }>;
}

/** An answer as JSON, or as it came when it is the text a program wants (a hook's instructions, a script to source). */
const parsed = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export interface WorldOptions {
  /** The project brain's pages; the default is the valid fixture without the migrations memory. */
  acmePages?: Made[];
  samPages?: Made[];
  teamPages?: Made[];
  /** Which shared brains are cloned on this machine at the start. */
  cloned?: { acme?: boolean; team?: boolean };
  /** False: the machine configuration does not know the shared brains, as on a machine where nobody ran `kioku init` (§2.4). */
  registered?: boolean;
}

/** Publish a brain made of these pages as `github.com/<slug>`, returning the bare repository. */
function publish(dir: string, remotes: Remotes, slug: string, tier: string, name: string, pages: Made[]): string {
  const src = join(dir, "src", slug);
  writeBrain(src, tier, pages, name);
  commitAll(src);
  const bare = join(remotes.base, `${slug}.git`);
  mkdirSync(join(bare, ".."), { recursive: true });
  // Through git's protocol, not a copy of the object files, which fails when one goes while it copies.
  execFileSync("git", ["clone", "-q", "--bare", "--no-local", src, bare]);
  return bare;
}

/**
 * The machine of §2.5: the personal brain `sam` with no remote, the project brain `acme` and the team brain
 * `northwind` cloned from bare remotes standing in for GitHub, and the code repository `acme-api` linked to both.
 */
export async function world<T>(fn: (w: World) => Promise<T>, o: WorldOptions = {}): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kioku-world-"));
  const remotes = new Remotes(dir);
  try {
    const home = join(dir, "home");
    const bare = {
      acme: publish(
        dir,
        remotes,
        "northwind/brain-acme",
        "project",
        "acme",
        o.acmePages ?? validPages().filter((p) => !p.path.startsWith("memory/run-migrations")),
      ),
      team: publish(
        dir,
        remotes,
        "northwind/brain",
        "team",
        "northwind",
        o.teamPages ?? [
          made({
            n: 90,
            type: RULE,
            namespace: "northwind",
            title: "Write commit messages in English",
            sections: { Rule: "Commit messages are in English.", Why: "Everyone reads them." },
          }),
        ],
      ),
    };
    const acme = join(home, ".kioku/brains/northwind/brain-acme");
    const team = join(home, ".kioku/brains/northwind/brain");
    if (o.cloned?.acme !== false)
      execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain-acme.git", acme]);
    if (o.cloned?.team !== false) execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain.git", team]);

    const sam = join(home, ".kioku/brains/sam/brain");
    writeBrain(
      sam,
      "personal",
      o.samPages ?? [
        made({
          n: 30,
          type: MEMORY,
          namespace: "sam",
          title: "Prefer small commits",
          sections: { "What happened": "x", Lesson: "y", "Rule of thumb": "z" },
        }),
        made({
          n: 31,
          type: INSTINCT,
          namespace: "sam",
          title: "Run database tests serially",
          sections: { When: "Tests touch the database.", Do: "Run them serially." },
          occasions: 1,
        }),
      ],
      "sam",
    );
    commitAll(sam);

    // The machine knows the addresses the person accepted with `kioku init`; `registered: false` is a machine that does not (§2.4).
    const known =
      o.registered === false
        ? ""
        : "repositories:\n  northwind/brain-acme: https://github.com/northwind/brain-acme.git\n  northwind/brain: https://github.com/northwind/brain.git\n";
    put(home, ".kioku/config.yaml", `brain: sam/brain\n${known}`);
    const repo = join(home, "work/acme-api");
    put(
      repo,
      "kioku.yaml",
      "brain: { name: northwind/brain-acme, url: https://github.com/northwind/brain-acme.git }\nteam: { name: northwind/brain, url: https://github.com/northwind/brain.git }\n",
    );

    const calls: string[][] = [];
    const kioku: World["kioku"] = async (argv, k = {}) => {
      const context = ctx({
        home,
        cwd: k.cwd ?? repo,
        stdin: async () => k.stdin ?? "",
        startBackground: (a) => calls.push(a),
        ...k.context,
      });
      const { code, raw } = await runTool(argv, context, k.tty ?? false);
      return { code, raw, out: k.tty || raw.trim() === "" ? raw : parsed(raw) };
    };
    return await fn({ dir, home, repo, acme, team, sam, remotes, bare, calls, kioku });
  } finally {
    remotes.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `kioku` with stdin as its second argument, as the write tests call it. */
export type StdinKioku = (
  argv: string[],
  stdin?: string,
  tty?: boolean,
  context?: Partial<Context>,
) => Promise<{ code: number; out: any; raw: string }>;

/** The world of §2.5, answering `kioku` with stdin as its second argument. */
export const stdinWorld = <T>(
  fn: (w: Omit<World, "kioku"> & { kioku: StdinKioku }) => Promise<T>,
  o?: WorldOptions,
): Promise<T> =>
  world(
    (w) =>
      fn({
        ...w,
        kioku: (argv, stdin = "", tty = false, context) => w.kioku(argv, { stdin, tty, ...(context && { context }) }),
      }),
    o,
  );
