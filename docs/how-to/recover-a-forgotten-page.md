# Recover a page that was forgotten

`kioku page forget` deletes a page in one commit and git keeps it. If the agent
forgot the wrong page, or you changed your mind, `kioku page restore` brings it
back. The same goes for a page `kioku page merge` took into another.

## Steps

1. Find the page's path and its brain. They are in the log, on the `forget`
   (or the `merge`) with the page's title:

   ```bash
   kioku brain log --since 7d
   ```

2. Restore it, naming the brain:

   ```bash
   kioku page restore <path> --brain <brain>
   ```

The page returns as it was at the commit before the one that deleted it, with
its `id`, in one commit, published as any write. In a conversation, "bring that
back" does the same: the agent runs these two.

## What does not come back with it

- **A merge's links.** A merge pointed every link to the page at the one that
  took it in. Restoring the page leaves them there, and leaves the merged page
  as the merge wrote it.
- **A newer page at the same path.** The restore is refused (`path_exists`):
  rename that page first, or leave it.

## When it is refused

A page is validated when it is restored, as any write. If a page it linked to
was forgotten since, or its namespace renamed, it no longer passes
(`invalid_page`, with what the validator found). Then:

- restore the page it linked to first, when that one was forgotten too; or
- write the page again with `kioku page save`, taking its text from git:

  ```bash
  git -C <brain folder> show <commit>^:<path>
  ```

  where `<commit>` is the `forget` in the log, and `kioku brain list` says
  where the brain's folder is.

## Someone else's `forget` in a shared brain

The same steps work. The `forget` was theirs and so is the decision: say so to
them.
