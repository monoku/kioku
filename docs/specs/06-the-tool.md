# 6. The tool

## 6.1 Command line

All logic lives in the command-line tool: reading brains, writing files, the
index, git, validation. The tool is the product: it is installed on its own
(§6.3), and an agent host is an integration it adds to that host (§6.2), whose
skill and command are short text telling the agent which verb to run and how
to behave; its hooks call `kioku hook <event>`. An agent that runs no hooks
uses the same tool, and the tool is tested without any agent host.

**Answers.** The tool answers in JSON when an agent, a hook or another program
calls it (`--json`), and in text when a person does. The JSON is the contract,
one line of it from every verb; the text is laid out for reading, with colour
only at a terminal as `display.color` says (§1.2), and is not promised to stay
as it is. Its colours are the brand's two: a title, a section's or a table's
head, is bold in lavender, and what a line is about, a verb, a brain, a page or
a key, bold in orange. An error is `{"error": {"code", "message"}}` in JSON and
`kioku: <message>` on standard error in text, `kioku:` in red at a terminal; a
program finds every refusal at `error.code`. A verb that writes puts that object
in its own result, beside `status: error`; one that reports what it found, such
as `brain validate` or `doctor`, answers its report with exit 1 and no `error`;
one with nothing to list says where it looked. `kioku --version --json` answers
the version, the contract and the brain formats the tool reads (§5): the
contract is the version of the JSON, 1 in 0.1.0, which moves only when a field a
program reads is removed or changes meaning.

**Steps.** A verb that waits on git reaching another machine, a git host, a
download, the host's own commands, or the search model reading pages says what
it is doing while a person watches: a line on standard error per step, in the
present while it runs (`Pushing 20 pages…`) after the footer's drop (§1.2),
animated with colour and plain without it, kept when it ends, dimmed after `✓`
or red after `✕`; then a blank line and the answer on standard output. With
JSON, or when standard error is not a terminal, the steps say nothing; a
question is not drawn over, a verb stopped midway leaves no half-drawn line,
and steps are not messages (§1.2). `setup`, `brain create`, `brain remove` and
`init` answer in that look with no step: a line per thing done (`✓`), not done
(`✕`) or left to the person (`⚠`), then what follows.

