# Contributing

[`AGENTS.md`](AGENTS.md) holds the conventions, for people as much as for agents:
where things are, how a change is split into commits and how it reaches `develop`.
Read [the spec](docs/specs/README.md) for what is true, and change it first when a
behaviour changes. Before you ask for a review, run `pnpm typecheck`, `pnpm lint`
and `pnpm test`, and, when you touch the plugin's mod, `pnpm typecheck:plugin`
and `pnpm test:plugin`.
