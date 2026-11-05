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

**A brain says its tier** in its own `kioku.yaml` (§2.5), `personal`, `project`
or `team`, set when it is made and never changed: it says who the brain is for,
and a link takes only a brain of its tier, so a client's project brain is never
read as the team's, nor the team's as a project's. A project folder's `brain`
takes a project brain, never the personal brain, which loads in every folder
anyway; its `team`, and the machine configuration's `team`, take a team brain. A brain of another tier is not loaded,
the session says so, and `init`, `kioku init` alone and `config set team` refuse
it.

An area of the team (engineering, design) is a namespace in the team brain; a
client with several products is one project brain with a namespace per
product; two companies are two team brains, each named by its own project
folders; a second personal brain is not allowed: use two namespaces.

## 2.2 One git repository per brain

Each brain is its own git repository, the whole of it, so that access is
granted per brain; the default branch holds it, and there are no proposal
branches. A reference to a brain, in `brain` and `team` of a project folder's
`kioku.yaml`, is its name, `brain: northwind/app-brain`, or its name and its
address, `brain: { name: northwind/app-brain, url: https://github.com/northwind/app-brain.git }`
(§2.4); an address alone, `brain: github.com/northwind/app-brain`, as 0.1.0 wrote
it, is read as that address and the name the last two segments of its path say,
a brain there that holds another name being refused, and `kioku init` alone
rewrites it in one of the two forms; unknown keys are an error in these files and in `~/.kioku/config.yaml`,
a `path` in a reference among them.

**A brain has a name of its own**, `<owner>/<repo>`, how every machine and every
program names it: two segments of letters, digits, `-` and `_`, such as
`sam/memoria` or `northwind/app-brain`. The person chooses it when the brain is
made (§2.3), it is written in the brain's own `kioku.yaml` (§2.5) and committed
with its first commit, and it never changes (a brain 0.1.0 made has it once
raised, §3.2): every machine reads it from there,
whoever cloned the brain and from wherever. The owner is a person, a team or a
company as whoever made the brain wrote it, and owns nothing on a git host.
**The name says nothing of where the brain is**: its repository takes any
address and any name, `https://github.com/sam/memoria.git`,
`git@gitlab.com:acme/platform/kioku.git` or a folder on a shared disk, and holds
the same brain. **One name is one brain on a machine**: two brains of one name,
at two addresses, are never on the same machine, and the second is refused
naming the first. No verb renames a brain: another name is another brain, made
with `brain create`, its pages carried over by hand. So a team names its
brains under an owner of its own, `northwind/`, and a person theirs, so that two
brains a machine may need never share a name.

Wherever an address is taken (`brain clone`, `init`, `brain publish --remote`) it
is any address git clones from: https, ssh, `git@host:path.git` or `ssh://…`,
`file://` or a folder, written as a path that begins with `/`, `./`, `../` or
`~`. `host/path`, whose first segment has a dot, is read as
`https://<host>/<path>.git`; Kioku has no default host, and a name never reads as
an address, for it has two segments, no dot and no leading `/`, `.` or `~`. An address that begins with `-`
is refused wherever one is taken. The machine keeps the address of each brain
(§2.5), so a brain is cloned from where it is.

## 2.3 Where Kioku is active

**The personal brain, once the person has one, is always on**, in any folder.
A machine has none until the person brings or makes it, `kioku brain clone
<address>` or `kioku brain create <owner>/<repo>`. **The name is always given**: Kioku chooses none. `brain create` makes a personal brain unless
`--tier` says project or team. A name another brain of the machine has is refused. With a
personal brain already on the machine, making or cloning another refuses and
names it (§6.1). Neither the installer, `setup` nor a session makes or brings one (§6.3).
In a session a brain is named by its tier (§1.2), which says who sees it;
everywhere else, and for programs, by its name, `sam/memoria`, the same on every
machine (§6.1). **Making or bringing a brain records nothing about the person.** Without a personal brain, Kioku works with the shared brains a repository names and
nothing personal is saved; the hook says so once a week, as it says once a
week how many pages of a personal brain with no remote live only on this
machine: two notices of §1.2's table, the second muted by `unpublished`.

**A brain is made on this machine and works there whole, with no remote and no
network**: `brain create` asks no git host anything and takes no destination.
**Only `kioku brain publish <brain> --remote <destination>` reaches a git host
for a brain with no remote**, when the person runs it, the brain and the
destination always named, the destination any address of §2.2: it sets `origin`
to it and pushes. The brain's name and folder do not change; the address is
recorded as its `url` (§2.5), and `publish` ends by saying that a project folder
which links the brain without its address needs `kioku init` to write it (§2.4). Without `--remote` it refuses and says so, and
`--remote` is the only way a destination is given. **Kioku never makes a
repository on a git host**: the one at the destination must exist and be empty
or hold this brain, and when nothing answers there `publish` changes nothing and
says to create an empty repository there. It talks to the host only through
git, with git's credentials, and carries git's own words. A repository that
already holds a brain of the same name replaces this machine's copy when that
copy has no page; two brains with pages of their own under one name are never
merged by the tool, which says how to merge them by hand; a brain of another
name or another tier, or anything else in the repository, is refused and
nothing changes.

