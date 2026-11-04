# The spec

What Kioku does, exactly, in six parts. This is the document that says what
is true: when another page disagrees with it, the other page is wrong. A `§`
anywhere in the repository, `§6.1` say, points here: the first number is the
part, the rest the section inside it.

| Part | Says |
|---|---|
| [§1](01-how-kioku-behaves.md) | How Kioku behaves |
| [§2](02-brains.md) | Brains |
| [§3](03-what-a-brain-holds.md) | What a brain holds |
| [§4](04-reading-at-the-start-of-a-session.md) | Sessions and search |
| [§5](05-validator.md) | Validator |
| [§6](06-the-tool.md) | The tool |

Kioku is memory for coding agents. The memory is kept
in **brains**: folders of Markdown files with git history, one per person,
one per project or client, one per team. An AI coding agent reads the brains
at the start of every session and **saves to them on its own** while it
works, the way a good assistant takes notes without being told. The person
sees that something was saved, and corrects it afterwards if it is wrong.
Nothing asks "save this?" and nobody has to say "save this". The agent is
Claude Code.
