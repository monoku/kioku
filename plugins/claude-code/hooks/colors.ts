// The brand's two colours, as the tool has them (src/core/brand.ts): the mod imports nothing of the tool's. Orange is a
// write, lavender a read.
export const ORANGE = "#F5A24B";
export const LAVENDER = "#7C87E0";
// The yellow of a button the person can press: it stands out from the brand's two and from what is only said.
export const YELLOW = "#E6C84A";

/**
 * What lights an item under the pointer, one colour for a dark theme and one for a light one, the same in every pane of the mod
 * (the history's cards and the lists of the page viewer and search). `auto` and a custom theme may be either, and the mod is not
 * told which: the host's own background for a message, which follows the theme.
 */
export const hoverOf = (theme: string): string =>
  theme.startsWith("dark") ? "#2E2E2E" : theme.startsWith("light") ? "#E8E8E8" : "userMessageBackground";
