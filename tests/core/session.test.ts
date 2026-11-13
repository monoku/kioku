import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NEWS_MAX, composeSummary, SKILLS_NOTE, SUMMARY_CAP } from "../../src/core/session/summary.ts";
import { loadSummaryBrains } from "../../src/core/session/summary-load.ts";
import { startDetached } from "../../src/core/session/background.ts";
import { indexPath, syncStatePath, viewsPath } from "../../src/core/state.ts";
import { readPending } from "../../src/core/write/pending.ts";
import { readMachineConfig, updateMachineConfig } from "../../src/core/config/machine.ts";
import { CONTEXT, DECISION, INSTINCT, MEMORY, RULE, SKILL, made, put, type Made } from "../fixtures.ts";
import { isolateGit } from "../remotes.ts";
import { sh, world, type World } from "../world.ts";

isolateGit();

/** The summary as the agent reads it: both parts, how to use the memory then what it holds (§4.1). */
const summaryOf = (r: { out: any; holds?: { out: any } }): string =>
  [r.out.hookSpecificOutput?.additionalContext, r.holds?.out?.hookSpecificOutput?.additionalContext]
    .filter((p) => p !== undefined)
    .join("\n\n");
/** A session's start: its two hooks, as the host runs them (§4.1). */
const start = async (w: World, o: { cwd?: string; source?: string } = {}) => {
  const stdin = JSON.stringify({ cwd: o.cwd ?? w.repo, source: o.source ?? "startup", session_id: "s" });
  const r = await w.kioku(["hook", "session-start"], { stdin });
  return { ...r, holds: await w.kioku(["hook", "session-start-holds"], { stdin }) };
};

/** Positions of the headings, which must rise in the order of §4.1. */
function inOrder(text: string, headings: string[]): void {
  const at = headings.map((h) => text.indexOf(h));
  for (let i = 0; i < at.length; i++) assert.ok(at[i]! >= 0, `missing ${headings[i]}`);
  for (let i = 1; i < at.length; i++) assert.ok(at[i]! > at[i - 1]!, `${headings[i]} comes after ${headings[i - 1]}`);
}

test("a session in acme-api shows the summary in the order of §4.1", () =>
  world(async (w) => {
    const r = await start(w);
    assert.equal(r.code, 0);
    const s = summaryOf(r);
    // Before the brains, the opening sends the agent to the skill, and to the tool rather than the files.
    inOrder(s, [
      "# Kioku",
      "most specific brain wins",
      "Load the `kioku` skill before reading or writing memory",
      "never through its files",
      "only `show` counts a page as opened",
      "Save on your own, without asking, the moment",
      "At that moment load the `kioku` skill",
      "- personal: sam",
    ]);
    inOrder(s, [
      "# Kioku",
      "- personal: sam",
      "- project: northwind/brain-acme",
      "- team: northwind/brain",
      "## northwind/brain-acme: front page",
      "## Rules",
      "## Skills",
      "## Decisions in northwind/brain-acme",
      "## Instincts",
      "The brains hold",
    ]);
    // Rules of the three brains, each its Rule and its Why; most specific first.
    inOrder(s, [
      "### No prod migrations from a session (northwind/brain-acme",
      "### Write commit messages in English (northwind",
    ]);
    assert.match(s, /Never\.\n\nWhy: Incident of 2026-09\./, "a Rule is its Rule and its Why");
    // A Skill is one line.
    assert.match(
      s,
      /^- Release a hotfix: Release a hotfix\. \(northwind\/brain-acme, skills\/release-a-hotfix\.md\)$/m,
    );
    // Under the heading, what to do with the list, for an agent that has not loaded the skill.
    assert.ok(
      s.includes(`## Skills\n\n${SKILLS_NOTE}\n\n- Release a hotfix`),
      "the note sits between the heading and the first Skill",
    );
    assert.match(SKILLS_NOTE, /kioku page show <path> --brain <brain>/);
    // Current decisions only: MySQL is superseded by Postgres.
    assert.match(
      s,
      /^- Postgres over MySQL: Postgres over MySQL\. \(knowledge\/acme\/decisions\/postgres-over-mysql\.md\)$/m,
    );
    assert.doesNotMatch(s, /MySQL for Acme/);
    // Instincts with recent evidence, personal then project.
    inOrder(s, [
      "- Run database tests serially: Run database tests serially. (1 occasion, last 2026-10-07; sam/brain,",
      "- Run database tests serially: Run database tests serially. (3 occasions, last 2026-10-07; northwind/brain-acme,",
    ]);
    // The brains hold fewer pages than a prompt's recall needs, so the fact and lesson Memories are named, last (§4.7).
    inOrder(s, ["## Instincts", "## Memories", "- Prefer small commits", "The brains hold"]);
    assert.ok(
      s.trimEnd().endsWith("finds them."),
      "every Memory was listed, and the last line no longer says they are not",
    );
    assert.ok(s.length <= SUMMARY_CAP);
    assert.deepEqual(
      w.calls,
      [["sync", "--cwd", w.repo, "--background"]],
      "sync is started in the background; run from source, nothing looks for a new version (§4.2, §6.4)",
    );
  }));

