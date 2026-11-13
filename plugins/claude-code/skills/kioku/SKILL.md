---
name: kioku
description: Kioku memory. Load it the moment the person corrects you, states a preference or a decision, says remember or forget, or asks what you know or saved, and the moment you learn something that will still be true in months: you then save on your own, without asking. Load it too before reading or writing any brain.
allowed-tools: Bash(kioku *)
user-invocable: false
---
# Kioku

The person's memory lives in brains: git repositories of Markdown pages that the `kioku` tool reads and writes. Never read or edit a brain's files: the tool validates, commits and counts what is opened. You save on your own, inside your turn, without asking; the person sees a mark from the tool and corrects things afterwards.

## Calling the tool

Run `kioku` by name, as the first word of the Bash command: no path to it, nothing piped into it, one writing verb per call. A body goes on stdin as a quoted heredoc:

```bash
kioku page save --brain project --kind knowledge --sub decision --title "Run migrations before the deploy" --summary "Migrations run before the deploy, never after." --source "Session 2026-10-07 in acme-api" --evidence "no, run the migrations before the deploy, not after" <<'EOF'
## Decision

Run the migrations before the deploy.

## Why

A deploy broke once.

## Consequences

The pipeline waits.
EOF
```

The answer is JSON: `status` is `done` (committed; `publication` is `pushed`, `pending` or `local`), `similar` (nothing written; see "Before writing") or `error` (nothing written; `error.message` says why).

- `--brain`: `personal`, `project`, `team`, or a brain's name from the session summary.
- `--title`: one line; it names the page.
- `--summary`: one line, always: what the session summary shows.
- `--aliases`: other names for the subject, comma-separated; search and `save` find it by them.
- `--source`: `Session <today's date> in <repository folder>`, or a URL.
- `--evidence`: see "Never saved".
- `--applies-to`: globs of the project files a project page is about (`src/billing/**`); reading or changing one names it.

The other verbs, answering the same way, each `kioku page <verb>`:

- `update <path> --brain <b> [--section <heading>] [--summary <s>] [--evidence <line> --source <s>]`, with the new body (or the section's new text) on stdin;
- `supersede <old path> --brain <b> --title … --summary … --source … [--evidence …]`, with the new decision on stdin;
- `forget <path> --brain <b>`;
- `confirm <path> --brain <b>`: the person says a page is still true; `retire <path> --brain <b> [--reason …]`: no longer true, and nothing replaces it; `rename <path> --brain <b> --title …`: links follow;
- `link <path> <path> --brain <b> [--type contradicts|qualifies]`: two related pages, each under the other's See also; a contradiction is for the person to settle;
- `search <words>`: before answering from memory, or when the summary lacks it; `list [--brain <b>]` (20 at a time; `next` is the `--offset` to read on); `show <path> --brain <b> [--section <heading>]`: a page with its links; `evolve [<path> --brain <b>]`;
- `kioku brain log [--since <when>]`: the writes (20 at a time, `next`) since today, `yesterday`, `3d` or a date; `kioku brain stats`: what they add up to.

What to save as, and the `## ` sections its body holds, in order:

| What | Flags | Sections |
|---|---|---|
| a lesson or a fact | `--kind memory` | What happened, Lesson, Rule of thumb |
| a learned "when X, do Y" | `--kind memory --sub instinct` | When, Do |
| a decision and why | `--kind knowledge --sub decision` | Decision, Why, Consequences |
| how something is done here | `--kind knowledge --sub playbook` | When, Steps |
| people, clients, glossary, agreements, where things are | `--kind knowledge --sub context` | free |
| how you must always work in this brain | `--kind rule` | Rule, Why |

Never write a Changelog, Evidence or See also section: the tool keeps them. Skills come from `evolve`, not from `save`.

## What to save

Save the moment you notice something that passes both tests:

1. **It will still be true in months.** Not a step of this task, not a value that changes next week.
2. **Knowing it would change how you act in a future session.**

What usually passes: a correction and the approach the person confirmed instead; a preference of tool, style or workflow; a decision taken in the conversation and why; an error and how it was resolved; context about the project, the client or the team that the repository does not hold; where things are outside it.

Never save what is ephemeral or already in a brain, what the repository or its history can tell you, the progress of the task at hand, or anything under "Never saved". When the person asks you to remember something, save it even if it fails the two tests, in the kind that fits best or as a memory in their words; "Never saved" still holds.

## Which brain

- **personal**: how this person works (preferences, corrections, their environment, their lessons).
- **project**: this project (decisions, how things are done here, the client, the people, where things are).
- **team**: conventions that cross projects, and how the team works.

When in doubt, personal: it affects nobody else. `--namespace <path>` names the area; `kioku namespace add <path> --summary "…" --brain <b>` makes one, which the person confirms. To move a page up, `kioku page promote <path> --brain <b> --to project|team` with the page rewritten, in words fit for that brain, on stdin; it retires the original.

## Before writing: find what exists

To write something new, always start with `save` without `--create`. When it answers `similar`, nothing was written: read what it lists and choose:

- **the same subject**, and the fact or procedure changed or grew: `update` that page;
- **a decision that changed**: `supersede` it; a decision's substance is never updated in place;
- **related, but a different subject**: run the same `save` again with `--create`; the new page links to the similar ones under See also, or only to those named with `--see-also <path,path>` (`none` for none).

When you already know the page, go straight to `update`. Pages that belong together: `link` them. An answer's `elsewhere` lists similar pages of other brains: when one disagrees, tell the person.

## Never saved

1. **In no brain, even when asked:** secrets (tokens, keys, passwords, connection strings), government identifiers, financial account numbers, criminal history, immigration status. Asked to, say in one line that Kioku does not keep that; the tool refuses it too.
2. **Never in a project or team brain:** personal remarks, opinions about colleagues or clients, the person's health or personal situation, anything they said about themselves rather than the work. When in doubt, the personal brain or nowhere.
3. **Not on your own initiative, even in the personal brain:** health, religion, politics, sexual orientation, ethnicity and the like. Only when the person asks you to remember it.

`--evidence` is required when a person said the thing: a short quote of their words, chosen under these three layers. For what you derived from your own work, `--source` is enough.

## In your reply

- Never ask "should I save this?", and say nothing about a save (file, path, commit): the person sees it by itself.
- Something is saved only when the tool answered `done`: never say or imply a save it did not confirm, and never say you remember something that is not in a brain or in this conversation.
- When a write answers `error`, say so in one line with the reason in plain words and no path; fix what can be fixed and retry.

## Instincts

A repeatable *how* you notice ("when the tests touch the database, run them serially") becomes an instinct, not a Skill: When, Do, and `--evidence` describing this occasion. When it happens again, it is in the summary or `save` returns it: add the occasion with `update <path> --brain <b> --evidence "<what happened this time>" --source "<source>"`, never a second page.

An instinct with three occasions is a candidate for a Skill (that write says `"candidate": true`). Never evolve one on your own. When the person sends `/kioku-evolve` or asks: run `kioku page evolve --json`; none: say so. Number them (title, When, occasions), ask which, wait, and for those only run `kioku page evolve <path> --brain <b>`, with `--to rule` or `--to playbook` when it is something always true or a procedure.

## Skills

When a Skill the summary lists applies to what you are about to do, `show` it first and follow it.

## Inside a brain

The session summary says when this session is inside a brain, opened to work on it. Answer with `search`, `list` and `show`; act with the verbs above; `kioku brain lint` says what to clean up, the person decides. What you write goes to that brain unless it is about the person. `/ingest` fills it from a source.

## When the person talks about memory

- **"What did you save today?"**: `kioku brain log`; answer in words. **"How is the memory doing?"**: `kioku brain stats`.
- **"That's wrong, it is X"**: find the page and `update` it; a changed decision is superseded.
- **"That's still right"** or **"that's no longer true"**: `confirm` or `retire` it.
- **"Forget that"**: `forget` it. **"That belongs to acme"**: `promote` it there.
