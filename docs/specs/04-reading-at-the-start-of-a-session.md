# 4. Sessions and search

## 4.1 The summary

The summary of the chain comes in two parts, each injected by a `SessionStart`
hook of its own, once per session, with no model call: they only read files.
The host caps what one hook injects at 10,000 characters, and past it keeps a
short preview and leaves the rest in a file the agent would have to open; so
each part takes that cap, is never past it, and nothing lowers it. While Kioku
is on, every session has both. The two hooks run at once and their parts reach
the agent in either order, so each opens with a heading that names it and
stands alone.

**How to use the memory.** After an opening that is never cut, the tool adds,
in this order, until the cap:

1. the project brain's `BRAIN.md`, trimmed; inside a brain (§2.7), that
   brain's;
2. the Rules of the three brains, each its title, its Rule and its Why, never
   its See also (a Rule written without those sections, its text up to the
   sections the tool keeps); when the cap cuts them, a last line says so and how to list
   them.

**What the memory holds.** After its heading, the tool adds, in this order,
until the cap:

1. the pages each namespace's `INDEX.md` names under `## Load first`, one line
   each, five at most a namespace;
2. the Skills of the three brains, one line each, under a line telling the
   agent to read a Skill with `kioku page show` before a task it fits;
3. the current decisions of the project brain, one line each, newest first,
   those that name what the session is about (the repository's folder, the
   project brain's name) before the rest;
4. the instincts with evidence in the last 90 days, personal then project, the
   relevant ones first within a brain;
5. what is new in the shared brains since this machine's last session that
   showed it, ten a brain at most, newest first, with how many more and the
   command that lists them; news the cap cut waits for the next session;
6. how many things `brain lint` (§4.4) has to review, per brain;
7. while the brains of the session hold fewer pages than a prompt's recall
   needs (§4.7), the Memories that are facts and lessons, one line each, the
   most specific brain first, the relevant ones first within a brain, then
   the newest: the first thing the cap cuts;
8. a last line, never cut: how many pages the brains hold, whether this part
   shows only some of them, that search finds them and, unless they were all
   listed, that Memories that are facts and lessons are found that way.

With no brain on the machine there is no second part; the first still says which
brains are being cloned or were not loaded, and with none of those either, there
is no summary. A session whose brains give the second part nothing but its last
lines still has it.

Retired and superseded pages (§3.5) are never in it. Memories that are facts
and lessons are one search away, and one prompt away once the brains hold
enough pages for a prompt to recall them (§4.7); until then no prompt brings
them, so the summary names them (item 7).

**The opening** says that on conflict the most specific brain wins; that the
agent loads the skill (§6.2) before it reads or writes memory; that it reads a
brain only through `kioku page search` and `show`, never through its files,
since only `show` counts a page as opened (§4.5); and, in a few lines, when to
save (§1.1): the two tests, the moments that usually pass them, that at such a
moment it loads the skill and saves without asking, and that secrets are never
saved, nor personal remarks to a shared brain; in a session just compacted, that
it saves now what the compaction's summary kept under `Not yet saved to Kioku`,
and any correction, preference or decision of the person's that summary holds
and no brain does (§1.1). Then it lists the brains, saying
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

**The second part's heading** names the brains it comes from, as the opening
lists them, and says that a page is read with `kioku page show`, never through
its files: an agent that reads it first knows what to do with its lines.

**A subagent** the session starts runs no session start and has none of the
conversation. A `SubagentStart` hook (§6.2) adds to its context, before its
first prompt and whatever its type, the Rules of the session's brains, as the
first part says them, under the same cap and with the same last line when it
cuts them: a Rule is always on (§3.4), for whoever works in the session. Before
them, a few lines never cut: that the Rules hold for it, that the most specific
brain wins, that the memory is read through the tool once the skill is loaded,
never through a brain's files, and that it saves nothing itself, saying in its
answer what is worth keeping, which the session that started it decides. Inside
a brain (§2.7), that brain's Rules alone. Nothing else of the summary, and
nothing at all where the brains hold no Rule. It is the session's summary said
again: no entry of the journal (§4.6), no count (§4.5), nothing said to the
person.

The first part's hook also tells the person which brains the summary loaded and
how many pages they hold (§1.2), and, inside a brain, by tier, which brains of
the chain are not loaded; a session with no summary gets no such line. It alone
writes the summary's entry in the journal (§4.6): the two parts are one read.

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
Changelog, and one for each of its parts, its summary and each section but the
Changelog, Evidence and See also, each under the page's title, so that a line
such as a lesson's rule of thumb is not lost in the rest of the page when
a prompt is recalled (§4.7); search ranks by the page's own; computed on the
machine by one multilingual model the tool pins,
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
  the relation was judged, §3.3); and, when the brains of a chain are linted
  together, the pages of one on the subject of a page in a more shared one,
  listed once, in the more specific brain, and left out of the count: a link
  cannot cross brains (§3.3), so nothing would settle it, and it is often
  meant;
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
- the pages this machine has not opened (§4.5), saying since when it counts,
  and those a recall keeps naming and no session opens, whose title and
  summary, all a recall shows of them, are to reword, or the page to retire;