test("a folder without kioku.yaml shows the personal brain alone, with no warning", () =>
  world(async (w) => {
    const elsewhere = join(w.home, "scratch");
    mkdirSync(elsewhere, { recursive: true });
    const r = await start(w, { cwd: elsewhere });
    const s = summaryOf(r);
    assert.match(s, /- personal: sam\/brain\n/);
    assert.doesNotMatch(s, /^- (project|team)|acme|northwind|not on this machine|not known/m);
    assert.match(s, /## Instincts/);
  }));

test("a session inside a brain's folder loads that brain alone and names the chain's other brains as not loaded, with the reason (§2.7, §4.1)", () =>
  world(async (w) => {
    const inAcme = summaryOf(await start(w, { cwd: join(w.acme, "knowledge/acme") }));
    inOrder(inAcme, [
      "- project: northwind/brain-acme (this session is inside it",
      "- personal: in this chain but not loaded; this session was opened inside the project brain northwind/brain-acme, which works on its own.",
      "Nothing the person says about themselves is saved in this session",
      "## northwind/brain-acme: front page",
      "## Decisions in northwind/brain-acme",
    ]);
    const acmeStart = await start(w, { cwd: join(w.acme, "knowledge/acme") });
    assert.match(acmeStart.raw, /personal not loaded/, "the person is told too");
    assert.doesNotMatch(inAcme, /- team: in this chain/, "a project brain names no team (§2.4)");
    assert.doesNotMatch(
      inAcme,
      /- personal: sam|- team: northwind\/brain/,
      "the other brains of the chain are not listed as loaded",
    );
    assert.doesNotMatch(inAcme, /also the project brain/);
    assert.equal(readFileSync(join(w.acme, "AGENTS.md"), "utf8").split("\n")[0], "# acme: a Kioku brain");
    assert.ok(
      readFileSync(join(w.acme, "CLAUDE.md"), "utf8").startsWith("@AGENTS.md\n"),
      "Claude Code's pointer imports the neutral file",
    );

    const inTeam = summaryOf(await start(w, { cwd: w.team }));
    inOrder(inTeam, [
      "- team: northwind/brain (this session is inside it",
      "- personal: in this chain but not loaded; this session was opened inside the team brain northwind",
      "## northwind/brain: front page",
    ]);
    assert.doesNotMatch(inTeam, /- personal: sam/);
    assert.doesNotMatch(inTeam, /^- project|acme/m, "a team brain names no project");

    const inSam = summaryOf(await start(w, { cwd: w.sam }));
    assert.match(inSam, /- personal: sam\/brain \(this session is inside it/);
    assert.doesNotMatch(inSam, /^- (project|team)|also the project brain|not loaded|saved in this session/m);
    assert.match(inSam, /## sam\/brain: front page/);

    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "project",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Who answers the pager",
        "--source",
        "https://x.io",
        "--summary",
        "Ops.",
      ],
      { cwd: join(w.acme, "memory"), stdin: "Ops does.\n" },
    );
    assert.deepEqual(
      [saved.out.status, saved.out.brain],
      ["done", "northwind/brain-acme"],
      "inside the brain, `project` is that brain",
    );

    const refused = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "personal",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "How Sam works",
        "--source",
        "https://x.io",
        "--summary",
        "Sam.",
      ],
      { cwd: join(w.acme, "memory"), stdin: "Sam does.\n" },
    );
    assert.match(
      JSON.stringify(refused.out),
      /not loaded/,
      "a brain of the chain that is not loaded is refused, not unknown",
    );
    const listed = await w.kioku(["brain", "list"], { cwd: w.acme });
    assert.deepEqual(
      (listed.out as { chain: { tier: string }[] }).chain.map((b) => b.tier),
      ["project"],
    );
    assert.deepEqual(
      (listed.out as { notLoaded: { tier: string }[] }).notLoaded.map((b) => b.tier),
      ["personal"],
    );
  }));

