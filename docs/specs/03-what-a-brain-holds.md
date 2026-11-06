# 3. What a brain holds

## 3.1 Kinds and folders

Four kinds, each a folder at the root of the brain and a template the
validator checks.

| Kind | Holds | Written by |
|---|---|---|
| Memory | what was learned: a lesson or a fact, one per file; and **instincts**, learned conditionals "when X, do Y" with the occasions that support them | the agent, from experience |
| Knowledge | what is true of the project or team, for people: decisions (what and why), playbooks (how something is done here), context (people, clients, glossary, agreements, where things are) | the agent or a person |
| Rule | how the agent must work in this brain; always on | mostly people |
| Skill | a repeatable technique the agent runs on its own when it applies | the agent, by evolving instincts (§3.6), or a person |

```text
<brain>/
├── BRAIN.md                     front page: what this brain is, repositories, owners
├── AGENTS.md                    for an agent opened in this folder (§2.7)
├── CLAUDE.md                    Claude Code's pointer: one line importing AGENTS.md (§2.7)
├── .claude/commands/ingest.md   /ingest for Claude Code, offered only in this folder (§1.7)
├── kioku.yaml                   format, name, tier, namespaces, language (§2.5)
├── knowledge/<namespace>/       INDEX.md, decisions/, playbooks/, context/ (§3.2)
├── memory/                      lessons and facts
│   └── instincts/               learned conditionals with evidence
├── rules/
└── skills/
```

The person's own profile, who they are and how they work, is a context page of
the personal brain. No page waits in an inbox: it is in the brain or it is not.

A brain is files inside its folder. The tool reads none through a symbolic
link, nor at a path that leaves the folder: a page, `BRAIN.md`, an `INDEX.md`
or `kioku.yaml` that is a link, or under one, is read as missing, so a brain
cannot put a file of the machine's into the agent's context; the validator
names every link (§5.1 rule 12).

## 3.2 Namespaces

`knowledge/` is split by namespace. Every page belongs to one; the other kinds
stay at the root and carry their namespace in front matter. **A brain starts
with none**: `kioku brain create` writes `kioku.yaml` with `namespaces: []`,
`BRAIN.md` and the files the tool owns, and each namespace, the first included,
is made when there is something to put in it. **A namespace is a path**,
written with `/` as the folder is: `payments`, `payments/billing`,
`payments/billing/invoices`, at most three deep. A knowledge page's folder is
`knowledge/<namespace>/<decisions|playbooks|context>/…`: the namespace is what
lies between `knowledge/` and the first of those three names, which are
therefore reserved. A page may live in a namespace that has others under it; a
namespace's parent is a namespace of the brain too; and subfolders under one
of the three folders are the person's and do not change the namespace.

**What a namespace is**: an area of work with its own vocabulary and people
(payments, onboarding, a client), not a kind of document, a date or a person.
It is **described** by the first paragraph under the heading of its
`knowledge/<namespace>/INDEX.md`, which is optional and the person's: nothing
moves or makes one when the tool is updated. One whose paragraph is missing,
or is the generic one the tool writes, is not described, and `brain lint` says
so when the brain has more than one (§4.4). The `INDEX.md` may also hold
`## Load first`, links to at most five pages to read before working in the
namespace, which the summary lists (§4.1). Nothing is inherited: each
namespace has its own description and its own `## Load first`.

**Making and moving.** `kioku namespace add <path> --summary "…"` declares a
namespace in `kioku.yaml` and writes its `INDEX.md`, in one commit; its parent
must exist. `kioku namespace describe` changes its description;
`kioku namespace rename <from> <to>` gives it another path, parent included,
and takes everything under it along. `kioku page move` gives a page another
namespace: a knowledge page's file moves, its `id` stays and the links follow.

**Choosing.** The agent chooses a page's namespace by the descriptions, the
deepest that fits; a namespace that fits needs no one's yes. When a brain has
more than one and `save` is not told which, it writes nothing and answers with
the namespaces and what each says (§6.1); in a brain with none, it answers
`namespace_none` with the command that makes the first. The agent makes one,
named for the area and described, when the brain has none, when the person
names an area that has none, or when what it is about to save fits no
description and the namespace it would go to holds about fifty pages; a single
page on a passing subject does not make one. **The person confirms each one
before it is made**: the host asks them, with the path and the description,
before the verb runs (§6.2); on a no the agent uses a namespace that exists,
or asks where.

