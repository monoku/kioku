# What the verbs answer

The JSON each verb answers with `--json`, or off a terminal: the contract
programs read (spec §6.1). A field added does not break it; one removed or
whose meaning changes moves `contract`, which `kioku --version` answers.
`tests/contract.test.ts` runs the verbs and fails when a field it pins is
missing from the answer or from this page. How to call each verb is
[the command-line reference](cli.md).

## Every verb

Where an answer names a `brain`, or a `key`, it is the brain's name,
`owner/repo`, the same on every machine (spec §2.2, §2.3); the tier is `tier`
where it is answered. Contract 2: in contract 1 a brain was named by its
repository, `host/owner/repo`, and `brain trust`, `brain create`'s `userFrom`
and `brain clone`'s `registered` were answered.

A refusal carries `error`, with `code` and `message`, at the top: a writing
verb beside `status: "error"` in its own shape (below); any other verb as
`{"error": {"code", "message"}}`. A verb that reports what it found, such as
`brain validate` or `doctor`, answers its report with exit 1 and no `error`.

## Writing verbs

`page save`, `update`, `supersede`, `forget`, `confirm`, `retire`, `rename`,
`move`, `link`, `promote` and `evolve <path>` answer one shape, with `status`
`done`, `similar`, `namespace` or `error`:

```json
{
  "status": "done",
  "brain": "acme",
  "path": "knowledge/acme/decisions/postgres-over-mysql.md",
  "commit": "3f9c2ab",
  "publication": "pushed",
  "id": "01J9QZ3M7X8K2V5B6N4P0R1S2T",
  "title": "Postgres over MySQL",
  "kind": "knowledge",
  "subkind": "decision",
  "namespace": "acme",
  "warnings": [{ "path": "…", "warning": "summary-missing", "message": "…" }]
}
```

- `done`: `status`, `brain`, `path`, `commit`, `publication`, `id`, `title`,
  `kind`, `subkind`, `namespace` and `warnings`.
- `publication`: `pushed`, `pending` (`sync` retries it) or `local` (no
  remote). `title`, `kind` and `subkind` are the page's after the write, or
  before `forget`.
- `similar`: `path`, `commit` and `publication` are null, and `similar` lists
  the pages found, each with `brain`, `path`, `title`, `kind`, `subkind`,
  `summary` and `touched`.
- `namespace`: nothing written; `namespaces`, each with `namespace`, `summary`
  (or null), `pages` and `below`.
- `error`: `error` holds `code`, `message` and, when the validator refused the
  page, `findings`. A `conflict` adds `error.conflict`: `branch`, `pages` and
  `commits`. An error after a commit exists, a `promote` whose original could
  not be retired or a commit set aside on publishing, still carries that
  `commit` and its `brain` (spec §1.6).

What some verbs add: `save` and `update`, `instinct` and `candidate` for an
instinct; `supersede`, `supersedes`; `forget` and `retire`, `linkedFrom`, the
pages that link to it; `rename` and `move`, `from` and `relinked` (and `move`,
`namespace`); `link`, `to`; `promote`, `promotedFrom` (`brain`, `path`,
`action`); `evolve <path>`, `instinct` and, for a Rule or a playbook,
`evolvedAs`. `evolve` with no path answers `candidates`, each with `brain`,
`path`, `title`, `occasions` and `when`.

## Machine

**`kioku --version`**: `version`, `contract`, the number of this JSON, and
`formats`, the brain formats the tool reads.

