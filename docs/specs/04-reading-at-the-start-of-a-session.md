# 4. Sessions and search

## 4.1 The summary

A `SessionStart` hook injects a summary of the chain, once per session, with no
model call: it only reads files. It takes the host's cap, 10,000 characters,
and nothing lowers it; while Kioku is on, every session has it. After an
opening that is never cut, the tool adds, in this order, until the cap:

1. the project brain's `BRAIN.md`, trimmed; inside a brain (§2.7), that
   brain's;
2. the pages each namespace's `INDEX.md` names under `## Load first`, one line
   each, five at most a namespace;
3. the Rules of the three brains, whole;
4. the Skills of the three brains, one line each, under a line telling the
   agent to read a Skill with `kioku page show` before a task it fits;
5. the current decisions of the project brain, one line each, newest first,
   those that name what the session is about (the repository's folder, the
   project brain's repository) before the rest;
6. the instincts with evidence in the last 90 days, personal then project, the
   relevant ones first within a brain;
7. what is new in the shared brains since this machine's last session that
   showed it, ten a brain at most, newest first, with how many more and the
   command that lists them; news the cap cut waits for the next session;
8. how many things `brain lint` (§4.4) has to review, per brain;
9. a last line: how many pages the brains hold and that search finds them.

Retired and superseded pages (§3.5) are never in it, nor Memories that are
facts and lessons, which are one search away.

**The opening** says that on conflict the most specific brain wins; that the
agent loads the skill (§6.2) before it reads or writes memory; that it reads a
brain only through `kioku page search` and `show`, never through its files,
since only `show` counts a page as opened (§4.5); and, in a few lines, when to
save (§1.1): the two tests, the moments that usually pass them, that at such a
moment it loads the skill and saves without asking, and that secrets are never
saved, nor personal remarks to a shared brain. Then it lists the brains, saying
for one that declares a `language` (§3.2) that its pages are written in it, and
for the machine configuration's `team` (§2.5) that it is the machine's, the
folder naming none, and under each its namespaces, one line each, indented by
depth: the path, its description cut short, and how many pages it holds, with
how many more its namespaces below hold (§3.2); then that `save` takes
`--namespace <path>` and a new namespace is made with `kioku namespace add`,
which the person confirms. When the namespaces do not fit, descriptions are cut
first, then the deepest levels; the first level is never left out. Inside a
brain (§2.7) the list holds that brain alone, and under it a line for the
personal brain and one for the machine's team: its tier, that it is in the
chain but not loaded, and that the session was opened inside the brain; with it
the line that says what the person says about themselves is not saved in this
session (§1.3). A brain not loaded has nothing in the summary and is not
counted in it.

The hook also tells the person which brains the summary loaded and how many
pages they hold (§1.2), and, inside a brain, by tier, which brains of the chain
are not loaded; a session with no summary gets no such line.

## 4.2 Sync

`sync` pulls every brain in the chain, pushes what is pending, clones a brain
the chain needs that is not on the machine, and reindexes what changed. The
`SessionStart` hook starts it in the background, `kioku sync --cwd <dir>
--background`, and does not wait: this session's summary uses what is on disk,
the next has the latest, and the summary says which brains are being cloned.

One `sync` runs on a machine at a time. A `sync` that finds another running
leaves its folder for that one, which syncs that folder's chain too before it
ends; a folder left when the other had already ended is taken by the next
`sync`. `kioku sync` by hand syncs the chain of the folder it runs in;
`kioku brain sync <brain>`, or `--all`, pulls and pushes a brain, or every
brain of the machine, and reindexes them for full text, leaving meaning to the
next `sync`. With `--background`, a failed fetch of the search model (§4.3) is
tried again after six hours; by hand it is tried at once, as a step that names
its size. Commits of this machine that cannot go on top of what others
published are kept on a branch, and the brain is `conflict` (§1.6).

## 4.3 Search

The tool keeps a derived index over the chain, in two parts. **Full text**:
title, aliases, summary and body, case and diacritics folded, prefixes
matching, a match in the title or aliases worth more than one in the body;
several words must all match, and when no page has them all, the pages with
some of the significant ones (stopwords left out) come instead. **Meaning**:
one vector per page over title, summary, aliases and body without the
Changelog, computed on the machine by one multilingual model the tool pins,
each of its files checked against a pinned checksum. The model is fetched once
per machine (about 250 MB), by `sync` only: `kioku setup` starts that first
`sync` in the background (`--no-model` keeps search full text), and the
`SessionStart` hook starts one while the model is missing; nothing is
downloaded by a hook itself, by `save`, by `search`, or by `setup` in the
foreground. `setup` says once that the model is being fetched; `doctor` says
while a `sync` fetches it; a failed fetch is recorded, and `doctor` and
`search` say why. `search.mode` is `hybrid`, the default, or `full-text`,
which downloads nothing, embeds nothing and says so; a model already on the
machine is kept.

`kioku page search` combines full text and meaning whenever the index of
meaning exists, ordering the pages by how much of the query each holds in
words and in meaning; a title holding every word of the query stays among the
first three. A search embeds the few pages changed since the last `sync`
itself; until the model is on the machine, or while more pages wait, it
answers with full text alone and says why; with `--json` it answers
`{mode, reason, hits}`. A retired or superseded page is a hit only with
`--include-retired`, and its hit carries `status`, `deprecated` or
`superseded`. `doctor` reports the same, and how many pages are indexed by
meaning. Indexing a whole brain never runs inside a hook. The similar pages of
`save` (§1.4) come from full text alone: a page whose title holds every word
of the new title first, then by the share of the new page's words each holds;
`save` never loads the model. The index is disposable: rebuilt when missing,
out of date, or when the model's pin changes.

## 4.4 Maintenance

`kioku brain lint` reports, per brain, without changing anything and without a
model:

- pairs of similar pages that do not already link to each other (a link says
  the relation was judged, §3.3);
- instincts with no new evidence for six months, except those evolved into a
  Skill; and the Skill candidates (§3.6);
- superseded decisions, links whose target is gone, pages missing a `summary`,
  current pages that link to a retired page;
- contradictions nobody has settled;
- changes of this machine kept aside after a conflict (§1.6);
- pages past their `stale_after` date (§3.3), and pages nobody has changed or
  confirmed for longer than their kind lasts: nine months for context, a year
  for a playbook, a Rule, a Skill or a Memory, the same in every brain;
  decisions and instincts are left out;
- the pages this machine has not opened (§4.5), saying since when it counts;
- in a brain with more than one namespace, the namespaces not described
  (§3.2).

Each list shows its first 20 entries and says how many there are (§6.1).
`sync` refreshes the report and the summary carries its count (§4.1). The
action happens in conversation, with the verbs of §6.1, when the person asks:
linking a pair, forgetting a page or a stale instinct, evolving a candidate,
confirming a page that is still true or retiring one that is not.

## 4.5 What is opened

This machine keeps a count, per page, of two things, never added up:

- **opened**: `kioku page show` read the page, whole or a part of it
  (`--section`, `--outline`, `--head`), by the agent or by the person. It is
  the only way to the page's text.
- **surfaced**: the page was offered in a line of the session summary (§4.1:
  the pages to read first, the Skills, the decisions and the instincts). A
  Rule is whole in every summary and is not counted. A search result is not
  counted either.

One entry per page, by brain and `id`, so a rename keeps it: how many times it
was opened and surfaced and the day of the last of each; and the day the
machine began to count, `counting_since`. It lives with the machine's state
(§2.5), never in a brain or in git, holds no text and no prompt, and is not
shared; `sync` drops the entries of pages no brain holds. A page is
**unopened** when it has not been opened and sixty days have passed since the
later of its last change and `counting_since`. Rules, retired and superseded
pages are not asked. `brain stats` (§6.1) gives each brain's numbers and
`brain lint` (§4.4) lists the pages, to retire or forget like any other
finding. The count is always on. Reading never changes a brain: the only thing
it changes is this count.

## 4.6 What a session did

Every time a session reaches the memory is one entry of **the session's
journal**, in order. The footer counts it (§1.2). The plugin's hooks write it
(§6.2), since they know the session's id and the tool does not. **Every entry
is a read or a write:**

| Entry | What made it | |
|---|---|---|
| `summary` | the session summary (§4.1), with the brains it loaded, how many pages they hold, and why: the session started, was resumed or was compacted | read |
| `skill` | the agent loading Kioku's own skill | read |
| `opened` | `page show`, one per page | read |
| `searched` | `page search` | read |
| `listed` | `page list`, how many pages it answered and, for a window of more, how many there are | read |
| `log`, `stats`, `lint` | `brain log`, `brain stats`, `brain lint` | read |
| `saved` | `page save`; `instinct` when it saved an instinct | write |
| `updated` | `page update`; `instinct again` when it adds an occasion to an instinct (`--evidence`), with whether the instinct is a candidate for a Skill (§3.6) | write |
| `replaced`, `forgot`, `retired`, `confirmed`, `renamed`, `moved`, `linked`, `promoted` | `page supersede`, `forget`, `retire`, `confirm`, `rename`, `move`, `link`, `promote` | write |
| `evolved` | `page evolve`, with what the instinct became: a Skill, a Rule or a playbook | write |

Reading a Skill is `opened`, like any page. Only a result the tool gave makes
an entry: a refusal, a `similar` answer or one that asks for a namespace makes
none. An entry records when, what it is, the turn (which each prompt moves on,
as does a session resumed or compacted) and the brain or brains reached, each
also as §1.2 names it to the person, so that the mod names brains as the hooks
do; a page's path, title, kind and subkind; a search's words, how many results
and the pages the answer brought, in order, each by brain, path and title; how
many pages a list or a summary holds; and the id the host gave the shell call
that made it, so the mod can draw its rows (§1.2). Never a page's text, never
a prompt. The journal lives with the machine's state (§2.5), one file per
session, never in a brain or in git, dropped two days after its last entry. A
command run in a terminal makes no entry.
