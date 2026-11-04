import { test } from "node:test";
import assert from "node:assert/strict";
import { fit, progressFor, progressMode } from "../src/cli/progress.ts";
import type { Ui } from "../src/cli/render.ts";

const UI: Ui = { color: true, columns: 80, home: "" };
const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");

test("the steps are animated at a terminal with colour, plain without it, and say nothing for JSON or when standard error is not a terminal (§6.1)", () => {
  assert.equal(progressMode({ json: false, stderrTty: true, env: {} }), "animated");
  assert.equal(
    progressMode({ json: true, stderrTty: true, env: {} }),
    "silent",
    "--json, or standard output that is not a terminal",
  );
  assert.equal(progressMode({ json: false, stderrTty: false, env: {} }), "silent", "standard error redirected");
  assert.equal(progressMode({ json: false, stderrTty: true, env: { NO_COLOR: "1" } }), "plain");
  assert.equal(progressMode({ json: false, stderrTty: true, env: { TERM: "dumb" } }), "plain");
  assert.equal(
    progressMode({ json: false, stderrTty: true, env: {}, setting: "never" }),
    "plain",
    "display.color never",
  );
  assert.equal(
    progressMode({ json: false, stderrTty: true, env: { TERM: "dumb" }, setting: "always" }),
    "plain",
    "a dumb terminal is never redrawn",
  );
  assert.equal(
    progressMode({ json: true, stderrTty: true, env: {}, setting: "always" }),
    "silent",
    "colour asked for does not make JSON speak",
  );
});

test("silent steps write nothing and answer what the work answers, or throw what it throws", async () => {
  const out: string[] = [];
  const steps = progressFor("silent", UI, {}, (t) => out.push(t));
  assert.equal(
    steps.run({ doing: "Pushing", done: "Pushed", direction: "up" }, () => 7),
    7,
  );
  assert.equal(await steps.runAsync({ doing: "Fetching", done: "Fetched", direction: "down" }, async () => "x"), "x");
  assert.throws(
    () =>
      steps.run({ doing: "Pushing", done: "Pushed", direction: "up" }, () => {
        throw new Error("no");
      }),
    /no/,
  );
  steps.close();
  assert.deepEqual(out, []);
});

test("plain steps are one line each as they start, nothing redrawn; a dumb terminal gets a dash", () => {
  const out: string[] = [];
  const steps = progressFor("plain", UI, {}, (t) => out.push(t));
  steps.run({ doing: "Looking for /srv/notes.git", done: "Found it", direction: "down" }, () => undefined);
  steps.run({ doing: "Pushing notes", done: "Pushed notes", direction: "up" }, () => undefined);
  steps.close();
  assert.equal(out.join(""), "⬢ Looking for /srv/notes.git…\n⬢ Pushing notes…\n\n", "a blank line before the answer");
  const dumb: string[] = [];
  progressFor("plain", UI, { TERM: "dumb" }, (t) => dumb.push(t)).run(
    { doing: "Pushing notes", done: "Pushed notes", direction: "up" },
    () => undefined,
  );
  assert.equal(dumb.join(""), "- Pushing notes…\n");
});

test("an animated step that ends at once shows only its line in the past, dimmed after ✓; the cursor comes back at the end", () => {
  const out: string[] = [];
  const steps = progressFor("animated", UI, {}, (t) => out.push(t));
  const r = steps.run({ doing: "Pushing notes", done: (n: number) => `Pushed ${n} pages`, direction: "up" }, () => 20);
  steps.close();
  assert.equal(r, 20);
  const text = out.join("");
  assert.match(text, /\x1b\[\?25l/, "the cursor is hidden while a step runs");
  assert.match(text, /\x1b\[2m✓\x1b\[22m \x1b\[2mPushed 20 pages\x1b\[22m\n/);
  assert.ok(!text.includes("Pushing notes…"), "a quick step is not drawn running");
  assert.ok(text.endsWith("\x1b[?25h\n"), "the cursor is given back, and a blank line sets the answer apart");
});

test("a step that throws stays in red after ✕ and the error goes on; one that answers a failure is shown failed too", async () => {
  const out: string[] = [];
  const steps = progressFor("animated", UI, {}, (t) => out.push(t));
  assert.throws(
    () =>
      steps.run({ doing: "Looking for ssh://nohost/x.git", done: "Found it", direction: "down" }, () => {
        throw new Error("unreachable");
      }),
    /unreachable/,
  );
  await assert.rejects(
    steps.runAsync({ doing: "Fetching the model", done: "Fetched the model", direction: "down" }, async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  steps.run(
    {
      doing: "Making the repository",
      done: (r: { ok: boolean }) => (r.ok ? "Made it" : "Could not make the repository"),
      direction: "up",
      failed: (r) => !r.ok,
    },
    () => ({ ok: false }),
  );
  steps.close();
  const text = out.join("");
  assert.match(text, /\x1b\[31m✕ Looking for ssh:\/\/nohost\/x\.git\x1b\[39m\n/);
  assert.match(text, /\x1b\[31m✕ Fetching the model\x1b\[39m\n/);
  assert.match(text, /\x1b\[31m✕ Could not make the repository\x1b\[39m\n/);
  assert.ok(text.endsWith("\x1b[?25h\n"), "a blank line sets the error apart too");
});

test("a step's words are cut to the terminal's width", () => {
  const out: string[] = [];
  const steps = progressFor("plain", { ...UI, columns: 40 }, {}, (t) => out.push(t));
  steps.run({ doing: `Looking for ${"x".repeat(80)}`, done: "Found it", direction: "down" }, () => undefined);
  const line = strip(out.join("")).trimEnd();
  assert.ok(line.length <= 40, `${line.length} characters`);
});

test("a path in a step is written ~/… under the home, and cut at its start when it does not fit, so its end stays", () => {
  const ui: Ui = { color: false, columns: 80, home: "/Users/sam" };
  assert.equal(
    fit(ui, "Pushing notes to /Users/sam/code/demo/.remotes/notes.git", 78),
    "Pushing notes to ~/code/demo/.remotes/notes.git",
  );
  assert.equal(
    fit(ui, "Found an empty repository at /srv/git/a/very/long/folder/of/remotes/scratch.git", 50),
    "Found an empty repository at …/remotes/scratch.git",
  );
  assert.equal(fit(ui, "Checking that gh is signed in", 20), "Checking that gh is…");
});
