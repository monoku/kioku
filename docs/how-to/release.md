# Release a version

A release is merging the pull request of a commit `Release <version>`: the
`release` workflow tests that commit, builds the bundle and the plugin from it
and publishes them, creating the tag `v<version>` (spec §6.4).

## Before

Commits to `main` and `develop` reach no one. Work accumulates on `develop`,
each commit that changes what a person or a machine sees with its line under
`## Unreleased` in `CHANGELOG.md`; `develop` reaches `main` by a pull request,
merged **with a merge commit** once `ci` passes, so each commit keeps its
signature and the spec's commit stays apart from the code's.

## 1. Prepare

From a clean `main`, as `origin` has it, with the version decided. The version
is `0.x` (§6.4): a break or new behaviour bumps the minor, a fix the patch, and
the major stays 0:

```bash
node scripts/release.mjs prepare <version>
```

It makes the branch `release/v<version>`, names the `## Unreleased` section
after the version (refusing when it is empty), sets the version in
`package.json` and in `plugins/claude-code/.claude-plugin/plugin.json`, runs the
checks and commits `Release <version>`; it never pushes, and prints the
commands that push the branch and open the pull request, where `ci` runs, and
the way back to `develop` for once it is merged. A version is
`<major>.<minor>.<patch>`, nothing after it: every release is the latest when
it is published, and a release that went wrong is followed by the next patch.

## 2. Merge

Merge the pull request **with a merge commit**: that is the release. A squash
changes the commit's subject, and the workflow finds nothing to publish. What
it publishes is spec §6.4: the assets are `kioku.mjs`, `kioku-plugin.tar.gz`
and a `.sha256` for each, the notes the version's `CHANGELOG.md` section. It
refuses a commit that does not set the version in both files, and a check that
fails publishes nothing and leaves no tag. A tag `v*` pushed by hand publishes
its commit again when `main` holds it. **A published tag is never moved**: what
comes after it is the next version.

## 3. Back to `develop`

Once the pull request is merged, `main` holds `Release <version>` and `develop`
does not: bring it back, so `develop` says the version just released and the
next pull request from `develop` does not fight over `CHANGELOG.md`:

```bash
git switch develop && git pull --ff-only origin develop
git fetch origin main && git merge --no-ff origin/main
git push origin develop
```

## A fix that cannot wait

When a fix must not wait for what `develop` holds:

1. Branch `fix/<what>` off `main` as `origin` has it, with the fix and its line
   under `## Unreleased`; open its pull request into `main` and merge it **with
   a merge commit** once `ci` passes. `main` then holds a commit not yet
   released, for the minutes until the next step.
2. From `main`, prepare the next patch, `node scripts/release.mjs prepare
   <patch>`, and merge its pull request, as in 1 and 2.
3. Back to `develop`, as in 3: that brings the fix there too.

## After

A machine the installer set up hears of the version within a day and takes it,
plugin included, with `kioku update`; a Homebrew machine with `brew upgrade kioku`.
