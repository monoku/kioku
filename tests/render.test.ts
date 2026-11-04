import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAIN, clip, entry, highlight, paint, shortRemote, table, tilde, uiFor, type Ui } from "../src/cli/render.ts";

const COLOR: Ui = { color: true, columns: 60, home: "/Users/sam" };
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

test("colour is for a terminal, and off for NO_COLOR and a dumb terminal; the width needs a usable terminal", () => {
  assert.equal(uiFor(true, {}, 120, "/h").color, true);
  assert.equal(uiFor(false, {}, 120, "/h").color, false, "a pipe");
  assert.equal(uiFor(true, { NO_COLOR: "1" }, 120, "/h").color, false);
  assert.equal(uiFor(true, { NO_COLOR: "" }, 120, "/h").color, true, "an empty NO_COLOR asks for nothing");
  assert.equal(uiFor(true, { TERM: "dumb" }, 120, "/h").color, false);
  assert.equal(uiFor(true, {}, 120, "/h").columns, 120);
  assert.equal(uiFor(true, {}, undefined, "/h").columns, 100);
  assert.equal(uiFor(true, {}, 12, "/h").columns, 100, "too narrow to lay out");
});

test("paint writes escape codes only when there is colour, and leaves the empty string alone", () => {
  assert.equal(paint(PLAIN).bold("x"), "x");
  assert.equal(paint(COLOR).bold("x"), "\x1b[1mx\x1b[22m");
  assert.equal(paint(COLOR).red(""), "");
});

test("paths and remotes are written short", () => {
  assert.equal(tilde(COLOR, "/Users/sam/.kioku/brains/a"), "~/.kioku/brains/a");
  assert.equal(
    tilde(COLOR, "/Users/samuel/x"),
    "/Users/samuel/x",
    "a folder that only starts like the home is not under it",
  );
  assert.equal(tilde(PLAIN, "/Users/sam/x"), "/Users/sam/x");
  assert.equal(shortRemote("https://github.com/northwind/brain.git"), "github.com/northwind/brain");
  assert.equal(shortRemote("git@github.com:northwind/brain.git"), "github.com/northwind/brain");
  assert.equal(clip("abcdefgh", 5), "abcd…");
  assert.equal(clip("abcdefgh", 5, true), "…efgh");
  assert.equal(clip("abc", 5), "abc");
});

test("a table lines up its columns, right-aligns counts, and leaves no trailing spaces", () => {
  const t = table(
    PLAIN,
    ["NAME", "N", "NOTE"],
    [
      ["alpha", "3", "x"],
      ["b", "12", ""],
    ],
    { right: [1] },
  );
  assert.deepEqual(t.split("\n"), ["NAME    N  NOTE", "alpha   3  x", "b      12"]);
});

test("a table too wide for the terminal cuts its widest column, and a path keeps its end", () => {
  const ui: Ui = { color: false, columns: 40, home: "" };
  const t = table(ui, ["A", "PATH"], [["one", "/very/long/folder/that/does/not/fit/at/all/leaf"]], { keepEnd: [1] });
  const lines = t.split("\n");
  assert.ok(
    lines.every((l) => l.length <= 40),
    t,
  );
  assert.match(lines[1]!, /^one {2}….*leaf$/);
});

test("styling is applied after padding, so colour never changes the layout", () => {
  const rows = [
    ["alpha", "1"],
    ["b", "22"],
  ];
  const p = paint(COLOR);
  const styled = table(COLOR, ["NAME", "N"], rows, {
    right: [1],
    style: (c, r, cell) => (r === -1 ? p.dim(cell) : c === 0 ? p.bold(cell) : cell),
  });
  assert.deepEqual(strip(styled), table(PLAIN, ["NAME", "N"], rows, { right: [1] }));
  assert.ok(styled.includes("\x1b[1malpha\x1b[22m"));
});

test("an entry puts the title and what it is edge to edge, and the details under it", () => {
  const ui: Ui = { color: false, columns: 50, home: "" };
  const e = entry(ui, "A title", "acme · memory", [
    { text: "memory/a-title.md" },
    { text: "" },
    { text: "words around [it]", dim: false },
  ]).split("\n");
  assert.equal(e.length, 3, "an empty detail is left out");
  assert.equal(e[0]!.length, 50);
  assert.ok(e[0]!.startsWith("A title") && e[0]!.endsWith("acme · memory"));
  assert.deepEqual(e.slice(1), ["  memory/a-title.md", "  words around [it]"]);
  const long = entry(ui, "T".repeat(80), "m", []).split("\n")[0]!;
  assert.equal(long.length, 50, "a long title is cut, not the meta");
  assert.match(long, /…\s+m$/);
});

test("the words a search matched are bold in lavender on a terminal and stay in brackets elsewhere", () => {
  assert.equal(highlight(PLAIN, "the [word] here"), "the [word] here");
  assert.equal(highlight(COLOR, "the [word] here"), "the \x1b[1m\x1b[38;2;124;135;224mword\x1b[39m\x1b[22m here");
});
