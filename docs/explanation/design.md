# How Kioku is designed

The principles the parts follow, so a change can be judged against something
steadier than one section of the [spec](../specs/README.md). A change that
bends a principle changes it here first, and the spec with it.

1. **The agent saves on its own.** It decides, inside its turn, what will still
   be true in months and would change how it acts, and writes it without
   asking: asking is the friction that makes a memory tool fall out of use, and
   the agent in the conversation knows a correction from noise. Structure is
   different: a new namespace is named by the agent and agreed by the person,
   at a question the host asks.

2. **Control comes after the fact, through visibility and reversibility.**
   Writes land on the default branch; git records who wrote what, the next
   summary shows what arrived, and `forget` reverts in one commit. There are no
   drafts and no inbox. So the rows are never switched off; a notice that
   reminds or informs may be muted by name.

3. **A brain is plain files in a git repository, one repository per brain.**
   Markdown with front matter, readable by any editor, `grep` and the git host.
   Nothing of the memory lives only where the tool can read it: the index is
   derived. What a machine counts about its own use lives with the machine. A
   brain works whole where it was made, with no remote and no host. It is named
   by the person, `owner/repo`, and carries its name in its own files, so it is
   the same brain on every machine and at any address; it has an address only
   when published, and trust follows the address, never the name. Its tier,
   personal, project or team, is its own and fixed, and a link takes only a
   brain of its tier.

4. **Every brain is the person's choice.** Installing makes no brain. A code
   repository names its project brain, and a machine loads it only once the
   person trusts it or its owner. A brain opened to be worked on is loaded
   alone.

5. **Context arrives by hook, behaviour by skill, what the person sees by
   hook.** A hook runs every time, so what the agent knows and the person sees
   do not depend on compliance, and a row is drawn from the tool's real result,
   never from the agent's words. The skill holds only what is true everywhere,
   capped at 1,500 words; what depends on the moment is in the summary.

6. **The tool advises, the agent decides.** `save` returns the similar pages
   instead of guessing; the agent chooses to update, supersede or create. Each
   writing verb has one meaning, so the hooks filter on exactly those verbs.

7. **A page changes by verbs, and every write goes through the tool.** Facts
   are updated in place, a decision is superseded and kept, an instinct
   collects occasions and evolves; confirming, retiring and renaming leave the
   text alone. One set of rules validates every write, in a session and by
   hand; no brain carries a copy of them.

8. **Maintenance is a report; action happens in conversation.** `brain lint`
   lists what a brain accumulates, without a model; the agent acts on it with
   the same verbs.

9. **What a session reads is bounded, and the memory comes to the agent.** The
   summary takes a share of the host's context (§4.1); at each prompt, the few
   pages that stand out by meaning are named, never their text (§4.7); search
   brings the rest when the agent asks. An agent does not look for what it does
   not know is there, so the memory does not wait to be asked.

10. **A brain receives before it sends, and a conflict is kept aside.** A write
    starts from what was published; commits that cannot go on top are kept on
    a branch, the brain goes on receiving, and the person resolves them with
    the tool.

11. **What changes the machine is the person's.** Naming who the person is,
    registering a brain, changing the agent's plugins, installing a version:
    each needs a terminal and refuses an agent,
    whatever a page it read says. Reading is open. A version the person
    installed, by whatever means, brings the machine forward on its own the
    first time it runs: it writes only the files the tool owns, the person's
    own brain's format and the machine's configuration, never moves a shared
    brain's format, and says what it did.

12. **One tool, one bundle, embeddable.** TypeScript on Node, one file a
    release publishes; the verbs are data a program can mount, and nothing in
    the core reads the home or the environment on its own. One adapter knows
    the agent host. The embedding engine, the one native piece, is fetched once
    in the background, pinned, and loaded by one hook only, the prompt's
    (§4.7), within a time it gives up past.
