import { colorFor, LAVENDER, ORANGE, sgr } from "../brand.ts";
import type { DisplayColor, NoticeName } from "../config/machine.ts";

/**
 * What Kioku tells the person in a hook's message, the summary or a notice (§1.2), before it is laid out: its level, its
 * headline and, under it, one line per fact. The words are the same with colour or without; colour only marks what kind
 * of words they are.
 */

/** A run of words, and what kind: plain, a name or path to dim, or a command to make bold. */
export type Span = string | { dim: string } | { cmd: string } | { read: string };

export interface Message {
  /** Nothing for information; `warn` when the person has something to do or something was not loaded; `error` when Kioku failed. */
  level?: "warn" | "error";
  /** The headline. */
  head: Span[];
  /** One fact a line, under the headline. */
  details?: Span[][];
  /** The name a notice is muted by (§1.2); none for the summary, an error, a conflict or a question, which are always said. */
  name?: NoticeName;
}

/** How a message is laid out: with colour or without. */
export interface Layout {
  color: boolean;
}

export const dim = (text: string): Span => ({ dim: text });
export const cmd = (text: string): Span => ({ cmd: text });
/** The arrow of a read, in the footer's lavender (§1.2). */
export const read = (text: string): Span => ({ read: text });

/**
 * Whether messages have colour (§1.2), as `colorFor` says. The host decides whether it draws the codes, so where the
 * words go is not asked.
 */
export const messageColor = (setting: DisplayColor | undefined, env: NodeJS.ProcessEnv): boolean =>
  colorFor(setting, env);

/** The layout `display.color` asks for. */
export const layoutFor = (color: boolean): Layout => ({ color });

/** The messages the person has not muted (§1.2). */
export const unmuted = (messages: Message[], mute: readonly NoticeName[] | undefined): Message[] =>
  messages.filter((m) => m.name === undefined || mute?.includes(m.name) !== true);

/** The message as text: the brand, the level, the headline, and under it its details. */
export function render(m: Message, layout: Layout): string {
  const paint = (code: string, close: string) => sgr(layout.color, code, close);
  const orange = paint(ORANGE, "39");
  const bold = paint("1", "22");
  const faint = paint("2", "22");
  const lavender = paint(LAVENDER, "39");
  const span = (s: Span): string =>
    typeof s === "string" ? s : "dim" in s ? faint(s.dim) : "read" in s ? lavender(s.read) : bold(s.cmd);
  const line = (spans: Span[]): string => spans.map(span).join("");
  const level =
    m.level === "warn" ? `${paint("33", "39")("⚠")} ` : m.level === "error" ? `${paint("31", "39")("✕")} ` : "";
  const brand = `${orange("⬢")} ${bold("kioku")}${orange(".md")}${faint(" · ")}${level}`;
  // A notice with a name ends with the command that mutes it (§1.2).
  const details = [
    ...(m.details ?? []),
    ...(m.name === undefined ? [] : [[dim("to stop this notice: "), cmd(`kioku config set display.mute +${m.name}`)]]),
  ];
  return [brand + line(m.head), ...details.map((d) => faint("  ⎿ ") + line(d))].join("\n");
}

/** A message with no colour: what a test or a log reads. */
export const plain = (m: Message): string => render(m, { color: false });
