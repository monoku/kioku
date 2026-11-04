import { test } from "node:test";
import assert from "node:assert/strict";
import { VERB_NAMES } from "../../src/cli/verbs.ts";
import { WRITING_VERBS } from "../../src/core/log.ts";
import { JOURNAL_READS, JOURNAL_WRITES } from "../../src/core/session/journal-verbs.ts";

// The core spells these verbs as words, since it does not read the command line's table: this holds the words to it.
test("the writing verbs and the journal's verbs are verbs the table declares (§1.2, §3.5, §4.6)", () => {
  const names = new Set<string>(VERB_NAMES);
  for (const verb of WRITING_VERBS) assert.ok(names.has(`page ${verb}`), `page ${verb} is no verb`);
  for (const verb of JOURNAL_WRITES) assert.ok(names.has(`page ${verb}`), `page ${verb} is no verb`);
  for (const verb of JOURNAL_READS) assert.ok(names.has(verb), `${verb} is no verb`);
});
