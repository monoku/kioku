import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";
import type { PageRef, PageResults, PageView } from "../types";
import { ago, chip, themeNow, waiting } from "./chrome";
import { hoverOf } from "./colors";
import { kioku, text } from "./tool";

// The page viewer (§1.2): the entries of the memory history and the rows of the conversation that name a page open it
// in a pane when pressed, and so does each page a search found. The pane only shows: it
// writes nothing, and it has no command of its own.

/** The pane's id, for `$.ui.open` and its `ui.render` hook: one, so that a page opened over another takes its place. */
export const PAGE_PANE = "kioku-page";
/** The id of the `n`th tab: each search and each page opened from the history or the rows has a pane of its own, and what is opened from inside one stays in it. */
const tabId = (n: number): string => `${PAGE_PANE}-${n}`;
/** What `Markdown` takes of a page: a page longer says so, in its last line. */
const MARKDOWN_LIMIT = 10_000;
/** The cells `↗ open` takes at the end of a result's path row, and the air before it. */
const OPEN_WIDTH = 9;

/** What the pane shows now, which lasts the session. */
const views = atom({ plugin: "kioku", key: "pageViews" } as const, {} as Record<string, PageView>);

/** The tabs open, and the searches this session made. */
const state = {
  tabs: 0,
  /** The tab each group of results, and each page opened alone, has: what is opened again from the same group takes the same tab. */ groups:
    new Map<string, string>(),
  /** The searches of this session that found pages, the latest first: what `/kioku-search` offers again, with the results it kept. */ recent:
    [] as PageResults[],
};

/** What makes a group of results one: the words and the pages they found, in order. */
const groupOf = (results: PageResults): string =>
  `results:${results.words}:${results.pages.map((p) => `${p.brain}/${p.path}`).join(",")}`;

