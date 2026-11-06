# Working on Kioku

Kioku is memory for coding agents, kept in **brains**: git repositories of
Markdown pages the agent reads and writes through the `kioku` CLI, with
Claude Code as the host. Start with `README.md`, then `docs/specs/README.md`.

## Where things are

- `docs/specs/` says **what is true**, one file per part, and
  `docs/explanation/design.md` **what shapes it**; `docs/README.md` says where
  the rest is.
- `src/` is the tool (TypeScript on Node 24, no build step in dev), with its
  bundle `lib/kioku.mjs` made by `pnpm build` and not tracked;
  `plugins/claude-code/` is the Claude Code plugin, one folder per host, at
  once marketplace and plugin, packed by `pnpm build` as
  `lib/kioku-plugin.tar.gz`; `install.sh` is the installer. How they fit is
  `docs/explanation/architecture.md`.
- A verb is declared once, in `src/cli/verbs.ts`, which the parser, `help`,
  `completion` and the tests read. A verb or flag changed there needs
  `pnpm docs:cli` (it writes each verb's top in `docs/reference/cli.md`), the
  fields it answers in `docs/reference/answers.md` (held by
  `tests/contract.test.ts`), and, after a change made on purpose to what
  `help` and `completion` print, `KIOKU_UPDATE_GOLDEN=1 node --test tests/golden.test.ts`.
- `plugins/claude-code/hooks/hooks.json` is written by `pnpm plugin:hooks`
  from the code, and a test holds it to it.

## Checks

```bash
pnpm typecheck
pnpm lint             # Biome: format and lint; `pnpm lint:fix` writes the format
pnpm test             # builds lib/kioku.mjs first: some tests run the bundle
pnpm test:demo        # about a minute: builds the demo and checks the story it tells
pnpm typecheck:plugin # the mod, against `types/claude-code.d.ts`: what it uses of the engine, in our words
pnpm typecheck:plugin:real # the same against the types Claude Code laid here; skipped where there are none, not in ci
pnpm test:plugin      # the mod, in Claude Code's engine: needs `claude`, no login
pnpm bench            # not a check: time and answer size per command, against your last --save (--compare)
pnpm eval:memory      # not a check: how often the agent reads and saves on its own, with `claude -p` on the demo (needs a login; costs)
pnpm eval:recall      # not a check: how the prompt's recall scores a labelled set of prompts on the demo, by rule; no agent, no cost
```

`ci` runs all but `test:demo`, `typecheck:plugin:real`, `bench` and the `eval:` ones, with
Claude Code at the version `kioku.claudeCode` in `package.json` pins. A name
the mod starts to use of the engine goes into `types/claude-code.d.ts`, in our
words. A claim about speed or tokens is shown with `pnpm bench` (bytes are
exact; milliseconds compare on one machine); one about how the agent uses the
memory, with `pnpm eval:memory` before and after. Tests never touch the real home.

## Conventions

- Text in the repository is English.
- A behaviour change is two commits: the spec first (and `design.md` when a
  principle moves), "Say …", then the implementation, citing `§` sections.
- Ask before committing; never push without being asked. Every change is its
  own branch off `develop`, merged with `git merge --no-ff` once the checks
  pass. Releases follow git flow: `develop` reaches `main` only through a
  branch `release/v<version>` off it (a fix that cannot wait, `hotfix/v<version>`
  off `main`) and its pull request, and `main` comes back into `develop` after
  each release. Never commit to `main`.
- Every commit that changes what a person or a machine sees adds its line under
  `## Unreleased` in `CHANGELOG.md`, above the last version's section.
- The skill is capped at 1,500 words and names no paths or ids; a test enforces
  both. The `AGENTS.md` the tool writes into brains names no host.
- The repository's name is written once, in `package.json`, read by
  `src/product.ts`; `install.sh` carries it too.

## Releasing

A release is merging into `main` the branch `release/v<version>` that
`node scripts/release.mjs prepare <version>` makes from `develop`, which moves
the version; never move a published tag. The procedure is `docs/how-to/release.md`, and the `release`
skill walks it.

## Things that bite

- Do not override `HOME` to point the tool at other brains: it breaks the
  `mise` node shim and the agents' logins. Set `KIOKU_HOME` to the folder that
  holds `.kioku/` (`.demo/.home` for the demo).
