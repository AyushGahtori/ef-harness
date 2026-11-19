# Editor coexistence: when the developer edits code too

The developer will open VS Code, fix things on `main`, run `npm install` and sometimes finish a task themselves. The harness has to live alongside that without blocking it, overwriting it or quietly reverting it. Workspace rules this builds on: [workspace and Git](workspace-and-git.md). Research: [coexistence, undo and re-entry](research/coexistence-undo-and-reentry.md).

## Decisions in plain words

1. **The developer's checkout is theirs.** The harness never edits, stashes, resets or commits there without an explicit click. All harness work happens in its own worktrees and `harness/*` branches.
2. **The merge queue doesn't need a clean checkout.** It advances `harness/integration`, which is never checked out by the developer, so dirty files on `main` never block it.
3. **Landing is a separate, visible step**, and it only touches the developer's files when that's provably safe.
4. **Developer commits are the new truth.** New commits on the base branch become the base for future work. The harness adapts to them; it never rewrites them.
5. **Human fixes are first-class.** “I fixed it myself” runs the same clean verification as a worker's candidate. If it passes, the developer is recorded as the author and dependent work unlocks.
6. **Nothing the developer wrote is ever discarded.** Reverts are forward commits. A human-owned worktree is never deleted without asking.

## What the harness watches

A file watcher on the checkout (ignoring dependency and build folders) plus periodic `git status` and ref checks.

| Observation | Classified as | What the developer sees |
|---|---|---|
| Edited files that no active task touches | Unrelated edit | Nothing |
| Edited a file inside an active task's write scope | Overlap | Small notice (below) |
| `package.json` or lockfile changed, uncommitted | Dependency change | Notice offering to include it |
| New commit on the base branch | Base moved | Digest item; integration syncs |
| Switched branch | Context change | Status bar shows the branch; landing target unchanged |
| Rebase or merge in progress | Busy | Landing waits until it finishes |

## Overlap: editing a file a worker owns

```
You're editing src/kitchen/print.tsx, which Priya (Mid, T07) is also changing.
[Take over T07]  [Keep both — merge later]  [Ignore]
```

- **Take over T07:** the worker stops at its next boundary, its WIP is saved as a checkpoint, and T07 becomes human-owned (see the fix-it-myself flow).
- **Keep both:** the worker continues; when it lands, the feature integrator merges with the developer's committed version and resolves or reports conflicts.
- **Ignore:** no change, no repeat notice for this file in this session.

## Advancing and landing

**Integration** (`harness/integration`) advances whenever the project merge queue accepts a candidate. When the developer commits to the base branch, the integrator merges those commits into integration (a **base sync**), reruns the checks affected by the changed files, and refreshes in-flight tasks whose inputs changed. Conflicts with a running task go to that task's owner as a normal revision.

**Landing** brings `harness/integration` into the developer's branch:

| Developer's checkout | Landing behavior |
|---|---|
| Branch not checked out, or checked out and clean | Fast-forward or merge commit, as the developer chose in settings |
| Checked out with dirty files that the landing doesn't touch | Safe: Git applies the update and leaves those files alone. Proceeds if auto-land is on; otherwise asks once |
| Checked out with dirty files that the landing *does* touch | Never touches the tree. Card below |
| Rebase, merge or conflict in progress | Waits; re-checks when it's finished |

```
Landing F12 waits: you have unsaved work in 2 files the harness also changed
  src/kitchen/print.tsx · src/kitchen/types.ts
[Commit my edits first]  [Land later]  [Stash, land, restore]  [Show me how to do it myself]
```

- **Commit my edits first** shows the diff, commits it with the developer as author, then lands (with a merge if needed).
- **Stash, land, restore** explains that restoring may produce conflicts the developer will need to resolve, and only runs on click.
- The harness never stashes silently.

Auto-land is off by default.

## Dependency changes made by hand

When `npm install` changes the lockfile in the checkout:

```
You changed package.json and package-lock.json (added date-fns).
Include this in the project so workers can use it?   [Commit and include]  [Not now]
```

**Commit and include** commits with the developer as author. That commit becomes base; the integrator reconciles it with any open dependency intents from workers. Until the developer includes it, workers don't see the new package.

## “I fixed it myself”

Three ways to start:

1. **Card action:** on a failed or held task, **Fix it myself**.
2. **Chat:** “I fixed task 4” or “T04 is done, I did it”. Routed as execution control to T04.
3. **Detection:** a developer commit touches a failed or held task's write scope → suggestion card: “Looks like you changed T04's files. Verify it as T04?”

### The flow

| Step | What happens |
|---|---|
| 1 · Take ownership | T04 becomes **human-owned**. Any worker on it stops; its WIP is kept on a checkpoint ref. The developer chooses where to work: **Open T04's worktree in VS Code** (WIP already there) or **in my own checkout**. |
| 2 · Developer edits | Normal editing. The harness stays out of the way. |
| 3 · Mark done | Button **I'm done with T04** or a chat message. |
| 4 · Collect | Worktree: the harness commits the changes with the developer as author. Own checkout: the developer picks the commits (prefilled from the commits that touched T04's scope since it was taken over). |
| 5 · Verify | Same clean verifier, same locked checks and held-back cases as for a worker. |
| 6a · Pass | T04 accepted, author = developer. Dependents unlock. |
| 6b · Fail | Shows which checks failed and why. Options: keep fixing · **This test is wrong** · **Accept anyway** |

- **This test is wrong** is a product decision, and the developer is the product owner. It becomes a change to the expectation (with impact preview), not a quiet edit of the test.
- **Accept anyway** records an override with a reason; dependents see a warning badge; the override appears in the final summary.

### Keeping the graph honest

- **Contract check.** If the developer changed an exported signature or schema, the kernel compares it with the published contract. Compatible: done. Incompatible: consumers get a revision (re-brief) and the plan preview shows the impact.
- **Out-of-scope changes.** Files changed outside T04's scope are listed: “You also changed `src/menu/api.ts`.” Options: record it as a small change of its own (so the graph knows it happened), attach it to T04, or leave it unrecorded.
- **Runtime graph.** The T04 node records `acceptedBy: human`, the commit, and the verification receipt. The office view shows the CEO's stamp on that box.

## Edge cases

| Situation | Behavior |
|---|---|
| Developer force-pushes or rewrites the base branch | Base sync detects history rewrite; integration rebuilds from the new base; tasks whose base vanished are refreshed from their checkpoints. Nothing of the developer's is touched. |
| Developer deletes a file a finished feature added | Treated as a developer change; the next base sync reports “F12's print route was removed in your commit 3f2a…” and asks whether that's intended removal (revision) or an accident. |
| Developer edits inside a worker's worktree while it runs | Detected by the watcher on the worktree; worker is paused; same three choices as the overlap card. |
| Developer fixes a task the harness already accepted | Just a normal commit; base sync picks it up; affected checks rerun. |
| Harness paused for days while the developer works | On resume, the [re-entry reconciliation](stops-undo-and-reentry.md#coming-back-later) runs before anything starts. |

[Diagram](editor-coexistence.svg) · [Editable Mermaid](editor-coexistence.mmd) · [Workspace and Git](workspace-and-git.md) · [Stops, undo and re-entry](stops-undo-and-reentry.md) · [Parallel integration](parallel-feature-integration.md) · [Research](research/coexistence-undo-and-reentry.md)