/** The path a relative link of a page names, in its brain: from the page's folder, `..` and `.` undone; none for a link that is not to a page of the brain. */
export function linkedPath(from: string, href: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return undefined;
  const target = href.split("#")[0]!;
  if (!target.endsWith(".md")) return undefined;
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (parts.pop() === undefined) return undefined;
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

/** The relative links to pages in a page's text, as it writes them: the ones a press on is ours to answer. */
export const linksOf = (body: string): string[] =>
  [...new Set([...body.matchAll(/\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g)].map((m) => m[1]!))].filter(
    (h) => linkedPath(DEEP, h) !== undefined,
  );

/**
 * A link to a page of the brain, as the pane draws it. A relative `.md` link is a file to the host, which opens it in its own
 * explorer, outside the session's folders; an `https:` link is pressed with its target as written, and it is the pane's to answer.
 * So each is written as an address that goes nowhere, with the link as it was in its path, and read back when pressed.
 */
/** A page deep enough that a relative link to a page names a page whatever its depth: which link is ours is known before the page it sits in is. */
const DEEP = "a/b/c/d/e/f/g/h/i.md";
const POINTER = "https://kioku.invalid/page/";
export const pointerOf = (href: string): string => `${POINTER}${encodeURIComponent(href)}`;
export const hrefOfPointer = (target: string): string =>
  target.startsWith(POINTER) ? decodeURIComponent(target.slice(POINTER.length)) : target;
/** The pages of the brain a page's text links to, each once, in order, with the words that link to it. */
const linkedOf = (body: string): { href: string; words: string }[] => {
  const seen = new Set<string>();
  const out: { href: string; words: string }[] = [];
  for (const m of body.matchAll(/\[([^\]]+)\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g)) {
    if (linkedPath(DEEP, m[2]!) === undefined || seen.has(m[2]!)) continue;
    seen.add(m[2]!);
    out.push({ href: m[2]!, words: m[1]! });
  }
  return out;
};
/** A page's text with the links to its brain's pages as the words alone, where the pane lists them as buttons instead. */
const unlinked = (body: string): string =>
  body.replace(/\[([^\]]+)\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g, (all, words: string, href: string) =>
    linkedPath(DEEP, href) === undefined ? all : words,
  );
const pointed = (body: string): string =>
  body.replace(/\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g, (all, href: string) =>
    linkedPath(DEEP, href) === undefined ? all : `](${pointerOf(href)})`,
  );

/** A text cut to fit `width` cells: from its start, with `…`, when `fromStart`, as a path is, else from its end. */
function fitted(text: string, width: number, fromStart: boolean): string {
  if (width < 2 || text.length <= width) return text;
  return fromStart ? `…${text.slice(text.length - (width - 1))}` : `${text.slice(0, width - 1)}…`;
}

/**
 * Shows the bee waiting in a tab, its wings beating, while `work` runs: `view` is what the tab draws at each frame. Resolves to the
 * tab and what `work` answered, and the tab holds the waiting view still, for the caller to put what it has in its place.
 */
async function whileWaiting<T>(
  $: EngineInterface,
  view: (frame: number) => PageView,
  tab: string | undefined,
  group: string | undefined,
  work: () => Promise<T>,
): Promise<{ id: string; result: T }> {
  const id = await show($, view(0), tab, group);
  const since = await $.clock.now();
  let frame = 0;
  let beat: { cancel: () => void } | undefined;
  try {
    beat = $.clock.every(WAIT_FRAME_MS, () => {
      frame += 1;
      void update($, views, (all) => (all[id]?.kind === view(0).kind ? { ...all, [id]: view(frame) } : all));
    });
  } catch {
    /* no clock: the bee waits still */
  }
  try {
    const result = await work();
    // An answer in a blink would show the bee for none: it stays a moment, the time a person needs to see it.
    const left = WAIT_MIN_MS - ((await $.clock.now()) - since);
    if (left > 0)
      await new Promise<void>((done) => {
        try {
          $.clock.after(left, () => {
            done();
          });
        } catch {
          done();
        }
      });
    return { id, result };
  } finally {
    beat?.cancel();
  }
}

/** The pane, for a view: a new tab, or `tab`, the one it is shown in, which it takes the place of there. */
export async function show($: EngineInterface, next: PageView, tab?: string, group?: string): Promise<string> {
  const known = tab === undefined && group !== undefined ? state.groups.get(group) : undefined;
  const id = tab ?? known ?? tabId(++state.tabs);
  // The host does not bring an open tab forward when it is asked to open it again: one that has to be seen is closed and opened.
  if (known !== undefined) await $.ui.close({ id }).catch(() => undefined);
  if (group !== undefined) state.groups.set(group, id);
  // A mark in each tab's name, to tell them apart at a glance: `↗` a page and its lists, `⌕` a search's field and its text.
  const title =
    next.kind === "page"
      ? `↗ ${next.title}`
      : next.kind === "choose"
        ? `↗ Kioku page · ${next.words}`
        : next.kind === "text"
          ? `⌕ Kioku search · ${next.words}`
          : next.kind === "ask"
            ? "⌕ Kioku search"
            : next.kind === "searching"
              ? `⌕ Kioku search · ${next.words}`
              : next.kind === "opening"
                ? `↗ ${next.title}`
                : "↗ Kioku page";
  // The keyboard, so that the arrows and Page Up and Down scroll it and Esc closes it; granted only over an empty prompt.
  // The view and the tab's name go out together, so that nothing waits for the other: what a press shows should not lag it.
  // A tab that is already open and only waits keeps its name and its keyboard: nothing to ask the host but the view.
  const wait = (next.kind === "opening" || next.kind === "searching") && tab !== undefined;
  await Promise.all([
    update($, views, (all) => ({ ...all, [id]: next })),
    wait ? undefined : $.ui.open({ id, title, focus: true, closeOnEscape: true }),
  ]);
  return id;
}

/**
 * Opens a page: the pane, with its body, as `kioku page show` answers it. `label` is the brain as Kioku names it, when it
 * is known; `back` is the search it was found by, which the pane then offers to go back to.
 */
export async function openPage(
  $: EngineInterface,
  target: {
    brain: string;
    path: string;
    label?: string;
    title?: string;
    back?: PageResults;
    trail?: PageRef[];
    tab?: string;
  },
): Promise<void> {
  // Opened again from the same results, or alone the same page, it is the tab it was in.
  const group = target.back !== undefined ? groupOf(target.back) : `page:${target.brain}/${target.path}`;
  // The tab shows the bee waiting while the tool reads the page; the page takes its place.
  const name = target.title ?? target.path.split("/").at(-1)!.replace(/\.md$/, "");
  const word = waitWord();
  const { id: tab, result: answer } = await whileWaiting(
    $,
    (frame) => ({ kind: "opening", title: name, frame, word }),
    target.tab,
    group,
    () => kioku($, ["page", "show", target.path, "--brain", target.brain]),
  );
  const body = text(answer?.body);
  const back = {
    ...(target.back !== undefined && target.back.pages.length > 1 && { back: target.back }),
    ...(target.trail !== undefined && target.trail.length > 0 && { trail: target.trail }),
  };
  if (answer === undefined || body === undefined) {
    await show($, { kind: "missing", what: `${target.path} (${target.label ?? target.brain})`, ...back }, tab, group);
    return;
  }
  const touched = text(answer.touched);
  await show(
    $,
    {
      kind: "page",
      title: text(answer.title) ?? target.path,
      brain: target.label ?? target.brain,
      brainName: target.brain,
      path: target.path,
      ...(touched !== undefined && { touched }),
      body: body.slice(0, MARKDOWN_LIMIT),
      cut: body.length > MARKDOWN_LIMIT,
      ...back,
    },
    tab,
    group,
  );
}

/** The field to search in: the tab that already has it, brought forward, and only when there is none, a new one. */
export async function showAsk($: EngineInterface): Promise<void> {
  const open = Object.entries(await read($, views)).find(([, view]) => view.kind === "ask")?.[0];
  await show($, { kind: "ask" }, open);
}

/** The pages a search found, listed in the pane to choose from: what a page opened from them goes back to. */
export async function showResults($: EngineInterface, results: PageResults, tab?: string): Promise<void> {
  await show($, { kind: "choose", ...results }, tab, groupOf(results));
}

/** How many pages a search lists: the tool's own default, which says by `more` whether there are others. */
const SEARCH_LIMIT = 20;

/** Runs the tool's search and shows what it found, in the viewer's list. */
export async function searchFor($: EngineInterface, words: string, first?: string): Promise<void> {
  // The tab shows the bee waiting, its wings beating, while the tool searches; the answer takes the tab's place.
  const word = waitWord();
  const { id: tab, result: answer } = await whileWaiting(
    $,
    (frame) => ({ kind: "searching", words, frame, word }),
    first,
    undefined,
    () => kioku($, ["page", "search", words, "--limit", String(SEARCH_LIMIT)]),
  );
  if (answer === undefined || !Array.isArray(answer.hits)) {
    await show($, { kind: "text", words, line: "the search did not answer" }, tab);
    return;
  }
  const pages: PageRef[] = [];
  for (const h of answer.hits as Record<string, unknown>[]) {
    const brain = text(h.brain);
    const path = text(h.path);
    if (brain !== undefined && path !== undefined) pages.push({ brain, path, title: text(h.title) ?? path });
  }
  const reason = text(answer.reason);
  const top = answer.mode === "full-text" ? `full-text only${reason !== undefined ? `: ${reason}` : ""}` : undefined;
  const bottom = answer.more === true ? "… more not shown: narrow the words" : undefined;
  const shown = { words, pages, ...(top !== undefined && { top }), ...(bottom !== undefined && { bottom }) };
  if (pages.length === 0) {
    await show(
      $,
      { kind: "text", words, line: `nothing found for “${words}”`, ...(top !== undefined && { top }) },
      tab,
    );
    return;
  }
  // Kept, to be seen again without searching again: the same words twice are one, the latest first.
  state.recent = [shown, ...state.recent.filter((r) => groupOf(r) !== groupOf(shown))].slice(0, RECENT_LIMIT);
  // The same results as an earlier search have a tab already, which takes them; the one that waited was only for the wait.
  const known = first === undefined ? state.groups.get(groupOf(shown)) : undefined;
  if (known !== undefined && known !== tab) {
    await $.ui.close({ id: tab });
    await update($, views, (all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== tab)));
    await showResults($, shown, known);
    return;
  }
  await showResults($, shown, tab);
}

