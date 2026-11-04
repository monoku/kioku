# 5. Validator

One command in the tool, `kioku brain validate`, applies these rules; no brain
carries a copy of them. Each brain's `kioku.yaml` declares the `format` the
validator applies, its `tier`, `namespaces` and `language` (§2.5); any other
key, `name` or `team` among them, is refused naming it.

## 5.1 Rules

1. Front matter missing or not valid YAML.
2. A required field missing, or `kind` or `tier` outside their lists.
3. `id` missing, malformed, or duplicated within the brain.
4. A `namespace` not declared in `kioku.yaml`.
5. A file in the wrong folder for its kind or subkind.
6. A required section missing.
7. A relative link, `supersedes` or `superseded_by` whose target does not
   exist.
8. A secret pattern in any field or body, in any kind.
9. `BRAIN.md` missing at the root, or `INDEX.md` missing in a namespace, at
   `knowledge/<namespace>/INDEX.md` however deep it is.
10. A `format` in `kioku.yaml` newer than the tool knows.
11. A declared namespace with a segment that cannot be a folder's (empty, `.`,
    `..` or holding a `\`) (§3.2).
12. A symbolic link anywhere in the brain, outside `.git`: the tool reads
    nothing through one (§3.1).

Warnings do not block, and each has a name: `summary` missing
(`summary-missing`); `## Changelog` missing on a kind that has one
(`changelog-missing`); a Rule longer than 600 characters (`rule-too-long`);
`evidence` missing on a page whose `source` is a session (`evidence-missing`);
a `stale_after` that is not a date (`stale-after-invalid`); a `status` other
than `deprecated` (`status-invalid`); a `verified` that is not entries with an
`at` (`verified-invalid`); a page of more than 500 lines (`page-too-long`); a
`## Load first` that names more than five pages or one not in the brain
(`load-first-long`, `load-first-broken`); a namespace segment that is not
letters, digits, dots, dashes and underscores starting with a letter or a digit
(`namespace-name-invalid`), or is a name §3.2 reserves
(`namespace-name-reserved`); a namespace more than three deep
(`namespace-too-deep`), or whose parent is not declared
(`namespace-parent-missing`); `AGENTS.md` missing at the root
(`agents-md-missing`); a file an agent host needs missing, such as Claude
Code's `CLAUDE.md` or `.claude/commands/ingest.md` (`host-file-missing`,
naming the file), all written by `kioku brain refresh`. Findings print as
`path:line: error [rule N] message`.

`save`, `update` and `supersede` validate the page before they commit; an
invalid page is never committed. A brain whose `format` is newer than the tool
reads (rule 10) is not written to: every writing verb and `brain refresh`
refuse it before touching a file, with exit 2 and the code `format_newer`,
naming the brain's format, the newest the tool reads, and that the tool is to
be updated; reading, search and `sync` go on, and `kioku doctor` names the
brain and the command that fixes it.
