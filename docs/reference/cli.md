# Command-line reference

The `kioku` tool, verb by verb: how to call it. The rules of every verb are
[the spec, §6.1](../specs/06-the-tool.md#61-command-line); what each answers
in JSON is [the answers](answers.md); where the tool, the brains and the
machine's state live is [a table in How Kioku is put
together](../explanation/architecture.md#what-lives-where-on-a-machine). Each
verb's heading, usage and first line are written from the table that declares
the verbs by `pnpm docs:cli`, and a test fails when they fall behind.

## Conventions

A body comes on standard input, usually a heredoc. `--json` goes anywhere on
the line. Flags are long, but for `-h` (`--help`) and `-v` (`--version`). `--brain <b>` takes a brain's tier or its
name (`owner/repo`); where a `brain` verb
takes `[<brain>]` and none is given, it acts on the brain the folder is inside,
else on every brain of the chain on the machine.

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | a usage error, a file of yours that is wrong, or a report with something to say (`brain validate` with errors, `doctor` with something required missing, `sync` or `init` with a failed clone) |
| 2 | the brain refused the write: `locked`, `changed` (a page changed since the verb read it: run it again) or `format_newer` |
| 3 | the environment lacks something or could not be reached (a brain folder, a release), or git answered more than 64 MiB (`git_output_too_large`) |

**Refusals.** A verb that changes the machine answers `needs_terminal` outside
one. The codes the verbs below do not name:

| Verb | Code | When |
|---|---|---|
| any, naming a brain | `brain_ambiguous`, `brain_unknown`, `brain_none`, `brain_config_invalid` | two brains answer; the brain is not on the machine; there is no brain to act on; the brain is on the machine but its `kioku.yaml` is refused (the message names the key) |
| `brain remove` | `brain_personal`, `brain_team`, `brain_no_remote`, `brain_unsaved` | without `--force`: your personal brain, the machine's team, a brain with no remote, a clone with changes, commits or branches no remote has |
| `page confirm` | `retired` | the page is retired |
| `page retire` | `already_retired`, `not_retired` | the retire, or the `--undo`, changes nothing |
| `page rename` | `path_exists`, `unchanged` | the new path exists; the title is the same |
| `page move` | `not_found`, `unchanged`, `path_exists` | the brain lacks the namespace; it is the page's own; the new path is taken |
| `page link` | `unchanged` | both pages already link as asked |

<!-- verbs: written by `pnpm docs:cli` from src/cli/verbs.ts; edit only the prose under each verb -->

## Machine

### `kioku setup`

```text
kioku setup [--shell fish|zsh|bash|all] [--no-model]
```

Once per machine: the configuration, kioku on your PATH, your shell's completion, the search model; no brain.
<!-- /generated -->

Changes only what is missing. The installer runs it in a terminal (answers
read from `/dev/tty`) with the arguments after `sh -s --`, as in `curl … | sh
-s -- --no-model`; `$XDG_DATA_HOME`, `KIOKU_INSTALL_DIR` and `KIOKU_BIN_DIR`
move the installer's folders, `XDG_CONFIG_HOME` fish's. `setup` writes a link
to `kioku` in the first of `~/.local/bin` and `~/bin` on your `PATH`, or else a
line marked `# kioku` in `~/.config/fish/conf.d/kioku.fish`, `~/.zshrc`,
`~/.bashrc` or, on macOS, `~/.bash_profile`; and the completion,
`~/.config/fish/completions/kioku.fish` or a line marked `# kioku completion`
(`--shell` picks a shell other than `$SHELL`'s, `all` the three). `--no-model`
sets `search.mode: full-text`; else the model (about 250 MB, once) is fetched
unless it is there or an earlier fetch's failure stands (`doctor` says why).

### `kioku doctor`

```text
kioku doctor
```

Checks the machine and says how to fix what is missing.
<!-- /generated -->

Each check is `ok`, `warn` or `missing`, with the fix under it: Node, git, the
configuration, each brain (one with no remote warns, naming `brain publish`,
unless `unpublished` is muted; no git host is asked), pending publications,
the index, the model, the installed tool, `kioku` on the `PATH`, how the tool
was installed and when a version was last looked for, each host's plugin
(where it is read from; a warning when it is not the tool's version) and, as
information, whether Claude Code's own memory is on.

### `kioku update`

```text
kioku update [<version>] [--check] [--dry-run]
```

Installs the latest release, or the one named, rewrites the agent integration and refreshes the brains.

`--prepare` is what the tool passes itself; not for people.

`--archive` is what the tool passes itself; not for people.

`--finish` is what the tool passes itself; not for people.
<!-- /generated -->

Fetches the latest release's checksum and, when it differs from the installed
bundle's, the bundle; reads its version and stops when it is not newer than
the one running. Else it fetches and checks `kioku-plugin.tar.gz`, puts both
under `versions/<version>/`, moves `current`, hands over to `kioku update
--finish` of the new version, which runs `kioku brain refresh --all`, and
removes every version but the previous. `<version>` takes a `v` before it, and
needs a terminal unless with `--check` or `--dry-run`. A tool Homebrew
installed answers `managed` with `brew upgrade kioku`.

```bash
kioku update --check
kioku update 0.1.0
```

Errors: `update_failed` (not fetched, checksum mismatch, or the release named
holds another version), `usage`.

### `kioku completion`

```text
kioku completion fish|zsh|bash
```

Prints your shell's completion script, which setup makes the shell source.
<!-- /generated -->

```bash
kioku completion fish | source
eval "$(kioku completion zsh)"
```

### `kioku plugin claude-code install`

```text
kioku plugin claude-code install [--dry-run]
```

Adds Claude Code's integration as a plugin, with Claude Code's own commands; asks first.
<!-- /generated -->

Runs what is not done of:

```bash
claude plugin marketplace add ~/.local/share/kioku/current/plugin
claude plugin install kioku@kioku
```

Under Homebrew the folder is the formula's `opt` folder. Asks first; `--dry-run`
only says. `claude` is accepted for `claude-code`. Errors: `agent_missing` (no
`claude` on the `PATH`), `plugin_missing` (a tool with no plugin beside it: a
checkout loads `plugins/claude-code` with `claude --plugin-dir`),
`plugin_command_failed`, `unknown_host`.

### `kioku plugin claude-code uninstall`

```text
kioku plugin claude-code uninstall [--dry-run]
```

Removes that plugin and its marketplace.
<!-- /generated -->

Runs `claude plugin uninstall kioku@kioku`, then removes the marketplace; the
brains and the tool stay. Same rules as `install`.

### `kioku config`

```text
kioku config
kioku config get <key>
kioku config set <key> <value>
kioku config unset <key>
```

Lists, reads and sets the machine's preferences, the owners it trusts and its team.
<!-- /generated -->

| Key | Value | Default |
|---|---|---|
| `team` | a team brain this machine has, by name: it loads where a project folder names no team (spec §2.4) | none |
| `display.color` | `auto`, `always` or `never` | `auto` |
| `display.mute` | the notices you do not want (spec §1.2): a list, `update-available,unpublished`, or one at a time, `+unpublished`, `-unpublished` | none |
| `trust.owners` | the owners of addresses whose brains a project folder may name without being asked, `host/owner` (spec §2.4): a list, or one at a time, `+github.com/northwind`, `-github.com/northwind` | none |
| `search.mode` | `hybrid` or `full-text` | `hybrid` |

Alone it lists each key with its value, set or default; `get display.mute`
also names the notices. `set team` refuses a brain this machine does not have
(`brain_unknown`, `brain_not_cloned`, with the command that brings it) and one
that is not a team brain. Trusting an owner trusts every brain at its
addresses, those it publishes later included. `brain` and `repositories` are
listed and read, but `set` refuses them (`config_key_readonly`). Errors:
`config_key_unknown`, `config_value_invalid` (with what is allowed and the
default); a file holding a key it does not know is `config_invalid`.

## In a project folder

### `kioku init`

```text
kioku init [<brain>]
```

Links a project folder to its project brain, cloned from an address or made by name; alone, accepts and clones what its kioku.yaml names.
<!-- /generated -->

Writes the project brain into `kioku.yaml` in the folder, or at the root of
the repository it is inside, keeping the `team` the file holds; commit it with
the code. A folder's team is written by hand, `team: northwind/team-brain` or
`team: { name: northwind/team-brain, url: … }` (spec §2.4). `<brain>` is an
address, cloned when this machine does not have the brain, or a name, made
here as a project brain when this machine has none of it. The file holds the
brain's name, and its address once it has one: a name alone links the
machines that have that brain and no others. Alone, where the file exists, it
accepts the addresses the file gives, clones what the chain is missing, and
writes the address of a brain named without one once it has a remote, so the
person who published it commits the link a teammate can clone. Refuses inside
a brain (`is_a_brain`), a brain of another tier (`brain_other_tier`), and a
different project brain than the file names (`kioku_yaml_exists`). Accepting
an address this machine does not know, or making a brain, needs a terminal.

```bash
kioku init github.com/northwind/acme-brain   # clone it and link it
kioku init northwind/acme-brain              # make it here and link it by name
kioku init                                   # accept and clone what kioku.yaml names
```

### `kioku sync`

```text
kioku sync [--cwd <dir>] [--background]
```

Pulls the brains of this folder's chain, pushes what is pending, updates the index.
<!-- /generated -->

By hand it fetches the search model first when it is missing. `--cwd` and
`--background` are what the session's hook passes. A brain kept aside is
`conflict`; exit 1 when a brain failed; another sync running is said, not
waited for.

## Brains

### `kioku brain create`

```text
kioku brain create <owner>/<repo> [--tier personal|project|team] [--language <tag>]
```

Makes a brain on this machine with the name you give it, with no remote and no network; personal unless --tier says.
<!-- /generated -->

`<owner>/<repo>` is the brain's name, which you choose and which never
changes: two segments of letters, digits, `-` and `_`, such as `sam/memoria`
(spec §2.2). Kioku chooses none and asks nothing of git or of the system for
it. The brain lives in `~/.kioku/brains/<owner>/<repo>/`, with its name in its
`kioku.yaml`; it is personal unless `--tier` says project or team. A brain
names no other brain: a project folder's `kioku.yaml` names its team.
`--language` writes the tag `brain language` takes. Errors: `brain_exists`
(this machine has a brain of that name), `personal_exists`, `usage` (not a
name; an address is for `brain publish --remote`).

```bash
kioku brain create sam/memoria
kioku brain create northwind/acme-brain --tier project
```

### `kioku brain clone`

```text
kioku brain clone <address>
```

Brings a brain that exists to this machine from any address, under the name it holds.
<!-- /generated -->

`<address>` is any address git clones from: `host/path` (read as
`https://<host>/<path>.git`), an https or ssh address, `git@host:path`, or a
folder. The brain comes under the name it holds, in its `kioku.yaml` (or, in a
brain of format 1, the last two segments of the address), into
`~/.kioku/brains/<owner>/<repo>/`, and its address is recorded. A personal
brain becomes the machine's (`personal_exists` when there is one); a shared
one is trusted. Refuses a repository that is not a brain (`not_a_brain`), a
name this machine has already or an address that is a brain's here
(`brain_exists`; when the brain here has no remote, it says to publish it
there instead), and a name with no host (`brain_url_invalid`).

```bash
kioku brain clone github.com/sam/memoria
kioku brain clone /Volumes/shared/brains/sam.git
```

### `kioku brain sync`

```text
kioku brain sync <brain>
kioku brain sync --all
```

Pulls and pushes a brain, or every brain, wherever you are.
<!-- /generated -->

### `kioku brain publish`

```text
kioku brain publish <brain> --remote <address>
```

Pushes a brain that lives only on this machine to an empty repository at the address you give; its name stays.
<!-- /generated -->

The brain and the destination are always named. The repository at the address
must exist (`git init --bare` makes one on a disk); the brain's name and folder
do not change, and the address is recorded under its name. What the
repository holds decides: empty, it takes the brain; the same brain while this
copy has no page, it connects; pages on both sides is `remote_diverged`, with
the commands to merge by hand; anything else, `remote_not_a_brain`,
`remote_other_name` or `remote_other_tier`. Nothing at the address is
`remote_absent`; an address that is another brain's here, `brain_exists`. It
ends by saying that a project folder linking the brain by name needs
`kioku init` to write its address.

```bash
kioku brain publish sam/memoria --remote github.com/sam/memoria
kioku brain publish northwind/acme-brain --remote git@git.example.com:northwind/acme-brain.git
```

### `kioku brain list`

```text
kioku brain list
```

The brains this machine knows, and the chain of this folder.
<!-- /generated -->

### `kioku brain path`

```text
kioku brain path <brain>
```

Prints a brain's folder.
<!-- /generated -->

Works anywhere, for any brain of the machine.

```bash
cd (kioku brain path acme)    # fish
cd "$(kioku brain path acme)" # bash, zsh
```

### `kioku brain remove`

```text
kioku brain remove <brain> [--force] [--dry-run]
```

Takes a brain off this machine, never off the git host: deletes its clone and forgets it; refuses what would lose work unless --force.
<!-- /generated -->

### `kioku brain log`

```text
kioku brain log [--since <when>] [--brain <b>] [--limit <n> [--offset <n>]]
```

The writes of the chain's brains since today, or since when you say.
<!-- /generated -->

`--since` takes `today` (the default), `yesterday`, a date or a span (`12h`,
`3d`, `2w`). Twenty writes at a time; `--offset` reads on.

### `kioku brain stats`

```text
kioku brain stats [--since <when>] [--brain <b>]
```

What the writes of the chain's brains add up to over a span, 30d unless you say: by verb, and how many saved pages were forgotten.
<!-- /generated -->

A page saved before the span and forgotten in it is a forget, not a revert.

```text
acme: 41 writes
  saved 18, updated 11, superseded 3, confirmed 6, forgotten 3
  3 of 18 saved pages were forgotten (17%)
  opened 42, unopened 5, on this machine since 2026-09-01
```

### `kioku brain sources`

```text
kioku brain sources [<source>] [--brain <b>] [--all]
```

What the brains were filled from, with the version each page was written from.
<!-- /generated -->

A source is written as the pages carry it; a work session counts only with
`--all`, a retired page never. `/ingest` runs it before reading.

### `kioku brain validate`

```text
kioku brain validate [<brain>]
```

Checks a brain's files against the format.
<!-- /generated -->

### `kioku brain lint`

```text
kioku brain lint [<brain>] [--limit <n>]
```

What to review: similar pages, quiet instincts, superseded decisions, and the rest.
<!-- /generated -->

### `kioku brain language`

```text
kioku brain language <tag> [--brain <b>]
```

Declares the language a brain's pages are written in; the summary tells the agent.
<!-- /generated -->

A tag is `en`, `es`, `es-419`, `pt-BR` and the like. Refused when the brain
says it already (`unchanged`).

### `kioku brain upgrade`

```text
kioku brain upgrade <brain>
```

Raises a brain to the newest format, in one commit.
<!-- /generated -->

From format 1, which 0.1.0 made, it writes the brain's name into its
`kioku.yaml` (spec §3.2), and pushes when the brain has a remote. A brain in
the newest format is left as it is. Teammates on an older version still read a
raised brain but no longer write to it until they update (`format_newer`), so
a project or team brain is yours to raise once they have; `kioku update`
raises your personal brain by itself. Needs a terminal.

### `kioku brain refresh`

```text
kioku brain refresh [<brain>] [--all]
```

Rewrites the files the tool owns in a brain, or in every brain.
<!-- /generated -->

A shared brain written by a later version is left (`left: newer`), and with
`--all` a build that is not a release, such as one run from a checkout, leaves
shared brains (`left: build`) (spec §2.7).

### `kioku brain conflicts`

```text
kioku brain conflicts [<brain>] [--branch <b> [--page <path>]] [--open <b>] [--resolve <b>]
```

The changes kept aside after a conflict with the team's, and how to resolve them.
<!-- /generated -->

With no flag it lists the branches kept aside, per brain. One flag at a time:
`--branch` answers `theirs`, `mine` and `base` of each page (`--page` for one);
`--open` checks the branch out under `~/.kioku/conflicts/<owner>/<repo>/`;
`--resolve` removes that folder and the branch, once `kioku page update` wrote
what stands. An unknown branch is `conflict_unknown`.

## Pages, reading

### `kioku page search`

```text
kioku page search <words> [--brain <b>] [--limit <n>] [--include-retired]
```

Searches the brains of this folder, by meaning and by text.
<!-- /generated -->

The best 20, or `--limit`; narrow the words rather than page. Answers by full
text alone, saying why, until the model is on the machine.

### `kioku page list`

```text
kioku page list [--brain <b>] [--kind <k>] [--namespace <ns>] [--limit <n> [--offset <n>]] [--fields <a,b>] [--count]
```

The pages, 20 at a time, with their fields.
<!-- /generated -->

Twenty pages at a time; `--offset` reads on (the text says
`… 55 more: --offset 20`). `--kind` is `knowledge`, `memory`, `rule` or
`skill`; `--fields` keeps those fields plus `brain` and `path`
(`fields_unknown` otherwise); `--count` answers only `total`.

### `kioku page show`

```text
kioku page show <path> [--brain <b>] [--section <name> | --outline | --head <n>]
```

One page, with its body, its links and its history.
<!-- /generated -->

One slice at a time: `--section` (`section_not_found` lists the sections),
`--outline` (the section names), `--head` (the first lines).

## Pages, writing (what the agent calls while it works)

### `kioku page save`

```text
kioku page save --brain <b> --kind <k> --title <t> --source <s> [--sub <decision|playbook|context|instinct>]
           [--evidence <q>] [--summary <s>] [--aliases <a,b>] [--namespace <ns>]
           [--stale-after <date>] [--source-version <v>] [--create [--see-also <paths>]] < body
```

Writes a page, or answers the similar pages it found instead.
<!-- /generated -->

Pages on the same subject come back as `similar` and nothing is written:
`update`, `supersede`, or `--create`, which links them under `## See also`
(`--see-also` narrows them, `none` links none). In a brain with several
namespaces and no `--namespace`, it answers `namespace` with each; with none,
`namespace_none`; an unknown one is `namespace_unknown`. `--stale-after`
takes `YYYY-MM-DD`; `--source-version` one line (a sha, a date, a hash).

### `kioku page update`

```text
kioku page update <path> [--brain <b>] [--section <name>] [--evidence <line> --source <s>]
             [--note <line>] [--summary <s>] [--aliases <a,b>] [--stale-after <date>|none]
             [--source-version <v>|none] < body
```

Rewrites a page's body, or one section, keeping its history.
<!-- /generated -->

The body replaces the page's, or with `--section` that section's. `--evidence`
with `--source` adds an occasion to an instinct; `--note` is the Changelog
line's text; `none` removes `--stale-after` or `--source-version`. An update
that changes nothing is refused.

### `kioku page supersede`

```text
kioku page supersede <old path> [--brain <b>] --title <t> --source <s> [--evidence <q>]
                [--summary <s>] [--aliases <a,b>] [--namespace <ns>] [--stale-after <date>]
                [--source-version <v>] < body
```

Writes a new decision and marks the old one as replaced.
<!-- /generated -->

### `kioku page forget`

```text
kioku page forget <path> [--brain <b>]
```

Deletes a page; git keeps it.
<!-- /generated -->

### `kioku page confirm`

```text
kioku page confirm <path> [--brain <b>] [--note <line>]
```

Records that a page is still true.
<!-- /generated -->

### `kioku page retire`

```text
kioku page retire <path> [--brain <b>] [--reason <line>] [--undo]
```

Marks a page as not current, kept as history.
<!-- /generated -->

### `kioku page rename`

```text
kioku page rename <path> --title <new title> [--brain <b>]
```

Gives a page a new title; links follow.
<!-- /generated -->

### `kioku page move`

```text
kioku page move <path> --namespace <ns> [--brain <b>]
```

Moves a page to another namespace of its brain; its id stays and links follow.
<!-- /generated -->

### `kioku page link`

```text
kioku page link <path> <path> [--brain <b>] [--type contradicts|qualifies]
```

Links two related pages, each under the other's See also.
<!-- /generated -->

Both pages in one brain; the kinds of link are spec §3.3. A direction already
there is kept, or typed in place.

### `kioku page promote`

```text
kioku page promote <path> --to <brain | tier> [--brain <b>] [--title <t>] [--summary <s>]
              [--aliases <a,b>] [--namespace <ns>] [--evidence <q>] [--create]
              [--keep | --forget] < body
```

Writes a page again in a more shared brain and retires the original.
<!-- /generated -->

The body is the page as it should read there. Kind, title, summary and aliases
come from the original unless given; `evidence` is not copied. `--forget`
deletes the original and `--keep` leaves it; by default it is retired. Two
commits, destination first. Refused: a destination not more shared
(`not_up`), an empty body, a Skill, a retired page.

### `kioku page evolve`

```text
kioku page evolve [<instinct path> [--to skill|rule|playbook]] [--brain <b>]
```

Lists the instincts ready to become Skills, or converts one.
<!-- /generated -->

A Rule that would be too long is `rule_too_long`: use `--to playbook`. An
instinct already evolved is `already_evolved`.

## Namespaces

### `kioku namespace list`

```text
kioku namespace list [--brain <b>]
```

The namespaces of the brains of this folder, with the pages in each.
<!-- /generated -->

### `kioku namespace add`

```text
kioku namespace add <path> --summary <text> [--brain <b>]
```

Declares a namespace, or one under another, and writes its index with what it is for.
<!-- /generated -->

When the agent runs it, Claude Code asks you first. Each part of the path is
letters, digits, dots, dashes and underscores, not a reserved name, at most
three deep (`usage`); the parent must exist (`not_found`) and the path must not
(`path_exists`).

### `kioku namespace describe`

```text
kioku namespace describe <path> --summary <text> [--brain <b>]
```

Says what a namespace is for, in the paragraph under its index's title.
<!-- /generated -->

Refused when it says that already (`unchanged`) or there is no such namespace
(`not_found`).

### `kioku namespace rename`

```text
kioku namespace rename <from> <to> [--brain <b>] [--dry-run]
```

Gives a namespace another path, with everything under it; its folder, its pages and the links into it follow.
<!-- /generated -->

`<to>` must not exist (`path_exists`: namespaces are not merged), its parent
must (`not_found`), and it is not under `<from>` (`usage`). Links from outside
the brain are not rewritten.

## Used by the agent integration, not by people

### `kioku hook`

```text
kioku hook session-start|session-start-holds|user-prompt-submit|pre-tool-use|post-tool-use [--host claude-code]
```

What the plugin's hooks call.
<!-- /generated -->

Reads the host's JSON on standard input (spec §6.2); `--host` is
`claude-code` by default, and another is `unknown_host`.

<!-- /verbs -->

## Help and version

`kioku`, `kioku help`, `--help` and `-h` print an overview: the verbs of one
word, a line for each group, and how to see more. `kioku <group>` and `kioku
help <group>` list a group's verbs; `kioku help <verb>`, `kioku help <group>
<verb>` and `<verb> --help` or `-h`, one verb's usage. A verb misused is told
what is wrong, then its usage and `kioku help <verb>`; with `--json`, the
`usage` error's message is one line, what is wrong and the usage. `kioku
--version`, `-v` or `-V`, prints the version, and with `--json` the contract
and the formats too (spec §6.1).
