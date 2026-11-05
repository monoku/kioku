# Changelog

What changed in each version of Kioku. What is true now is in the
[spec](docs/specs/README.md); what shapes it, in
[How Kioku is designed](docs/explanation/design.md).

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