- in a brain with more than one namespace, the namespaces not described
  (§3.2).

Each list shows its first 20 entries and says how many there are (§6.1).
`sync` refreshes the report and the summary carries its count (§4.1). The
action happens in conversation, with the verbs of §6.1, when the person asks:
linking a pair or merging it, forgetting a page or a stale instinct, evolving a candidate,
confirming a page that is still true or retiring one that is not.

## 4.5 What is opened

This machine keeps a count, per page, of two things, never added up:

- **opened**: `kioku page show` read the page, whole or a part of it
  (`--section`, `--outline`, `--head`), by the agent or by the person. It is
  the only way to the page's text.
- **surfaced**: the page was offered in a line of the session summary (§4.1:
  the pages to read first, the Skills, the decisions, the instincts and the
  Memories), or
  recalled at a prompt or at a file (§4.7). A Rule is whole in every summary and is not
  counted. A search result is not counted either.

One entry per page, by brain and `id`, so a rename keeps it: how many times it
was opened and surfaced and the day of the last of each; of the times it was
surfaced, how many were a recall's (**recalled**), and of those how many the
session that was given the page then opened (**followed**), once for each
recall however often it opens it; and the day the machine began to count,
`counting_since`. A recall is followed when `page show` reads the page in the
session it was named to, after it was named: the hook that writes the opening
into the journal (§4.6) finds the recall there. It is what tells a recall that
helped from one that did not, where the labelled set of §4.7 only tells what
the rule would do. It lives with the machine's state
(§2.5), never in a brain or in git, holds no text and no prompt, and is not
shared; `sync` drops the entries of pages no brain holds. A page is
**unopened** when it has not been opened and sixty days have passed since the
later of its last change and `counting_since`. Rules, retired and superseded
pages are not asked. A page is **unfollowed** when a recall named it five
times or more and no session opened it after. `brain stats` (§6.1) gives each
brain's numbers, how many times its pages were recalled and followed among
them, and `brain lint` (§4.4) lists the pages, to retire or forget like any
other finding. The count is always on. Reading never changes a brain: the only thing
it changes is this count.

## 4.6 What a session did

Every time a session reaches the memory is one entry of **the session's
journal**, in order. The footer counts it (§1.2). The plugin's hooks write it
(§6.2), since they know the session's id and the tool does not. **Every entry
is a read or a write:**

| Entry | What made it | |
|---|---|---|
| `summary` | the session summary (§4.1), with the brains it loaded, how many pages they hold, and why: the session started, was resumed or was compacted | read |
| `recalled` | the pages a prompt brought, or a file the agent read or changed (§4.7), each by brain, path, title and `id`, which the count of §4.5 is kept by, and that they were found by words or by path when they were | read |
| `skill` | the agent loading Kioku's own skill | read |
| `opened` | `page show`, one per page | read |
| `searched` | `page search` | read |
| `listed` | `page list`, how many pages it answered and, for a window of more, how many there are | read |
| `log`, `stats`, `lint` | `brain log`, `brain stats`, `brain lint` | read |
| `saved` | `page save`; `instinct` when it saved an instinct | write |
| `updated` | `page update`; `instinct again` when it adds an occasion to an instinct (`--evidence`), with whether the instinct is a candidate for a Skill (§3.6) | write |
| `replaced`, `forgot`, `retired`, `confirmed`, `renamed`, `moved`, `linked`, `promoted` | `page supersede`, `forget`, `retire`, `confirm`, `rename`, `move`, `link`, `promote` | write |
| `evolved` | `page evolve`, with what the instinct became: a Skill, a Rule or a playbook | write |
| `merged` | `page merge`, on the page that holds both, with the path of the one taken in | write |
| `restored` | `page restore` | write |

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
session, never in a brain or in git, dropped thirty days after its last entry,
so that a session resumed weeks later still has its history, its footer's
counts and what it was already given. A
command run in a terminal makes no entry.