/** What the bee does while a person waits, one of these for each wait, as Claude's own spinner has its words: bees, honey and the memory. */
const WAIT_WORDS = [
  "Buzzing",
  "Foraging",
  "Pollinating",
  "Building comb",
  "Capping cells",
  "Fanning wings",
  "Gathering nectar",
  "Making honey",
  "Remembering",
  "Recalling",
  "Sifting memories",
  "Following the trail",
  "Waggle dancing",
  "Tending the hive",
];
/** The wait's dots, one more at each beat and none again after three: always as wide as three, with blanks that do not collapse, so that the word stays where it is. */
const dots = (frame: number): string => ".".repeat(frame % 4).padEnd(3, "\u00A0");
const waitWord = (): string => WAIT_WORDS[Math.floor(Math.random() * WAIT_WORDS.length)]!;

/** The least a wait is shown for, so that a quick answer still shows the bee: about two of its beats. */
const WAIT_MIN_MS = 500;
/** How long the waiting bee's wings stay in one frame. */
const WAIT_FRAME_MS = 250;

/** How many searches `/kioku-search` offers again. */
const RECENT_LIMIT = 20;

/** After a reset of the session's state: what the session found is not the new conversation's, so its tabs close and the searches are forgotten. */
export async function pageRestore($: EngineInterface): Promise<void> {
  for (const id of Object.keys(await read($, views))) await $.ui.close({ id }).catch(() => undefined);
  state.tabs = 0;
  state.groups.clear();
  state.recent = [];
  await update($, views, () => ({}));
}

