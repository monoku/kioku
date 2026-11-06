# 1. How Kioku behaves

## 1.1 The agent saves on its own

While working, the agent decides what is worth keeping and writes it to a brain
the moment it notices, inside its own turn, with one call to the tool. The rule
is open, not a list of situations. Something is worth saving when both are
true:

1. **It will still be true in months.** Not a step of the current task, not a
   value that changes next week.
2. **Knowing it would change how the agent acts in a future session.** A
   preference, a correction, a decision, a way of working, a fact about the
   project that the code and the git history do not tell.

What usually passes: a correction and the approach the person confirmed
instead; a preference of tool, style or workflow; a decision and why; an error
and how it was resolved; context about the project, the client or the team that
is not in the repository; where to find things outside it. These guide which
kind the page gets (§3); they are not the gate. What never passes: anything
ephemeral, or redundant with the brains; anything the repository shows; the
progress of the task at hand; everything in §1.5.

When the person says something should be remembered ("remember this"), the
agent saves it regardless of the rule, in the most fitting kind, or as a Memory
with the person's words as the body.

## 1.2 What the person sees

The agent does not describe the save in its reply: no file name, no path, no
commit. The person sees a row in the conversation, at the call:
`⬢ kioku.md ↑ saved  Run migrations before the deploy (project)`. The plugin
draws it (§6.2) from the session's journal (§4.6), which the hooks write from
the tool's own result, so it appears only when a commit exists (§1.6) and never
comes from the agent's words. A read is drawn the same way; a brain's file
opened directly has no row.

A page is named by its path in its brain, then the brain in parentheses by its
tier, which says who sees it: `knowledge/billing/decisions/webhook-retries.md
(project)`. A brain that is not one of the session's is named by its tier and
its name, `(project · northwind/acme-brain)`; one whose tier cannot be read, by
its name alone; brains together are
`(project, personal)`, and the summary counts them by tier,
`personal 65 · project 79 · team 172`. Everything below names them this way.

### The rows

Where the host draws a call to `kioku` as a shell command, Kioku draws a row
of its own in place of the command and its result: what the call's journal
entries say (§4.6), one row per entry, so the conversation, the footer and the
history never disagree. Until the entry exists, a dim line with the command's
first words stands in for the whole command, a here-document's text included.
Rows have nothing to set, last the session and write nothing into a brain; the
hooks write no message for a call.

