# Research: manual edits, undo and resuming after days away

Question: how can the harness work alongside a developer editing the same repo, undo a merged feature safely, and resume cleanly after a long break or a spending limit? Designs that use this: [editor coexistence](../editor-coexistence.md) and [stops, undo and re-entry](../stops-undo-and-reentry.md).

## Living next to manual edits

- **Git protects uncommitted work by default:** merges and checkouts that would overwrite local changes are refused; updates that don't touch dirty files proceed.
- **Predict before acting:** `git merge-tree --write-tree` computes a merge result and conflicts without touching the index or working tree (Git 2.38+). [git-merge-tree](https://git-scm.com/docs/git-merge-tree)
- **File watching:** native watchers such as `@parcel/watcher` (used by VS Code) or chokidar report changes efficiently; ignore dependency and build folders. [@parcel/watcher](https://github.com/parcel-bundler/watcher)
- **Authorship:** Git separates author and committer, so a commit the harness creates for the developer's own edits can credit the developer as author. [git-commit](https://git-scm.com/docs/git-commit)

## Undoing merged work

- `git revert -m 1 <merge>` undoes a merge with a new commit. Git's own guidance warns that re-merging the same branch later needs a revert of the revert, which is why the harness records undo as a forward revision in its graph. [Revert a faulty merge](https://git-scm.com/docs/howto/revert-a-faulty-merge)
- **Unused dependencies:** tools like knip find unused files, exports and packages, which helps decide whether a package added by a removed feature is still used. [knip](https://knip.dev/)
- **Data:** dropping columns is irreversible; the expand-and-contract pattern (stop writing, then drop later) keeps rollback possible. [ParallelChange](https://martinfowler.com/bliki/ParallelChange.html)
- **External effects can't be rolled back, only compensated:** the saga pattern pairs each step with a compensating action (Garcia-Molina and Salem, 1987). Sent emails stay sent; a registered webhook can be unregistered.

## Saving work continuously

- Agent sessions can be resumed natively in several runtimes (Codex `thread/resume`; Claude Code session resume; Cursor agent IDs), but resumption can fail after updates. A WIP commit plus a code-generated handoff note is the portable fallback.
- Checkpointing at every turn boundary bounds the loss from any stop to one turn, the same principle as write-ahead logging.

## Re-entry after a break

- People returning to interrupted work need a reminder of the goal and the next step; summaries that restate context reduce resumption time (interruption research, e.g. Mark, Gudith and Klocke, CHI 2008).
- Notification products use “catch-up” views (unread since last visit) rather than replaying everything; the welcome-back screen applies the same idea with reconciliation first.

## To measure

- Time from opening the app after a weekend to the first useful action.
- How often a landing is blocked by dirty files and which option developers choose.
- Undo plans: false “safe to remove” classifications on seeded projects with shared code.