**A brain is looked for on the machine before anything is cloned**: `init`,
`sync` and a session look for it by the name the link gives, and `clone` and
`init`, given an address, by `origin` too. An address says nothing of the name it
holds, so a clone is made first in a folder of the tool's outside the managed
one, where its `kioku.yaml` is read: its `name`, its `tier` and, for a link, that
the name is the one the link says. Only then does the clone move to its folder
under its name (§2.5); any refusal removes it and leaves nothing. A clone whose
name the machine already has is refused, naming the brain here: at another
address, it is another brain of the same name; with no remote, the brain here
is the one to publish, and `clone` says to run `kioku brain publish <name>
--remote <address>`, which joins the two or refuses as above. One repository is
never two brains on a machine, nor one name.

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
machine trusts it. A brain is trusted when it is in `repositories` of the
machine configuration (§2.5), when the owner of its address, the host and the
first segment of its path, `github.com/northwind`, is in `trust.owners`, which
never reaches another host, or when it is the personal brain or the machine
configuration's `team`, both the person's own act, or a brain made on this
machine; every brain the folder names is checked on its own. **Trust follows the
address, never the name**: a name is what a brain says of itself, and anyone can
write `northwind/` in theirs. **A name with no address is a brain of this machine
and nothing else**: it is looked for by name among the brains here and never
cloned, for there is no address to clone from, so it names no place for the tool
to go to; where the brain has a remote, the session says that a teammate cannot
load it without its address and that `kioku init` writes it
(`link-without-address`, §1.2); where the machine has none of that name, the
session says so, that a teammate who has the brain gives its address, and
`kioku init <address>` links it (`brain-not-here`). A brain the
folder names with an address (§2.2) is trusted only at an address this machine
knows for it: the one `repositories` records, or the https or ssh form of the
same repository; a trusted name at any other address is not trusted, and an
address that holds a brain of another name than the link says is refused and
leaves nothing, so a folder cannot send a trusted brain's clone, or
its pushes, elsewhere, and an address a folder gives is recorded only by the
person's act. Until then the session says which brain it did not load, the
command to run, `kioku init` in the folder, which accepts the addresses the file
gives, or `kioku config set trust.owners +<host/owner>`, which trusts every
address of that owner, both of which the person runs in a terminal and an agent
cannot, and that a new session loads it; the summary tells the agent to pass that on. **A brain whose tier the link
does not take** (§2.1), named by address or by name, is not loaded, the session
says so, and `init` refuses to write it. A session inside a
brain's folder (§2.7) needs no check.

The folder is what names the brains, never a brain: a brain's own
`kioku.yaml` names no other brain, so a project brain does not carry its team.
A project that spans several repositories writes the same `brain` and `team`
in each. The team is the folder's, else the machine configuration's `team`
(§2.5), else none: where the folder names no team, or there is no such file,
the person's own team loads.

