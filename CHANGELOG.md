# Changelog

What changed in each version of Kioku. What is true now is in the
[spec](docs/specs/README.md); what shapes it, in
[How Kioku is designed](docs/explanation/design.md).

## Unreleased

- **Kioku installs with Homebrew**: `brew install monoku/kioku/kioku`, from
  Kioku's own tap, which each release moves to its version. The formula puts
  the plugin where it does not move between versions, gives the shell its
  completion, and ends with the next steps; `brew upgrade kioku` updates it.
  Under Homebrew, `kioku setup` leaves the `PATH` and the completion to the
  formula, and `doctor` no longer asks for the installer. A machine where
  both the installer and Homebrew installed Kioku is told by `doctor` which
  one runs, and how to keep one.
- **A new version brings the machine forward on its own**, whatever installed
  it: the first session that runs it rewrites an older configuration, raises
  your own brain's format and refreshes the files Kioku owns in every brain,
  in the background, and the next session says what it did, once
  (`brought-forward`, which `display.mute` can silence; a step that failed is
  always said). `kioku update` and `kioku setup` still do it at once, and
  `doctor` says when it is pending.
- **A machine is set up once `kioku setup` has run**, not once a
  configuration exists: a verb such as `kioku brain create` run before it no
  longer hides that `setup` is missing. The session works and says so, as
  `doctor` does. A machine an earlier version set up counts as set up.

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
