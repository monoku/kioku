# Run the demo

The demo builds three brains on your machine, from a fixed seed, through the
tool's own verbs, so you can look at Kioku without touching `~/.kioku`. They
belong to Northwind, a fictional company, and to sam, a developer there; the
project is Northwind's orders application, "the app". Everything in them is
invented.

```bash
pnpm install --frozen-lockfile
pnpm demo --force
```

It takes about a minute. `--force` rebuilds `.demo/` (gitignored), throwing
away what a trial session wrote; `--out <dir>` builds elsewhere.

| Path in `.demo/` | Is |
|---|---|
| `brains/sam/brain/` | sam's personal brain, about 67 pages in five namespaces |
| `brains/northwind/team-brain/` | Northwind's team brain, about 174 pages in sixteen namespaces, one three deep |
| `brains/northwind/app-brain/` | the app's project brain, about 80 pages in four namespaces |
| `app/` | the app's code repository, linked to the project brain and the team's: a session here loads all three |
| `.home/` | the machine's state, standing in for `~/.kioku` |
| `.remotes/` | bare repositories standing in for the git host |

Every report of `kioku brain lint` has an example somewhere, and the project
brain shows a summary that opens with what to load first and sources read at
different versions (`kioku brain sources --brain northwind/app-brain`).

`pnpm test:demo` builds it into a temporary folder and checks that every brain
validates, the reports are a handful, the project brain's searches find their
pages (`SEARCHES` in the seed) and no page cites this repository.

## Run a verb against it

`pnpm demo` writes a `.mise.toml` in `.demo/app` that sets `KIOKU_HOME`
to the demo's home and puts the checkout's launcher first on the `PATH`, so
with [mise](https://mise.jdx.dev) a terminal there runs this checkout's tool
against the demo's brains (`mise trust` once, when it asks):

```bash
cd .demo/app
kioku page search migrations
```

Without mise, set the two by hand:
`KIOKU_HOME=$PWD/../.home ../bin/kioku page search migrations`. `KIOKU_HOME`
moves Kioku's state and leaves `HOME` alone, so a `mise` shim and the agents'
logins keep working. Never point `HOME` at the demo.

The demo is about sam: the `.mise.toml` and the session's settings tell git
that the person is sam (`github.user`, through `GIT_CONFIG_COUNT`, which adds
to your git configuration and hides nothing of it), so a page confirmed there
is confirmed by sam whatever your git says.

## Try a change in a Claude Code session

`pnpm demo` writes a `kioku` launcher for this checkout's bundle in
`.demo/bin` and sets `KIOKU_HOME` and `KIOKU_BIN` in
`.demo/app/.claude/settings.local.json`. A session opened in
`.demo/app` then runs this checkout's tool against the demo's brains.
After changing `src/`, `pnpm dev:claude` rebuilds the bundle;
`pnpm dev:claude -- --launch` also starts `claude` there with this checkout's
plugin loaded for the session (`--plugin-dir plugins/claude-code`), in place
of an installed one, so the hooks, the skill and the mod are the working
tree's too. The settings carry the same folder in `CLAUDE_CODE_PLUGIN_DIRS`
for a session opened another way, where Claude Code honours it.