| Group | Verb | Does |
|---|---|---|
| machine | `setup` | sets the machine up once, idempotent, in a terminal (§6.3) |
| | `plugin <host> install` | adds the host's plugin, saying what it will do and asking, in a terminal (§6.2) |
| | `plugin <host> uninstall` | removes the plugin and its marketplace, in a terminal (§6.2) |
| | `config` | lists, reads and sets the preferences, the owners the machine trusts and the machine's team, checking a value before writing; `set` and `unset` in a terminal (§2.5) |
| | `completion` | prints the shell's completion of the verbs, their flags, the brains of the machine and `config`'s keys (§6.3) |
| | `doctor` | checks the machine, from Node and git to each brain, the index, the model, the installed tool and each host's plugin; changes nothing and says what to do (§6.3) |
| | `update` | brings the machine to the latest release, or to the one named (§6.4) |
| in a project folder | `init <brain>` | writes the project brain in the folder's `kioku.yaml`, its name and its address once it has one, keeping a `team` written by hand; given an address, clones it when the machine lacks it, given a name, makes it shared; registers it and clones the chain; alone, trusts and clones what the file names and writes the address of one published since (§2.4) |
| | `sync` | pulls and pushes the brains of this folder's chain and updates the index (§4.2) |
| | `handoff set\|show\|clear` | the handoff of this folder and branch, where its last session stopped, for the next one on this machine, never in a brain: left, shown or dropped (§4.8) |
| brains | `brain create <owner>/<repo>` | makes a brain on this machine, with the name given, with its files and first commit, asking no git host anything and taking no destination; personal unless `--tier` says project or team; the name is always given; one that fails leaves nothing (§2.3) |
| | `brain clone <address>` | brings a brain that exists from any address, under the name it holds (§2.2, §2.5), and registers it as its `kioku.yaml` says, in a terminal (§2.4) |
| | `brain sync` | pulls and pushes a brain, or every brain of the machine, and reindexes them for full text; one with no remote is `no-remote` (§4.2) |
| | `brain publish <brain> --remote <destination>` | gives a brain with no remote its repository, its name unchanged, leaving one with a remote alone, in a terminal (§2.3) |
| | `brain remove` | takes a brain off this machine, its folder with it, never off the git host, in a terminal (§2.5) |
| | `brain validate` | checks a brain's files against the format (§5) |
| | `brain language` | declares the language the brain's pages are written in, in one commit (§3.2) |
| | `brain refresh` | rewrites the files the tool owns, committing when something changed and pushing in a shared brain (§2.7) |
| | `brain upgrade <brain>` | raises a brain to the newest format, in one commit, pushing in a brain with a remote; in a terminal (§3.2) |
| | `brain lint` | reports what a brain accumulates (§4.4) |
| | `namespace list` | the namespaces of each brain of the chain, as a tree, with the pages in each by kind (§3.2) |
| | `namespace add` | the only verb that makes a namespace, declaring it and writing its index in one commit; the host asks the person first (§3.2, §6.2) |
| | `namespace rename` | gives a namespace another path in one commit, with everything under it; the links follow, the ids stay, and two namespaces are never merged (§3.2) |
| | `namespace describe` | changes the first paragraph of a namespace's index, in one commit (§3.2) |
| | `brain conflicts` | the changes kept aside after a conflict, per brain, and the ways to see and resolve them; the brain stays on its default branch (§1.6) |
| | `brain list` | the brains this machine knows, the chain of this folder and, inside a brain, which one and what it leaves unloaded (§2.7) |
| | `brain path` | prints the brain's folder |
| | `brain log` | the writes of the chain's brains, newest first, from each brain's history, with who and how (`via`, §1.6); a window |
| | `brain stats` | what the writes of the chain's brains add up to over a span, by verb and by `via`, naming no author, with how many saved pages were forgotten and not restored, and this machine's count of pages opened, and of the times a recall named a page and the session then opened it (§4.5) |
| | `brain sources` | what was ingested, per source, with the version each page was written from (§1.7) |
| pages, reading | `page search` | the mode and the hits, each with its page and a snippet (§4.3) |
| | `page list` | the pages of the chain's brains, or of one, with their fields, their links both ways (§3.3) and what changed since this machine's last session (§4.1); a window |
| | `page show` | one page: the same fields, its body or one slice of it, and its history (§3.3) |
| pages, writing | `page save` | answers the similar pages instead of writing when it finds some, else writes; in a brain with several namespaces and none named, says what each is for (§1.4, §3.2) |
| | `page update` | edits a page in place and appends its Changelog or Evidence line; one that changes nothing is refused (§3.5) |
| | `page supersede` | writes the new decision and marks the old one (§3.5) |
| | `page forget` | deletes a page; git keeps it (§3.5) |
| | `page restore` | brings back a page that was forgotten or merged away, as it was, in the brain named (§3.5) |
| | `page confirm` | records that the page is still true, who by and when (§3.5) |
| | `page retire` | marks a page not current, or current again (§3.5) |
| | `page move` | gives a page another namespace of its brain; the id stays, the links follow (§3.2) |
| | `page rename` | gives a page a new title; the links follow (§3.5) |
| | `page merge` | makes one page of two of a brain, with the body sent; the id of the one that stays, the names of the other as aliases, and the links follow (§3.5) |
| | `page link` | adds each page to the other's See also, with the relation when given (§3.3) |
| | `page promote` | writes the page again in a more shared brain of the chain, by tier or name, through `save` there, then retires, forgets or keeps the original (§1.3) |
| | `page evolve` | lists the Skill candidates with their When and occasions, or converts one (§3.6) |
| the integration's | `hook` | what the host's hooks call (§6.2) |

`kioku`, `kioku help`, `--help` and `-h` print an overview: a first line with
the mark and what Kioku is, `kioku.md · memory for coding agents`, then the
verbs of one word in their sections, then a line for each group, what it holds
and how many verbs it has, then how to see more; `hook`, which only the host
calls, is not in it. A group named alone, `kioku page`, or after `help`, lists
its verbs, a line each, and exits 0. `kioku help <verb>`, `kioku help <group>
<verb>`, and `--help` or `-h` after a verb, print one verb's usage, what it is
for and where the reference says more. With `--json`, help answers the verbs it
shows, every verb for the overview. At a terminal help fits the terminal's
width, and in a usage line the command is bold, a flag orange, a placeholder
lavender and the brackets dimmed. A verb the tool does not have answers
`unknown_verb` and names the one it resembles. A verb misused, a flag it does
not have, a value missing or one it does not take, a word too many, is told in
the tool's words, then the verb's usage and `kioku help <verb>` (`usage`); in
JSON the message is one line, what is wrong and the usage. `kioku --version`,
`-v` or `-V`, prints the version. Every other flag is long.