/** Three brains with far more than fits: Rules, Skills, decisions and instincts by the hundred. */
function big(): { acme: Made[]; sam: Made[]; team: Made[] } {
  const pad = (i: number) => String(i).padStart(3, "0");
  const acme: Made[] = [];
  let n = 100;
  for (let i = 0; i < 12; i++)
    acme.push(
      made({
        n: n++,
        type: RULE,
        title: `Project rule ${pad(i)}`,
        sections: { Rule: `Always do thing ${i} the Acme way. `.repeat(5), Why: "Because." },
      }),
    );
  for (let i = 0; i < 40; i++)
    acme.push(
      made({
        n: n++,
        type: SKILL,
        title: `Skill ${pad(i)}`,
        summary: `Does thing ${i} in one line.`,
        sections: { "When to use": "x", Steps: "y" },
      }),
    );
  for (let i = 0; i < 200; i++)
    acme.push(
      made({
        n: n++,
        type: DECISION,
        title: `Decision ${pad(i)}`,
        summary: `What Acme decided about topic ${i}, in one line of summary text.`,
        sections: { Decision: "d", Why: "w", Consequences: "c" },
      }),
    );
  for (let i = 0; i < 50; i++)
    acme.push(
      made({
        n: n++,
        type: INSTINCT,
        title: `Project instinct ${pad(i)}`,
        sections: { When: "w", Do: `Do ${i}.` },
        occasions: 2,
      }),
    );
  for (let i = 0; i < 100; i++)
    acme.push(
      made({
        n: n++,
        type: MEMORY,
        title: `Lesson ${pad(i)}`,
        sections: { "What happened": "x", Lesson: "y", "Rule of thumb": "z" },
      }),
    );
  const sam = Array.from({ length: 10 }, (_, i) =>
    made({
      n: n++,
      type: RULE,
      namespace: "sam",
      title: `Personal rule ${pad(i)}`,
      sections: { Rule: `Sam works like ${i}.`, Why: "w" },
    }),
  );
  const team = Array.from({ length: 10 }, (_, i) =>
    made({
      n: n++,
      type: RULE,
      namespace: "northwind",
      title: `Team rule ${pad(i)}`,
      sections: { Rule: `Northwind rule ${i}.`, Why: "w" },
    }),
  );
  return { acme, sam, team };
}

test("on the large fixture each part of the summary stays under 10,000 characters, the cut falls between items and the order holds (§4.1)", () => {
  const b = big();
  return world(
    async (w) => {
      const r = await start(w);
      const usage: string = r.out.hookSpecificOutput.additionalContext;
      const holds: string = r.holds.out.hookSpecificOutput.additionalContext;
      for (const [name, part] of [
        ["usage", usage],
        ["holds", holds],
      ] as const)
        assert.ok(part.length <= SUMMARY_CAP, `${name}: ${part.length} characters`);
      assert.ok(holds.length > SUMMARY_CAP - 600, "the cut leaves little room unused");
      assert.match(holds, /this summary shows part of them/);
      assert.ok(holds.trimEnd().endsWith("not listed here."), "the closing line is whole and last");
      assert.ok(holds.startsWith("# Kioku: what the brains of this session hold"), "the second part names itself");
      inOrder(usage, ["# Kioku: the brains of this session", "## northwind/brain-acme: front page", "## Rules"]);
      // Every list item that made it in is whole.
      for (const line of `${usage}\n${holds}`
        .split("\n")
        .filter(
          (l) =>
            l.startsWith("- ") && !l.startsWith("- personal") && !l.startsWith("- project") && !l.startsWith("- team"),
        )) {
        assert.match(line, /\)$/, line);
      }
      // Whatever came after the cut is absent, never a later section before an earlier one.
      const sections = ["## Load first", "## Skills", "## Decisions in northwind/brain-acme", "## Instincts"].filter(
        (h) => holds.includes(h),
      );
      inOrder(holds, sections);
    },
    { acmePages: b.acme, samPages: b.sam, teamPages: b.team },
  );
});

test("the hook answers in under a second with the network unavailable and a brain missing, and says it is being cloned", () =>
  world(
    async (w) => {
      renameSync(w.bare.acme, `${w.bare.acme}.away`);
      const began = performance.now();
      const r = await start(w);
      const took = performance.now() - began;
      assert.ok(took < 1000, `${Math.round(took)} ms`);
      assert.match(
        summaryOf(r),
        /project northwind\/brain-acme is not on this machine yet; it is being cloned in the background/,
      );
      assert.match(
        summaryOf(r),
        /team northwind\/brain is not on this machine yet; it is being cloned in the background/,
        "the folder names the team, so it is known before the project brain is here (§2.4)",
      );
      assert.match(
        r.out.systemMessage,
        /⬢ kioku\.md · cloning 2 brains in the background\n  ⎿ brain-acme · brain\n  ⎿ they will be in the next session/,
      );

      // The sync the hook started fails without the network, and says so next time; with it back, the next session has the brain.
      const failed = await w.kioku(["sync", "--cwd", w.repo]);
      assert.equal(failed.code, 1);
      assert.equal(failed.out.outcomes.find((o: { tier: string }) => o.tier === "project").status, "failed");
      assert.equal(existsSync(w.acme), false, "a failed clone leaves nothing behind");
      assert.match(summaryOf(await start(w)), /The last sync of northwind\/brain-acme failed/);

      assert.ok(existsSync(join(w.team, "kioku.yaml")), "the team the folder names is reached on its own");

      renameSync(`${w.bare.acme}.away`, w.bare.acme);
      const ok = await w.kioku(["sync", "--cwd", w.repo]);
      assert.equal(ok.code, 0, ok.raw);
      assert.deepEqual(
        ok.out.outcomes.filter((o: { status: string }) => o.status === "cloned").map((o: { tier: string }) => o.tier),
        ["project"],
      );
      assert.ok(
        readMachineConfig(w.home)!.repositories["northwind/brain-acme"] !== undefined,
        "the clone is registered",
      );
      const next = summaryOf(await start(w));
      assert.match(next, /- project: northwind\/brain-acme/);
      assert.doesNotMatch(next, /not on this machine|failed/);
    },
    { cloned: { acme: false, team: false } },
  ));

