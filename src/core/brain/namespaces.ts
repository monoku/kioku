import { readBrain } from "./brain.ts";
import { readInsideIfAny } from "./inside.ts";
import { descriptionOf, isGenericDescription } from "./namespace-index.ts";
import { depthOf, isUnder } from "./namespace-name.ts";

export interface NamespaceSummary {
  /** The path of the namespace (§3.2). */
  namespace: string;
  /** How deep it is: 1 for a top-level one. */
  depth: number;
  /** The pages of the namespaces under it, all levels, not counted in `total`. */
  below: number;
  /** Pages carrying this namespace, by kind (`decision`, `playbook`, `context`, `instinct`, `memory`, `rule`, `skill`). */
  pages: Record<string, number>;
  total: number;
  /** What its `INDEX.md` says it is for, or null when it does not say (§3.2). */
  summary: string | null;
}

/**
 * The namespaces a brain declares, as a tree in the order of `kioku.yaml` (a namespace, then what is under it), with
 * the pages of each by kind (§3.2): a knowledge page by its folder, the other kinds by the `namespace` of their front
 * matter. A page whose namespace is not declared is not counted.
 */
export function namespaceOverview(root: string): NamespaceSummary[] {
  const brain = readBrain(root);
  const rows = new Map<string, NamespaceSummary>(
    brain.config.namespaces.map((n) => {
      const index = readInsideIfAny(root, `knowledge/${n}/INDEX.md`);
      const said = index === undefined ? undefined : descriptionOf(index);
      return [
        n,
        {
          namespace: n,
          depth: depthOf(n),
          below: 0,
          pages: {},
          total: 0,
          summary: said === undefined || said === "" || isGenericDescription(said) ? null : said,
        },
      ];
    }),
  );
  for (const page of brain.pages) {
    if (page.placement === undefined) continue;
    const ns = page.placement.namespace ?? (page.parsed.ok ? page.parsed.file.front.getString("namespace") : undefined);
    const row = ns === undefined ? undefined : rows.get(ns);
    if (row === undefined) continue;
    const what = page.placement.sub ?? page.placement.kind;
    row.pages[what] = (row.pages[what] ?? 0) + 1;
    row.total++;
  }
  for (const row of rows.values())
    row.below = [...rows.values()]
      .filter((o) => o.namespace !== row.namespace && isUnder(o.namespace, row.namespace))
      .reduce((n, o) => n + o.total, 0);
  const order = new Map(brain.config.namespaces.map((n, i) => [n, i]));
  const key = (n: string): number[] => n.split("/").map((_, i, a) => order.get(a.slice(0, i + 1).join("/")) ?? 1e9);
  return [...rows.values()].sort((a, b) => {
    const x = key(a.namespace),
      y = key(b.namespace);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
    return 0;
  });
}