**Which brain.** The verbs that take a page take `--brain <b>`; a path is
brain-relative or absolute, and without `--brain` it is looked up in the chain.
`--brain` takes a brain's tier, `personal`, `project` or `team`, or its name,
among the brains of the chain;
`kioku brain <verb> <brain>` takes a name among every brain of the machine. Two
brains that answer equally well are an error naming them, never a guess; a brain
not on the machine, an error saying how to bring it. `brain clone` names a brain
by its address, which says where and never what name it holds; `brain create`,
by the name it will have; and `init`, by an address or a name (§2.2, §2.4).

**When a brain is named.** A verb that fixes a brain's identity (`brain create`,
`brain clone`, `brain upgrade`, `init`), takes it off the machine (`brain remove`)
or sends it to a git host (`brain publish`, `brain sync`) always takes the brain
named, never one inferred from the folder or the tier. So does a write with
nothing in the brain to find it by, which would otherwise land wherever the
folder or the number of brains on the machine sent it: `page save`,
`page restore`, `namespace add` and `brain language` always name the brain
they write to, inside a brain too. A verb that only reads, or changes what a brain already
holds (`page show`, `page forget`, `namespace describe`, `brain log`,
`brain lint` and the rest), takes `--brain` or `[<brain>]` as an option:
without it the brain the folder is inside, else the brains of the chain
answer, and where more than one would answer a write, it is the error above.

**Bounded answers.** A verb whose answer grows with a brain gives 20 entries
unless `--limit` says otherwise, one number for all. `page list` and `brain
log` answer a window whether or not a flag was given, saying how many there
are in all and the `--offset` that reads on, which needs no `--limit`; `page
search` answers the best 20 and whether there are hits behind them; `brain
lint` each list's first 20 entries and how long each list it cut is.
`namespace list` is not bounded.

**What a write answers.** The brain, the path, the commit and the publication
state (`pushed`, `pending`, or `local` for a brain with no remote), with the
page's `id`, `title`, `kind` and `subkind` (after the write, or before
`forget`), the validator's warnings, and what the verb adds: the decision
replaced, the pages that linked to a forgotten one, the page a merge took in
and the pages whose links followed, the commit a restore undoes, an instinct's
candidacy (§3.6), and for `save` the pages on its subject in the session's
other brains (§1.4). A refusal answers in the same shape with `status: error`, a code and
the reason. The hook writes what it did into the session's journal (§4.6),
from which the mod draws the rows (§1.2). A publication not yet pushed is kept
as machine state (§2.5) for `sync` to retry (§1.6).

## 6.2 Agent integration

An agent host is an integration the host holds as a plugin, added with
`kioku plugin <host> install` and removed with `kioku plugin <host> uninstall`.
The host the tool knows is Claude Code, `claude-code`; what differs between
hosts, their hook JSON, their plugin records and the files a brain carries for
them, is one adapter per host, apart from the rest. The plugin **travels with
the tool**: a release carries it beside the bundle (§6.4), and the installer,
`kioku update` and a package manager put it in a folder beside the tool, a
marketplace of one plugin the host reads in place; its version is the tool's,
and the host has no other way to it. The plugin holds:

- hooks, each calling the launcher (found by the build a developer names, else
  the `PATH`, else where the installer puts it). At the session's start, two
  compose the summary's two parts (§4.1), each inside a brain of that brain
  alone (§2.7), and the first writes it to the journal, starts `sync`, says
  when there is no personal brain (§1.2), and starts the daily look for a new
  version where the installer installed the tool (§6.4), and a third gives a
  session that starts anew the handoff of its place (§4.8), its wrapper
  starting nothing on a machine that holds none; at each prompt, one
  counts the session's next turn (§4.6) and adds the pages that bear on the
  prompt (§4.7); before the host compacts a session, one asks its summary to
  keep what was said and not saved (§1.1); when the session starts a subagent,
  one gives it the Rules (§4.1); after the shell tool, one filtered to the tool's writing and
  reading verbs writes what they did into the journal (§4.6), and after
  `kioku handoff set` names on the handoff the pages the session reached
  (§4.8); before the skill
  tool, one lets the host load Kioku's own skill without asking, writing that
  into the journal, and nothing for another skill; before the host's tools
  that read or change one file, one names the pages that say they are about
  that file (§4.7), its wrapper starting nothing where no page says so; before
  `kioku namespace add`, one has the host ask the person, naming the namespace and its brain
  (§3.2), whatever `display.mute` holds; a namespace added in a terminal goes
  through no hook;
- one mod, which draws the rows, the footer, the memory history, the page
  viewer and the search of §1.2, with `/kioku-history`, `/kioku-search` and
  `/kioku-evolve` (§3.6), which sends the agent one line for the skill to act on,
  from the journal, read after each of the tool's commands and each prompt,
  with no process of its own; after `/clear`, `/resume` or `/branch` it puts
  back what the session start found and reads the journal again. A failure of
  its own never stops a command, the hooks work without it, and it has no
  options;
- one skill, written only there, with the whole policy: §1.1, §1.3, §1.4,
  §1.5, §1.6, instincts and Skills (§3.6), how to search, that a brain is read
  only through the tool (§4.1), that `page list` and `brain log` answer a
  window (§6.1), how to act on the person's corrections, and how to work
  inside a brain (§2.7). It allows the tool once it is loaded, which is all
  that saving without a yes needs (§1.1). The agent loads it; the person's
  menu of commands does not list it;
- no command files: the mod's commands carry no plugin prefix; `/ingest` (§1.7)
  is each brain's. There are no commands to start or close a session, to save, to
  propose or to approve, and none that runs on its own.

The agent calls the tool as `kioku`, the first word of the command, the body in
a heredoc, so the hooks' filters match; when the person's `PATH` does not reach
the launcher, the session's start puts its folder on the shell tool's `PATH`.

`kioku plugin claude-code install` runs, of adding the folder beside the tool
as a marketplace and installing the plugin from it, what is not done; that
folder does not move when the tool does, and a marketplace of the same name
from elsewhere is pointed at it. A tool with no plugin beside it is refused,
with the reason. `uninstall` removes the plugin, then the marketplace. Both say
what they will do and ask, refuse outside a terminal, write nothing into the
host's settings, work in the host's configuration folder in effect, and need
the host's own command on the `PATH`. **The plugin follows the tool with no
command**: the host reads a marketplace added from a folder in place at each
session start, so when the tool moves, the next session loads the plugin of
that version; a session open while it moved keeps the plugin it started with.

**A plugin and a tool of different versions still work together**, since every
write goes through the tool: a verb the skill names that the tool lacks fails
with the tool's error, a write the plugin's filters do not know makes no entry,
so no row and no count, and a hook the tool does not know answers nothing and
succeeds. The hooks hand the tool the plugin's version, and when the session
start finds the two apart it says so once for each pair (`plugin-version`,
§1.2), with the command that brings them together: `kioku plugin <host>
install` when the plugin is behind; when the tool is, `kioku update` where the
installer installed it, or else the command of what installed it (§6.4).

## 6.3 What a person needs

| Needs | For | If missing |
|---|---|---|
| Node 24 or later | running the tool | the installer and `doctor` say so and how to install it |
| git | brains | |
| Claude Code | the agent integration (§6.2) | the tool works from the terminal; nothing saves on its own |
| An account on the git host of the shared brains, with access to their repositories | reading and writing published shared brains; none for a brain with no remote or published to a repository on disk; nothing needs GitHub | access is granted by whoever administers the brain's repository |

There is no Kioku account, no service, no token of its own and nothing that
listens on the machine. Identity is the person's git host account, with the
credentials git already uses; permissions per brain are the repository's.
Installing is one command:

```bash
curl -fsSL https://raw.githubusercontent.com/monoku/kioku/main/install.sh | sh
```