**Names.** Each segment is a folder's name: letters, digits, dots, dashes and
underscores, starting with a letter or a digit. Reserved, in any case:
`decisions`, `playbooks`, `context`, `instincts`, `memory`, `rules`, `skills`,
`knowledge` and `index`. `namespace add` and `namespace rename` refuse a name
that is not this, is reserved, or is more than three deep; the validator
(§5.1) refuses only what cannot be a folder and warns of the rest.

**The format.** A brain is `format: 2`: namespaces as paths, a `language`, and
its `name` in `kioku.yaml` (§2.2). `format: 1`, what 0.1.0 made, is the same
without a name. The counter moves only when an older tool would misread the
files (§5.1 rule 10); a key an older tool can ignore never raises it; nothing
lowers it, `kioku brain refresh` never changes it, and a brain any released
version wrote stays readable and writable by every later one.

**A raise is one commit, by `kioku brain upgrade <brain>`**, which says the
format before and after, and pushes in a brain with a remote. From `format: 1`
it writes the name the brain had on this machine, its repository's owner and
name (`github.com/sam/brain` is `sam/brain`), and moves the brain to its folder
under that name (§2.5) when it was elsewhere. Until then the tool reads and
writes a brain of an older format as it is, with that name; one cloned from an
address, on a machine that never had it, has the name of the last two segments
of the address's path, `https://github.com/northwind/app-brain.git` is
`northwind/app-brain`, which is the name the link must say. **The version that
brings a newer format raises the person's own brain by itself** when it
brings the machine forward (§6.4): in `kioku update`, in `kioku setup` (§6.3),
or in the `sync` of the first session that runs it, and says so; it never raises a project or team
brain, whose teammates on an older version could then no longer write to it
(§5.1): `kioku brain upgrade` does, in a terminal, when the person says, and
until then `doctor` and the session say it can be raised (`format-behind`,
§1.2).

**The language.** A brain may declare, in `kioku.yaml`, the one language its
pages are written in, `language`, a short tag such as `en` or `es`, with
`kioku brain language` or when it is made. It is a convention: the validator
does not read a page's language, and search by meaning (§4.3) still finds a
page in another. The summary tells the agent to write in it (§4.1); quotes in
`evidence` stay in the person's words.

## 3.3 File format

Every file is Markdown with YAML front matter. **Links between files are
relative Markdown links**; a file is referred to by its path inside the brain.
Every file carries an **`id`**, generated by the tool when the page is created
and never changed: the stable key for the index, for interfaces, and for
repairing links, never shown to the agent, which neither mentions nor uses it.

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `memory`, `knowledge`, `rule`, `skill` |
| `id` | yes | generated by the tool (a ULID); unique in the brain; immutable |
| `namespace` | yes | the namespace the file belongs to, declared in `kioku.yaml` |
| `title` | yes | one line |
| `created` | yes | date |
| `summary` | no | one line; what the session summary shows |
| `aliases` | no | other names the thing is known by; weighted in search |
| `source` | yes | where it comes from: `Session 2026-10-07 in acme`, a path, a URL |
| `source_version` | no | the version of the source the page was written from: a commit sha, a date or a hash, one line; `kioku brain sources` reads it |
| `evidence` | when a person said it | a short quote, chosen under §1.5 |
| `stale_after` | no | a date, `YYYY-MM-DD`, after which the page needs a second look; `brain lint` lists the page from that day |
| `status` | no | `deprecated` when the page was retired: kept as history, not current; absent means current |
| `verified` | no | written by the tool: a list of one entry, `by` (`human:<name>`, the name the person goes by, §2.3: the name git on the machine knows, else the system user) and `at` (an ISO 8601 moment in UTC), when a person confirmed the page is still true |
| `supersedes` | decisions only, optional | relative link to the decision this one replaces (`./old.md`); a brain-relative path is also accepted |
| `superseded_by` | decisions only, written by the tool | relative link to the decision that replaced this one |

There is no `state`, `confidence` or `approved_by`. Knowledge, Rule and Skill
pages carry a `## Changelog` the tool appends to on every update, one line per
change, `- YYYY-MM-DD <what changed>`. A Memory is corrected in place; an
instinct keeps its record in `## Evidence`, one line per occasion,
`- YYYY-MM-DD: <what happened> (<source>)`, starting with one.

