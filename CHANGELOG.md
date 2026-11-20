# Changelog

What changed in each version of Kioku. What is true now is in the
[spec](docs/specs/README.md); what shapes it, in
[How Kioku is designed](docs/explanation/design.md).

## Unreleased

- **A page says when the code it is about changed after it.** A page of a
  project brain that names files (`applies_to`) is now compared with the
  project folder's history: when those files have commits of a later day than
  the one the page was last changed or confirmed, `kioku brain lint` lists it
  under `outpaced`, with how many commits and the day of the last, and the
  page's `review` says so, before the other two reasons, in `kioku page show`,
  `kioku page list` and a search hit. When the agent reads or changes a file
  and a page is named for it, the line says whether that file changed after
  the page. It is read from git, with no model, by `sync` and by `brain lint`
  run in the project folder; what is not committed says nothing, and a folder
  that is no repository has no list. `kioku page confirm` or an update moves
  the page's day and ends the mark.

- **A page due a second look says so where it is used.** That a page is past
  its `stale_after` date, or that nobody has changed or confirmed it for longer
  than its kind lasts, was said only by `kioku brain lint`, which is read when
  someone asks. It is now said beside the page: `kioku page show`, `kioku page
  list` and each hit of `kioku page search` answer `review`, with why
  (`expired`, `unconfirmed`) and the day it counts from, and the line a recall
  names a page by, at a prompt or at a file, ends with it. Nothing is hidden or
  reordered, and `kioku page confirm` or an update ends the mark at once. At a
  recall, that a page is not confirmed is taken from the report the last `sync`
  recorded.

- **A brain keeps its memory pages by namespace: format 3.** Every lesson was
  in `memory/` and every instinct in `memory/instincts/`, whatever its
  namespace, which only its front matter said: one folder that grew with
  everything the agent saved. A memory page now lives in
  `memory/<namespace>/`, an instinct in `memory/<namespace>/instincts/`, as a
  knowledge page lives in `knowledge/<namespace>/`; Rules and Skills stay as
  they were. `kioku page move` and `kioku namespace rename` move memory pages
  with the rest. **Moving to it:** `kioku update` raises your personal brain by
  itself; a project or team brain is yours to raise with `kioku brain upgrade
  <brain>`, in a terminal, once your teammates have updated, since a version
  before this one reads a brain of format 3 and refuses to write to it
  (`format_newer`). The raise is one commit that moves the files: ids, fields
  and text stay, links follow, and a page keeps its last-touched day and its
  history. It refuses, touching nothing, while a memory page names no namespace
  of the brain (`memory_unplaced`), and lists them with the command that gives
  each one. Until a brain is raised the tool reads and writes it as it is. A
  memory page a teammate saved before the raise and published after is moved to
  its folder by `sync`.
- **A page keeps its history when it moves.** `touched` and `history` followed
  a page's path, so a page moved to another namespace, or whose namespace was
  renamed, looked written that day and lost what came before. They now follow
  the page across its moves.
- **Renaming a namespace to another depth keeps the links out of it.** A page
  moved from `payments/billing` to `billing` kept its links as written from the
  old depth, which then pointed nowhere and the rename was refused. They are
  written again from where the page now is.

## 0.6.5

- **A trusted owner covers only its own addresses.** With an owner in
  `trust.owners`, a project folder's `kioku.yaml` could give an address Kioku
  read as that owner's and git took elsewhere,
  `https://github.com/northwind/../other/brain.git` or
  `https://other.example?@github.com/northwind/brain.git`, and the brain there
  was cloned and loaded without asking, its pushes going to that address. An
  address now has an owner only where Kioku and git read it the same: plain
  characters in its host, user and path, and no empty, `.` or `..` segment. Any
  other is under no owner and the same repository as none but itself, so the
  session says it did not load it and `kioku init`, in a terminal, is how you
  accept it. `trust.owners` no longer takes `host/..`. Nothing changes with
  `trust.owners` empty, as it is until you set it.

## 0.6.4

- **The README's `ci` badge says how `main` stands.** It showed the last run of
  `ci` on any event from `main`, so the pull request that brings a release back
  into `develop`, whose own run waits or does nothing, turned it to "failing"
  while every check had passed. It now counts only pushes to `main`.

## 0.6.3

- **Nothing changes in the tool or the plugin.** The demo Kioku is developed
  and measured against holds together: its Skills say what they are for, its
  code repository has a manifest and the modules its pages name, and its
  sessions give git the demo person's name. `pnpm eval:memory` measures the
  agent there, not the demo's gaps.

## 0.6.2