test("sync clones the project and team brains the folder names, in the same run", () =>
  world(
    async (w) => {
      const r = await w.kioku(["sync", "--cwd", w.repo]);
      assert.deepEqual(
        r.out.outcomes.filter((o: { status: string }) => o.status === "cloned").map((o: { tier: string }) => o.tier),
        ["project", "team"],
      );
      assert.ok(existsSync(join(w.team, "kioku.yaml")));
      assert.ok(existsSync(indexPath(w.home)), "sync reindexed");
    },
    { cloned: { acme: false, team: false } },
  ));

test("no model and no network: composing the summary makes no request", () =>
  world(async (w) => {
    const calls: string[] = [];
    const saved = {
      fetch: globalThis.fetch,
      http: http.request,
      https: https.request,
      connect: net.connect,
      create: net.createConnection,
    };
    const trap = (name: string) =>
      ((...args: unknown[]) => {
        calls.push(name);
        throw new Error(`no ${name} allowed: ${String(args[0])}`);
      }) as never;
    globalThis.fetch = trap("fetch");
    http.request = trap("http");
    https.request = trap("https");
    net.connect = trap("net.connect");
    net.createConnection = trap("net.createConnection");
    try {
      const r = await start(w);
      assert.ok(summaryOf(r).length > 0);
    } finally {
      globalThis.fetch = saved.fetch;
      http.request = saved.http;
      https.request = saved.https;
      net.connect = saved.connect;
      net.createConnection = saved.create;
    }
    assert.deepEqual(calls, []);
  }));

test("a commit pushed by a teammate is new in the next session, and not in the one after", () =>
  world(async (w) => {
    assert.doesNotMatch(
      summaryOf(await start(w)),
      /since your last session/,
      "the first session has nothing to compare with",
    );

    const other = join(w.dir, "teammate");
    execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain-acme.git", other]);
    const page = made({
      n: 80,
      type: CONTEXT,
      title: "Acme's on-call rota",
      summary: "Who answers at night.",
      sections: {},
    });
    put(other, page.path, page.text);
    const teammate = {
      ...process.env,
      GIT_AUTHOR_NAME: "Ana",
      GIT_AUTHOR_EMAIL: "ana@example.com",
      GIT_COMMITTER_NAME: "Ana",
      GIT_COMMITTER_EMAIL: "ana@example.com",
    };
    execFileSync("git", ["-C", other, "add", "-A"], { env: teammate });
    execFileSync("git", ["-C", other, "commit", "-q", "-m", "save: Acme's on-call rota"], { env: teammate });
    execFileSync("git", ["-C", other, "push", "-q", "origin", "main"], { env: teammate });

    // This machine's own save between sessions is not news to it.
    await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Staging URL",
        "--source",
        "https://x.io",
      ],
      { stdin: "It is behind the VPN.\n" },
    );
    const synced = await w.kioku(["sync", "--cwd", w.repo]);
    assert.equal(synced.code, 0, synced.raw);

    const second = summaryOf(await start(w));
    assert.match(
      second,
      /## New in northwind\/brain-acme since your last session\n\n- added: Acme's on-call rota \(knowledge\/acme\/context\/acme-s-on-call-rota\.md\)/,
    );
    assert.doesNotMatch(second, /- added: Staging URL/);
    // `pages` and `show` carry the same news, for an interface (§6.1).
    const pages = (await w.kioku(["page", "list", "--brain", "northwind/brain-acme"])).out.pages;
    assert.equal(pages.find((p: { path: string }) => p.path === page.path).change, "added");
    assert.equal(
      pages.find((p: { title: string }) => p.title === "Staging URL").change,
      null,
      "this machine's own save is not news",
    );
    assert.equal((await w.kioku(["page", "show", page.path])).out.change, "added");
    const resumed = summaryOf(await start(w, { source: "resume" }));
    assert.match(
      resumed,
      /Acme's on-call rota \(knowledge/,
      "a resumed session keeps the view of the session it continues",
    );
    const third = summaryOf(await start(w));
    assert.doesNotMatch(third, /since your last session/);
    assert.ok(existsSync(viewsPath(w.home)));
  }));

