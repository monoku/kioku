// What the mod (plugins/claude-code/hooks) uses of the engine it runs in, in Kioku's own words, so that `pnpm typecheck:plugin` needs no host.
// Only what the mod uses: a name it starts to use is added here. It holds the mod to itself, not to the host:
// `pnpm test:plugin` runs the mod in the real engine and `pnpm typecheck:plugin:real` checks it against the host's own types.

declare const h: (type: unknown, props: unknown, ...children: unknown[]) => JSX.Element;
declare const Fragment: unique symbol;

declare namespace JSX {
  interface Element {
    readonly __element: true;
  }
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicAttributes {
    key?: string;
  }
  type IntrinsicElements = Record<never, never>;
}

declare module "claude-code" {
  export type Surface = "terminal" | "desktop" | "vscode" | "mobile";
  type Children = unknown;
  type Space = number | "xs" | "sm" | "md" | "lg";

  export interface BoxProps {
    children?: Children;
    flexDirection?: "row" | "column";
    flexGrow?: number;
    flexShrink?: number;
    alignItems?: "center";
    justifyContent?: "center" | "flex-end";
    width?: number;
    height?: number;
    minWidth?: number;
    gap?: Space;
    rowGap?: Space;
    marginTop?: Space;
    marginBottom?: Space;
    paddingX?: Space;
    paddingY?: Space;
    paddingLeft?: Space;
    paddingRight?: Space;
    borderStyle?: "round";
    borderColor?: string;
    backgroundColor?: string;
    hover?: Omit<BoxProps, "children" | "hover">;
  }
  export interface TextProps {
    children?: Children;
    color?: string;
    bold?: boolean;
    dimColor?: boolean;
    wrap?: "truncate-end" | "truncate-start";
  }
  export interface ButtonProps {
    children?: Children;
    label?: string;
    plain?: boolean;
    variant?: "secondary";
    onPress?: () => void;
  }
  export interface InputProps {
    placeholder?: string;
    autoFocus?: boolean;
    submitLabel?: string;
    onSubmit?: (value: string) => void;
  }
  export interface MarkdownProps {
    text: string;
    pressableLinks?: readonly string[];
    onLinkPress?: (link: { readonly href: string }) => void;
  }
  type Element<P> = (props: P & { key?: string }) => JSX.Element;
  interface Common {
    Box: Element<BoxProps>;
    Text: Element<TextProps>;
    Button: Element<ButtonProps>;
    Markdown: Element<MarkdownProps>;
  }
  /** Every surface has `Common`; only some have a field. */
  export interface Elements {
    terminal: Common & { Input: Element<InputProps> };
    desktop: Common & { Input: Element<InputProps> };
    vscode: Common & { Input: Element<InputProps> };
    mobile: Common;
  }

