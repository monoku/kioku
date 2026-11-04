/**
 * `pnpm demo [--out <dir>] [--force]`: build the demo brains of `seed.ts` through the tool's own verbs, dated, into
 * `<dir>` (default `.demo/` in the repository). Everything stays local: the shared brains push to bare repositories
 * under `<dir>/.remotes`, standing in for the git host, and the brains get their own machine configuration under
 * `<dir>/.home`; the real `~/.kioku` is never touched. `--force` throws it all away and rebuilds; the seed is fixed,
 * so the story is the same each time, and whatever a trial session wrote is gone.
 *
 * What comes out: the three brains under `<dir>/brains/<owner>/<repo>`, laid out as a machine keeps them, one git
 * repository each, and `<dir>/app`, Northwind's code repository linked to the project brain and the team's, where a
 * session loads all three.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Context } from "../../src/cli/run.ts";
import { answerOf, runTool } from "../tool.ts";
import { stringifyFolderConfig } from "../../src/core/config/folder-config.ts";
import { writeMachineConfig } from "../../src/core/config/machine.ts";
import { git } from "../../src/core/git.ts";
import { DEMO_USER, prepareSession } from "../dev/prepare.ts";
import { BRAINS, LOAD_FIRST, NAMESPACE_SUMMARIES, TODAY, plan, type BrainName, type PagePlan } from "./seed.ts";

const { values } = parseArgs({
  options: { out: { type: "string" }, force: { type: "boolean" } },
  strict: true,
});
const root = resolve(new URL("../..", import.meta.url).pathname);
const out = resolve(values.out ?? join(root, ".demo"));
const home = join(out, ".home");
const remotes = join(out, ".remotes");
const app = join(out, "app");
/** Where a brain of the seed is kept: as `~/.kioku/brains` keeps one, by its repository. */
const folderOf = (brain: BrainName): string => join(out, "brains", BRAINS[brain].repo);
/** How the demo names a brain to the tool: by its repository, as a person types it (§2.3). */
const ref = (brain: BrainName): string => BRAINS[brain].repo;