test("the first hook of a session's start leaves the views alone, so the second shows the news whichever runs first (§4.1)", () =>
  world(async (w) => {
    await start(w);
    await teammateAdds(w, 1, "Acme's pager rota");
    const stdin = JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" });
    // The host runs the two at once: the first finishing before the second starts is the order that could race.
    const first = await w.kioku(["hook", "session-start"], { stdin });
    const holds = await w.kioku(["hook", "session-start-holds"], { stdin });
    assert.doesNotMatch(first.out.hookSpecificOutput.additionalContext, /since your last session/);
    assert.match(
      holds.out.hookSpecificOutput.additionalContext,
      /## New in northwind\/brain-acme since your last session\n\n- added: Acme's pager rota/,
    );
    assert.equal(holds.out.systemMessage, undefined, "the second says nothing to the person: the first does");
  }));

/** A teammate, Ana, adds pages to acme in one commit and pushes it; this machine syncs. */
async function teammateAdds(w: World, n: number, ...titles: string[]): Promise<string> {
  const other = join(w.dir, `teammate-${n}`);
  execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain-acme.git", other]);
  titles.forEach((title, i) => {
    const page = made({ n: n * 100 + i, type: CONTEXT, title, summary: `${title}.`, sections: {} });
    put(other, page.path, page.text);
  });
  const title = titles[0]!;
  const teammate = {
    ...process.env,
    GIT_AUTHOR_NAME: "Ana",
    GIT_AUTHOR_EMAIL: "ana@example.com",
    GIT_COMMITTER_NAME: "Ana",
    GIT_COMMITTER_EMAIL: "ana@example.com",
  };
  execFileSync("git", ["-C", other, "add", "-A"], { env: teammate });
  execFileSync("git", ["-C", other, "commit", "-q", "-m", `save: ${title}`], { env: teammate });
  execFileSync("git", ["-C", other, "push", "-q", "origin", "main"], { env: teammate });
  assert.equal((await w.kioku(["sync", "--cwd", w.repo])).code, 0);
  return title;
}

test("news a cut summary left out waits for the next session: it is still new to this machine (§4.1)", () => {
  const b = big();
  return world(
    async (w) => {
      await start(w);
      const rota = await teammateAdds(w, 81, "Acme's on-call rota");
      const cut = summaryOf(await start(w));
      assert.match(cut, /this summary shows part of them/, "the large brains fill the cap");
      assert.doesNotMatch(cut, /since your last session/, "the news did not fit");
      const listed = await w.kioku(["page", "list", "--brain", "northwind/brain-acme", "--limit", "500"]);
      assert.equal(
        listed.out.pages.find((p: { title: string }) => p.title === rota)?.change,
        "added",
        "held for the next session, not moved on",
      );
    },
    { acmePages: b.acme, samPages: b.sam, teamPages: b.team },
  );
});

test("news that would not fit whole lists the newest ten and how many more, and is not news again in the next session (§4.1)", () =>
  world(async (w) => {
    await start(w);
    const titles = Array.from({ length: 30 }, (_, i) => `Acme's runbook for the incident of week ${i + 1}`);
    await teammateAdds(w, 84, ...titles);
    const first = summaryOf(await start(w));
    const listed = first.match(/^- added: Acme's runbook/gm) ?? [];
    assert.equal(listed.length, NEWS_MAX, first);
    assert.match(first, new RegExp(`- and ${30 - NEWS_MAX} more: \`kioku page list --brain northwind/brain-acme\``));
    assert.doesNotMatch(summaryOf(await start(w)), /since your last session/, "shown, so the news moved on");
  }));

test("a pending publication is pushed by sync, and the summary mentions it until it is out", () =>
  world(async (w) => {
    renameSync(w.bare.acme, `${w.bare.acme}.away`);
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "northwind/brain-acme",
        "--kind",
        "knowledge",
        "--sub",
        "context",
        "--title",
        "Staging URL",
        "--source",
        "https://x.io",
      ],
      { stdin: "Behind the VPN.\n" },
    );
    assert.equal(saved.out.publication, "pending");
    const during = await start(w);
    assert.match(summaryOf(during), /A change to northwind\/brain-acme is committed but not published yet/);
    assert.match(
      during.out.systemMessage,
      /⬢ kioku\.md · changes not published yet\n  ⎿ brain-acme · committed\n  ⎿ they will be retried/,
    );
    const still = await w.kioku(["sync", "--cwd", w.repo]);
    assert.equal(still.out.outcomes.find((o: { tier: string }) => o.tier === "project").status, "failed");
    assert.ok(readPending(w.home)["northwind/brain-acme"]);

    renameSync(`${w.bare.acme}.away`, w.bare.acme);
    const r = await w.kioku(["sync", "--cwd", w.repo]);
    assert.equal(r.out.outcomes.find((o: { tier: string }) => o.tier === "project").status, "pushed");
    assert.deepEqual(readPending(w.home), {});
    assert.equal(sh(w.bare.acme, "rev-parse", "main"), sh(w.acme, "rev-parse", "HEAD"));
    const after = await start(w);
    assert.doesNotMatch(summaryOf(after), /not published/);
    assert.doesNotMatch(after.out.systemMessage ?? "", /not published/);
  }));

