# 2. Brains

## 2.1 Three tiers, one chain

| Tier | Owner | Holds | How many |
|---|---|---|---|
| personal | one person | how they work, their lessons and instincts | one per person |
| project (or client) | the people on that project | decisions, playbooks and context of one project or client | one per project, whatever folders it spans |
| team | the whole team | conventions, how the team works | one per project folder, as many teams as the person works with, and one of the machine's own for folders that name none |

A session loads one chain, personal → project → team, and every link points at
one brain: the machine configuration has a single `brain` key and at most one
`team`, a project folder's `kioku.yaml` a single `brain` key and at most one
`team`; a brain's own file names no brain (§2.4). At most three brains load at
once; two for a project with no team, or a repository that names a team and no
project; one, the personal brain, in a folder with no `kioku.yaml` on a machine
with no `team`; none on a machine with no personal brain (§2.3); exactly one,
the brain itself, in a session opened inside a brain (§2.7). Which project
applies comes from the folder. A project that names a team shares it with
everyone in it; where it names none, each person's own team, the machine
configuration's `team`, loads, and the summary says so (§4.1). The cost: in a
project whose folder names no team, a page saved to the team goes to the
person's own team, which teammates may not see. The agent reads the brains of
the chain together, and on conflict the most specific tier wins, personal over
project, project over team: with one brain a tier, that always has one answer.

An area of the team (engineering, design) is a namespace in the team brain; a
client with several products is one project brain with a namespace per
product; two companies are two team brains, each named by its own project
folders; a second personal brain is not allowed: use two namespaces.

## 2.2 One git repository per brain

