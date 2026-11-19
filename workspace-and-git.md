# Workspace setup and Git

What happens when the developer picks a folder, why Git is required, and how the harness creates isolated worktrees without touching the developer's uncommitted work. Research: [Git worktrees and workspace states](research/git-worktrees-and-workspaces.md). Living alongside the developer's editor afterwards: [editor coexistence](editor-coexistence.md).

## Decisions in plain words

1. **Git is required, but the developer doesn't need to know Git.** Parallel workers, checkpoints, undo, “export my work as branches” and crash recovery are all Git features. Without Git the harness cannot promise any of them. The app bundles its own Git, so nothing needs installing.
2. **The developer's checkout is their desk.** The harness never edits, stashes, resets or commits files in the developer's working folder without an explicit click. Workers build in separate worktrees outside the project folder.
3. **Dirty work is snapshotted, never moved.** If the folder has uncommitted changes, the harness can take a read-only snapshot of them as a hidden commit, using a temporary index. The developer's files and staging area stay exactly as they were.
4. **The harness writes only to its own branches.** Everything lives under `harness/*` and `refs/harness/*`. Landing into the developer's branch is a separate, visible step.

## Folder states and what the user sees

| Folder | Screen | Actions |
|---|---|---|
| Empty | “New project here. We'll set up Git for you.” | Silent `git init`, default branch `main`, an initial commit after Phase 0 scaffolding. |
| Files but no Git | “This folder isn't tracked by Git yet. The harness needs Git for parallel work, undo and recovery.” | **Set up Git here (recommended)**: scan for secrets and large files, write a `.gitignore` proposal, show it, then make a *baseline* commit. **Work on a copy**: copy into a new folder and set up Git there. No option to continue without Git. |
| Git repo, clean | Nothing extra. | Record `HEAD` and branch as the project base. |
| Git repo with uncommitted changes | “You have 7 uncommitted files.” | **Include my changes** (snapshot, below). **Start from my last commit** (warns that landing may later need those files committed). **Let me commit first** (waits and rechecks). |
| No commits yet | “Your repo has no commits.” | Make the baseline commit after showing what will be included. |
| Merge, rebase or cherry-pick in progress, or conflicts | “Git is in the middle of a merge.” | Block with **Open in my editor** and a re-check button. The harness never finishes or aborts it. |
| Detached `HEAD` | “You're not on a branch.” | Pick a branch, or create `harness-base/<date>` from this commit. |
| Inside a OneDrive/Dropbox-synced or network folder | Warning: sync tools lock files and slow builds. | Continue, or move the project. |
| Git missing from PATH | Nothing; the bundled Git is used. | Settings can point at a system Git (minimum version). |
| No `user.name` / `user.email` | One-time prompt with the global values prefilled. | Harness commits use the worker identity (below). |

### First-commit safety scan

Before any baseline or snapshot commit, scan deterministically for: `.env*` files, private keys, high-entropy tokens, files over 50 MB, `node_modules`, build outputs and OS junk. Show the proposed `.gitignore` additions and a list of “these look like secrets and will not be committed”. The user can accept, edit or cancel.

## Snapshot of uncommitted work

```powershell
$env:GIT_INDEX_FILE = "$harnessTmp\snapshot.index"
git read-tree HEAD
git add -A                                   # honors .gitignore, writes only the temporary index
$tree   = git write-tree
$commit = git commit-tree $tree -p HEAD -m "harness: snapshot of uncommitted work"
git update-ref refs/harness/snapshots/<project>/<n> $commit
Remove-Item Env:GIT_INDEX_FILE
```

The developer's working tree, real index and branch are untouched. The snapshot commit becomes the base for workers. The safety scan runs on the snapshot's diff first. Later, when the developer commits the same changes themselves, the merge queue sees identical content and the landing is clean.

## Branches and refs

