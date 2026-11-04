import type { DisplayColor } from "./config/machine.ts";

/**
 * How Kioku's words are coloured wherever they go (§1.2): a message in the host, a verb's text and its steps at a
 * terminal. The mod, which imports nothing of the tool's, writes the same two colours in hex.
 */

/** The brand's orange, `#F5A24B`: the mark, and a step that sends something away. */
export const ORANGE = "38;2;245;162;75";
/** The brand's lavender, `#7C87E0`: a step that brings something here. */
export const LAVENDER = "38;2;124;135;224";

/** A painter: `s` between an SGR code and the one that closes it, when there is colour and something to colour. */
export const sgr =
  (color: boolean, open: string | number, close: string | number) =>
  (s: string): string =>
    color && s !== "" ? `\x1b[${open}m${s}\x1b[${close}m` : s;

/**
 * Whether there is colour (§1.2): `never` and `always` say so; `auto` colours where the words reach a terminal, unless
 * `NO_COLOR` is set (https://no-color.org) or the terminal is dumb.
 */
export function colorFor(setting: DisplayColor | undefined, env: NodeJS.ProcessEnv, terminal = true): boolean {
  if (setting === "never") return false;
  if (setting === "always") return true;
  return terminal && (env.NO_COLOR === undefined || env.NO_COLOR === "") && env.TERM !== "dumb";
}