## 4.7 At each prompt

The agent does not search for what it does not know the brains hold. So at each
prompt the person sends, a `UserPromptSubmit` hook looks for pages that bear on
it, by meaning or, where meaning cannot run, by the prompt's words, and, when
some stand out, adds them to the prompt's context: one line each, its title, its
summary, its brain and its path, under a line that says how they were found and
that a page is read with `kioku page show` before the agent relies on it. Never a page's text: the agent opens what it
needs.

A page **stands out** by how far its similarity to the prompt is above the mean
of every page of the session's brains, in standard deviations, taken twice, for
the page whole and for its part most similar to the prompt (§4.3), the better of
the two counting: 3 or more when its title or summary shares a significant word
with the prompt, compared by stem (`deploys` meets `deploying`), or 4 or more
alone; three at most, the furthest out first. The model scores every page close to every
prompt, so a similarity says little by itself, and a word in common is what
tells a page on the subject from one that only sounds like it. Among a few pages the measure says nothing, so
there is no recall while the brains hold fewer than 30 pages indexed by meaning:
the summary names them all while the cap allows (§4.1). These numbers are chosen, not derived:
`pnpm eval:recall` scores them on a labelled set of prompts against the demo,
and `pnpm eval:memory` what the agent does with them.

**By words.** Where meaning cannot run, the search model not on the machine yet,
`search.mode` kept to `full-text` (§4.3), or fewer than 30 pages with a vector
for their current text, the hook reads the index's pages alone, with no model: a
page stands out when its title, aliases and summary hold two or more significant
words of the prompt, compared by stem as above, that together weigh 1.5 or
more, and at least two thirds of what the heaviest page's weigh. A word weighs
by how few of the session's pages hold it: 1 when a single page does, nothing
when half of them do, so the project's name says little and `refund` much.
Three at most, the heaviest first, and none while the brains hold fewer than 30
pages, which the summary names (§4.1). Words find no page written in another
language than the prompt's, and fewer pages than meaning does: on the labelled
set, 13 of 20 where meaning finds 19. `pnpm eval:recall -- --words` scores these
numbers.

**By path.** What the person types often does not name what the agent is about
to touch: "fix the failing test" says nothing of the folder the lesson is
about. So a page of the project brain may say which files it is about
(`applies_to`, §3.3), and when the agent reads or changes a file one of its
globs matches, with the host's tools that read or change one file, a
`PreToolUse` hook names the page beside the tool's result: one line, as a
prompt's recall, under a line that says it was found by the file. The file is
taken relative to the project folder, the one whose `kioku.yaml` names the
brain; a file outside it matches nothing. Three pages at most a file, by path;
the hook decides nothing about the call, reads the index as it is, with no
model, and keeps the file's name nowhere. A page is named from the next time
the index is brought up to date, by a `sync`, a search or a save (§4.3). Where
no page of the machine's brains says which files it is about, the hook's
wrapper ends before it starts the tool, so every other machine pays nothing
for it.

Never recalled: a Rule, whole in every summary (§4.1); a retired or superseded
page (§3.5); a page this session already opened or was already recalled. Nothing
is recalled for a prompt that starts with `/`, one with fewer than three words,
inside a brain (§2.7), or on a machine with no index; the hook never fetches
the search model (§4.3), and never indexes: it never creates, rebuilds or writes
the index, so an index missing or of another version, after an update, waits
for the next `sync`, as does a page without a vector for its current text. The hook loads the model, where it is on the machine, which takes about half a second, and
gives up past a second, adding nothing, and its process ends with its answer. The prompt is read and kept nowhere.