if (existsSync(out)) {
  if (!values.force) {
    console.error(`${out} exists; pass --force to rebuild it.`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}
mkdirSync(home, { recursive: true });

// Git must not stop to ask anything, and every commit is dated by the seed, not by the clock.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
// Each write gets its own minute of the day, in order of planning, so the timeline is total and the same each run.
let tick = 0;
const dayOf = (age: number): Date =>
  new Date(TODAY.getTime() - age * 86_400_000 - 8 * 3_600_000 + (tick++ % 480) * 60_000);
/** A follow-up never precedes the page it follows, whatever the ages say. */
const after = (base: Date, age: number): Date => {
  const d = dayOf(age);
  return d.getTime() > base.getTime() ? d : new Date(base.getTime() + ((tick++ % 60) + 1) * 60_000);
};

let clock = TODAY;
const identity = (brain: BrainName) =>
  brain === "sam" ? ["Sam", "sam@example.com"] : ["Ana", "ana@northwind.example"];

/** One call of the tool as the agent makes it, at a given moment, in the code repository's folder. */
async function kioku(argv: string[], at: Date, by: BrainName, stdin = ""): Promise<any> {
  clock = at;
  const [name, email] = identity(by);
  Object.assign(process.env, {
    GIT_AUTHOR_DATE: at.toISOString(),
    GIT_COMMITTER_DATE: at.toISOString(),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  });
  const ctx: Context = {
    home,
    cwd: existsSync(join(app, "kioku.yaml")) ? app : out,
    env: process.env,
    stdin: async () => stdin,
    now: () => clock,
    startBackground: () => {},
    semantic: {
      download: async () => {
        throw new Error("no network in the demo");
      },
      loadEmbedder: async () => {
        throw new Error("no engine in the demo");
      },
    },
  };
  const { code, raw } = await runTool([...argv, "--json"], ctx);
  if (raw.trim() === "") throw new Error(`kioku ${argv.join(" ")} exited ${code} and said nothing`);
  return answerOf(raw);
}

const sectionsToBody = (sections: Record<string, string>): string =>
  Object.entries(sections)
    .map(([h, text]) => (h === "" ? `${text}\n` : `## ${h}\n\n${text}\n`))
    .join("\n");

const pathOf = new Map<string, string>(); // `${brain}:${title}` -> brain-relative path

async function saveOrCreate(p: PagePlan, at: Date): Promise<string> {
  const args = [
    "page",
    "save",
    "--brain",
    ref(p.brain),
    "--kind",
    p.kind,
    ...(p.sub ? ["--sub", p.sub] : []),
    "--title",
    p.title,
    "--source",
    p.source,
    "--namespace",
    p.namespace,
    ...(p.summary ? ["--summary", p.summary] : []),
    ...(p.evidence ? ["--evidence", p.evidence] : []),
    ...(p.aliases ? ["--aliases", p.aliases.join(",")] : []),
    ...(p.staleAfter ? ["--stale-after", p.staleAfter] : []),
    ...(p.sourceVersion ? ["--source-version", p.sourceVersion] : []),
  ];
  const body = sectionsToBody(p.sections);
  let r = await kioku(args, at, p.brain, body);
  if (r.status === "similar") {
    // Related but not the same: create it, linked to the similar pages, as the agent would (§1.4, §3.3). A Rule goes
    // whole into every summary, See also included, so the agent links it to nothing rather than to loose neighbours.
    r = await kioku([...args, "--create", ...(p.kind === "rule" ? ["--see-also", "none"] : [])], at, p.brain, body);
  }
  if (r.status !== "done") throw new Error(`save of "${p.title}" in ${p.brain}: ${JSON.stringify(r.error ?? r)}`);
  pathOf.set(`${p.brain}:${p.title}`, r.path);
  return r.path as string;
}

interface Event {
  at: Date;
  run: () => Promise<void>;
}

async function main(): Promise<void> {
  const oldest = dayOf(440);
  // The machine: brains kept under the demo folder through path overrides (§2.5).
  const config = {
    trust: { owners: [] as string[] },
    repositories: Object.fromEntries(
      (Object.entries(BRAINS) as [BrainName, (typeof BRAINS)[BrainName]][]).map(([name, b]) => [
        `github.com/${b.repo}`,
        { path: folderOf(name) },
      ]),
    ),
  };
  await writeMachineConfig(config, home);

  // The demo's GitHub is a folder that does not exist, so nothing reaches the network; and the person the demo is about is
  // sam, as git says who a person is (§2.3): who confirms a page.
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.file://${join(out, ".no-github")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    GIT_CONFIG_KEY_1: "github.user",
    GIT_CONFIG_VALUE_1: DEMO_USER,
  });
  for (const name of ["sam", "team", "app"] as BrainName[]) {
    const b = BRAINS[name];
    const r = await kioku(["brain", "create", b.repo, "--tier", b.tier], oldest, name);
    if (r.error) throw new Error(`brain create ${name}: ${JSON.stringify(r.error)}`);
    const folder = r.path as string;
    // A shared brain publishes to a bare repository under the demo folder: a git host that is yours to throw away.
    if (b.tier !== "personal") {
      const bare = join(remotes, `${b.repo}.git`);
      mkdirSync(join(bare, ".."), { recursive: true });
      git(undefined, ["init", "-q", "--bare", "-b", "main", bare]);
      git(folder, ["remote", "add", "origin", bare]);
      git(folder, ["push", "-q", "-u", "origin", "main"]);
    }
    // The namespaces of the seed (§3.2): the configuration and one front page each.
    writeFileSync(
      join(folder, "kioku.yaml"),
      stringifyFolderConfig({
        form: "brain",
        format: 1,
        tier: b.tier,
        namespaces: b.namespaces,
      }),
    );
    // One front page each, with what the namespace is for as its paragraph, which the agent chooses by (§3.2).
    for (const ns of b.namespaces) {
      mkdirSync(join(folder, "knowledge", ns), { recursive: true });
      writeFileSync(
        join(folder, "knowledge", ns, "INDEX.md"),
        `# ${ns}\n\n${NAMESPACE_SUMMARIES[name][ns]}\n\n## Load first\n\nThe pages to read before working on ${ns}, five at most, one link per line.\n`,
      );
    }
    git(folder, ["add", "-A"]);
    git(folder, ["commit", "-q", "-m", "Set the namespaces"]);
    if (b.tier !== "personal") git(folder, ["push", "-q", "origin", "main"]);
  }
  // The code repository the sessions open: its kioku.yaml names the project brain and the team (§2.4).
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(app, "kioku.yaml"),
    `brain: github.com/${BRAINS.app.repo}\nteam: github.com/${BRAINS.team.repo}\n`,
  );
  writeFileSync(
    join(app, "README.md"),
    `# app\n\nNorthwind's orders application, standing in: a code repository linked to the demo project brain, ${BRAINS.app.repo}, and the team's, ${BRAINS.team.repo}. Open the agent here.\n`,
  );
  git(app, ["init", "-q", "-b", "main"]);
  git(app, ["add", "-A"]);
  git(app, ["commit", "-q", "-m", "Link the app to its brains"]);

  // Every write as an event on the timeline, oldest first, so history and `touched` tell the truth.
  const events: Event[] = [];
  const planned = plan();
  for (const p of planned) {
    const created = dayOf(p.age);
    events.push({
      at: created,
      run: async () => {
        await saveOrCreate(p, created);
      },
    });
    let last = created;
    for (const o of p.occasions ?? []) {
      const at = after(last, o.age);
      last = at;
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            ["page", "update", rel, "--brain", ref(p.brain), "--evidence", o.text, "--source", o.source],
            at,
            p.brain,
          );
          if (r.status !== "done") throw new Error(`evidence on ${rel}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    if (p.evolveAge !== undefined) {
      const at = after(last, p.evolveAge);
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            ["page", "evolve", rel, "--brain", ref(p.brain), ...(p.evolveTo ? ["--to", p.evolveTo] : [])],
            at,
            p.brain,
          );
          if (r.status !== "done") throw new Error(`evolve ${rel}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    if (p.supersededBy) {
      const s = p.supersededBy;
      const at = after(created, s.age);
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            [
              "page",
              "supersede",
              rel,
              "--brain",
              ref(p.brain),
              "--title",
              s.title,
              "--summary",
              s.summary,
              "--source",
              s.source,
              ...(s.sourceVersion ? ["--source-version", s.sourceVersion] : []),
              ...(s.evidence ? ["--evidence", s.evidence] : []),
            ],
            at,
            p.brain,
            sectionsToBody(s.sections),
          );
          if (r.status !== "done") throw new Error(`supersede ${rel}: ${JSON.stringify(r.error)}`);
          pathOf.set(`${p.brain}:${s.title}`, r.path);
        },
      });
    }
    for (const e of p.edits ?? []) {
      const at = after(created, e.age);
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            ["page", "update", rel, "--brain", ref(p.brain), "--section", e.section, "--note", e.note],
            at,
            p.brain,
            e.text,
          );
          if (r.status !== "done" && r.error?.code !== "unchanged")
            throw new Error(`edit ${rel}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    if (p.contradicts !== undefined) {
      const c = p.contradicts;
      const at = after(created, c.age);
      events.push({
        at,
        run: async () => {
          const a = pathOf.get(`${p.brain}:${p.title}`);
          const b = pathOf.get(`${p.brain}:${c.title}`);
          if (a === undefined || b === undefined) return;
          const r = await kioku(["page", "link", a, b, "--brain", ref(p.brain), "--type", "contradicts"], at, p.brain);
          if (r.status !== "done") throw new Error(`contradicts ${a} ${b}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    if (p.promoted !== undefined) {
      const m = p.promoted;
      const at = after(created, m.age);
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            [
              "page",
              "promote",
              rel,
              "--brain",
              ref(p.brain),
              "--to",
              ref(m.to),
              "--namespace",
              BRAINS[m.to].namespaces[0]!,
              "--create",
            ],
            at,
            p.brain,
            sectionsToBody(m.sections),
          );
          if (r.status !== "done") throw new Error(`promote ${rel}: ${JSON.stringify(r.error ?? r)}`);
          pathOf.set(`${m.to}:${p.title}`, r.path);
        },
      });
    }
    if (p.reread !== undefined) {
      const at = after(created, p.reread.age);
      const version = p.reread.version;
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            ["page", "update", rel, "--brain", ref(p.brain), "--source-version", version],
            at,
            p.brain,
          );
          if (r.status !== "done") throw new Error(`source version of ${rel}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    if (p.verifiedAge !== undefined) {
      const at = after(created, p.verifiedAge);
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(["page", "confirm", rel, "--brain", ref(p.brain)], at, p.brain);
          if (r.status !== "done") throw new Error(`confirm ${rel}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    if (p.retired !== undefined) {
      const at = after(created, p.retired.age);
      events.push({
        at,
        run: async () => {
          const rel = pathOf.get(`${p.brain}:${p.title}`)!;
          const r = await kioku(
            ["page", "retire", rel, "--brain", ref(p.brain), "--reason", p.retired!.reason],
            at,
            p.brain,
          );
          if (r.status !== "done") throw new Error(`retire ${rel}: ${JSON.stringify(r.error)}`);
        },
      });
    }
    for (const l of p.linkTo ?? []) {
      const at = after(created, l.age);
      events.push({
        at,
        run: async () => {
          const a = pathOf.get(`${p.brain}:${p.title}`);
          const b = pathOf.get(`${p.brain}:${l.title}`);
          if (a === undefined || b === undefined || a === b) return;
          const r = await kioku(["page", "link", a, b, "--brain", ref(p.brain)], at, p.brain);
          if (r.status !== "done" && r.error?.code !== "already_linked")
            throw new Error(`link ${a} ${b}: ${JSON.stringify(r.error)}`);
        },
      });
    }
  }
  // A rename is the last thing that happens to a page, so every earlier event finds it by the title it was written with.
  for (const p of planned.filter((x) => x.renamedTo !== undefined)) {
    const to = p.renamedTo!;
    const at = after(dayOf(p.age), to.age);
    events.push({
      at: new Date(Math.max(at.getTime(), TODAY.getTime() - 60_000)),
      run: async () => {
        const rel = pathOf.get(`${p.brain}:${p.title}`)!;
        const r = await kioku(["page", "rename", rel, "--brain", ref(p.brain), "--title", to.title], clock, p.brain);
        if (r.status !== "done") throw new Error(`rename ${rel}: ${JSON.stringify(r.error)}`);
        pathOf.set(`${p.brain}:${to.title}`, r.path);
        pathOf.set(`${p.brain}:${p.title}`, r.path);
      },
    });
  }
  events.sort((x, y) => x.at.getTime() - y.at.getTime());
  let n = 0;
  for (const e of events) {
    await e.run();
    if (++n % 25 === 0) process.stdout.write(`  ${n}/${events.length} writes\n`);
  }

  // What the person who knows the project brain wrote by hand: where to start, and what a search should answer.
  {
    const folder = folderOf("app");
    const rel = (title: string): string => {
      const found = pathOf.get(`app:${title}`);
      if (found === undefined) throw new Error(`the demo has no page called "${title}"`);
      return found;
    };
    for (const [ns, titles] of Object.entries(LOAD_FIRST)) {
      const index = join(folder, "knowledge", ns, "INDEX.md");
      const links = titles.map((t) => `- [${t}](${posix.relative(`knowledge/${ns}`, rel(t))})`);
      writeFileSync(index, `# ${ns}\n\n${NAMESPACE_SUMMARIES.app[ns]}\n\n## Load first\n\n${links.join("\n")}\n`);
    }
    clock = TODAY;
    git(folder, ["add", "-A"]);
    git(folder, ["commit", "-q", "-m", "Say where to start"]);
    git(folder, ["push", "-q", "origin", "main"]);
  }

  // What came out.
  clock = TODAY;
  const report: string[] = [];
  for (const name of ["sam", "team", "app"] as BrainName[]) {
    const pages = await kioku(["page", "list", "--brain", ref(name), "--limit", "1000"], TODAY, name);
    const lint = await kioku(["brain", "lint", ref(name)], TODAY, name);
    const valid = await kioku(["brain", "validate", ref(name)], TODAY, name);
    const byKind: Record<string, number> = {};
    for (const p of pages.pages) byKind[p.subkind ?? p.kind] = (byKind[p.subkind ?? p.kind] ?? 0) + 1;
    const links = pages.pages.reduce((t: number, p: { links: string[] }) => t + p.links.length, 0);
    report.push(
      `${ref(name)}: ${pages.pages.length} pages (${Object.entries(byKind)
        .map(([k, v]) => `${v} ${k}`)
        .join(
          ", ",
        )}), ${links} links, lint ${lint.brains[0].count} to review, validate ${valid.errors} errors ${valid.warnings} warnings`,
    );
  }
  console.log(report.join("\n"));
  console.log(
    `\nDemo brains in ${join(out, "brains")}: ${Object.values(BRAINS)
      .map((b) => `${b.repo}/`)
      .join(", ")}, their bare remotes in .remotes/, and Northwind's code repository linked to them in app/.`,
  );
  console.log(
    `Their machine configuration is ${join(home, ".kioku/config.yaml")}; run the tool against it with KIOKU_HOME=${home}. \`pnpm demo --force\` resets everything.`,
  );
}

await main();
// A session opened in `app` runs this checkout against these brains, in the terminal or the desktop app.
prepareSession(root, out);
console.log(
  `A Claude Code session opened in ${app} runs this checkout's bundle against them; \`pnpm dev:claude\` rebuilds it after a change in src/.`,
);
