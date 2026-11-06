# How Kioku is put together

The memory is plain files in git, and one tool reads and writes them. This page
names the parts and how they meet; what each does exactly is in the
[spec](../specs/README.md), and what shapes it in
[How Kioku is designed](design.md).

## The parts

```text
 ┌─────────────────────────── Claude Code ───────────────────────────┐
 │  the kioku plugin: hooks, skill, /kioku-evolve, and the mod that  │
 │  draws the rows, the footer, the history, the viewer, the search  │
 └──────┬────────────────────────────────────────────────────────────┘
        │ hooks: kioku hook <event>        agent: kioku <verb> (Bash)
        ▼
   ~/.local/bin/kioku ── launcher: runs ~/.local/share/kioku/current/kioku.mjs
        │
        ├── src/cli       verbs: parse, call core, answer text or JSON
        ├── src/core      everything that is true of brains
        └── src/harness   the adapter that knows the host
        ▼
   brains: git repositories of Markdown      ~/.kioku/: config, index, model, journals
```

| Part | Where | What it is |
|---|---|---|
| **Brains** | any git repository; cloned under `~/.kioku/brains/` | Markdown pages with YAML front matter, one brain per person, project or team: the only place memory lives (spec §2, §3) |
| **The tool** | `src/`, shipped as `lib/kioku.mjs` | All the logic: brains, the index, git, validation (spec §6.1) |
| **The plugin** | `plugins/claude-code/`, beside the tool once installed | Hooks, one skill, one command, and the mod, which draws from the session's journal (spec §1.2, §6.2); its files are below |
| **The index** | `~/.kioku/` | A disposable SQLite file for full text, and from a local model one vector per page and one per section of it (spec §4.3) |
| **The installer** | `install.sh` | Fetches the latest release, checks it and installs it; `kioku update` does the same from inside (spec §6.3, §6.4) |
| **The formula** | `scripts/homebrew-formula.mjs`, written into the tap `monoku/homebrew-kioku` at each release | Homebrew's way to install the same release: the bundle, the plugin under a folder that does not move, the completion (spec §6.3) |
| **The demo** | `scripts/demo/` | Three brains seeded through the tool's own verbs ([how-to](../how-to/demo.md)) |

## Inside the tool

- `src/cli/` is thin: each verb parses its flags, calls core and returns
  `{data, text, exit}`; `run.ts` dispatches and prints. `verbs.ts` declares
  every verb once, for the parser, `help`, `completion` and the reference.
- `src/core/` holds the rules: `brain/` (files, front matter, kinds, paths),
  `config/` (the machine configuration, `kioku.yaml`, the chain), `brains/`
  (create, clone, init, publish, refresh, remove, trust), `write/`,
  `validate/`, `index/` and `semantic/` (search), `session/` (the summary, the
  journal), `setup/` (the install, the `PATH`, the completion, updates), and
  modules for `sync`, `doctor`, `lint`, `log`, `conflicts` and the rest.
- `src/harness/` is the only place that knows a host: its hook input and
  output, its plugin commands, the files a brain carries for it. Adding a host
  is adding an adapter.

## The plugin's folder

`plugins/claude-code/` is at once the marketplace and the plugin: its
`.claude-plugin/marketplace.json` names the plugin as the folder itself
(`"source": "./"`), `plugin.json` carries the version, the tool's, and the
repository's root is not a marketplace. A release's `kioku-plugin.tar.gz` is
that folder without its tests; to work on it, `claude --plugin-dir
plugins/claude-code`. `hooks/hooks.json` has one handler per event, the shell
ones filtered `if: "Bash(kioku <verb> *)"`, each running `hooks/kioku.sh`, which
finds the launcher by `KIOKU_BIN`, then the `PATH`, then `KIOKU_BIN_DIR` or
`~/.local/bin`, and hands the tool `KIOKU_PLUGIN_VERSION`; the mod is
`hooks/register.tsx`, under `modules`, which also serves the commands; the skill
`skills/kioku/SKILL.md`.

## The path of one save

1. The agent decides something is worth keeping (spec §1.1) and runs
   `kioku page save …` with the body in a heredoc.
2. The tool resolves the folder's chain and looks for similar pages in the
   target brain (spec §1.4): it returns them, or validates the page, brings in
   what was published, writes, commits and pushes (spec §1.6). A push that
   fails waits in `~/.kioku/pending.json` for the next `sync`.
3. It answers with the brain, path, commit and publication.
4. The `PostToolUse` hook writes that answer into the session's journal, and
   the mod draws the row at the call. The agent's reply names no file.

## The path of a session start

1. Claude Code runs two hooks at once, one for each part of the summary
   (spec §4.1): how to use the memory, and what it holds.
2. Each finds the chain (spec §2.4, §2.7) and composes its part from files
   only, to the host's cap for one hook. The first also starts
   `kioku sync --cwd <dir> --background` without waiting.
3. The first says what the person must see (spec §1.2) and writes the summary
   into the journal; the mod draws the footer.

## The path of a prompt

1. Claude Code runs `kioku hook user-prompt-submit`, which counts the
   session's next turn (spec §4.6).
2. Then, within a second, the recall (spec §4.7, `src/core/session/recall.ts`,
   imported by this hook alone): it opens the index only as it is, loads the
   model, embeds the prompt and weighs the pages with a current vector; past
   the second it adds nothing.
3. The pages that stand out go to the agent as one line each, to the person as
   one row, and into the journal; the process ends with its answer, whatever
   the recall left running.

## Embedding the tool

- **The verbs are data.** `commands` in `src/cli/run.ts` maps each verb to its
  handler, and `run` takes the context (home, folder, environment, standard
  input) as an argument.
- **Nothing in `src/core/` reads the home, the folder or the environment by
  itself.** They arrive in the context; `KIOKU_HOME` is read once, in
  `defaultContext`. git inherits the environment the program was given, plus
  `GIT_TERMINAL_PROMPT=0` and ssh in batch mode.
- **One verb at a time per program.** The steps a verb shows
  (`src/core/steps.ts`) are one value for the whole program.
- **The JSON is versioned.** `kioku --version --json` says `contract`;
  `tests/contract.test.ts` pins the fields programs read
  ([answers](../reference/answers.md)).

## What lives where on a machine

| Path | Holds | Travels? |
|---|---|---|
| a brain's folder | the memory and its history | yes, through git |
| `<project folder>/kioku.yaml` | the folder's project and team brains | yes, with the code |
| `~/.kioku/config.yaml` | the machine's brains, the addresses it accepted and its preferences | no |
| `~/.kioku/brains/<owner>/<repo>/` | every brain of the machine, by its name, made here or cloned | no |
| `~/.kioku/` (index, model, `pending.json`, `sessions/`) | derived state and each session's journal, dropped two days after its last entry | no |
| `~/.local/share/kioku/versions/<v>/` | the tool and its `plugin/`; `current` points at the active one, and Claude Code reads `current/plugin` | no |
| `~/.local/bin/kioku` | the launcher | no |