- **The agent no longer tells you it saved.** Told at a session's start to say
  nothing of a save, which you see by its row, a smaller model still said "I
  saved that as a decision" most of the time: by its answer, the agent was far
  from that start. `kioku page save` now says it again where the agent reads
  last before it answers: its answer has `tell`, which says to tell nothing of
  the save itself and to answer what was asked. Measured with
  `pnpm eval:memory` on the demo with Haiku, ten runs of each saving scenario:
  answers that named the save went from 12 of 17 saves to 2 of 19.

## 0.6.1

- **The agent saves before it answers, also when you ask for one line.** A
  preference or a decision said in passing, in a message that asked for a short
  answer, was answered and often not saved by a smaller model: the summary's
  opening now tells the agent to save before it answers, whatever else the
  message asks for, and to say nothing of the save, which you see by its row.
  Measured with `pnpm eval:memory` on the demo: with Haiku the two saving
  scenarios went from about one run in ten to every run, and the four where
  nothing is worth saving stayed at none; with Sonnet, which already saved
  every time, nothing changed. Haiku still names the save in its answer in
  about a third of the runs. The eval has three more of those quiet scenarios:
  a step of the task, a state that ends within the hour, and a remark about
  the person.

## 0.6.0

- **A prompt's recall meets a page's words whatever form they have**: `deploy`
  and `deploying`, `migraciones` and `migración`, `webhook` and `webhooks` now
  count as a word in common, as two pages' titles already did for `save`.
  Before, only words cut to the very same stem did, so such a page had to
  stand further out to be named.
- **A small memory shows its lessons and facts at the session's start.** While
  the brains of a session hold fewer than 30 pages, too few for a prompt to
  recall any, the summary names each Memory that is a fact or a lesson, one
  line with its title and summary, where before only a search found them. Once
  the brains hold more, each prompt brings the ones that bear on it, as since
  0.4.0, and the summary lists none.
- **A machine with no search model has a recall too, by words.** Where the
  model is not on the machine yet, or `search.mode` is `full-text`, each prompt
  now brings the pages whose title, aliases and summary hold two or more of its
  significant words, a rare word weighing more than a common one; three at
  most, and none while the brains hold fewer than 30 pages. The row says
  `recalled  by words` in place of `by meaning`. It finds fewer pages than
  meaning does, and none written in another language than the prompt's.
  `pnpm eval:recall -- --words` measures it.
- **What you said and was not saved is kept through a compaction.** When
  Claude Code compacts a long session, by itself or at `/compact`, Kioku asks
  the summary to keep, under `Not yet saved to Kioku`, the corrections,
  preferences and decisions of yours that no page holds yet, and the session's
  start after it tells the agent to save them before going on. The plugin has
  a `PreCompact` hook for it, `kioku hook pre-compact`; it shows nothing and
  never stops a compaction.
- **A subagent works under the Rules too.** A subagent the session starts
  (to explore, to plan, any type) got none of the session's summary, so a Rule,
  always on, did not hold for it. It is now given the Rules of the session's
  brains at its start, and told to read the memory through the tool and to
  leave saving to the session that started it. The plugin has a
  `SubagentStart` hook for it, `kioku hook subagent-start`; with no Rule in
  the brains it adds nothing.
- **A page can say which files it is about, and comes back when the agent
  touches them.** `kioku page save --applies-to "src/billing/**,db/migrations"`
  (and `page update --applies-to`, `none` to remove it) writes the new
  optional field `applies_to`, globs relative to the project folder. When the
  agent reads or changes a file one of them matches, the page of the project
  brain is named beside the tool's result, one line, once a session, and the
  conversation shows `recalled  by path`. What you ask for often does not name
  the folder a lesson is about; the file does. The plugin has a `PreToolUse`
  hook on the file tools for it, `kioku hook pre-tool-path`, which starts
  nothing on a machine where no page uses the field. `page list` and
  `page show` answer `applies_to`; the validator warns of a glob that matches
  no file and of the field outside a project brain. A brain's format does not
  move: an older Kioku ignores the field.
- **`kioku brain stats` says how often a recall was worth it.** Beside the
  pages opened, each brain now has `recalled`, the times a prompt or a file
  brought one of its pages to a session on this machine, `followed`, the times
  that session then opened the page, and `follow_rate`. `kioku brain lint`
  lists, as `unfollowed`, the pages a recall named five times or more and no
  session opened: their title and summary are all a recall shows, so they are
  the ones to reword, or to retire. Counted from this version on; nothing
  changes which pages a recall names.
