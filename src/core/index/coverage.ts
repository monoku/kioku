import type { DatabaseSync } from "node:sqlite";

/** How many pages of the index have a vector of this model for their current content; read-only, for `doctor`. */
export function coverageOf(db: DatabaseSync, model: string): number {
  return (
    db
      .prepare(`
    SELECT count(*) AS n FROM pages p JOIN vectors v ON v.brain = p.brain AND v.path = p.path AND v.hash = p.hash AND v.model = ?`)
      .get(model) as { n: number }
  ).n;
}
