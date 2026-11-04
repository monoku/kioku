# Uninstall Kioku

Taking Kioku off a machine, in this order. Only `~/.kioku/` holds memory; the
rest is reinstalled in a minute.

## 1. Take the integration out of Claude Code

```bash
kioku plugin claude-code uninstall
```

It removes the plugin and its marketplace.
With a second configuration folder of Claude Code, run it again with that
folder in effect.

## 2. Decide about the brains

`~/.kioku/brains/` holds your personal brain and the clones of the shared
ones. If the personal brain has no remote (`kioku doctor` says "no remote"),
deleting it deletes that memory: publish it first with `kioku brain publish`,
or copy the folder somewhere else. A shared brain is on its git host and is
cloned again when a machine needs it.

## 3. Delete the tool and the state

```bash
rm -rf ~/.local/share/kioku ~/.local/bin/kioku ~/.kioku
```

The tool is under `$XDG_DATA_HOME/kioku` when that variable is set, and
wherever `KIOKU_INSTALL_DIR` and `KIOKU_BIN_DIR` pointed when they were used.
`~/.kioku/` also holds the machine configuration, the search index and the
search model.

## 4. Undo what `setup` wrote in your shell

The files and lines are listed under [`kioku setup`](../reference/cli.md#kioku-setup)
in the command-line reference: remove the fish files, and the `# kioku` lines
and the one after each in `.zshrc`, `.bashrc` or `.bash_profile`.

If `setup` linked `kioku` into another folder of your `PATH` (`which -a kioku`
shows it, `~/bin/kioku` say), remove that link.

## 5. Optional: the project folders

A `kioku.yaml` that `kioku init` wrote into a project folder is harmless
without Kioku; remove it if the repository should not carry it.