A row is one line: the brand, `⬢ kioku.md`; the arrow, `↓` for a read, `↑` for
a write, `−` for `forgot` and `retired`; the history's word for it; the page's
title and its brain, never cut. A search, a list or a report says what it
asked, how many pages it answered and its brains. A row whose answer holds more
has a button, `▸ expand`, which opens it and becomes `▾ collapse`; a press
costs the agent nothing. An open row lists what the answer holds, each line
with its name: for a page its fields (§6.1), its last touch and its commit with
its message; for a write its `file`, `brain`, `type`, `commit` and whether it
was `published` or is pending; for a search, every page the answer holds, with
its title, path and brain. It says nothing the answer does not carry; a list or
a report has no button. The same page opened or the same search made in a row
is one row, `× 3`. Kioku's own skill, loaded, is a row, `↓ loaded  Kioku
skill`, with no button.

A call that runs more than the tool is drawn all the same, and its first row,
open, says the other commands. A run of calls to `kioku` the host folds into
one line is drawn as its calls' rows, one under another; a run holding a call
that failed is unfolded, and one holding a call that is not `kioku`'s is folded
as the host folds it. Every other call is drawn as the host draws it: a command
that is not the tool's, and a `kioku` that made no entry. A `kioku` that failed
(`error` in its answer, whatever the shell says) is drawn by the host with its
here-documents cut to an ellipsis; the agent says the failure (§1.6). An answer
that asks before it writes, `similar` or `namespace`, is a dim line saying so,
and its answer is left out.

### What the hooks say

What no call made, the hooks say as a system message of the host: the summary,
the notices, what a prompt recalled (§4.7), and the question before a namespace
(§3.2). At a session's start
it begins on a line of its own, under the words the host puts before it. The
summary comes first, and the notices after it, a blank line between each. It is
one row, as the mod draws a call's: the brand, and on its line the
history's `summary` row in its words and its columns. The version of the tool
is not said there: only a newer one is (`update-available`).

```
⬢ kioku.md ↓ summary   session summary · 324 pages (personal, project, team)
```

A session resumed or compacted says why, `resumed` or `after /compact`, in
place of `session summary`.

What a prompt recalled (§4.7) is said the same way, under the person's message,
as one row: the history's `recalled` row on the brand's line. The pages are
the memory history's to list, where they open. A prompt that recalled nothing
says nothing.

```
⬢ kioku.md ↓ recalled  by meaning · 2 pages (project, personal)
```

`display.mute` in the machine configuration (§2.5) lists, by name, the notices
the person does not want; a muted notice is said neither in a session nor in a
verb's answer. `doctor` still reports what it finds, except the `unpublished`
warning, which the same name mutes. Only notices that remind or inform have a
name:

| Name | The notice |
|---|---|
| `not-set-up` | the machine has no configuration yet, with `kioku setup` (§6.3) |
| `update-available` | a newer version exists, with the version this machine runs and `kioku update`; only where the installer installed the tool (§6.4) |
| `brought-forward` | once, after a version first ran: what bringing the machine forward rewrote, raised and refreshed (§6.4); a step that failed is an error, never muted |
| `plugin-version` | the host's plugin and the tool are of different versions, once for each pair, with the command that brings them together (§6.2) |
| `cloning` | brains of the chain being cloned, ready next session (§4.2) |
| `untrusted` | a brain a repository names that this machine does not trust, with `kioku init` in the folder, or `kioku config set trust.owners +<host/owner>` for every brain of that owner (§2.4) |
| `publication-pending` | commits a write could not publish yet, retried (§1.6) |
| `index-building` | the search index being built for the first time (§4.3) |
| `no-personal-brain` | in a session: the machine has no personal brain, so nothing personal is saved; `setup` still says how to make or bring one (§2.3, §6.3) |
| `unpublished` | a brain with no remote lives only on this machine, with `kioku brain publish`: the weekly notice, `doctor`'s warning and the reminders after `setup`, `brain create`, `init` where it makes a brain, and `brain remove` (§2.3) |
| `link-without-address` | in a session: the folder's `kioku.yaml` names by name alone a brain that has a remote, so teammates cannot clone it, with `kioku init`, which writes its address (§2.4) |
| `format-behind` | a project or team brain of an older format than the tool writes, which teammates on an older version still write to, with `kioku brain upgrade <brain>` once they have updated (§3.2) |
| `brain-not-here` | in a session: the folder's `kioku.yaml` names by name alone a brain this machine does not have, so it is not loaded, with `kioku init <address>` once a teammate who has it gives its address (§2.4) |

The rest is never silenced: an error, changes kept aside after a conflict
(§1.6), a question the host asks (§3.2), the summary, what a prompt recalled and
the rows. A notice with
a name ends with the command that silences it,
`kioku config set display.mute +<name>`.

Every message has one shape: the brand, `⬢ kioku.md · `, then a level, nothing
for information, `⚠` when the person has something to do or something was not
loaded, `✕` when Kioku could not do its work; then the message, in lower case,
with no full stop, in the past for what has happened; under the headline, one
line per fact, each starting `  ⎿ `, the command whole on its own line, `run …`.
The summary and what a prompt recalled are rows, not notices: no level and no
headline, the history's row on the brand's line. In a terminal the message has colour; a host
that does not draw it shows the same words plainly. `display.color` decides
(§2.5): `auto`, the default, colours unless `NO_COLOR` is set or `TERM` is
`dumb`; `always` and `never` regardless.

### The footer

At the right end of the host's footer: `⬢ kioku.md ↓3 ↑2`, how many times this
session read the memory and wrote to it, every journal entry (§4.6) in one
arrow or the other: `↓` the summary (at the start, and when resumed or
compacted), Kioku's skill loaded, every page opened, search, list, `brain log`,
`stats` and `lint`; `↑` every write, an instinct seen again or evolved included.
Each makes a drop fall or rise in its arrow's cell, and the number moves on
when the drop ends. A narrow terminal drops the icon, then `.md`, then the
name, and keeps the counts. It has nothing to set, and Kioku writes nothing
into the host's settings for it.

### The memory history

`/kioku-history` opens a pane with the session's whole history, or shows it
again, and never closes it: the pane's own close and `Esc` do. It runs in the
middle of a turn too, nothing of the history is drawn before it runs, and the
pane starts closed in every session. The host places it, beside the
conversation or above the prompt; with the prompt empty it takes the keyboard.
One journal entry per line, newest first, under a separator per day and a group
per turn headed by the time of its first entry; a summary is a turn of its own.
An entry says its arrow and its word, as in the rows (`summary`, `loaded`,
`opened`, `found`, `listed`, `log`, `stats`, `lint`; `saved`, `instinct`,
`again`, `updated`, `replaced`, `evolved`, the other writes by name, `forgot`,
`retired`), then the page's title, path and brain; a search its words and how
many results, a list or a summary how many pages, each with its brains. When an
entry does not fit, its path is cut from the start, then its title; its brain
is never cut. Empty, the pane says so. It starts empty in the next session and
writes nothing.

### The page viewer

A pane shows one page of the memory, read only, placed as the history is; with
the prompt empty it takes the keyboard, and `Esc` closes it. It asks the tool
for the page (`kioku page show`), never reads a brain's files, and is not a read
of the session: the footer and the journal do not count it; the tool counts it
as opened (§4.5). A page opens by an `↗ open` at the end of the line that names
it: a history entry (not a forgotten page), the `file` line of an open row,
each page an open search lists; a history entry for a search that kept its
`hits` (§4.6) has `↗ results`, which lists those pages in the pane. The pane
has `✕ close`, and `←` when there is somewhere to go back to; then the page's
title, its brain, never cut, its path, cut from the start, and when it changed
(`touched`, §3.3); then the page as Markdown, a long page cut and saying so. A
page that cannot be opened says so in one line, and its pane still closes. A
page's links to pages of its brain, from its folder, open them in the pane; `←`
goes back one step, and a page opened from a list goes back to it. A link
outside the brain is the host's; where the host would open a link to a page as
a file, the pages it links to are buttons under it. A list has a line per page
with its title, path and brain, in the search's order; only its `↗ open` opens
the page. Each page and each list has its own tab, and the same one opened
again takes the tab it has; while the tool reads, the tab shows a wait. A
button (`↗ open`, `↗ results`, `✕ close`, `▸ expand`) is yellow text on a
terminal and the host's own button where it draws one. The panes start empty in
every session and write nothing into a brain.

### Searching the memory

`/kioku-search <words>` lists what `kioku page search <words>` finds, in a tab
of the viewer, so it finds what the agent would. It reads no brain's files and
is not a read of the session: the footer, the journal and the history do not
count it. It is drawn only when run. The list is the viewer's, with no text of
the pages: where the tool says there is more than it lists, the last row says
to narrow the words; where it answered by words alone, the first row says
`full-text only` and the reason; finding nothing, it says so. With no words the
tab has a field, and under it the session's searches with their counts, each
with `↗ results`, which shows that list again without asking the tool; when a
field is open the command shows it and makes no other, and a surface that draws
no field says to send `/kioku-search` with the words. Each search has its own
tab, and the same words take the tab they had. `/clear`, `/resume` and
`/branch` close the tabs and forget them.

### Afterwards

The person controls the memory **afterwards**, in the conversation: "what did
you save today?", "that's wrong, it is X", "forget that", "that belongs to
acme". The agent resolves each with the tool (§6.1); "how is the memory doing?"
it answers from `kioku brain stats`, as a signal, never as a verdict. The brain
stays an ordinary git repository anyone can open in an editor.
## 1.3 Which brain

The agent chooses by subject among the session's brains (§2.1):

| Subject | Brain |
|---|---|
| how this person works: preferences, corrections, their environment, their lessons | personal |
| this project: decisions, how things are done here, the client, the people, where things are | project |
| conventions that cross projects: how the team works | team |

**When in doubt, personal**: it affects nobody else. When the person moves
something to a more shared brain ("that goes to acme"), the agent promotes it:
`kioku page promote` writes a new page in the destination, in words fit for it,
through the same `save` as any other (similar pages, validator, publication),
and retires the original. **The destination is a brain of the session's chain**,
named by its tier, `project` or `team`, or by its name: the folder says which
project brain and which team brain are the session's (§2.4), so a page is
promoted from inside the project that uses the brain. A brain outside the chain
is refused, saying to open the session in the project folder that links it; a
personal brain is never a destination. A page is promoted up, by the tier each
brain says (personal, project, team), never down or across.

In a session opened inside a brain (§2.7), what the person says about
themselves is not saved to the brain in front of it, which others share (§1.5,
layer 2); the agent tells the person it was not kept and that a session opened
outside a brain saves it (§2.7).

## 1.4 Before writing: find what exists

A memory that exists is updated, not written twice. The agent knows what the
brains hold through the summary (§4.1) and search (§4.3), and the tool enforces
the habit: `kioku page save` looks for pages on the same subject (title,
aliases, text) in the target brain and, when it finds some, returns them
**instead of writing**. The agent then chooses:

- **update** the page when it is the same subject and the fact or procedure
  changed or grew (`kioku page update`);
- **supersede** when a decision changed: the new decision is written and the
  old one marked as replaced, each linking to the other (`kioku page
  supersede`);
- **create** when the pages found are related but not the same (`kioku page
  save --create`); the new page links to them under `## See also` (§3.3).