The installer downloads the bundle and the plugin's archive from the latest
release, with a plain download and no account, checks each against its
checksum (§6.4), and installs nothing when one disagrees. The bundle it
downloaded unpacks the archive, so that how a release lays its plugin out is
known only to that release's tool. It keeps one folder
per version, the plugin beside the bundle, and marks the active one, which the
launcher `kioku` runs, or the build a developer names; run again, it moves the
mark to the latest release, as `kioku update` does. In a terminal it then runs
`kioku setup` with the arguments it was given, and a failed `setup` leaves the
tool installed and says how to run it again; with no terminal it writes no
configuration, profile or brain, and names the next step, `kioku setup`, by
the launcher's whole path when its folder is not on the `PATH`.

`kioku setup` does, once and idempotently, what a machine needs: the machine
configuration (§2.5); `kioku` on the `PATH`, by a link in a folder already on
it or else by the shell's profile; the shell's completion, by a file or a
profile line that evaluates `kioku completion <shell>`, so it follows every
update; and the search model (§4.3), fetched by the `sync` it starts in the
background, unless `--no-model`. Before it writes anything, it brings forward
what an older version left, as the hand-over of `kioku update` does (§6.4): it
rewrites a configuration an older version wrote (§2.5) and raises the person's
own brain to the newest format (§3.2), and says so; a project or team brain of
an older format is left as it is, and said. Then it refreshes every brain
(§2.7), writing only what differs. The installer, run over an older version, so
leaves the machine as `kioku update` does.
Neither it nor the installer makes a brain: while there is no personal brain,
`setup` says how to bring one or make one and, unless `unpublished` is muted
(§1.2), that `kioku brain publish <brain> --remote <destination>` then puts it in a repository they make (§2.3). It
refuses outside a terminal, and ends by naming the agent hosts on the machine
with no Kioku plugin, with the command that installs it (§6.2), the person's
own step; until then nothing happens in that host's sessions, and `doctor`
says so.

## 6.4 Releases and updates

The tool uses semantic versions, `<major>.<minor>.<patch>`, and every release is
the latest when it is published. The version is `0.x` for as long as the
interface may change, with the meaning semantic versioning gives `0.x`: a change
to a verb, a flag, a message or the JSON contract that breaks what worked raises
the minor, as new behaviour does, and a fix raises the patch; each is said in
the CHANGELOG. The brains' files are promised from the first release (§3.2). A
release is what the product repository's main branch holds when its version
moves, and it is tagged `v<version>` there: the bundle, the host's plugin as a
marketplace of its own, and a checksum for each; the plugin is released with the
tool at the same version (§6.2). A brain's `format` is a
separate counter that moves only when brain files change incompatibly. Versions
are ordered as semantic versioning orders them.

`kioku update` brings the machine to the latest release, never back: a latest
that is not newer than the version running changes nothing, so a machine on a
build of its own newer than the latest stays there. It downloads only the
bundle and checks it against its checksum, then hands over to the version it
downloaded, twice. First, before the active version moves, that version fetches
the plugin's archive of its own release, checks it against its checksum and
puts the plugin beside its bundle: the version running knows nothing of how a
newer one lays its plugin out, so a release may change it without a step
between. Then, once it is active, it rewrites a configuration an older version wrote (§2.5), raises the
person's own brain to the newest format and says so (§3.2), and refreshes every
brain (§2.7); a project or team brain of an older format is left as it is, and
said. It keeps the previous version and says that
`kioku update <previous version>` goes back. `--check` says whether there is a
newer version and `--dry-run` what it would do; both write nothing. `kioku
update <version>` installs that release, a newer or an earlier one, only in a
terminal. A download that fails or does not match its checksum, or a version
that cannot put its plugin in place, changes nothing.

The tool moves only when the person moves it: `kioku update`, the installer run
again, or the package manager that installed it. No session installs anything.
Where the installer installed it, the session's start looks, at most once a
day and in the background, whether a newer release exists, and the next session
says so once (`update-available`, §1.2); with that notice muted, no session
looks. The stamp of the last look and the version found are machine state
(§2.5); a look that fails is tried the next day. A tool installed any other
way, by Homebrew or as a build a person runs from where they put it, is updated
by what installed it: no session looks, and `kioku update` changes nothing and
answers `managed`, with the command that updates it.