Each brain is its own git repository, the whole of it, so that access is
granted per brain; the default branch holds it, and there are no proposal
branches. A reference to a brain is its repository,
`github.com/<owner>/<repo>`, in `brain` and `team` of a project folder's
`kioku.yaml`; unknown keys are an error in these files and in
`~/.kioku/config.yaml`, a `path` in a reference among them. `host/owner/repo`
is the brain's key on every machine, and says where its repository
is, `https://<host>/<owner>/<repo>.git`. A brain's repository takes any name:
`team-brain`, `kioku-brain` and a person's `brain` read well. A repository
elsewhere (ssh, the team's own host, a shared disk) is named the same way with its address beside it, `url`: anything git clones from,
a folder or `file://` included. An ssh address, `git@host:owner/repo.git` or
`ssh://…`, says both name and place and may stand alone as the reference; else
`{ repo, url }`. An address that begins with `-` is refused wherever one is
taken. The machine keeps the address of each repository it knows (§2.5), so a
brain is cloned from where it is.

## 2.3 Where Kioku is active

**The personal brain, once the person has one, is always on**, in any folder.
A machine has none until the person brings or makes it, `kioku brain clone
<owner>/<repo>`, or `kioku brain create`, which with no brain named makes
`<name>/brain`, `<name>` being the name the person goes by as this machine
knows it: the name git knows (`github.user`, else the name, else the part of
the email before the `@`), else the system user. It says where the name came
from and that `git config --global github.user <handle>` changes it; with a
personal brain already on the machine it refuses and names it (§6.1). Neither
the installer, `setup` nor a session makes or brings one (§6.3). **A brain has
no name of its own.** In a session it is named by its tier (§1.2), which says
who sees it; everywhere else by its repository as a person types it,
`owner/repo` on github.com and `host/owner/repo` on another host (§6.1), and
programs read its key, `host/owner/repo`. **Making or bringing a brain records
nothing about the person.** Without a personal brain, Kioku works with the shared brains a repository names and
nothing personal is saved; the hook says so once a week, as it says once a
week how many pages of a personal brain with no remote live only on this
machine: two notices of §1.2's table, the second muted by `unpublished`.

**A brain is made on this machine and works there whole, with no remote and no
network**: `brain create` asks no git host anything, and the name it gets is
the one it keeps if published. **Only `kioku brain publish` reaches a git host
for a brain with no remote**, when the person runs it: with `--to <url>` it
pushes to the repository there, which must exist and be empty or hold this
brain; without, to the repository the brain's key says. **Kioku never makes a
repository on a git host**: when nothing answers at the address, `publish`
changes nothing and says the two ways on, creating an empty repository there
or giving `--to <url>`. It talks to the host only through git, with git's
credentials, and carries git's own words. A repository that already holds a
brain of the same tier replaces this machine's copy when that copy has no page
and a repository of its own; two brains with pages of their own under one name
are never merged by the tool, which says how to merge them by hand; anything
else in the repository is refused and nothing changes.

**Project and team brains are on only where a project folder's `kioku.yaml`
names them** (§2.4), **or where the session is inside the brain** (§2.7);
elsewhere the personal brain loads, and the machine configuration's `team` when
it names one (§2.5); with none, no team and no warning. Kioku has no switch of
its own: the host's is disabling or uninstalling its plugin, after which the
hooks do not run and the mod draws nothing (§1.2). The tool in a terminal
always answers. There is none per folder either.

## 2.4 Linking a project folder to its brains

A file named `kioku.yaml` in a project folder names its project brain, `brain`,
and its team brain, `team`, either alone or both. A session finds the nearest
such file at or above its folder, with no git involved. A code repository has
it at its root, committed, so a teammate who clones the code gets the link, and
**the link is a request**: a brain it names is cloned and loaded only when this
machine trusts it. A brain is trusted when its repository is in `repositories` of the
machine configuration (§2.5), when its owner is in `trust.owners`, or when it
is the personal brain or the machine configuration's `team`, both the person's
own act; every brain the folder names is checked on its own. A brain the
folder names with an address of its own (§2.2) is trusted only at an address
this machine knows for it: the one its key says, an ssh address of the same
repository, or the one `repositories` records; a trusted name at any other
address is not trusted, so a folder cannot send a trusted brain's clone, or
its pushes, elsewhere, and an address a folder gives is recorded only by the
person's act. Until then the session says which brain it did not load, the
command to run, `kioku brain trust <brain>` or `kioku brain trust --owner
<owner>`, or `kioku brain clone <brain> --url <address>` for an address, which
the person runs in a terminal and an agent cannot, and that a new session loads
it; the summary tells the agent to pass that on. A session inside a brain's folder (§2.7) needs
no check.

The folder is what names the brains, never a brain: a brain's own
`kioku.yaml` names no other brain, so a project brain does not carry its team.
A project that spans several repositories writes the same `brain` and `team`
in each. The team is the folder's, else the machine configuration's `team`
(§2.5), else none: where the folder names no team, or there is no such file,
the person's own team loads.

Linking is one command per folder: `kioku init <brain>`, `kioku init --team
<brain>`, or both. It writes the file in the current folder, or at the root of
the repository it is inside, and refuses inside a brain (§2.7). `init` is the
person naming a brain, so it registers what it names, and asks for a terminal
when the brain is not already known to the machine (registered, or owned by a
trusted owner), as `brain trust` does; `kioku init` alone, where the file
exists, trusts and clones the brains it names. `init` links brains that exist:
one that cannot be cloned leaves nothing behind, neither file nor
registration, and the person is told how to make it; `--create` makes it, as
`brain create` does, on this machine, for teammates to clone once it is
published. A brain the machine knows at an address of its own (§2.2) is
written with that address. A brain's own configuration file is also
`kioku.yaml`, one name, one parser: a project folder's has no `tier`, a
brain's has one (§2.5).

## 2.5 Where brains live on a machine

The tool clones brains into a folder it manages,
`~/.kioku/brains/<host>/<owner>/<repo>/`, the host left out for github.com, or
into the folder the person names with `--dir <folder>` on `brain create`,
`brain clone` and `init`, recorded as the repository's `path` and never moved
by the tool. Only a brain's content travels between machines, through git once
pushed, and a project folder's `kioku.yaml` with its code; the machine's
configuration, the derived index and the rest of the state under `~/.kioku/`
stay on the machine and are rebuilt, and the tool is installed per machine
(§6.3).

The person's configuration, `~/.kioku/config.yaml`, records **where things
are** and the person's preferences, and never which project applies, nor the
team of a project folder that names one:

- `brain` (which brain is theirs), `team` (the team brain that loads where a
  project folder names none, §2.4) and `repositories` (the ones this machine
  knows and trusts, each with an optional `path` and `url`, §2.2).
- Not who the person is: that is git's, and the name the person goes by (§2.3)
  is worked out each time from it, else from the system user, and recorded
  nowhere. It is who confirms a page (§3.3), the name of the personal brain
  `brain create` makes, and, where git knows no one, the author of the tool's
  commits, `<name>@localhost`.
- `display`, what the person sees in a session and in the terminal: `color`
  (`auto`, `always` or `never`) and `mute` (the notices they do not want, by
  the names of §1.2, none by default).
- `search.mode`: `hybrid` or `full-text` (§4.3).
- `trust.owners`: owners, `host/owner`, whose repositories a project folder may
  name without being asked (§2.4).

```yaml
# Kioku's machine configuration. kioku config lists every key, its value and what it takes.
brain: github.com/sam/brain
team: github.com/northwind/team-brain
repositories:
  github.com/sam/brain: { path: ~/code/sam/brain }
  github.com/northwind/team-brain: {}
```

`kioku config` reads and sets the preferences (§6.1) and `team`, which it sets
only to a team brain this machine has cloned, `kioku config set team <brain>`,
and leaves `brain`, `repositories` and `trust.owners` to `brain create`, `brain
clone`, `brain remove`, `init` and `brain trust`. **A key the file does not hold is refused**, in one
message that names it. The tool writes the file, opening it with one comment
line that says `kioku config` lists its keys, and writes only what is set.

A project folder's `kioku.yaml`, committed with the code (§2.4), has `brain`,
`team` or both, `brain: github.com/northwind/app-brain` say. A brain's has `format`
(§3.2), `tier` (`personal`, `project` or `team`), `namespaces` and,
optionally, `language` (§3.2); no name (§2.3), and no other brain (§2.4). Any other key is refused, naming it (§5).
Between them, the most specific brain wins (§2.1).

```yaml
format: 1
tier: project
namespaces: [app]
```

`KIOKU_HOME`, set to a folder, moves where Kioku keeps all of this: `.kioku/`
is looked for in it, and `~` in a brain's path means it. It is for a second set
of brains, a demo or a test; what the agents keep in the person's home stays
there.

`kioku brain remove` takes a brain off **this machine**: it deletes the clone
in the managed folder, forgets the repository in `repositories` and drops its pages
from the index; it never touches the git host, so `brain clone` brings it back,
and a code repository whose `kioku.yaml` names the brain clones it again at the
next `sync`. Unless `--force`, it refuses a brain with no remote, one whose
clone holds changes or commits that exist nowhere else (the branches of §1.6
included), a clone git cannot read, the personal brain and the machine's
`team`; with `--force` on either, `brain` or `team` is forgotten too. A clone
in a folder named with `--dir` is the person's: it is forgotten and its files
are left; the folders where its conflicts were opened go either way. Every
write commits and, in a brain with a remote, pushes (§1.6); a brain with no
remote is never looked for on a git host by `sync`, `brain sync`, `doctor` or a
session: it is `no-remote`, not a failure, until `brain publish` gives it one.

## 2.7 A session inside a brain

A brain is also a folder to open an agent in, to work on the memory itself: ask
what it holds, compare pages, clean it (§4.4), fill it (§1.7). `kioku brain
path <brain>` prints the folder. When the session's folder is inside a brain,
whose `kioku.yaml` has a `tier`, the hook loads **that brain alone**, whatever
its tier. The personal brain and the machine configuration's `team` are still
the session's chain but are not loaded, and the summary says so (§4.1). The
verbs read and write the loaded brain only; `--brain` naming one not loaded is
refused, saying it is in the chain, not loaded and why, and that a session in a
project folder loads the chain; `page promote` needs a second brain and is
refused as well. Nothing loads the chain from inside a brain. The brain must be
one the machine can name: a clone it knows (§2.5), a folder under the managed
folder, or a clone whose `origin` is its repository; a stray copy nothing names
is reported in the summary and only the personal brain loads. Pages go to that
brain; what is about the person is not saved (§1.3). The agent changes the
brain only through the verbs of §6.1, never by editing files, so every change
is validated and committed.

Among the root files of §3.1, the tool owns `AGENTS.md`, which says what the
folder is, how it is read and written and that files are not edited directly,
names no agent, and ends with a comment naming the version that wrote it; and
what each agent host the tool knows needs (§6.2), for Claude Code a `CLAUDE.md`
of one line importing `AGENTS.md` and `.claude/commands/ingest.md`, the
`/ingest` command of §1.7. `brain create` writes them; the validator warns when
one is missing (§5.1). `kioku brain refresh` rewrites them to the current
version's text; `--all` does it for every brain on the machine, which `kioku
update` runs (§6.4). In a project or team brain they only move forward: `brain
refresh` rewrites them only when the running version is the one `AGENTS.md`
names or a later one (the same version writes back a file a person edited); a
version below it leaves them and says which version holds them, so two versions
never undo each other's commits. `--all` leaves shared brains to a build that
is not a release, whose version has a pre-release part, such as one run from a
checkout (§6.4): only `kioku brain refresh <brain>`, naming the brain, writes
such a build's files into it. A file whose version cannot be read names none,
and when neither names one the files are rewritten. The personal brain's are
always rewritten.