/** When a session starts: the pane starts empty. */
export async function pageStart($: EngineInterface): Promise<void> {
  state.tabs = 0;
  state.groups.clear();
  state.recent = [];
  await update($, views, () => ({}));
}

/** The pane. */
export function registerPage(on: Parameters<Register>[0]): void {
  on("ui.render", { component: "Pane", requestId: new RegExp(`^${PAGE_PANE}-\\d+$`) }, async ($, e, next) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Markdown } = ui;
    // The mobile app draws no field yet. Ask by the surface: its table hands out an `Input` that draws nothing, so `"Input" in ui` is true there.
    const Input = e.surface === "mobile" ? undefined : $.ui.resolve(e).Input;
    const tab = e.requestId;
    const shown = (await read($, views))[tab];
    // The close mark is drawn over the last cell of the first row, so the first row is two cells shorter.
    const first = Math.max(1, e.props.bodyColumns - 2);
    if (shown === undefined) return <Text dimColor>nothing opened yet</Text>;
    // The pane's first row, two cells shorter for the host's close mark: at the left, back, to the page a link was followed from,
    // or else to the pages a search found, when it was found by one; and at the right, to close the pane. Yellow, as the rows'
    // buttons are, and a line of air below, so that they read as controls and not as the page.
    const controls = (shown: { trail?: PageRef[]; back?: PageResults }, here: string) => {
      const before = shown.trail?.at(-1);
      const goBack = (): void => {
        if (before !== undefined)
          void openPage($, {
            brain: before.brain,
            path: before.path,
            ...(before.label !== undefined && { label: before.label }),
            ...(shown.back !== undefined && { back: shown.back }),
            trail: shown.trail!.slice(0, -1),
            tab,
          });
        else if (shown.back !== undefined) void show($, { kind: "choose", ...shown.back }, tab);
      };
      const text =
        before !== undefined
          ? `← ${before.title}`
          : shown.back !== undefined
            ? `← ${shown.back.pages.length} pages for “${shown.back.words}”`
            : undefined;
      return (
        <Box width={first} marginBottom={1} flexDirection="row" justifyContent="flex-end" minWidth={0}>
          {text === undefined ? null : (
            <Box flexShrink={1} flexGrow={1} minWidth={0} paddingRight={2}>
              {chip(ui, e.surface, {
                key: `back:${before?.path ?? shown.back?.words ?? ""}:${here}`,
                label: text,
                onPress: goBack,
                truncate: true,
              })}
            </Box>
          )}
          <Box flexShrink={0}>
            {chip(ui, e.surface, {
              key: "close",
              label: "✕ close",
              onPress: () => {
                void $.ui.close({ id: tab });
              },
            })}
          </Box>
        </Box>
      );
    };
    if (shown.kind === "opening" || shown.kind === "searching") {
      // A page opening or a search running: the wait is in the middle of the pane, across and down, under the row of controls.
      const rows = e.props.scroll?.bodyRows;
      return (
        <Box flexDirection="column" width={e.props.bodyColumns} {...(rows !== undefined && { height: rows })}>
          {controls({}, "")}
          <Box flexGrow={1} width={e.props.bodyColumns} alignItems="center" justifyContent="center">
            {waiting(ui, shown.frame, `${shown.word}${dots(shown.frame)}`)}
          </Box>
        </Box>
      );
    }
    if (shown.kind === "ask") {
      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          {controls({}, "")}
          {/* Air around the field: its focus ring is drawn outside its cells, and beyond a terminal it is cut by the row that holds it. */}
          <Box width={e.props.bodyColumns} paddingY="sm" paddingX="xs">
            {Input !== undefined ? (
              <Input
                key="words"
                placeholder="Search the memory"
                autoFocus
                submitLabel="search"
                onSubmit={(v) => {
                  if (v.trim() !== "") void searchFor($, v.trim(), tab);
                }}
              />
            ) : (
              <Text dimColor>No search field here: send /kioku-search and the words</Text>
            )}
          </Box>
          {/* What this session searched, to see again without searching again: nothing is run, and what the agent knows does not change. */}
          {state.recent.length > 0 ? (
            <Box width={e.props.bodyColumns} marginTop={1} marginBottom={1}>
              <Text dimColor wrap="truncate-end">
                recent searches
              </Text>
            </Box>
          ) : null}
          <Box flexDirection="column" rowGap="sm">
            {state.recent.map((r) => (
              <Box key={`recent:${groupOf(r)}`} width={e.props.bodyColumns} flexDirection="row" minWidth={0}>
                <Box flexShrink={1} minWidth={0}>
                  <Text wrap="truncate-end">
                    {fitted(
                      `“${r.words}” · ${r.pages.length} ${r.pages.length === 1 ? "page" : "pages"}`,
                      e.props.bodyColumns - 3 - OPEN_WIDTH,
                      false,
                    )}
                  </Text>
                </Box>
                <Box flexShrink={0} flexGrow={1} justifyContent="flex-end">
                  {chip(ui, e.surface, {
                    key: `recent:${groupOf(r)}:results`,
                    label: "↗ results",
                    onPress: () => {
                      // Shown again as it was found: in its own tab, the one it had if it is still there.
                      void showResults($, r);
                    },
                  })}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      );
    }
    if (shown.kind === "text") {
      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          {controls({}, "")}
          <Box width={e.props.bodyColumns} marginBottom={1}>
            <Text dimColor wrap="truncate-end">
              {shown.line}
            </Text>
          </Box>
          {shown.top !== undefined ? (
            <Box width={e.props.bodyColumns} marginBottom={1}>
              <Text dimColor wrap="truncate-end">
                {shown.top}
              </Text>
            </Box>
          ) : null}
        </Box>
      );
    }
    if (shown.kind === "page") {
      const touched =
        shown.touched !== undefined ? ` · changed ${ago(shown.touched, new Date(await $.clock.now()))}` : "";
      // A link of the page, followed: the page it names opens in this tab, with this one to go back to.
      const follow = (href: string): void => {
        const path = linkedPath(shown.path, href);
        if (path === undefined) return;
        const here: PageRef = {
          brain: shown.brainName,
          ...(shown.brain !== shown.brainName && { label: shown.brain }),
          path: shown.path,
          title: shown.title,
        };
        void openPage($, {
          brain: shown.brainName,
          path,
          ...(shown.brain !== shown.brainName && { label: shown.brain }),
          ...(shown.back !== undefined && { back: shown.back }),
          trail: [...(shown.trail ?? []), here],
          tab,
        });
      };
      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          {controls(shown, shown.path)}
          {/* The page's own title, which the host draws only while another pane is open, and under it where it is: the brain and
              when it changed are never cut; the path gives way, from its start. */}
          <Box width={e.props.bodyColumns}>
            <Text bold wrap="truncate-end">
              {shown.title}
            </Text>
          </Box>
          <Box width={e.props.bodyColumns} flexDirection="row" marginBottom={1}>
            <Box flexShrink={0}>
              <Text dimColor>{`${shown.brain} · `}</Text>
            </Box>
            <Box flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-start">
                {shown.path}
              </Text>
            </Box>
            {touched !== "" ? (
              <Box flexShrink={0}>
                <Text dimColor>{touched}</Text>
              </Box>
            ) : null}
          </Box>
          {/* The links to other pages of the brain are the pane's to answer: a press on one opens that page, and back returns here. */}
          <Markdown
            key={`body:${shown.brainName}:${shown.path}:${(shown.trail ?? []).length}`}
            text={e.surface === "terminal" ? pointed(shown.body) : unlinked(shown.body)}
            pressableLinks={linksOf(shown.body).map(pointerOf)}
            onLinkPress={(link) => {
              follow(hrefOfPointer(link.href));
            }}
          />
          {/* The desktop opens a link to a file in its own explorer and the pane is not asked, so there the pages a page links to are
              buttons under it, which are. */}
          {e.surface !== "terminal" && linkedOf(shown.body).length > 0 ? (
            <Box flexDirection="column" marginTop={1} rowGap="sm">
              <Text dimColor>linked pages</Text>
              {linkedOf(shown.body).map((l) => (
                <Box key={`linked:${l.href}`}>
                  {chip(ui, e.surface, {
                    key: `linked:${l.href}`,
                    label: `↗ ${l.words}`,
                    onPress: () => {
                      follow(l.href);
                    },
                  })}
                </Box>
              ))}
            </Box>
          ) : null}
          {shown.cut ? <Text dimColor>{`the page goes on: ${MARKDOWN_LIMIT} characters shown`}</Text> : null}
        </Box>
      );
    }
    if (shown.kind === "choose") {
      const { kind: _, ...results } = shown;
      // What lights a result under the pointer: the colour every pane of the mod uses for the host's theme.
      const hoverTint = hoverOf(await themeNow($));
      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          {controls({}, "")}
          <Box width={e.props.bodyColumns} marginBottom={1}>
            <Text dimColor wrap="truncate-end">{`${shown.pages.length} pages for “${shown.words}”`}</Text>
          </Box>
          {shown.top !== undefined ? (
            <Box width={e.props.bodyColumns} marginBottom={1}>
              <Text dimColor wrap="truncate-end">
                {shown.top}
              </Text>
            </Box>
          ) : null}
          <Box flexDirection="column" rowGap="sm">
            {shown.pages.map((p) => {
              const open = (): void => {
                void openPage($, { ...p, back: results, tab });
              };
              return (
                // Both lines light together under the pointer. Only `↗ open`, at the end of the second line, opens the page, as it does in
                // the history's rows: the lines are text, so that a press that is not on it does nothing. Each line is cut to fit, so that a page never takes a third.
                <Box
                  key={`choose:${p.brain}:${p.path}`}
                  flexDirection="column"
                  width={e.props.bodyColumns}
                  hover={{ backgroundColor: hoverTint }}
                >
                  <Box width={e.props.bodyColumns}>
                    <Text dimColor>{"› "}</Text>
                    <Text>{fitted(p.title, e.props.bodyColumns - 2, false)}</Text>
                  </Box>
                  <Box paddingLeft={2} width={e.props.bodyColumns} flexDirection="row" minWidth={0}>
                    <Box flexShrink={1} minWidth={0}>
                      <Text dimColor wrap="truncate-start">
                        {fitted(`${p.path} (${p.label ?? p.brain})`, e.props.bodyColumns - 3 - OPEN_WIDTH, true)}
                      </Text>
                    </Box>
                    <Box flexShrink={0} flexGrow={1} justifyContent="flex-end">
                      {chip(ui, e.surface, { key: `choose:${p.brain}:${p.path}:open`, label: "↗ open", onPress: open })}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
          {shown.bottom !== undefined ? (
            <Box width={e.props.bodyColumns}>
              <Text dimColor wrap="truncate-end">
                {shown.bottom}
              </Text>
            </Box>
          ) : null}
        </Box>
      );
    }
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {controls(shown, "")}
        <Box width={e.props.bodyColumns}>
          <Text dimColor wrap="truncate-end">{`could not open ${shown.what}`}</Text>
        </Box>
      </Box>
    );
  }).catch(($, e, next) => next(e));
}
