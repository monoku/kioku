---
name: release
description: Cut a new Kioku version as git flow has it, a release branch off develop (or a hotfix branch off main) and its pull request into main - check what accumulated under CHANGELOG's "## Unreleased", propose the version (0.x semantic versioning), run scripts/release.mjs prepare (branch, version, checks, commit), and hand the person the push and pull request commands; merging it publishes. Use whenever someone wants to release, publish, ship, tag or "deploy" Kioku, cut or prepare a version (0.2.0, a patch, a minor), or asks what is ready to go out, even if they do not say "release".
---

# Release a Kioku version

Commits to `main` reach no one: the installer and `kioku update` fetch only
GitHub releases. Kioku follows git flow: work accumulates on `develop` with its lines
under `## Unreleased` in `CHANGELOG.md`, and reaches `main` only through a branch
`release/v<version>` off `develop` (or `hotfix/v<version>` off `main`), whose pull request
this skill prepares. Merging it is the release: the `release` workflow sees the version
move and publishes what `main` then is. `main` holds what was released and nothing more. The
full procedure is `docs/how-to/release.md`; read it if anything here seems off.

Two things are the person's, never yours: **pushing** (the script never
pushes, and neither do you) and **any commit** you would make on the way
(ask first, as the repository's conventions say). A published tag is never
moved; whatever comes after it is the next version.

## 1. Check the starting point

From the repository root:

```bash
git switch develop && git status --short
git fetch -q origin && git status -sb | head -1
git rev-list --count HEAD..origin/main
git describe --tags --abbrev=0 origin/main
```

- The tree must be clean (the script refuses otherwise). Uncommitted work is
  either part of this version, to be committed first with the person's yes,
  or not, to be left out; ask which.
- `develop` must be `origin/develop`, neither behind nor ahead: what is only
  local is pushed first (the person's to approve), and `develop` pulled.
- `develop` must hold all of `main` (the count above is 0): if not, the last
  release was not brought back; do that first, as in step 6.
- The last tag is the version you start from: `v<version>`.

CI must be green on what you are about to release, every job of the last
run on `develop`: ask the person to look at the repository's Actions page
(`<repository>/actions?query=branch%3Adevelop`, the repository being
`repository.url` in `package.json`). Nothing here needs `gh`, and nothing
should start using it.

## 2. Read what accumulated

Read the `## Unreleased` section of `CHANGELOG.md` and the commits since the
last tag (`git log --oneline <last tag>..HEAD`).

- If the section is missing or empty, the script will refuse. Draft the lines
  from the commits, in the changelog's style (what a person or a machine sees
  change, not file names; what a machine moving to it must do), show them,
  and commit them only once the person agrees.
- If commits changed what people see and the section does not say so, point
  it out before releasing: the section becomes the release's notes.

## 3. Propose the version

Semantic versioning as it reads in `0.x` (§6.4 of the spec), from what the
section says; the major stays 0:

- **minor**: something that worked stops working or changes meaning (a verb
  or flag removed or renamed, a JSON field removed or changed, the `contract`
  in `kioku --version`), or new behaviour: a verb, a flag, a field, a view, a
  new rule that refuses what was ambiguous.
- **patch**: only fixes, with nothing new to learn.

A brain that a released tool could no longer read is not a version to choose:
the brains' files are promised (§3.2 of the spec). Stop and say so.

Say which and why in one line, and wait for the person's yes; they may know
something the changelog does not. A version is `<major>.<minor>.<patch>`, with
nothing after it: every release is the latest when it is published, and one
that went wrong is followed by the next patch.

When the person says "hotfix", "urgente" or that a fix cannot wait for
`develop`, follow "A fix that cannot wait" in `docs/how-to/release.md`: a
branch `hotfix/v<patch>` off `origin/main`, the fix committed there with its
line under `## Unreleased` (with the person's yes), then step 4 on that branch.

## 4. Prepare the release pull request

From `develop`, as `origin` has it and holding all of `main`, or on the
`hotfix/v<version>` branch (the script refuses otherwise):

```bash
node scripts/release.mjs prepare <version>
```

From `develop` it makes the branch `release/v<version>`; it renames `## Unreleased` to
`## <version>`, sets `version` in `package.json` and in
`plugins/claude-code/.claude-plugin/plugin.json` (the plugin's version is the tool's:
Claude Code updates the plugin only when it moves), runs
typecheck, lint, the tests (which build `lib/kioku.mjs` with that version inside)
and `scripts/check-tag.mjs`, and commits `Bump version to <version>`; the mod's checks run
in `ci`, on the pull request. It takes a minute or two.
If it fails, show the failing output and stop: do not retry with changes of
your own. Then hand the person what it printed: `git push -u origin <branch>`
in its own block, and the address that opens the pull request into `main`,
titled `Release <version>`. Pushing is theirs unless they ask you to; opening
the pull request is theirs, in the browser.

## 5. Finish the branch

What the pull request or its `ci` finds is fixed on the branch, with more
commits (each with the person's yes); no new features go there. Everything the
branch holds when it is merged is released. It is merged **with a merge
commit** once `ci` passes, as `main`'s rules require.

## 6. What the merge does

Merging is the release; there is no other command. The `release` workflow sees
the version in `package.json` move, checks the plugin's is the same, tests the
commit `main` is then at, and creates the GitHub release and its tag on it, with `kioku.mjs`, `kioku-plugin.tar.gz`,
their `.sha256` files and the version's `CHANGELOG.md` section as its notes. A
machine the installer set up hears of it within a day and takes it with
`kioku update`; one Homebrew set up takes it with `brew upgrade kioku`. Once it
is merged, check it: the tag appears once the release is published, which
takes some minutes, and the person sees the run on the Actions page and the
release at `<repository>/releases/tag/v<version>`:

```bash
git fetch -q --tags origin && git tag --list v<version>
```

Then bring `main` back into `develop`, so `develop` says the version just
released and the next release does not fight over `CHANGELOG.md`, and drop the
branch. Once the person confirms the merge, offer to run the commands
`release.mjs` printed; the pushes are theirs to approve:

```bash
git switch develop && git pull --ff-only origin develop
git fetch origin main && git merge --no-ff origin/main
git push origin develop
git branch -d <branch> && git push origin --delete <branch>
```