- **`kioku page save` says when another brain of the session has a page on the
  same subject.** A personal preference that says otherwise than a decision of
  the project's was written with no word, and "the most specific brain wins"
  settled it without anyone knowing. A save's answer now carries `elsewhere`,
  those pages, whether it wrote or answered `similar`; it never stops the
  write, and the agent tells you when the two disagree. `kioku brain lint`,
  run on the brains of a folder together, lists the pages of one on the
  subject of a page in a more shared one, `similarElsewhere`, apart from its
  count.
- **A session can pick up where the last one stopped.** When you stop with
  work unfinished, the agent leaves a handoff with the new
  `kioku handoff set`: what was being done and why, what is left, what comes
  next, what is not decided, and what it takes to go on, with the pages of
  the memory that session wrote and opened. The next session you start in the
  same place is given it, said as what it is, a note on this machine and not
  memory. A place is a folder and its branch: a worktree has its own handoff,
  a folder that is no repository has one, and a checkout that moves between
  branches has one a branch, the session being told when another branch has
  one and this one has none. Ask "what were we doing here?" and the agent
  reads it with `kioku handoff show`; `kioku handoff clear` drops it. It is
  the short memory of a place, where the brains are the long one: in no
  brain, never synced or searched, 4,000 characters at most, replaced by the
  next and dropped after thirty days. A fuller handoff document for someone
  else is still yours to have written, and the handoff says where it is. The
  progress of a task is still never a page.
- **A session's journal is kept thirty days, not two.** A session resumed
  weeks later, with `claude --resume`, still has its memory history, its
  footer's counts, and what it was already given, so nothing is recalled to
  it twice. The journal stays what it was: names and counts on this machine,
  never a page's text or a prompt.
- **Two pages on one subject become one, and a forgotten page comes back.**
  `kioku page merge <from> <into>` takes the merged body on stdin and, in one
  commit, keeps the `id` of the page that stays, makes the other's title and
  aliases its aliases, joins both pages' See also and an instinct's occasions,
  points every link of the brain at it and deletes the other; before, it was an
  `update` and a `forget` by hand, and the links to the forgotten page broke.
  Decisions are not merged: they are superseded. `kioku page restore <path>
  --brain <b>` brings back a page as it was before the `forget` or the `merge`
  that deleted it, where before it took a `git revert` in the brain's folder;
  it is refused when a page it linked to is gone. In a conversation: "these two
  are the same", "bring that back". `brain log` lists both, a merge with `into`;
  `brain stats` counts them in `by_verb`, and a save forgotten and then
  restored is no longer a reverted save. The journal has `merged` and
  `restored`.
- **A Rule a teammate changes is said to you.** A Rule goes whole into every
  session, and anyone who can push to a project or team brain writes one; you
  saw a page count. Now a session's start names each Rule of its shared brains
  that someone else added, changed, retired or removed since this machine last
  said so: what happened, its title, its brain, who the commit says changed it
  and the `kioku page show` that reads it, five at most. Each change is said
  once, in a notice `display.mute` cannot silence. Your own commits are not
  said, nor a `confirm` or a `link`; a brain loaded for the first time says
  none.
- **A `kioku` call that made no entry can be opened again.** When the agent
  ran the tool and nothing of it reached the journal, a verb that makes no
  entry such as `kioku --version`, or an answer piped into another command,
  the conversation showed a dim line of the command's first words and hid what
  it answered, with nothing to expand. Such a call, and the run it is in, is
  now drawn by Claude Code as any other command.
- **The footer no longer counts one read or write too many** when a session is
  cleared, resumed or branched while a drop is still falling.

## 0.5.0

- **`namespace add` and `brain language` always name the brain they write
  to**, with `--brain`, as `page save` already did: nothing in the brain says
  where they belong, so the same command no longer lands in the only brain of
  the chain one day and fails the day a second brain arrives. The verbs that
  read, or change what a brain already holds, keep `--brain` optional.

## 0.4.0

- **A session's start says its summary in one row**, as the rows of a call
  are drawn: `⬢ kioku.md ↓ summary   session summary · 324 pages (personal,
  project, team)`. The version of the tool is no longer said there; a session
  says a version only when a newer one exists, with the one this machine runs.
