# Threat model

What Kioku defends against, what it does not, and where the line is: the
[spec](../specs/README.md) and [the design](design.md) read from the side of
someone who wants to misuse them.

## What is worth protecting, and from whom

The machine and the person's accounts, since an agent that runs `kioku` runs
with their permissions; the brains' contents, which reach the agent's context
and so act as instructions; what must never be written down (§1.5); and the
tool and the model it fetches.

| Actor | Can | Cannot |
|---|---|---|
| A teammate with push access to a shared brain | Write any page (§3.5) | Make a machine load a brain it does not trust |
| Whoever writes a code repository's `kioku.yaml` | Name brains, which this machine loads only if it trusts them (§2.4) | Send a trusted brain's clone or pushes to an address the machine does not know |
| Someone whose text ends up in a page: an ingested source (§1.7), docs, a web page | Put instructions in what the agent later reads | Run anything by themselves |
| The agent, misled or mistaken | Run the verbs the skill allows | Run the verbs that are the person's |
| Whoever controls where a release or the model comes from | Serve a different file | Pass a file that does not match its checksum |

The person at the terminal is trusted; a compromised machine is out of scope.

## What a page can and cannot do

Kioku cannot make page text safe to obey. It limits what an obeyed page can
reach.

**Held by the tool**

- **A brain loads only when trusted** (§2.4). A `kioku.yaml` naming another
  brain makes the machine say so, never clone it.
- **What changes the machine needs a terminal** (design principle 11):
  `setup`, `config set`, `brain clone`, `publish`, `remove`, `trust`,
  `plugin … install|uninstall` and `update <version>` refuse unless
  standard input and output are a terminal (`needs_terminal`,
  `src/cli/terminal.ts`).
- **A brain reads only its own files**: a symbolic link, or a path that leaves
  the brain's folder, is read as missing (§3.1), so a committed link cannot
  bring a file of the machine's, `~/.aws/credentials` say, into the summary;
  the validator names every link (§5.1 rule 12).
- **A page cannot restructure the summary**: its headings are pushed down when
  the summary is built (`src/core/session/summary.ts`).
- **Rows come from the tool's result** (principle 5): a page cannot make the
  person believe a save happened, or did not.
- **The journal holds names, never text** (§4.6), and a session's id names its
  file only when it is one word of letters, digits, `-` and `_`.

**Not held, by design**

- **A page can steer the agent toward the writing verbs**, which it runs
  without asking (§1.1): write, supersede, forget. The defence is after the
  fact: every write is a commit, `brain log` lists them, `forget` reverts.
- **`Kioku-Via` is a label, not a proof**: any process can write that trailer,
  and no check relies on it.
- **Anything else the agent may do** (edit code, run commands) is the host's
  permission model; Kioku adds only the allowance of its own verbs once its
  skill is loaded.
- **Trusting an owner trusts everything it publishes**, later repositories
  included.

## Secrets and identifiers

Layer 1 of §1.5 is enforced by the skill and by the validator's patterns,
which every write runs before committing: line by line, the shapes of common
hosts and clouds and long `label: value` assignments, so a short password, a
split or encoded value or an unknown provider's token passes, and only what
goes through the tool is seen, not a commit pushed with git. A finding names
the pattern, never the match. Layers 2 and 3 rest on the skill's judgement.

A secret that reaches a brain stays in git history after `forget`. Rotating it
is the remedy; rewriting history is the person's, outside Kioku.

## The tool and what it fetches

- **The bundle and the plugin** are checked against their checksums from the
  same release, and nothing is installed when one disagrees (§6.4); the
  plugin's archive is unpacked only into its version's folder. That catches a
  corrupted download, not a release whose files and checksums were both
  replaced; a build provenance attestation would.
- **No update installs itself.** A release reaches a machine only by the
  person's `kioku update`, installer or package manager. A bad release still
  rewrites the files the tool owns in every brain of a machine that installs
  it; `update` keeps the previous version and says how to go back.
- **The embedding engine and model** come from pinned URLs, checked against a
  pinned size and checksum (`src/core/semantic/install.ts`), and no hook loads
  them.
- **`curl | sh`**: the installer checks what it downloads; a reader who wants
  more reads the script first.
- **Git runs nothing a repository ships.** A clone is a plain `git clone` of
  a reference held to `[\w.-]` parts, or of a `url` the machine trusts: the
  one a key says, an ssh address of the same repository, or one the person
  recorded, never one a folder's `kioku.yaml` alone gives (§2.4); an
  address beginning with `-` is refused, and addresses go after `--`. Hooks,
  filters and drivers need configuration a clone does not carry, and nothing
  recurses into submodules. The person's own git configuration is theirs.

## Out of scope

A teammate who writes false but well-formed pages (a review problem: the
summary and `brain log` show them); keeping a brain from people who can read
its repository (the git host's access control); an agent host that ignores its
own permissions.
