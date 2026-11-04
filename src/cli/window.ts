import { nextOf } from "../core/limit.ts";

/** The line that tells a window was cut, and the `--offset` that reads on; none when the window reaches the end. */
export function moreLine(total: number, offset: number, shown: number): string | undefined {
  const next = nextOf(total, offset, shown);
  return next === null ? undefined : `… ${total - next} more: --offset ${next}`;
}