Any page may end with `## See also`: one relative link per line, with the
title of the page it points at. The tool writes it: `save --create` lists the
similar pages it returned and the agent chose not to update, all of them unless
`--see-also` narrows the list; `kioku page link` joins two pages, in both
directions; `update --section` removes a link like any section. A link with
nothing after it says the pages are related; a word in brackets after it says
how they stand, `(contradicts)`, or `(qualifies)` on the page that narrows the
other and `(qualified by)` on the one narrowed, which `page link --type
contradicts|qualifies` writes on both sides. `brain lint` lists a contradiction
while both pages are current; retiring or superseding one, or removing the
link, settles it.

The date a page was last touched is not a field: the tool derives
**`touched`**, the date of the last commit that changed it, and shows it beside
`created` wherever it lists pages with `--json`: the hits of `page search`, the
similar pages of `page save`, `page list` and `page show`, which also answers
the page's **`history`**, the commits that changed it, newest first, each with
commit, day, author and message.

## 3.4 Each kind

| Kind | Folder | Extra fields | Required sections | Changelog |
|---|---|---|---|---|
| Memory | `memory/` | | What happened, Lesson, Rule of thumb | no |
| Memory, instinct | `memory/instincts/` | | When, Do, Evidence | no |
| Knowledge, decision | `knowledge/<ns>/decisions/` | `supersedes`, `superseded_by` | Decision, Why, Consequences | yes |
| Knowledge, playbook | `knowledge/<ns>/playbooks/` | | When, Steps | yes |
| Knowledge, context | `knowledge/<ns>/context/` | | free | yes |
| Rule | `rules/` | | Rule, Why | yes |
| Skill | `skills/` | | When to use, Steps | yes |

A **playbook** is followed by a person with the agent helping; a **Skill** is
run by the agent alone; a **Rule** is always on, a Skill is invoked when it
applies. An **instinct** has a playbook's shape (when, do) but is tentative
conduct the agent learned, supported by the occasions under Evidence; a
**Memory** without that shape is a lesson or a fact. Rules go whole into the
summary, so the validator warns past 600 characters.

## 3.5 Updating, superseding, forgetting

A fact or preference that changed is corrected on its page. A decision that
changed is not edited: a new decision supersedes it, and the old one stays as
history, listed as current by neither the summary nor the default search. A
page the person rejects is deleted with a commit; git keeps it. Every change is
a commit with the git identity of the person whose agent made it, with the
message `<verb>: <title>`; a supersede reads `supersede: <new> (replaces <old>)`.
Three things are said of a page without rewriting it:

- **Confirmed.** `kioku page confirm` records that the page is still true, who
  confirmed it and when (`verified`, and a Changelog line on the kinds that
  have one).
- **Retired.** `kioku page retire` marks a page that is not current and that no
  other page replaces (`status: deprecated`). It stays, so a link to it still
  arrives, and leaves the summary (§4.1) and the default search (§4.3), as a
  superseded decision does; `--include-retired` brings either back, marked,
  and `--undo` brings a retired page back. A retired page cannot be confirmed.
- **Renamed.** `kioku page rename` gives a page a new title and file name in
  one commit: the `id` stays, the old title becomes an alias, and every link
  in the brain to the old path, in a page's body, `supersedes`,
  `superseded_by`, an `INDEX.md` or the front page, points to the new one;
  links from outside the brain are not rewritten.

## 3.6 Instincts and Skills

When the agent notices a repeatable *how* ("when the tests touch the database,
run them serially"), it writes an **instinct**, not a Skill: when, do, and one
line of evidence. The next time, the search of §1.4 returns the instinct and
the agent adds a line of evidence instead of a second page. An instinct with
three or more occasions is a **candidate** for a Skill; a `save` or `update`
that leaves one so answers `candidate: true`, which the journal keeps (§4.6)
and the memory history shows (§1.2), and `brain lint` and `page evolve` list
the candidates.

Evolution turns an instinct into a Skill in the same brain, in one commit:
When becomes When to use, Do becomes Steps, the Skill takes the instinct's
`summary` and has the instinct's path as `source`, and the instinct gets a
dated Evidence line linking the Skill, which is not an occasion and ends its
candidacy. With `--to rule` it becomes a Rule, "when X, do Y" in one sentence
with its occasions as the Why, which must fit what a Rule may be; with
`--to playbook`, a playbook that takes When and puts Do as its first step. It
is a deliberate act: the person runs `/kioku-evolve`, which lists the
candidates and converts the ones they pick, or the agent runs
`kioku page evolve <path>` when asked, below the threshold too; the agent
never converts a candidate on its own. The summary lists the Skills of the
three brains with their `summary`, and the agent reads one when it applies,
before starting. A Skill is a page of the brain, not a skill of Claude Code's
own.
