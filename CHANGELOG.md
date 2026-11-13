# Changelog

What changed in each version of Kioku. What is true now is in the
[spec](docs/specs/README.md); what shapes it, in
[How Kioku is designed](docs/explanation/design.md).

## Unreleased

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