| Ref | Owner | Purpose |
|---|---|---|
| Developer's branch (e.g. `main`) | Developer | Landing target. Only updated by a visible landing. |
| `harness/integration` | Project integrator | Accepted, merged work. Always clean and tested. |
| `harness/f/<feature>` | Feature integrator | Private feature branch while its tasks land. |
| `harness/t/<task>/<attempt>` | Attempt lease holder | One worker's attempt. |
| `refs/harness/snapshots/*` | Kernel | Snapshots of dirty work. |
| `refs/harness/checkpoints/<task>/<n>` | Kernel | WIP commits at checkpoints, kept for resume and export. |

Harness commits: author `<role> <agent-id> <agent-id@harness.local>` (e.g. `Worker A0014`), committer = the developer's configured identity, plus a trailer `Harness-Task: T03b` and `Harness-Attempt: 2`. Human fixes accepted through the harness keep the human as author ([editor coexistence](editor-coexistence.md)).

## Worktrees

- Location: `%LOCALAPPDATA%\EFHarness\wt\<project-short-id>\<attempt-short-id>` to stay far from Windows path limits. Set `core.longpaths=true` for the harness's Git calls.
- **Integration worktree.** One persistent worktree per project, `wt\<project>\integration`, checked out at `harness/integration`. Only the merge queue changes it: after each successful compare-and-swap of the ref, it fast-forwards the worktree (`git checkout --detach <new>`) under the integration lease and then signals the App preview to restart. The App preview runs from this worktree; merge candidates are built in separate fresh merge worktrees, never here. Workers and the developer never edit it.
- Creation: `git worktree add --detach <path> <base-commit>`, then create the attempt branch. The worktree is registered in the attempt lease.
- **Ignored files don't exist in a new worktree.** `.env`, `node_modules` and local config are missing. The **environment manifest** (from Phase 0 or [brownfield discovery](brownfield-discovery.md)) lists what a runnable attempt needs:
  - Secrets: injected as process environment variables from the vault at run time, never written as files.
  - Non-secret local config: copied from an allowlist.
  - Dependencies: installed from the lockfile with a shared package cache (pnpm store or npm cache). Benchmark a warm template worktree per lockfile hash for large projects.
- Submodules: `git submodule update --init` in each worktree; reuse the main repo's objects.
- Git LFS: fetch only the LFS objects the task's paths need.
- Large monorepos: sparse checkout limited to the task's read set plus shared packages, when the brief declares them.
- Cleanup: on acceptance or abandonment, remove the worktree after the retention period and run `git worktree prune`. Checkpoint refs survive until the feature lands or the user deletes them.

## Windows specifics

| Issue | Handling |
|---|---|
| Path length | Short worktree root, `core.longpaths`. |
| Antivirus scanning `node_modules` | Offer to add the worktree root to Defender exclusions (admin prompt, optional). |
| Line endings | Respect the repo's `.gitattributes`; otherwise keep `core.autocrlf` as the developer configured it. Workers never rewrite line endings. |
| Case-insensitive file system | The verifier flags two paths differing only by case. |
| Files locked by a running dev server | Stop the attempt's Job Object before removing its worktree. |

## Edge cases

| Situation | Behavior |
|---|---|
| Developer deletes a worktree folder by hand | Recovery sees the missing path, fences the attempt and recreates from the last checkpoint ref. |
| Developer runs `git gc` or `git worktree prune` | Checkpoints are refs, so they survive. Missing worktrees are recreated. |
| Repo moved to another folder | Re-open asks to relocate; worktrees are repaired with `git worktree repair`. |
| Huge repo (millions of files) | Measure worktree creation time during setup; lower parallelism or switch to sparse checkout automatically. |
| Shallow clone | Works for worktrees; blame-based hotspot analysis is skipped. |
| Project uses another VCS (Mercurial, Perforce) | Not supported in v1. Offer **Work on a copy** with Git. |

[Diagram](workspace-git-and-brownfield.svg) · [Editable Mermaid](workspace-git-and-brownfield.mmd) · [Editor coexistence](editor-coexistence.md) · [Brownfield discovery](brownfield-discovery.md) · [Verification and isolation](verification-and-isolation.md) · [Research](research/git-worktrees-and-workspaces.md)
