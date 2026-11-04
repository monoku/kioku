import type { EngineInterface } from "claude-code";
import { LAVENDER, ORANGE, YELLOW } from "./colors";

// What the panes and rows draw the same way (§1.2): the buttons, which are yellow text on a terminal and the host's own button
// beyond it, and the close of a pane. A pane does not choose its own; what looks of the mod looks so in all of it.

type Ui = ReturnType<EngineInterface["ui"]["resolve"]>;

/** How a terminal and the rest draw a button: a plain one is its yellow text; a desktop draws its own from the label, and a secondary one stands out from the page. */
export const lookOf = (surface: string): { plain: true } | { variant: "secondary" } =>
  surface === "terminal" ? { plain: true } : { variant: "secondary" };

/**
 * A button of the mod: `label`, with its icon, is what a desktop draws, and the same in yellow what a terminal does. `truncate`
 * cuts a long label with `…` where the room is short.
 */
export function chip(
  ui: Ui,
  surface: string,
  args: { key: string; label: string; onPress: () => void; truncate?: true },
) {
  const { Button, Text } = ui;
  return (
    <Button key={args.key} {...lookOf(surface)} label={args.label} onPress={args.onPress}>
      <Text color={YELLOW} {...(args.truncate !== undefined && { wrap: "truncate-end" as const })}>
        {args.label}
      </Text>
    </Button>
  );
}

/** The close at the top of a pane. The host draws its own mark over the last cell of the first row, so the row is two cells shorter. */
export function closeRow(ui: Ui, surface: string, columns: number, onPress: () => void) {
  const { Box } = ui;
  return (
    <Box width={Math.max(1, columns - 2)} marginBottom={1} flexDirection="row" justifyContent="flex-end">
      {chip(ui, surface, { key: "close", label: "✕ close", onPress })}
    </Box>
  );
}

/** The host's theme as last known: `/theme` may change it mid-session, so a pane asks each time it draws, and the last one known stands when the host does not say. */
let theme = "dark";
export async function themeNow($: EngineInterface): Promise<string> {
  const value = (await $.config.list().catch(() => [])).find((r) => r.key === "theme")?.value;
  if (typeof value === "string") theme = value;
  return theme;
}

const DAY_MS = 86_400_000;

/** When a page was last touched, as every pane says it: from the tool's `touched`, which it reads from git, never a file's date. */
export function ago(touched: string, now: Date): string {
  const [y, m, d] = touched.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) return touched;
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / DAY_MS,
  );
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The history's mark for a tab's name (§1.2). */
export const HISTORY_MARK = "⬢";

/** The wait (§1.2), in the colours of the footer: the ⬢ and what it does in orange, its wings in lavender, which beat with each `frame`. */
export function waiting(ui: Ui, frame: number, text: string) {
  const { Text } = ui;
  const [l, r] = frame % 2 === 0 ? ["ɛ", "ɜ"] : ["ʚ", "ɞ"];
  return (
    <Text wrap="truncate-end">
      <Text color={LAVENDER}>{l}</Text>
      <Text color={ORANGE}>⬢</Text>
      <Text color={LAVENDER}>{r}</Text>
      <Text color={ORANGE}>{` ${text}`}</Text>
    </Text>
  );
}