**`kioku setup`**: `configuration` (`created`, `nothing`), `personal`, `forwarded` and `refreshed`, as `kioku update` answers them, with `refreshError` when the refresh failed, `origin` (`installer`, `homebrew`, `other`: how the tool was installed; under Homebrew there is no `shellPath` and no `completion`, the formula's), `launcher` (`path`, `present`, `onPath`), `shellPath` when the
`PATH` step ran (`action`: `linked`, `profile`, `unavailable`; `target`,
`files`, `skipped`, `line`), `completion` (`shell`, `action`: `written`,
`present`, `unavailable`; `files`), `model` (`action`: `fetching` with `mb`,
`ready`, `pending`, `failed`, `full-text`, `unavailable`; `detail`) and
`agents`, each with `host`, `name`, `found` and `added`.

**`kioku doctor`**: `part` (`kioku`), `version`, `contract`, `ok` and `checks`,
each with `name`, `state` (`ok`, `warn`, `missing`), `detail` and, when there
is something to do, `fix`.

**`kioku update`**: `status` (`updated`, `current`, `available`, `managed`),
`version`, `latest` (when the latest release is behind the one running), `was`,
`installed`, `pruned`, `refreshed` (what `brain refresh --all` answered),
`forwarded` (what the version installed brought forward: `rewrote`, the
configuration 0.1.0 wrote; `moved` and `kept`, the brains moved to their folder
or left where they were and why; `raised`, the personal brain raised to the
newest format; `behind`, the shared brains of an older format), `finishError`
and `dryRun`; `managed` answers `origin` (`homebrew`, `other`)
and `command`.

**`kioku plugin <host> install`** and **`uninstall`**: `host`, `status`
(`done`, `unchanged`, `planned`, `cancelled`), `commands` and `dryRun`.

**`kioku config`**: `keys`, each with `key`, `value`, `default`, `source`
(`file`, `default`), `editable`, `allowed` and, for a key with no default,
`whenAbsent`; `get`, `set` and `unset` answer one such object.

**`kioku help`**, and a group alone (`kioku brain`): `verbs`, each with `verb`,
`usage` and `does`; every verb for the overview, the group's for a group.

## Project folders and brains

**`kioku init`**: `file`, `inRepository`, `wrote`, `brain` and `team` when the
file names them, `brought` when it cloned the brain from the address given (as
`brain clone` answers it), `cloned` (what cloning the chain did, as `sync`'s
`outcomes`), `created` (each brain made, as `brain create` answers it),
`addressed` (the brains whose address it wrote, published since), `notHere`
(the brains the file names by name alone that this machine does not have) and
`chain`.

**`kioku sync`** and **`kioku brain sync`**: `busy`, `outcomes` (`key`,
`tier`, `path`, `status`: `pulled`, `pushed`, `up-to-date`, `no-remote`,
`failed`, `conflict`; `message`) and `index`.

**`kioku brain create`**: `action` (`created`), `brain`, `tier`, `path`,
`commit`, `publication` (`local`), and `language` when one was given.

**`kioku brain clone`**: `brain`, `tier`, `path`, `action` (`cloned`) and
`url`, the address it was cloned from.

**`kioku brain publish`**: `brain`, `status` (`pushed`, `connected`, `exists`),
`remote`.

**`kioku brain remove`**: `brain`, `folder`, `removed` (`folder`), `personal`,
`team`, `published`, `remote` when it had one, `dryRun`.

**`kioku brain list`**: `brains`, each with `key`, `folder`, `onDisk`,
`personal`, and `tier`, `format` and `remote` when they are known; `chain`, each link with `tier`, `key`, `folder` and `onDisk`,
and the team's with `from` (`folder`, `machine`); `inside`; `notLoaded` (`tier`, `key`); `untrusted`
(`tier`, `key`, and `address` when the folder gives one this machine does not know for it).

**`kioku brain path`**: `brain` (its key) and `path`.

**`kioku brain validate`**: `ok`, `errors`, `warnings`, `brains`.

**`kioku brain lint`**: `brains`, each with `brain`, `count`, `totals` (the
length of each list that was cut) and its lists: `similar`, `staleInstincts`,
`superseded`, `brokenLinks`, `missingSummary`, `skillCandidates`, `expired`,
`unconfirmed`, `retiredLinks`, `contradictions`, `conflicts`, `undescribed`
and `unopened` (each with `since`, `days`, `surfaced`), and `counting_since`.

**`kioku brain log`**: `since`, `writes`, each with `verb`, `title`, `brain`,
`path`, `date`, `author`, `via` and `commit`; and `total`, `offset`, `limit`,
`next`.

**`kioku brain stats`**: `since` and `brains`, each with `brain`, `writes`,
`by_verb`, `by_via` (per `via` and `unknown`: `writes`, `saved`, `reverted`,
`revert_rate`), `saved`, `reverted`, `revert_rate` (null when nothing was
saved), `confirmed`, `opened`, `unopened` and `counting_since`.

**`kioku brain sources`**: one entry per source, with `brain`, `source`,
`count`, `last`, `version` and `versions`; with a source, `pages`, each with
its `source_version`.

**`kioku brain upgrade`**: `brain`, `from` and `to`, the formats before and
after, and, when it raised the brain, `commit` and `published` (`pushed`,
`pending`, `local`).

**`kioku brain refresh`**: `brains`, each with `brain`, `path`, `written`,
`commit`, `publication` and, when left, `left` (`newer`, `build`) and
`held`.

**`kioku brain language`**: `brain`, `language`, `commit`, `publication`.

**`kioku brain conflicts`**: `brains`, each with `brain` and `conflicts`,
each with `branch`, `date`, `commits` (`sha`, `message`), `pages` and, when
opened, `worktree`. `--branch` answers `brain`, `branch` and `pages`, each with
`page`, `base`, `mine` and `theirs`.

**`kioku namespace list`**: `brains`, each with `brain`, `tier` and
`namespaces` (`namespace`, `depth`, `pages` by kind, `total`, `below`), as a
tree.

**`kioku namespace add`** and **`describe`**: `status`, `brain`, `namespace`,
`commit` and `publication`.
**`rename`**: `status` (`done`, `dry-run`), `brain`, `from`, `to`, `moved`
(`{from, to}` per file), `rewritten`, and `commit` and
`publication` when written.

## Pages, reading

**`kioku page search`**: `mode` (`hybrid`, `full-text`), `reason` when
full text alone, `limit`, `more`, and `hits`, each with `brain`, `path`, `id`,
`title`, `kind`, `subkind`, `namespace`, `summary`, `snippet`, `created`,
`touched` and, with `--include-retired`, `status` (`deprecated`, `superseded`).

**`kioku page list`**: `pages`, `total`, `offset`, `limit` and `next`. A page
has `brain`, `path`, `id`, `kind`, `subkind`, `namespace`, `title`, `summary`,
`aliases`, `created`, `source`, `source_version`, `evidence`, `stale_after`,
`supersedes`, `superseded_by`, `status`, `verified`, `touched`, `occasions`
(an instinct's), `change` (`added`, `changed`, or null), `links`, `linkedFrom`
and `relations` (`type`, `path`).

**`kioku page show`**: the page's fields, `body` and `history`, each entry
with `commit`, `date`, `author` and `message`; a slice adds `slice`
(`outline`, `truncated`).

## The session's journal

The file the plugin's hooks write and the mod reads (spec §4.6), one JSON
line per entry: `at`, `turn`, `what` (`summary`, `recalled`, `skill`, `opened`,
`searched`, `listed`, `log`, `stats`, `lint`, `saved`, `instinct`, `updated`,
`instinct again`, `replaced`, `forgot`, `retired`, `confirmed`, `renamed`,
`moved`, `linked`, `promoted`, `evolved`), `arrow` (`read`, `write`), `brain`
(comma-separated for a search, a recall, a list or the summary) and `label`, the brain
as the person is shown it, one per name in `brain`; for a page, `path`,
`title`, `kind` and `subkind`; for a search, `words`, `count` and `hits`, each
with `brain`, `path` and `title`; for what a prompt recalled (spec §4.7), `count`
and `hits`, and never the prompt; for a list or the summary, `count` and, for
a window of a list, `total`; `candidate` on an instinct seen again that is now
a candidate, `became` on `evolved` (`skill`, `rule`, `playbook`), `source` on
`summary` (why it loaded) and `call`, the id the host gave the shell call that
made the entry.