Linking a project is one command per folder, `kioku init <brain>`, and **`init`
links the project brain alone**: it writes `brain` and keeps the `team` the file
holds. A brain `init` makes is a project brain. It writes the file in the current folder,
or at the root of the repository it is inside, and refuses inside a brain
(§2.7). **A folder's team is written by hand**, `team: northwind/team-brain` or
`team: { name: northwind/team-brain, url: … }`, once per repository and
committed, and `kioku init` alone then trusts and clones it like any brain the
file names, checking that it is a team brain; the person's own team, for folders that name none, is `kioku config
set team` (§2.5). `<brain>` is an
address (§2.2), which `init` clones when the machine does not have the brain, or
a name, **which `init` makes when the machine has no such brain**, as `brain
create` does, saying what it made and where. `init` is the person naming a brain,
so it registers what it names, and asks for a terminal when it makes a brain or
the brain is not already known to the machine (its address in `repositories`, or
at the address of a trusted owner). **The file holds the brain's name, and
its address once it has one**: a name alone links the machines that have a brain
of that name and no others, and `init` says so when the brain has no remote.
`kioku init` alone, where the file exists, trusts and clones the brains it
names, and **writes the address of a brain the file names without one once that
brain has a remote**, so the person who published it commits the link a teammate
can clone. One that cannot be cloned leaves nothing behind, neither file nor
registration, and the person is told how to make it. A brain's own configuration file is also
`kioku.yaml`, one name, one parser: a project folder's has no `tier`, a
brain's has one (§2.5).

## 2.5 Where brains live on a machine

**Every brain lives in the folder the tool manages**, `~/.kioku/brains/<owner>/<repo>/`,
its name: `sam/memoria` is `~/.kioku/brains/sam/memoria/` on every machine.
There is no other place: no verb takes a folder for a brain, the configuration
records none, and the name alone says where a brain is. `kioku brain path
<brain>` prints it; a link the person makes to it is theirs, and a session
opened through one is inside the brain (§2.7). **A brain of the machine is a
folder there whose `kioku.yaml` holds its name**: one made here is known by its
folder alone, and is gone when the folder is; one with a remote is also in
`repositories`, and when its folder is missing `sync` and a session clone it
again. Only a brain's content travels between machines, through git once
pushed, and a project folder's `kioku.yaml` with its code; the machine's
configuration, the derived index and the rest of the state under `~/.kioku/`
stay on the machine and are rebuilt, and the tool is installed per machine
(§6.3).

The person's configuration, `~/.kioku/config.yaml`, records **where things
are** and the person's preferences, and never which project applies, nor the
team of a project folder that names one:

- `brain` (which brain is theirs), `team` (the team brain that loads where a
  project folder names none, §2.4) and `repositories`: **the addresses the
  person accepted**, each under the name of the brain it holds, `name: url`. A
  brain made here is not in it until it is published (§2.3), for it has no
  address to accept; `brain publish`, `brain clone` and `init` add one, and
  `brain remove` drops it.
- Not who the person is: that is git's, and the name the person goes by is
  worked out each time from it, else from the system user, and recorded
  nowhere. It is who confirms a page (§3.3) and, where git knows no one, the
  author of the tool's commits, `<name>@localhost`; it names no brain.
- `display`, what the person sees in a session and in the terminal: `color`
  (`auto`, `always` or `never`) and `mute` (the notices they do not want, by
  the names of §1.2, none by default).
- `search.mode`: `hybrid` or `full-text` (§4.3).
- `trust.owners`: owners of addresses, `host/owner`, whose repositories a
  project folder may name without being asked (§2.4), a list `kioku config set`
  writes as it writes `display.mute`: whole, `a,b`, or one owner added, `+a`, or
  taken out, `-a`.

```yaml
# Kioku's machine configuration. kioku config lists every key, its value and what it takes.
brain: sam/memoria
team: northwind/team-brain
repositories:
  sam/memoria: git@github.com:sam/memoria.git
  northwind/team-brain: https://github.com/northwind/team-brain.git
```

A configuration 0.1.0 wrote, by `host/owner/repo` and with a `path` or `url` for
each repository, is rewritten in this form by the version that first reads it,
in the hand-over of `kioku update` (§6.4), saying so: each brain takes the name
its key gave it, `github.com/sam/brain` is `sam/brain`, and one kept elsewhere,
in a `path` of the person's or under its host, moves to its folder under that
name, its files unchanged. Two brains whose keys give one name, from two hosts,
are left as they were, and the hand-over and `doctor` say so and how to remove
one.

`kioku config` reads and sets the preferences (§6.1), `trust.owners`, and `team`,
which it sets only to a team brain this machine has, `kioku config set team
<brain>`, and leaves `brain` and `repositories` to `brain create`, `brain clone`,
`brain publish`, `brain remove` and `init`. **A key the file does not hold is refused**, in one
message that names it. The tool writes the file, opening it with one comment
line that says `kioku config` lists its keys, and writes only what is set.

A project folder's `kioku.yaml`, committed with the code (§2.4), has `brain`,
`team` or both, each a name or a name and its address (§2.2). A brain's has
`format` (§3.2), `name` (§2.2; from `format: 2`, §3.2), `tier` (`personal`, `project` or `team`, §2.1),
`namespaces` and, optionally, `language` (§3.2); no other brain (§2.4). Any other key is refused, naming it (§5).
Between them, the most specific brain wins (§2.1).

```yaml
format: 2
name: northwind/app-brain
tier: project
namespaces: [app]
```

`KIOKU_HOME`, set to a folder, moves where Kioku keeps all of this: `.kioku/`
is looked for in it, the brains in its `brains/` included. It is for a second set
of brains, a demo or a test; what the agents keep in the person's home stays
there.

`kioku brain remove` takes a brain off **this machine**: it deletes the brain's
folder and the folders where its conflicts were opened, forgets its address in `repositories` when it has one, and drops its pages
from the index; it never touches the git host, so `brain clone` brings it back,
and a code repository whose `kioku.yaml` names the brain clones it again at the
next `sync`. Unless `--force`, it refuses a brain with no remote, one whose
clone holds changes or commits that exist nowhere else (the branches of §1.6
included), a clone git cannot read, the personal brain and the machine's
`team`; with `--force` on either, `brain` or `team` is forgotten too. Every
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
one of the machine's, a folder under the managed folder, the path resolved
through any link the person made to it (§2.5); a copy elsewhere, a git clone of
its repository included, is not, and the summary says so and only the personal
brain loads. Pages go to that
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