test("sync pushes the personal brain when it has a remote, keeps local commits through a rebase, and reports by hand", () =>
  world(async (w) => {
    const personalBare = join(w.remotes.base, "sam/brain.git");
    mkdirSync(personalBare, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", personalBare]);
    // Written before the brain has a remote, so the commit is waiting for `sync`.
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "personal",
        "--kind",
        "memory",
        "--title",
        "Coffee before standup",
        "--source",
        "https://x.io",
      ],
      { stdin: "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n" },
    );
    assert.equal(saved.out.publication, "local");
    sh(w.sam, "remote", "add", "origin", "https://github.com/sam/brain.git");
    const r = await w.kioku(["sync", "--cwd", w.repo], { tty: true });
    assert.equal(r.code, 0, r.raw);
    assert.match(r.out, /^sam\/brain +pushed$/m);
    assert.match(r.out, /^northwind\/brain-acme +up-to-date$/m);
    assert.match(r.out, /^index: \d+ reindexed, 0 removed, \d+ unchanged$/m);
    assert.equal(sh(personalBare, "rev-parse", "main"), sh(w.sam, "rev-parse", "HEAD"));
    const state = JSON.parse(readFileSync(syncStatePath(w.home), "utf8"));
    assert.equal(state.brains["sam/brain"].status, "pushed");

    // A teammate's commit and a local one meet: the local one is rebased on top and pushed.
    const other = join(w.dir, "teammate");
    execFileSync("git", ["clone", "-q", "https://github.com/northwind/brain-acme.git", other]);
    writeFileSync(join(other, "BRAIN.md"), "# acme\n\nFrom a teammate.\n");
    sh(other, "commit", "-q", "-am", "teammate");
    sh(other, "push", "-q", "origin", "main");
    writeFileSync(join(w.acme, "knowledge/acme/INDEX.md"), "# acme\n\nLocal.\n");
    sh(w.acme, "commit", "-q", "-am", "local");
    const again = await w.kioku(["sync", "--cwd", w.repo]);
    assert.equal(again.out.outcomes.find((o: { tier: string }) => o.tier === "project").status, "pushed");
    assert.equal(sh(w.bare.acme, "log", "--format=%s", "-2", "main"), "local\nteammate");
  }));

