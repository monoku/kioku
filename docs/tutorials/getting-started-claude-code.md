# Getting started with Claude Code

By the end you will have Kioku installed, Claude Code connected and your first
memory saved by the agent. About ten minutes. You need Claude Code, Node 24 or
later, and git.

## 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/monoku/kioku/main/install.sh | sh
```

The installer puts `kioku` on your `PATH` (open a new terminal if it says so),
gives your shell its completion, and starts fetching the search model in the
background (about 250 MB, once); search uses full text until it is there.

With Homebrew, install it this way instead, then run `kioku setup`, which
starts fetching the model; Homebrew gives `kioku` its `PATH` and completion:

```bash
brew install monoku/kioku/kioku
kioku setup
```

Your personal brain is where the agent keeps what it learns about how you
work. Make it:

```bash
kioku brain create sam/memory
```

The name is yours, `owner/repo`, and it is the brain's on every machine, wherever the repository lives. It lives at
`~/.kioku/brains/sam/memory/`, with no remote and no network. When you want a
backup or a second machine, make an empty private repository on your git host,
`github.com/sam/memory` say, and run
`kioku brain publish sam/memory --remote github.com/sam/memory`; on the second
machine, `kioku brain clone github.com/sam/memory` brings it as `sam/memory`.

## 2. Connect Claude Code

```bash
kioku plugin claude-code install
```

It shows the `claude plugin` commands it will run and asks. Then check the
machine:

```bash
kioku doctor
```

## 3. Teach it something

Open Claude Code in any folder, ask for something, and correct the agent as
you normally would:

> "No: run the migrations before the deploy, not after."

When the agent judges it durable, it saves it on its own, and you see a row in
the conversation, **⬢ kioku.md ↑ saved** and the page's title, which opens to
show its file and its commit. The first time, your brain has no namespace yet:
the agent proposes one and Claude Code asks you to confirm it.

You see the reads too: the footer counts what the session read and wrote,
`/kioku-history` lists it, and `/kioku-search <words>` searches the memory as
the agent would. To check or fix the memory, talk to the agent: "what did you
save today?", "that's wrong, it is X", "forget that". In a terminal,
`kioku brain log` lists today's writes.

Claude Code keeps notes of its own too; see
[Use Kioku next to Claude Code's own memory](../how-to/claude-code-own-memory.md).
A page forgotten by mistake comes back:
[Recover a page that was forgotten](../how-to/recover-a-forgotten-page.md).

## 4. Link a project

For a project with a shared brain, in its project folder, in a terminal:

```bash
kioku init github.com/northwind/acme-brain
```

It writes the project brain into the folder's `kioku.yaml`. When the project
shares a team brain, add it to that file by hand, once:

```yaml
brain: { name: northwind/acme-brain, url: https://github.com/northwind/acme-brain.git }
team: { name: northwind/team-brain, url: https://github.com/northwind/team-brain.git }
```

then run `kioku init` alone to trust and clone it, and commit the file. A team
you work with outside any project is yours to name on your machine, once it is
cloned:

```bash
kioku brain clone github.com/northwind/team-brain && kioku config set team northwind/team-brain
```

It loads in every folder whose `kioku.yaml` names no team. A teammate who clones the code runs
`kioku init` there to trust and clone the brain. If the brain does not exist
yet, `kioku init northwind/acme-brain` makes it on your machine, and
`kioku brain publish northwind/acme-brain --remote github.com/northwind/acme-brain`
pushes it to the empty repository your teammates clone; `kioku init` in the code
folder then writes its address into the link they clone.

From then on, a session in that folder reads the folder's `kioku.yaml`, finds
the project and team brains it names on the machine (or clones them), adds your
personal brain, and gives the agent one summary of the three. A decision saved to the project brain is in a
teammate's next session, listed as new since their last one.

## Next

- [Command-line reference](../reference/cli.md)
- [How Kioku is put together](../explanation/architecture.md)
