# Use Kioku next to Claude Code's own memory

Claude Code keeps notes of its own, which it calls auto memory, and it is on by
default. Kioku does not replace it and does not read it. This page says how the
two sit together, how to keep only one, and how to bring the old notes in.

## What each one is

| | Claude Code's auto memory | Kioku |
|---|---|---|
| Where | `~/.claude/projects/<project>/memory/`, per repository | brains: git repositories, in `~/.kioku/brains/` |
| Shared | no; machine-local | yes, through git, in a project or team brain |
| Who writes | Claude Code, on its own | the agent, through `kioku page save` and the other verbs |

Both are loaded at the start of a session, so the agent can be told one thing
twice.

## Which one gets what you say

With both on, a preference, a correction, "remember that…", "save this to
memory" or a plain statement goes to Kioku: its skill is the more specific
instruction, and that is the one the agent follows. If you find a note in
Claude Code's folder that Kioku should hold, move it (below) and consider
turning auto memory off.

`kioku doctor` says whether Claude Code's auto memory is on or off, in the
`claude memory` line.

## Keep only Kioku

Any one of these turns auto memory off:

- In a session, run `/memory` and use the auto memory toggle. It saves
  `autoMemoryEnabled: false` to `~/.claude/settings.json`.
- Set `"autoMemoryEnabled": false` in a project's `.claude/settings.json`, to
  turn it off for that project alone.
- Set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the environment that starts
  `claude`.

Nothing in Kioku depends on the choice.

## Bring the old notes into a brain

Claude Code's notes are Markdown files with a small front matter, so
`/ingest` reads them like any other folder. Open Claude Code inside the brain
that should hold them, usually your personal brain, and run:

```text
/ingest ~/.claude/projects/<project>/memory
```

`/ingest` shows what it would write, update or leave out, and waits for your
answer. Run it again later: it says when the folder has not changed
([`kioku brain sources`](../reference/cli.md#kioku-brain-sources)).
