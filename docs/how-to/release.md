# Release a version

Kioku follows git flow. A release is merging a branch `release/v<version>`
(or `hotfix/v<version>`) into `main` through its pull request: the `release`
workflow sees the version in `package.json` move, tests the commit `main` is
then at, builds the bundle and the plugin from it and publishes them, creating
the tag `v<version>` on it (spec §6.4).

## Before

Commits to `main` and `develop` reach no one. Work accumulates on `develop`,
each commit that changes what a person or a machine sees with its line under
`## Unreleased` in `CHANGELOG.md`. `develop` reaches `main` only through a
release branch, merged **with a merge commit** once `ci` passes, so each commit
keeps its signature and the spec's commit stays apart from the code's. `main`
holds what was released and nothing more.

## 1. Prepare

From a clean `develop`, as `origin` has it and holding all of `main`, with
`ci` green on it and the version decided. The version is `0.x` (§6.4): a break
or new behaviour bumps the minor, a fix the patch, and the major stays 0:

```bash
node scripts/release.mjs prepare <version>
```

It makes the branch `release/v<version>`, names the `## Unreleased` section
after the version (refusing when it is empty), sets the version in
`package.json` and in `plugins/claude-code/.claude-plugin/plugin.json`, runs the
checks and commits `Bump version to <version>`; it never pushes, and prints
the commands that push the branch and open its pull request into `main`, where
`ci` runs, and the way back to `develop` for once it is merged. It also runs on
a branch `release/v<version>` already made off `develop`, by hand or with
`git flow release start`. A version is `<major>.<minor>.<patch>`, nothing after
it, and after the one in `package.json`: every release is the latest when it is
published, and a release that went wrong is followed by the next patch.

## 2. Finish the branch

What the pull request finds is fixed on the branch, with more commits; no new
features go there. Everything the branch holds when it is merged is released.

## 3. Merge

Merge the pull request into `main` **with a merge commit**: that is the
release. What it publishes is spec §6.4: the assets are `kioku.mjs`,
`kioku-plugin.tar.gz` and a `.sha256` for each, the notes the version's
`CHANGELOG.md` section. It refuses a version the plugin's manifest does not
share, and a check that fails publishes nothing and leaves no tag: when what
failed was passing (GitHub, the network), re-run the workflow from the Actions
page; when it was the code, the fix is the next patch. Once the release is
published, the same run writes its formula into the Homebrew tap,
`monoku/homebrew-kioku`, with the version and the checksums just published,
and pushes it with the tap's deploy key; without the secret
`HOMEBREW_TAP_DEPLOY_KEY` the step is skipped and nothing fails. A push to
`main` that leaves the version as it was publishes nothing, and a tag pushed
by hand publishes nothing either: only what reached `main` through its pull request runs with the
token that publishes. **A published tag is never moved**: what comes after it
is the next version.

## 4. Back to `develop`

Once the pull request is merged, `main` holds the release and its merge, and
`develop` does not: bring them back, so `develop` says the version just
released and the next release does not fight over `CHANGELOG.md`
(`release.mjs` refuses to start from a `develop` that lacks any of `main`).
Then drop the branch:

```bash
git switch develop && git pull --ff-only origin develop
git fetch origin main && git merge --no-ff origin/main
git push origin develop
git branch -d release/v<version> && git push origin --delete release/v<version>
```

## A fix that cannot wait

When a fix must not wait for what `develop` holds, a hotfix:

1. Branch `hotfix/v<patch>` off `main` as `origin` has it
   (`git switch -c hotfix/v<patch> origin/main`, or `git flow hotfix start`),
   and commit the fix there with its line under `## Unreleased`.
2. On that branch, `node scripts/release.mjs prepare <patch>`.
3. Push it, open its pull request into `main` and merge it, as in 3: that is
   the release.
4. Back to `develop`, as in 4: that brings the fix there too.

## After

A machine the installer set up hears of the version within a day and takes it,
plugin included, with `kioku update`; a Homebrew machine with `brew upgrade kioku`.