  export interface Timer {
    cancel(): void;
  }
  type TimerCall = (ms: number, fn: () => void) => Timer;
  export interface ProcessResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    isStdoutTruncated: boolean;
    isStderrTruncated: boolean;
  }
  export interface EngineInterface {
    clock: { now(): Promise<number>; after: TimerCall; every: TimerCall };
    command: {
      register(command: {
        name: string;
        description: string;
        argumentHint?: string;
        immediate?: boolean;
      }): Promise<{ command: string }>;
    };
    config: { list(): Promise<{ key: string; value?: unknown }[]> };
    prompt: { submit(input: { text: string }): Promise<unknown> };
    env: { get(name: string): Promise<string | undefined> };
    fs: { read(path: string): Promise<unknown> };
    plugin: { name: string; root: string };
    process: { run(argv: readonly string[], init?: { cwd?: string; timeoutMs?: number }): Promise<ProcessResult> };
    session: { id(): Promise<string> };
    ui: {
      resolve<S extends Surface>(e: { surface: S }): Elements[S];
      open(pane: {
        id: string;
        title?: string;
        focus?: boolean;
        [option: string]: unknown;
      }): Promise<{ isPlaced: boolean }>;
      close(pane: { id: string }): Promise<void>;
    };
  }
  /** The mods' state, which each mod's contract declares. */
  export interface PluginState {}
  export type Atom<T> = { readonly plugin: string; readonly key: string; readonly __value?: T };
  export function atom<const R extends { plugin: string; key: string }, T>(ref: R, initial: T): Atom<T>;
  export function read<T>($: EngineInterface, atom: Atom<T>): Promise<T>;
  export function update<T>($: EngineInterface, atom: Atom<T>, fn: (value: T) => T): Promise<void>;

  interface RenderBase<S extends Surface> {
    readonly plugin?: string;
    readonly surface: S;
    readonly requestId: string;
    readonly viewport?: { readonly columns: number; readonly rows: number };
  }
  interface ToolCallShown {
    readonly tool: string;
    readonly input: unknown;
    readonly output: unknown;
    readonly isRunning: boolean;
    readonly isErrored: boolean;
    readonly isInterrupted: boolean;
  }
  /** The props of each host component the mod draws. */
  export interface RenderProps {
    Pane: {
      readonly title: string;
      readonly isFocused: boolean;
      readonly bodyColumns: number;
      readonly placement: "dock" | "inline";
      readonly scroll: { readonly offset: number; readonly bodyRows: number };
    };
    SessionMode: { readonly modes: readonly string[] };
    ToolGroup: {
      readonly calls: readonly (ToolCallShown & { readonly tool_use_id: string | undefined })[];
      readonly isExpanded?: boolean;
      readonly isCallsOnly?: boolean;
    };
    ToolUse: ToolCallShown & { readonly tool_use_id: string };
    ToolResult: { readonly tool: string; readonly tool_use_id: string };
  }
  /** One member per surface and component, so that `e.surface === "mobile"` narrows `e` and what `$.ui.resolve(e)` answers. */
  export type RenderInput<C extends keyof RenderProps = keyof RenderProps> = {
    [K in C]: {
      [S in Surface]: RenderBase<S> & { readonly component: K; readonly props: RenderProps[K] };
    }[Surface];
  }[C];
  interface ClassicInput {
    readonly session_id: string;
    readonly source?: "compact" | "fork" | "resume" | "startup" | "clear";
  }
  /** Each event a hook of the mod or of its tests answers, and what it is given. What a hook resolves to is not held here. */
  export interface EventInputs {
    "session.start": { readonly cwd: string; readonly surface?: Surface; readonly isInteractive?: boolean };
    "session.id": Record<never, never>;
    "command.run": { readonly command: string; readonly args: string };
    "command.register": { readonly name: string; readonly description?: string };
    "prompt.submit": { readonly text: string };
    "config.list": Record<never, never>;
    "fs.read": { readonly path: string };
    "process.run": { readonly argv: readonly string[] };
    "tool.call": { readonly tool: string };
    "ui.open": { readonly id: string };
    "ui.close": { readonly id: string };
    "ui.render": RenderInput;
    "classic.SessionStart": ClassicInput;
    "classic.UserPromptSubmit": ClassicInput;
    "classic.PostToolUse": ClassicInput;
  }
  type Handler<I> = ($: EngineInterface, e: I, next: (e: I) => Promise<unknown>) => unknown;
  export type Hook<E extends keyof EventInputs = keyof EventInputs> = Handler<EventInputs[E]>;
  interface Registration<I> {
    catch(handler: Handler<I>): void;
  }
  export interface On {
    <C extends keyof RenderProps>(
      event: "ui.render",
      matcher: { component: C; requestId?: string | RegExp },
      hook: Handler<RenderInput<C>>,
    ): Registration<RenderInput<C>>;
    <E extends keyof EventInputs>(event: E, hook: Hook<E>): Registration<EventInputs[E]>;
    (
      event: "command.run",
      matcher: { command: string },
      hook: Hook<"command.run">,
    ): Registration<EventInputs["command.run"]>;
    (event: "tool.call", matcher: { tool: string }, hook: Hook<"tool.call">): Registration<EventInputs["tool.call"]>;
  }
  export type Register = (on: On) => unknown;
}

declare module "claude-code/testing" {
  import type { EngineInterface, On } from "claude-code";

  /** What a test reads of a drawing. */
  export interface Found {
    readonly props: Record<string, unknown>;
    readonly text: string;
  }
  type Query = { type?: string; key?: string; in?: string };
  export interface Mounted {
    find(query: Query): Promise<Found | undefined>;
    findAll(query: Query): Promise<Found[]>;
    press(target: { key?: string }): Promise<unknown>;
    unmount(): Promise<void>;
  }
  /** The engine as a test drives it: it also fires the events a host would. */
  export type Engine = Omit<EngineInterface, "ui" | "session" | "command"> & {
    ui: EngineInterface["ui"] & {
      mount(target: never): Promise<Mounted>;
      press(target: { plugin?: string; key?: string; requestId?: string }): Promise<unknown>;
    };
    session: EngineInterface["session"] & {
      start(input: { cwd: string; surface: string; isInteractive: boolean }): Promise<unknown>;
    };
    command: EngineInterface["command"] & { run(input: never): Promise<unknown> };
    classic: {
      SessionStart(input: never): Promise<unknown>;
      PostToolUse(input: never): Promise<unknown>;
    };
  };
  type Body = ($: Engine, on: On) => unknown;
  export function test(name: string, body: Body): void;
  interface Matchers {
    readonly not: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(item: unknown): void;
    toMatch(pattern: string | RegExp): void;
    toMatchObject(expected: object): void;
    toHaveLength(length: number): void;
    toBeUndefined(): void;
    toBeLessThan(bound: number): void;
  }
  export const expect: ((actual: unknown) => Matchers) & { arrayContaining(items: readonly unknown[]): unknown };
  export const mock: {
    env(on: On, variables: Readonly<Record<string, string>>): void;
    clock(on: On, options?: { now?: number }): { advance(ms: number): Promise<void> };
  };
}