What a prompt recalled is an entry of the journal (§4.6) and counts as surfaced
(§4.5); the hook says it to the person under their message, in the history's
`recalled` row (§1.2), which says `by meaning`, `by words` or `by path`, and
the memory history lists the pages, where they open. What a file recalled is
the same entry, said the same way, at the tool's call.

## 4.8 Where the last session left off

The progress of a task is never a page (§1.1): it is not true in months. But a
person who stops with work unfinished and opens a session some days later
finds an agent that knows the brains and nothing of what was going on. So a
place has one **handoff**, apart from every brain: what the agent leaves when
the person stops for now, with `kioku handoff set`, the text on stdin, in
place of the one there was. It says what was being done and why, what is done
and what is left, what comes next, what is not decided, and the files and
commands it takes to go on.

**A place is a folder and, in a repository, the branch checked out there.**
The folder is the nearest of the project folder, the one whose `kioku.yaml` a
session there reads (§2.4), and the top of the repository or of the worktree
the session is in; with neither, the folder itself. So a worktree has its own
handoff, being another folder; a folder that is no repository has one, with no
branch, asked nowhere and said nowhere; and one checkout that moves between
branches has one a branch, so that leaving a handoff on one never replaces
another's. A folder with no branch checked out is a place with none.

It is for the next session in the same place on the same machine, to go on
from where the last one stopped, and for nothing else. It is not a document to
hand to another person: when the person had a fuller one written, by whatever
means, the handoff says where that document is and does not copy it. It is the
short memory of a place, what holds until the work is done, where the brains
are the long one, what holds in months; nothing passes from it into a brain by
itself.

**The pages of the session.** A handoff also names the pages of the memory the
session that left it wrote and opened: eight at most, the ones it wrote before
the ones it only opened, the latest first, each by its brain, its path and its
title, never one it forgot, never a page's text. The agent does not write that
list and the tool that leaves the handoff cannot, since it does not know the
session: the plugin's hook after `kioku handoff set` (§6.2) takes it from the
session's journal (§4.6) and puts it on the handoff just left. So the next
session knows which pages that work leaned on, and reads one with `kioku page
show`. An agent host with no such hook leaves a handoff with no pages, and
any host reads one with `kioku handoff show`.

The handoff is machine state (§2.5), one file a folder, as a session's journal
is one a session, so that two sessions in two folders never write the same
one: never in a brain or in git, never synced, searched, recalled or counted,
no entry of the journal (§4.6) and no row. It
is 4,000 characters at most, and one that is empty, longer, or holds what is
never written down (§1.5, layer 1) is refused and leaves the one there was.
Nobody having written it for thirty days, it is neither shown nor kept; until
then its heading says the day it was left, and that it may be stale. The pages
it names were taken when it was left, so they do not depend on the session's
journal still being there (§4.6).
`kioku handoff show` says it whole, with the folder's handoffs on other
branches, each by its branch and its day, which is how the agent answers
"what were we doing here?"; `kioku handoff clear` drops it; both take another
branch of the folder with `--branch`.

A session that starts anew in the place, at its start or after `/clear`, is
given its handoff **by a `SessionStart` hook of its own**, beside the
summary's two (§4.1), so that it has that hook's whole cap, is given whole, and
takes nothing of the room of the Rules. Its part opens with a heading that
names it and stands alone, as the summary's do, and says what it is: a note
the agent left on that day, on this machine, for that branch, not memory, to
be checked against the repository before it is relied on. Then the text, its
headings pushed down as a page's are; the pages of the session, one line each;
and in one line the folder's handoffs on other branches. Where this branch has
none and another has, the session is told only that, with the branches and
their days, and that it asks the person before it goes on here when the work
they mean is that one. A session resumed or compacted is given none: it has
its conversation. On a machine that holds no handoff the hook's wrapper ends
before it starts the tool, and the tool asks git for the place only where
there is one to look for. The summary's opening tells every session when to
leave one, in a line that is the first thing a short cap leaves out. The agent
leaves it without asking, as it saves; nothing leaves one by itself.