- **The session summary comes in two parts, each a hook of its own**, since
  Claude Code caps what one hook injects at 10,000 characters: how to use the
  memory (the opening, the brains, the project's front page and the Rules),
  and what it holds (the pages to load first, the Skills, the decisions, the
  instincts, the news and what lint has to review). A brain with many Rules no
  longer leaves its Skills, decisions and instincts out of the session. A Rule
  is now its Rule and its Why, without its See also.
- **Each prompt brings the pages that stand out for it**, by meaning: up to
  three, one line each with its title and summary, so that the agent knows the
  brains hold something it would not have looked for. Only once the search
  model is on the machine and the brains hold 30 pages or more; the hook gives
  up past a second, and the prompt is kept nowhere. The conversation shows
  what each prompt recalled in a `recalled` row under the message, and the
  memory history lists the pages, where they open.
- **Each part of a page has a vector of its own**, its summary and each
  section, so that a line such as a lesson's rule of thumb is found by the
  prompt it answers even when the rest of the page is about something else.
  The search index is rebuilt once, and the first `sync` after the update reads
  the meaning of every page again. `kioku page search` ranks as before.

## 0.3.1

- **Releases are built with the pnpm setup action pinned to a commit**, not to
  a tag its owner could move, and the release notes are found in
  `CHANGELOG.md` with every character of the version escaped. Nothing changes
  in the tool or its plugin.

## 0.3.0

- **A session's start says Kioku's version**, on a line of its own, and under
  it the history's `summary` row, `↓ summary   session summary · 316 pages
  (personal, project, team)`. It comes first, and a blank line parts it
  from each notice; the one that says a newer version is available no longer
  repeats the version this machine runs, which the summary says.
- **An update hands the plugin to the version it installs.** `kioku update`
  downloads only the new version's bundle, and that version fetches its own
  plugin and puts it in place before it becomes active; the installer checks
  the plugin's download and hands it to the bundle the same way. A release can
  so change how its plugin is laid out without a version in between. Going back
  to 0.2.x with `kioku update <version>` still works.

## 0.2.1

- **The installer now leaves a machine as `kioku update` does.** `kioku setup`,
  which the installer runs, brings forward what an older version left and
  refreshes the files Kioku owns in every brain, and says what it did; run
  again, it does nothing. From 0.1.0, that means `config.yaml` rewritten by
  the brains' names, each brain moved to its folder with the address of its
  remote, and your own brain raised to format 2.
- **A `config.yaml` that 0.1.0 wrote keeps its entries until it is brought
  forward**: `kioku config set` and the other verbs that write it no longer
  drop a brain's `path`, nor record an address for a brain with no remote.

## 0.2.0

- **A brain has a name of its own**, `<owner>/<repo>`, chosen when it is made
  and written in its `kioku.yaml`: the same on every machine, whatever its
  address. Kioku chooses none and asks nothing of git, a git host or the
  system for it. `kioku brain create <owner>/<repo>` always takes it; alone it
  is refused.
- **An address is only where a brain is.** `kioku brain clone <address>` takes
  any address git clones from, https, ssh or a folder, and brings the brain
  under the name it holds. `owner/repo` never means github.com: an address has
  its host, `github.com/owner/repo`.
- **Every brain lives in `~/.kioku/brains/<owner>/<repo>/`.** `--dir` is gone
  from `brain create`, `brain clone` and `init`, and `repositories` in
  `config.yaml` holds the addresses you accepted, `name: url`.
- **`kioku brain publish <brain> --remote <address>`**: the brain and the
  address are always named, and its name and folder do not change. `--to` is
  gone.
- **`kioku init <brain>` links the project brain alone**, cloned from an
  address or made by name; a folder's team is written by hand, and
  `--team` and `--create` are gone. `kioku init` alone accepts the addresses
  the file gives and writes the address of a brain linked by name once it is
  published. A `kioku.yaml` holds a name, or `{ name, url }`.
- **Trust follows the address, never the name.** `kioku brain trust` is gone:
  `kioku init` accepts a folder's addresses, and `kioku config set trust.owners
  +github.com/northwind` trusts an owner. A brain of another tier than its
  link takes, the personal brain among them, is not loaded.
- **Brain format 2**: the brain's `name` in `kioku.yaml`. `kioku brain upgrade
  <brain>` raises a brain of format 1, and `kioku update` raises your personal
  brain on its own, rewrites a 0.1.0 configuration and moves each brain to its
  folder; project and team brains are left for you, with the notice
  `format-behind`. New notices: `link-without-address`, `brain-not-here`.
- The JSON contract is 2: a brain is named by its name, not
  `host/owner/repo`; `brain trust`, `brain create`'s `userFrom` and
  `brain clone`'s `registered` are gone.

## 0.1.0

Kioku's first version: memory for coding agents, kept in brains, git
repositories of Markdown pages, yours and your team's, that the agent reads and
writes through the `kioku` command line, with Claude Code as its host. The
README says how to install it and start.
