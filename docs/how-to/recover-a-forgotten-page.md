# Recover a page that was forgotten

`kioku page forget` deletes a page in one commit and git keeps it. If the agent
forgot the wrong page, or you changed your mind, the page comes back by
reverting that commit.

## Steps

1. Find the commit of the `forget`. It is in the log, with the brain it was
   made in:

   ```bash
   kioku brain log --since 7d
   ```

   Look for the `forget` write with the page's title and take its `commit`.

2. Revert it in that brain's folder. `kioku brain list` says where the brain
   is, and `kioku brain path personal` prints your personal brain's:

   ```bash
   git -C <brain folder> revert --no-edit <commit>
   ```

3. Let Kioku publish and index it:

   ```bash
   kioku sync
   ```

The page returns as it was, with its `id`, its history and its links. A
`forget` is one commit that touches one page, so the revert touches nothing
else.

## When it does not apply cleanly

- **Pages that linked to it were rewritten since.** The revert may stop on a
  conflict in those pages. Resolve it with git, or leave the revert and write
  the page again with `kioku page save`, taking its text from
  `git -C <brain folder> show <commit>^:<path>`.
- **Someone else's `forget` in a shared brain.** The same steps work, and
  `kioku sync` pushes the revert. The `forget` was theirs and so is the
  decision: say so to them.
