---
name: release
description: Cut a new Kioku version from main through a pull request - check what accumulated under CHANGELOG's "## Unreleased", propose the version (0.x semantic versioning), run scripts/release.mjs prepare (branch, version, checks, commit), and hand the person the push and pull request commands; merging it publishes. Use whenever someone wants to release, publish, ship, tag or "deploy" Kioku, cut or prepare a version (0.2.0, a patch, a minor), or asks what is ready to go out, even if they do not say "release".
---

# Release a Kioku version

Commits to `main` reach no one: the installer and `kioku update` fetch only
GitHub releases, and a release is the merge of a pull request whose commit
`Release <version>` the `release` workflow tests and publishes. Work accumulates on `develop`
with its lines under `## Unreleased` in `CHANGELOG.md`, and reaches `main` by one pull
request at each release; this skill turns what `main` then holds into a version. The
full procedure is `docs/how-to/release.md`; read it if anything here seems off.

Two things are the person's, never yours: **pushing** (the script never
pushes, and neither do you) and **any commit** you would make on the way
(ask first, as the repository's conventions say). A published tag is never
moved; whatever comes after it is the next version.

## 1. Check the starting point

From the repository root:

```bash
git status --short
git fetch -q origin && git status -sb | head -1
git describe --tags --abbrev=0
```

- The tree must be clean (the script refuses otherwise). Uncommitted work is
  either part of this version, to be committed first with the person's yes,
  or not, to be left out; ask which.
- `main` must be `origin/main`, neither behind nor ahead: work reaches `main`
  through the pull request from `develop`, so what is only on `develop` or
  only local is merged there first, and `main` pulled.
- The last tag is the version you start from: `v<version>`.

Optionally, see that CI is green on what you are about to release:
`gh run list --branch main --limit 3`.

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
branch `fix/<what>` off `main`, its pull request into `main` merged with a
merge commit, then this skill from step 1 for the next patch.

## 4. Prepare the release pull request

From `main`, as `origin` has it (the script refuses otherwise):

```bash
node scripts/release.mjs prepare <version>
```

It makes the branch `release/v<version>`, renames `## Unreleased` to
`## <version>`, sets `version` in `package.json` and in
`plugins/claude-code/.claude-plugin/plugin.json` (the plugin's version is the tool's:
Claude Code updates the plugin only when it moves), runs
typecheck, lint, the tests (which build `lib/kioku.mjs` with that version inside)
and `scripts/check-tag.mjs`, and commits `Release <version>`; the mod's checks run
in `ci`, on the pull request. It takes a minute or two.
If it fails, show the failing output and stop: do not retry with changes of
your own. Then hand the person the two commands it printed, each in its own
block: `git push -u origin release/v<version>` and the `gh pr create` that
opens the pull request. Pushing and opening it are theirs, unless they ask
you to.

The pull request is merged **with a merge commit** once `ci` passes: a squash
would change the commit's subject, and the workflow would find nothing to publish.

## 5. What the merge does

Merging is the release; there is no other command. The `release` workflow finds
`Release <version>` in the push, checks the version it sets, tests that commit,
and creates the GitHub release and its tag, with `kioku.mjs`, `kioku-plugin.tar.gz`,
their `.sha256` files and the version's `CHANGELOG.md` section as its notes. A
machine the installer set up hears of it within a day and takes it with
`kioku update`; one Homebrew set up takes it with `brew upgrade kioku`. Once it
is merged, offer to check it:

```bash
gh run list --workflow release --limit 3
gh release view v<version>
```

Then bring `main` back into `develop`, so `develop` says the version just
released and the next pull request from `develop` does not fight over
`CHANGELOG.md`. Once the person confirms the merge, offer to run the commands
`release.mjs` printed; the push is theirs to approve:

```bash
git switch develop && git pull --ff-only origin develop
git fetch origin main && git merge --no-ff origin/main
git push origin develop
```