test("a write in the personal brain publishes at once when it has a remote, as a shared brain's does (§1.6)", () =>
  world(async (w) => {
    const personalBare = join(w.remotes.base, "sam/brain.git");
    mkdirSync(personalBare, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", personalBare]);
    sh(w.sam, "remote", "add", "origin", "https://github.com/sam/brain.git");
    const saved = await w.kioku(
      [
        "page",
        "save",
        "--brain",
        "personal",
        "--kind",
        "memory",
        "--title",
        "Coffee before standup",
        "--source",
        "https://x.io",
      ],
      { stdin: "## What happened\n\nx\n\n## Lesson\n\ny\n\n## Rule of thumb\n\nz\n" },
    );
    assert.equal(saved.out.publication, "pushed");
    assert.equal(sh(personalBare, "rev-parse", "main"), sh(w.sam, "rev-parse", "HEAD"));
  }));

test("a second sync while one runs does nothing", () =>
  world(async (w) => {
    const { acquireLock } = await import("../../src/core/fs/lock.ts");
    const { syncLockPath } = await import("../../src/core/state.ts");
    const lock = await acquireLock(syncLockPath(w.home));
    try {
      const r = await w.kioku(["sync", "--cwd", w.repo]);
      assert.equal(r.out.busy, true);
    } finally {
      lock.release();
    }
  }));

test("a sync that finds another running leaves its folder, and the next sync clones what that folder's chain needs (§4.2)", () =>
  world(
    async (w) => {
      const { acquireLock } = await import("../../src/core/fs/lock.ts");
      const { syncLockPath } = await import("../../src/core/state.ts");
      const lock = await acquireLock(syncLockPath(w.home));
      try {
        assert.equal((await w.kioku(["sync", "--cwd", w.repo])).out.busy, true);
      } finally {
        lock.release();
      }
      assert.ok(!existsSync(w.acme), "not cloned while the other ran");
      const next = await w.kioku(["sync", "--cwd", w.dir]);
      assert.equal(next.code, 0, next.raw);
      assert.ok(
        next.out.outcomes.some(
          (o: { key: string; status: string }) => o.key === "northwind/brain-acme" && o.status === "cloned",
        ),
        next.raw,
      );
      assert.ok(existsSync(w.acme));
      const after = await w.kioku(["sync", "--cwd", w.dir]);
      assert.ok(
        !after.out.outcomes.some((o: { key: string }) => o.key === "northwind/brain-acme"),
        "a folder is taken once",
      );
    },
    { cloned: { acme: false, team: false } },
  ));

test("the background start returns at once and leaves the work to a detached process", () =>
  world(async (w) => {
    const script = join(w.dir, "slow.mjs");
    writeFileSync(script, "setTimeout(() => console.log('done', process.argv.slice(2).join(' ')), 300);\n");
    const began = performance.now();
    startDetached(w.home, script, ["sync", "--cwd", w.repo], process.env);
    assert.ok(performance.now() - began < 300, "the start does not wait");
    startDetached(w.home, script, ["refresh"], process.env);
    await new Promise((r) => setTimeout(r, 800));
    const log = readFileSync(join(w.home, ".kioku/sync.log"), "utf8");
    assert.match(
      log,
      new RegExp(`^--- \\d{4}-\\d\\d-\\d\\dT[^ ]+ kioku sync --cwd ${w.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n`),
      "a line says when and what",
    );
    assert.match(log, new RegExp(`done sync --cwd ${w.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n`));
    assert.match(log, /--- \S+ kioku refresh\n/);
    assert.match(log, /done refresh\n/, "a second command does not wipe what the first wrote");
  }));

test("the composer leaves out superseded decisions named only by `supersedes`, and old evidence", () =>
  world(async (w) => {
    const s = composeSummary({
      brains: loadSummaryBrains([
        {
          link: { tier: "project", key: "k", path: w.acme, cloned: true, ref: { owner: "o", repo: "r" } },
          isProject: true,
        },
      ]),
      missing: [],
      problems: [],
      pending: {},
      syncFailures: {},
      now: new Date(2027, 6, 1),
    });
    assert.doesNotMatch(s, /MySQL for Acme/);
    assert.doesNotMatch(s, /## Instincts/, "evidence from 2026-10-07 is not recent in July 2027");
  }));

test("once a week, while the personal brain has pages and no remote, the person is told they live only on this machine", () =>
  world(async (w) => {
    const NUDGE =
      /⬢ kioku\.md · ⚠ your personal brain is only on this machine\n  ⎿ 2 pages, no remote\n  ⎿ back it up: kioku brain publish/;
    const at = async (days: number, source = "startup") =>
      (
        await w.kioku(["hook", "session-start"], {
          stdin: JSON.stringify({ cwd: w.repo, source, session_id: "s" }),
          context: { now: () => new Date(2026, 9, 7 + days, 12) },
        })
      ).out.systemMessage ?? "";
    assert.match(await at(0), NUDGE);
    assert.doesNotMatch(await at(1), NUDGE, "not again within the week");
    assert.doesNotMatch(await at(8, "resume"), NUDGE, "not in a resumed session");
    assert.match(await at(8), NUDGE, "again a week later");
    sh(w.sam, "remote", "add", "origin", "https://example.com/sam/brain.git");
    assert.doesNotMatch(await at(30), NUDGE, "any remote ends it");
  }));

test("unpublished muted stops the weekly notice: the brain is kept on this machine on purpose (§1.2, §2.3)", () =>
  world(async (w) => {
    writeFileSync(
      join(w.home, ".kioku/config.yaml"),
      readFileSync(join(w.home, ".kioku/config.yaml"), "utf8") + "display:\n  mute: [unpublished]\n",
    );
    const r = await start(w);
    assert.doesNotMatch(r.out.systemMessage ?? "", /only on this machine/);
  }));

test("an empty personal brain is not nagged about a backup", () =>
  world(
    async (w) => {
      const r = await start(w);
      assert.doesNotMatch(r.out.systemMessage ?? "", /lives? only on this machine/);
    },
    { samPages: [] },
  ));

test("a folder that names its project brain alone loads personal and project, with no team and nothing to say (§2.4)", () =>
  world(async (w) => {
    writeFileSync(join(w.repo, "kioku.yaml"), "brain: github.com/northwind/brain-acme\n");
    const r = await start(w);
    const s = summaryOf(r);
    assert.match(s, /- project: northwind\/brain-acme/);
    assert.doesNotMatch(s, /^- team|northwind\/brain(?!-)|team brain/m);
    assert.doesNotMatch(r.out.systemMessage ?? "", /cloning|not loaded/);
  }));

test("the machine's team loads where the folder names none, and the summary and brain list say it is the machine's (§2.4, §4.1)", () =>
  world(async (w) => {
    writeFileSync(join(w.repo, "kioku.yaml"), "brain: github.com/northwind/brain-acme\n");
    await updateMachineConfig((c) => void (c.team = "northwind/brain"), w.home);
    const LINE =
      "- team: northwind/brain (this machine's team, as this folder names none: teammates here may not have it)";
    const s = summaryOf(await start(w));
    inOrder(s, ["- personal: sam", "- project: northwind/brain-acme", LINE]);

    const list = await w.kioku(["brain", "list"]);
    assert.deepEqual(
      list.out.chain.map((l: { tier: string; from?: string }) => [l.tier, l.from]),
      [
        ["personal", undefined],
        ["project", undefined],
        ["team", "machine"],
      ],
    );
    const text = await w.kioku(["brain", "list"], { tty: true });
    assert.match(
      text.raw,
      /^Chain here: personal sam\/brain → project northwind\/brain-acme → team northwind\/brain \(this machine's\)$/m,
    );

    // A folder that names its team: that one, said as nothing special; the machine's is not loaded.
    writeFileSync(
      join(w.repo, "kioku.yaml"),
      "brain: github.com/northwind/brain-acme\nteam: github.com/northwind/brain\n",
    );
    const named = summaryOf(await start(w));
    assert.match(named, /^- team: northwind\/brain$/m);
    assert.doesNotMatch(named, /this machine's team/);

    // Outside any project: the personal brain and the machine's team.
    const elsewhere = summaryOf(await start(w, { cwd: w.home }));
    inOrder(elsewhere, ["- personal: sam", LINE]);
    assert.doesNotMatch(elsewhere, /- project/);

    // Inside a brain, the machine's team is in the chain and not loaded.
    const inAcme = await start(w, { cwd: w.acme });
    assert.match(
      summaryOf(inAcme),
      /- team: in this chain but not loaded; this session was opened inside the project brain northwind\/brain-acme/,
    );
    assert.match(inAcme.raw, /personal and team not loaded/);
  }));

test("a plugin of another version than the tool: the summary still comes, and the session says it once for each pair, with the command for the older side (§6.2)", () =>
  world(async (w) => {
    const installed = join(w.home, ".local", "share", "kioku", "versions", "0.0.0", "kioku.mjs");
    const session = async (plugin: string | undefined, tool: string, bundle?: string) => {
      const r = await w.kioku(["hook", "session-start"], {
        stdin: JSON.stringify({ cwd: w.repo, source: "startup", session_id: "s" }),
        context: {
          version: tool,
          env: { NO_COLOR: "1", ...(plugin !== undefined && { KIOKU_PLUGIN_VERSION: plugin }) },
          ...(bundle !== undefined && { bundle }),
        },
      });
      assert.equal(r.code, 0, r.raw);
      assert.match(summaryOf(r), /- project: northwind\/brain-acme/, "the summary comes all the same");
      return (r.out.systemMessage ?? "") as string;
    };
    const said = (fix: string) =>
      new RegExp(
        `⚠ Kioku \\S+ and its plugin \\S+ are different versions\\n {2}⎿ everything still runs; to bring them together: ${fix}`,
      );

    assert.match(await session("0.1.0", "0.2.0"), said("kioku plugin claude-code install"), "the plugin is the older");
    assert.doesNotMatch(await session("0.1.0", "0.2.0"), /different versions/, "once for this pair");
    assert.match(
      await session("0.3.0", "0.2.0", installed),
      said("kioku update"),
      "the tool is the older, the installer's",
    );
    assert.match(
      await session("0.4.0", "0.2.0", "/opt/homebrew/Cellar/kioku/0.2.0/libexec/kioku.mjs"),
      said("brew upgrade kioku"),
    );
    assert.match(await session("0.5.0", "0.2.0"), said("update Kioku the way it was installed"));
    assert.doesNotMatch(await session("0.2.0", "0.2.0"), /different versions/, "the same version says nothing");
    assert.doesNotMatch(await session(undefined, "0.2.0"), /different versions/, "an older wrapper says no version");
    assert.doesNotMatch(await session("0.6.0", "0.0.0-dev"), /different versions/, "the tool run from source");

    await w.kioku(["config", "set", "display.mute", "+plugin-version"], { context: { interactive: true } });
    assert.doesNotMatch(await session("0.7.0", "0.2.0"), /different versions/, "muted");
  }));