A save whose path exists is an error, never an overwrite.

## 1.5 What is never saved

Three layers, from the strictest:

1. **Never, in any brain**, enforced by the skill and by the validator's
   patterns on every kind: secrets (tokens, keys, passwords, connection
   strings), government identifiers, financial account numbers, criminal
   history, immigration status. Not even when the person asks.
2. **Never in a shared brain**, judged by the skill: personal remarks, opinions
   about colleagues or clients, the person's health or personal situation,
   anything the person said about themselves rather than the work. When in
   doubt, the personal brain or nowhere.
3. **Not on the agent's initiative, even in the personal brain**: health,
   religion, politics, sexual orientation, ethnicity and the like; saved only
   when the person asks.

`evidence`, the short quote that lets a person verify a page, is required when a
person said the thing and optional when the agent derived it from its own work,
where `source` is enough. The agent chooses the quote under the three layers.

## 1.6 Honesty

- The tool says "done" only when the commit exists. In a brain with a remote it
  says whether the push completed or is pending; `sync` retries a pending push
  at the next session start and the summary mentions it until it is out. An
  open row of a write says which.
- A write that fails after its commit exists says so: a `promote` whose
  original could not be retired or forgotten after the destination's commit,
  or a write whose commit was set aside when published (below), answers `error`
  with the reason and the `commit` and its `brain`, never `commit: null`, and
  the journal, the row and the footer count it as a write. A refusal happens
  before any file is written: the validator (§5.1) reads the pages a write is
  about to put in place, and a refused write leaves the brain's tree as it was.
