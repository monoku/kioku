import { test } from "node:test";
import assert from "node:assert/strict";
import { cappedReport, LINT_LISTS, type LintReport } from "../../src/core/lint.ts";
import { DEFAULT_LIMIT, nextOf, windowing } from "../../src/core/limit.ts";

const report = (n: number): LintReport => ({
  brain: "northwind/brain-acme",
  root: "/x",
  similar: [],
  staleInstincts: [],
  superseded: [],
  brokenLinks: [],
  missingSummary: Array.from({ length: n }, (_, i) => `p${i}.md`),
  skillCandidates: [],
  expired: [],
  unconfirmed: [],
  retiredLinks: [],
  contradictions: [],
  conflicts: [],
  unopened: [],
  unfollowed: [],
  similarElsewhere: [],
  counting_since: null,
  undescribed: ["a"],
  count: n + 1,
});

test("a lint report shows the first 20 entries of a list and its full length; a short list is untouched (§6.1)", () => {
  assert.equal(DEFAULT_LIMIT, 20);
  const capped = cappedReport(report(45), DEFAULT_LIMIT);
  assert.equal(capped.missingSummary.length, 20);
  assert.deepEqual(capped.totals, { missingSummary: 45 });
  assert.equal(capped.count, 46, "the count still says how much there is to review");
  assert.deepEqual(capped.undescribed, ["a"]);
  assert.deepEqual(cappedReport(report(3), DEFAULT_LIMIT).totals, {});
  assert.ok(LINT_LISTS.every((k) => Array.isArray(report(1)[k])));
});

test("a window says the offset that reads on, and none at the end", () => {
  assert.deepEqual(windowing([1, 2, 3, 4, 5], 0, 2), { part: [1, 2], total: 5, offset: 0, limit: 2, next: 2 });
  assert.equal(windowing([1, 2, 3, 4, 5], 4, 2).next, null);
  assert.equal(nextOf(5, 3, 2), null);
  assert.equal(nextOf(6, 3, 2), 5);
});