- A write in a brain with a remote first brings in what others published, so
  it lands on their version. When changes of this machine still cannot go on
  top of it (made offline, or two writes crossed), nothing is lost and nothing
  blocks: every unpublished commit is kept on a branch
  `kioku/conflict-<commit>`, the pages say what the others wrote, and the brain
  keeps receiving. The write answers `error` with code `conflict`, the pages
  and the branch; the summary names the branch until it is resolved. The agent
  reads both versions with the person (`kioku brain conflicts`), writes what
  should stand with `update`, and resolves it. `brain lint` lists it (§4.4).
- A write that finds a page it writes changed since it read it, by another
  session's write or a `sync`, writes nothing and answers `error` with code
  `changed`; run again, it starts from the version there now. A write whose
  pages nothing changed is never refused.
- The agent reports a failed write in its reply, with the tool's reason, without
  the path. It never claims to have saved what the tool did not confirm, and
  never says it remembers what is not in a brain.
- What the person must see regardless of the agent (brains being cloned, an
  index being built, a pending publication, no personal brain) the hooks say
  at the session's start, as the notices of §1.2.
- Every commit says how the write arrived, in a trailer, `Kioku-Via: <value>`:
  the agent host's id (`claude-code`) when the agent wrote, `terminal` when a
  person did in a terminal, `kioku` for what the tool writes by itself
  (`brain refresh`), and `agent` for a write with no terminal that no host
  adapter recognises. The commit's author is the person's git identity whoever
  wrote; the trailer tells a page the agent deduced from one a person decided,
  as information, not authentication. `brain log` shows it and `brain stats`
  splits by it (§6.1).

## 1.7 Filling a brain from sources

A brain can be filled from what exists outside any session: documentation, a
wiki, a folder of documents, a mailbox, a PDF. The person asks **in a session
inside the brain** (§2.7), with `/ingest <path or URL>…`, which the brain
carries, so it exists in no other session and writes only to that brain. It
never happens on its own and nothing watches a source. The agent reads the
source with its host's means (files, images, PDFs, connected MCP servers); the
tool parses nothing and receives pages.

Ingesting is distilling, not copying. Each page passes §1.1: a long document
yields the few things that are durable and would change how the agent acts,
each with `source` pointing at it and `evidence` a short quote from it. §1.4
applies page by page. §1.5 weighs more here, mail and chat above all: what a
person wrote about themselves, about others, or in confidence does not reach a
shared brain, and secrets reach none. A decision record or a procedure becomes
a decision or a playbook; a source that says where things are becomes a context
page.

An ingest is proposed before it is written: the agent shows what it would
write, update or supersede, a line per page, and what it leaves out and why,
and writes what the person approves; the person may say once that this ingest
runs without asking. It ends with an account of the pages
written, updated or left alone and why; the rows appear as always. An ingest
first asks what the brain already took from the source, `kioku brain sources`
(§6.1), and stops when every page is at the version being read; another version
updates those pages instead of writing new ones. The version is written with
`--source-version`, one line the agent works out (a commit sha, a date, a hash);
the tool reads no source to check it.
